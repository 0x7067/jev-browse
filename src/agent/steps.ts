import type { Agent } from "../agent.ts";
import { choose } from "../model/decide.ts";
import { actionSpace } from "../model/space.ts";
import { fieldContext, fieldText } from "../model/text.ts";
import { StalePage, type HistoryEntry, type PageState } from "../types.ts";
import { sleep } from "../sleep.ts";
import { blockedProbe } from "./consults.ts";
import { fusedNow } from "./fuses.ts";

export async function observeStep(a: Agent): Promise<void> {
    a.page = await a.browser.observe();
    a.phase = "decide";
  }

export async function decideStep(a: Agent): Promise<void> {
    if (!a.startedAt) a.startedAt = performance.now();

    if (a.decisions.length >= a.maxSteps * 2) {
      a.blockedCause = "decision_budget";
      a.phase = "blocked";

      return;
    }

    if (!(await a.browser.fresh(a.page))) {
      throw new StalePage("Page changed since the last observation. Choose again.");
    }

    a.decision = null;

    if (a.followUp) {
      const fu = a.followUp;
      a.followUp = null;

      if (fu.type === "DONE") {
        if (a.prematureDone()) {
          a.phase = "decide";

          return;
        }

        await a.confirmDone(a.page);
        a.phase = "done";

        return;
      }

      const resolved = a.resolveFollowUp(fu);

      if (resolved) {
        a.lastOperation = "FOLLOW_UP";
        a.decision = {
          choice: resolved,
          operation: "FOLLOW_UP",
          target: null,
          confidence: 1,
          probabilities: { [resolved]: 1 },
          operation_probabilities: {},
          target_probabilities: {},
          target_confidence: null,
          raw_answers: null,
          model: "follow-up",
          usage: null,
          latency_ms: 0,
        };
        a.phase = "act";

        return;
      }
    }

    const toggle = a.toggleHint();
    const repair = a.repairHint ?? toggle;
    a.repairHint = null;

    const goal = repair ? `${a.goal}\n\n${repair}` : a.goal;

    const dead = new Set(
      [...a.domDead].flatMap(([node, n]) => (n >= 2 ? [node] : [])),
    );

    const live =
      dead.size === 0
        ? a.page
        : {
            ...a.page,
            actions: a.page.actions.filter(
              (a) => !(a.kind === "click" && a.node !== undefined && dead.has(a.node)),
            ),
          };

    const page = toggle
      ? {
          ...live,
          actions: live.actions.filter(
            (el) =>
              el.label !==
              a.history[a.history.length - 1]?.action.replace(/ \(dom\)$/, ""),
          ),
        }
      : live;

    a.decision = await choose(a.client, page, goal, a.history);
    a.decisions.push(a.decision);
    reportDecision(a, page, Boolean(repair));
    a.lastOperation = a.decision.operation;
    a.phase = "act";
  }

export function reportDecision(a: Agent, page: PageState, repaired: boolean): void {
    if (!a.onEvent) return;

    const space = actionSpace(page.actions);
    const decision = a.decision!;

    a.onEvent({
      type: "decision",
      elapsed_ms: a.elapsed(),
      choice: decision.choice,
      operation: decision.operation,
      confidence: decision.confidence,
      follow_up: decision.follow_up ?? null,
      offered_elements: space.elements.length,
      offered_controls: Object.keys(space.controls).length,
      offered_operations: Object.keys(space.targets).length,
      repaired,
      url: page.url,
    });
  }

export async function actStep(a: Agent): Promise<void> {
    const decision = a.decision;
    const page = a.page;

    if (!decision) throw new Error("Choose before acting");
    a.decision = null;
    const selected = decision.choice;

    if (selected === "DONE" || selected === "BLOCKED") {
      if (!(await a.browser.fresh(page, undefined, "structure"))) {
        throw new StalePage("Page changed since the decision. Choose again.");
      }

      if (selected === "BLOCKED" && a.earlyWaits < 3 && !a.probeConsulted) {
        a.earlyWaits++;

        const outcome = await blockedProbe(
          a.browser,
          page,
          a.history,
          () => a.elapsed(),
          (action, p) => a.waitEntry(action, p),
        );

        a.page = outcome.latest;

        if (outcome.changed) {
          a.phase = "decide";

          return;
        }

        a.probeConsulted = true;
        a.repairHint = outcome.hint;
        a.phase = "decide";

        return;
      }

      if (selected === "DONE") {
        if (a.prematureDone()) {
          a.phase = "decide";

          return;
        }

        await a.confirmDone(page);
      }

      if (selected === "BLOCKED") a.blockedCause = "model_claim";

      a.phase = selected === "DONE" ? "done" : "blocked";

      return;
    }

    let action = page.actions.find((a) => a.id === selected);

    if (!action) throw new Error(`Decision selected unknown action ${selected}`);

    if (decision.operation === "CONTEXT_CLICK") {
      action = { ...action, kind: "context" };
    }

    if (decision.operation === "DRAG" && decision.target2) {
      const dest = page.actions.find((a) => a.id === decision.target2);

      if (!dest?.node) throw new Error(`Drag destination ${decision.target2} is not an element`);

      if (dest.node === action.node) {
        throw new StalePage("Drag destination is the source itself. Choose again.");
      }

      action = { ...action, kind: "drag", dragTo: dest.node };
    }

    if (a.history.length >= a.maxSteps) {
      a.blockedCause = "step_budget";
      a.phase = "blocked";

      return;
    }

    let text: string | null = null;
    let helper: { model: string; latency_ms: number; usage?: unknown } | null = null;

    if (action.kind === "fill") {
      if (!(await a.browser.fresh(page, undefined, "page"))) {
        throw new StalePage("Page changed before text generation. Choose again.");
      }

      const context = fieldContext(a.goal, action, page, a.history);

      if (a.pendingText && JSON.stringify(a.pendingText[0]) === JSON.stringify(context)) {
        [, text, helper] = a.pendingText;
      } else {
        let generated;

        for (let attempt = 0; ; attempt++) {
          try {
            generated = await fieldText(context);
            break;
          } catch (error) {
            if (!String(error).includes("no valid field value") || attempt >= 2) throw error;
          }
        }

        text = generated.text;
        helper = generated.helper;
        a.pendingText = [context, text, helper];
        a.textCalls.push({ ...helper, field: action.label, value: text });
      }
    }

    await a.browser.act(action, page, text);
    a.pendingText = null;
    a.earlyWaits = 0;
    a.probeConsulted = false;

    const entry: HistoryEntry = {
      step: a.history.length + 1,
      action: action.label,
      kind: action.kind,
      choice: selected,
      probability: decision.probabilities[selected],
      confidence: decision.confidence,
      latency_ms: decision.latency_ms,
      text,
      text_helper: helper?.model ?? null,
      text_latency_ms: helper?.latency_ms ?? 0,
      operation: decision.operation,
      target: decision.target,
      follow_up: decision.follow_up,
      page_changed: null,
      url: page.url,
      usage: decision.usage,
      executed_ms: a.elapsed(),
      elapsed_ms: a.elapsed(),
    };

    a.history.push(entry);
    a.staleStreak = 0;
    a.phase = "settle";
    a.settleContext = { action, page, text, decision };
    a.settleEntry = entry;
  }

export async function settleStep(a: Agent): Promise<void> {
    const ctx = a.settleContext;
    const entry = a.settleEntry;

    if (!ctx || !entry) throw new Error("Settle without an executed action");
    const { action, page, text, decision } = ctx;
    a.settleContext = null;
    a.settleEntry = null;

    if (["click", "context", "select", "press"].includes(action.kind)) {
      const navDeadline = Date.now() + 2500;

      for (let i = 0; i < 2 && !a.browser.pendingNav?.(); i++) await sleep(80);

      while (a.browser.pendingNav?.() && Date.now() < navDeadline) await sleep(120);
    }

    a.page = await a.browser.observe();
    entry.page_changed = a.page.fingerprint !== page.fingerprint || a.page.dialog !== undefined;

    const doc = String(Array.isArray(page.page_key) ? page.page_key[0] : page.page_key);

    if (a.domDoc !== doc) {
      a.domDoc = doc;
      a.domRetried.clear();
      a.domDead.clear();
    }

    if (
      entry.page_changed === false &&
      (action.kind === "click" ||
        action.kind === "hover" ||
        action.kind === "drag" ||
        action.kind === "fill") &&
      action.node !== undefined &&
      !a.domRetried.has(action.node)
    ) {
      a.domRetried.add(action.node);

      try {
        await a.browser.domClick(action, page, text);
        const retried = await a.browser.observe();

        if (retried.fingerprint !== page.fingerprint) {
          a.page = retried;
          entry.page_changed = true;
          entry.action = `${action.label} (dom)`;
        }
      } catch {
      }
    }

    if (
      entry.page_changed === false &&
      action.kind === "click" &&
      action.node !== undefined
    ) {
      a.domDead.set(action.node, (a.domDead.get(action.node) ?? 0) + 1);
    }

    const REVEAL_KINDS = new Set(["scroll", "wait", "hover", "back", "forward"]);

    if (
      decision.follow_up &&
      decision.follow_up !== "NONE" &&
      !(decision.follow_up === "DONE_AFTER" && REVEAL_KINDS.has(action.kind))
    ) {
      a.followUp = {
        type: decision.follow_up === "DONE_AFTER" ? "DONE" : decision.follow_up,
        text,
        prevNodes: new Set(
          page.actions.flatMap((a) => (a.node === undefined ? [] : [a.node])),
        ),
      };
    }

    entry.pending_requests = a.page.pending_requests ?? 0;
    entry.url = a.page.url;
    entry.elapsed_ms = a.elapsed();
    a.fingerprints.push(a.page.fingerprint);

    const fused = fusedNow(a.history, a.fingerprints, a.page.fingerprint);

    if (!fused) {
      a.fuseConsulted = false;
      a.phase = "decide";
    } else if (!a.fuseConsulted) {
      a.fuseConsulted = true;
      a.repairHint =
        "Your recent actions made no progress. Try a different approach — scroll, hover, a different element — or claim BLOCKED.";
      a.phase = "decide";
    } else {
      a.blockedCause = "no_progress";
      a.phase = "blocked";
    }
  }

