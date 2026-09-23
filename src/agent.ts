
import { choose, type Decision } from "./model/decide.ts";
import { warmModelEndpoints } from "./model/endpoints.ts";
import { actionSpace } from "./model/space.ts";
import { extractAnswer, fieldContext, fieldText } from "./model/text.ts";
import { makeClient } from "./env.ts";
import { MAX_STEPS } from "./questions.ts";
import { sleep } from "./sleep.ts";
import { StalePage, type BrowserDriver, type JsonValue, type PageState } from "./types.ts";

const FIRST_SETTLE_MS = 1500;

const FIRST_SETTLE_CONTENT_MS = 4000;

const FIRST_SETTLE_PENDING_MS = 12_000;

const FIRST_SETTLE_POLL_MS = 150;

function hasContent(page: PageState): boolean {
  return Boolean(page.text.trim()) || page.actions.some((a) => a.node !== undefined);
}

async function settleFirstObservation(
  browser: BrowserDriver,
  page: PageState,
): Promise<PageState> {
  const idleDeadline = performance.now() + FIRST_SETTLE_MS;
  const contentDeadline = performance.now() + FIRST_SETTLE_CONTENT_MS;
  const pendingDeadline = performance.now() + FIRST_SETTLE_PENDING_MS;
  let latest = page;

  for (;;) {
    const content = hasContent(latest);
    const pending = Boolean(latest.pending_requests) || Boolean(latest.pending_nav);
    const deadline = pending ? (content ? contentDeadline : pendingDeadline) : idleDeadline;

    if ((content && !pending) || performance.now() >= deadline) return latest;

    await sleep(FIRST_SETTLE_POLL_MS);
    latest = await browser.observe();
  }
}

const STEP_KINDS: [RegExp, string[]][] = [
  [/\b(type|enter|fill|upload)\b/i, ["fill"]],
  [/\bdrag\b/i, ["drag"]],
  [/\bpress\b/i, ["press"]],
  [/\bwait for\b/i, ["wait"]],
];

const UNDO_LABEL = /^\s*(remove|delete|clear|deselect|unselect|undo|×|✕|✖|x)\b/i;

function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function atWordBoundary(haystack: string, needle: string): boolean {
  let i = haystack.indexOf(needle);

  while (i !== -1) {
    if (i === 0 || !/[\p{L}\p{N}]/u.test(haystack[i - 1])) return true;
    i = haystack.indexOf(needle, i + 1);
  }

  return false;
}

export interface AgentOptions {
  url: string;
  goal: string | string[];
  open: (url: string) => Promise<BrowserDriver>;
  maxSteps?: number;
}

export interface HistoryEntry {
  step: number;
  action: string;
  kind: string;
  choice: string;
  probability: number;
  confidence: number;
  latency_ms: number;
  text: string | null;
  text_helper: string | null;
  text_latency_ms: number;
  operation: string;
  target: string | null;
  page_changed: boolean | null;
  url: string;
  usage: unknown;
  executed_ms: number;
  elapsed_ms: number;
  pending_requests?: number;
  follow_up?: string;
}

export interface RunResult {
  status: "done" | "blocked" | "error";
  goal: string;
  url: string;
  final_url: string;
  steps: number;
  decisions: number;
  elapsed_ms: number;
  history: HistoryEntry[];
  final_text?: string;
  answer?: string;
  downloads?: string[];
  error?: string;
  blocked_cause?: string;
  final_state?: string;
  answer_note?: string;
}

function stateSummary(page: PageState): string {
  const lines: string[] = [];

  for (const element of actionSpace(page.actions).elements) {
    const state = (["checked", "selected", "expanded", "value", "position"] as const).flatMap((k) =>
      element[k] === undefined || element[k] === "" ? [] : [`${k}=${element[k]}`],
    );

    if (state.length) lines.push(`${String(element.label).slice(0, 60)} ${state.join(" ")}`);
  }

  return lines.join("\n");
}

type Phase = "observe" | "decide" | "act" | "settle" | "done" | "blocked" | "error";

export class Agent {
  readonly goal: string;
  private browser!: BrowserDriver;
  private page!: PageState;
  private decision: Decision | null = null;
  private history: HistoryEntry[] = [];
  private decisions: Decision[] = [];
  private earlyWaits = 0;
  private fingerprints: string[] = [];
  private domRetried = new Set<number>();
  private domDead = new Map<number, number>();
  private domDoc: string | undefined;
  private followUp: { type: string; text: string | null; prevNodes: Set<number> } | null = null;
  private textCalls: any[] = [];
  private pendingText: [unknown, string, { model: string; latency_ms: number }] | null = null;
  private settleContext: {
    action: PageState["actions"][number];
    page: PageState;
    text: string | null;
    decision: Decision;
  } | null = null;
  private settleEntry: HistoryEntry | null = null;
  private probeConsulted = false;
  private fuseConsulted = false;
  private doneConsults = 0;

  private onEvent?: (event: { type: string; [k: string]: JsonValue }) => void;

  private blockedCause: string | null = null;
  private repairHint: string | null = null;
  private staleStreak = 0;
  private lastOperation: string | null = null;
  private phase: Phase = "observe";
  private terminalError: string | null = null;
  private startedAt = 0;
  private maxSteps: number;
  private client = makeClient();
  private openDriver: (url: string) => Promise<BrowserDriver>;
  private startUrl: string;

  private constructor(opts: AgentOptions) {
    const task = Array.isArray(opts.goal) ? opts.goal.join("\n").trim() : opts.goal.trim();

    if (!task) throw new Error("Supply a task");
    this.goal = task;
    this.startUrl = opts.url;
    this.openDriver = opts.open;
    this.maxSteps = opts.maxSteps ?? MAX_STEPS;
  }

  static async start(opts: AgentOptions): Promise<Agent> {
    const agent = new Agent(opts);
    warmModelEndpoints(agent.client.baseURL);
    agent.browser = await agent.openDriver(opts.url);

    try {
      agent.page = await settleFirstObservation(agent.browser, await agent.browser.observe());
    } catch (error) {
      await agent.browser.close();
      throw error;
    }

    agent.phase = "decide";

    return agent;
  }

  private elapsed(): number {
    return Math.round(performance.now() - this.startedAt);
  }

  private get status(): "ready" | "done" | "blocked" | "error" {
    if (this.phase === "done" || this.phase === "blocked" || this.phase === "error") {
      return this.phase;
    }

    return "ready";
  }

  private async observeStep(): Promise<void> {
    this.page = await this.browser.observe();
    this.phase = "decide";
  }

  private async decideStep(): Promise<void> {
    if (!this.startedAt) this.startedAt = performance.now();

    if (this.decisions.length >= this.maxSteps * 2) {
      this.blockedCause = "decision_budget";
      this.phase = "blocked";

      return;
    }

    if (!(await this.browser.fresh(this.page))) {
      throw new StalePage("Page changed since the last observation. Choose again.");
    }

    this.decision = null;

    if (this.followUp) {
      const fu = this.followUp;
      this.followUp = null;

      if (fu.type === "DONE") {
        if (this.prematureDone()) {
          this.phase = "decide";

          return;
        }

        await this.confirmDone(this.page);
        this.phase = "done";

        return;
      }

      const resolved = this.resolveFollowUp(fu);

      if (resolved) {
        this.lastOperation = "FOLLOW_UP";
        this.decision = {
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
        this.phase = "act";

        return;
      }
    }

    const toggle = this.toggleHint();
    const repair = this.repairHint ?? toggle;
    this.repairHint = null;

    const goal = repair ? `${this.goal}\n\n${repair}` : this.goal;

    const dead = new Set(
      [...this.domDead].flatMap(([node, n]) => (n >= 2 ? [node] : [])),
    );

    const live =
      dead.size === 0
        ? this.page
        : {
            ...this.page,
            actions: this.page.actions.filter(
              (a) => !(a.kind === "click" && a.node !== undefined && dead.has(a.node)),
            ),
          };

    const page = toggle
      ? {
          ...live,
          actions: live.actions.filter(
            (a) =>
              a.label !==
              this.history[this.history.length - 1]?.action.replace(/ \(dom\)$/, ""),
          ),
        }
      : live;

    this.decision = await choose(this.client, page, goal, this.history);
    this.decisions.push(this.decision);
    this.reportDecision(page, Boolean(repair));
    this.lastOperation = this.decision.operation;
    this.phase = "act";
  }

  private reportDecision(page: PageState, repaired: boolean): void {
    if (!this.onEvent) return;

    const space = actionSpace(page.actions);
    const decision = this.decision!;

    this.onEvent({
      type: "decision",
      elapsed_ms: this.elapsed(),
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

  private prematureDone(): boolean {
    const acted = this.history.filter((h) => h.operation !== "WAIT");
    const MUTATING = new Set(["click", "context", "select", "fill", "drag", "press"]);
    const unproven = acted.length < 2 || !acted.some((h) => MUTATING.has(h.kind));

    if (this.doneConsults >= 1 || !unproven) return false;

    const steps = this.goal.match(
      /\b(click|type|press|select|activate|enter|fill|upload|submit|check|uncheck|drag|open|go to|navigate|mark|complete|choose|toggle|switch|wait for)\b/gi,
    );

    const skipped = STEP_KINDS.some(
      ([step, kinds]) => step.test(this.goal) && !this.history.some((h) => kinds.includes(h.kind)),
    );

    if ((steps?.length ?? 0) < 2 && !skipped) return false;

    this.doneConsults++;
    this.onEvent?.({
      type: "done_consult",
      elapsed_ms: this.elapsed(),
      consult: this.doneConsults,
      acted: acted.length,
      url: this.page.url,
    });
    this.repairHint =
      "Before claiming DONE, check each part of the goal against the page. If every part is visibly satisfied, claim DONE; if a part remains, act on it.";

    return true;
  }

  private toggleHint(): string | null {
    const tail = this.history.slice(-2);

    const norm = (s: string) => s.replace(/ \(dom\)$/, "");

    if (
      tail.length === 2 &&
      tail[0].kind === "click" &&
      tail[1].kind === "click" &&
      norm(tail[0].action) === norm(tail[1].action) &&
      tail[0].page_changed === true &&
      tail[1].page_changed === true
    ) {
      return `"${norm(tail[1].action)}" is a toggle: clicking it again just re-closes what it opened. The items it revealed are in the table — act on one of them instead.`;
    }

    return null;
  }

  private giveUpHint(page: PageState): string {
    const base =
      "Your recent actions made no progress. Try a different approach — scroll, hover, a different element — or claim BLOCKED.";

    const scrolled = this.history.some((h) => h.kind === "scroll");

    if (!scrolled && (page.scroll?.height ?? 0) > page.h * 1.1) {
      return base + " The page extends below the visible area and you have not scrolled — the goal's content is likely below the fold.";
    }

    return base;
  }

  private resolveFollowUp(fu: {
    type: string;
    text: string | null;
    prevNodes: Set<number>;
  }): string | null {
    if (fu.type === "PRESS_ENTER") {
      return this.page.actions.find((a) => a.id === "press_enter")?.id ?? null;
    }

    if (fu.type === "CLICK_MATCH_TYPED") {
      const appeared = this.page.actions.filter(
        (a) =>
          a.kind === "click" &&
          a.node !== undefined &&
          !fu.prevNodes.has(a.node) &&
          !UNDO_LABEL.test(a.label),
      );

      if (fu.text && fu.text.length >= 3) {
        const tokens = fold(fu.text)
          .split(/[^\p{L}\p{N}]+/u)
          .filter((t) => t.length >= 3);

        const matched = appeared.find((a) =>
          tokens.some((t) => atWordBoundary(fold(a.label), t)),
        );

        if (matched) return matched.id;
      }

      if (appeared.length === 1) return appeared[0].id;
    }

    return null;
  }

  private async confirmDone(page: PageState): Promise<void> {
    if (page.pending_nav || this.browser.pendingNav?.()) {
      const deadline = Date.now() + 2500;

      while (Date.now() < deadline && this.browser.pendingNav?.()) {
        if (!(await this.browser.fresh(page, undefined, "structure"))) {
          throw new StalePage("Navigation committed while confirming DONE. Choose again.");
        }

        await sleep(120);
      }

      if (!(await this.browser.fresh(page, undefined, "structure"))) {
        throw new StalePage("Page changed while confirming DONE. Choose again.");
      }
    }

    const window_ = (page.pending_requests ?? 0) > 0 ? 1500 : 400;

    await (this.browser.settle?.(window_) ?? sleep(window_));

    if (!(await this.browser.fresh(page, undefined, "structure"))) {
      throw new StalePage("Page changed while confirming DONE. Choose again.");
    }
  }

  private async actStep(): Promise<void> {
    const decision = this.decision;
    const page = this.page;

    if (!decision) throw new Error("Choose before acting");
    this.decision = null;
    const selected = decision.choice;

    if (selected === "DONE" || selected === "BLOCKED") {
      if (!(await this.browser.fresh(page, undefined, "structure"))) {
        throw new StalePage("Page changed since the decision. Choose again.");
      }

      if (selected === "BLOCKED" && this.earlyWaits < 3 && !this.probeConsulted) {
        this.earlyWaits++;
        const entry = this.waitEntry("Wait for the page to update", page);
        const started = Date.now();
        let deadline = started + 4_000;

        for (;;) {
          await sleep(800);
          this.page = await this.browser.observe();

          if ((this.page.pending_requests ?? 0) > 0) deadline = started + 10_000;

          const changed = this.page.fingerprint !== page.fingerprint;

          if (changed || Date.now() >= deadline) {
            entry.page_changed = changed;
            entry.url = this.page.url;
            entry.elapsed_ms = this.elapsed();

            if (changed) {
              this.phase = "decide";

              return;
            }

            this.probeConsulted = true;
            this.repairHint = this.giveUpHint(page);
            this.phase = "decide";

            return;
          }
        }
      }

      if (selected === "DONE") {
        if (this.prematureDone()) {
          this.phase = "decide";

          return;
        }

        await this.confirmDone(page);
      }

      if (selected === "BLOCKED") this.blockedCause = "model_claim";

      this.phase = selected === "DONE" ? "done" : "blocked";

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

    if (this.history.length >= this.maxSteps) {
      this.blockedCause = "step_budget";
      this.phase = "blocked";

      return;
    }

    let text: string | null = null;
    let helper: { model: string; latency_ms: number; usage?: unknown } | null = null;

    if (action.kind === "fill") {
      if (!(await this.browser.fresh(page, undefined, "page"))) {
        throw new StalePage("Page changed before text generation. Choose again.");
      }

      const context = fieldContext(this.goal, action, page, this.history);

      if (this.pendingText && JSON.stringify(this.pendingText[0]) === JSON.stringify(context)) {
        [, text, helper] = this.pendingText;
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
        this.pendingText = [context, text, helper];
        this.textCalls.push({ ...helper, field: action.label, value: text });
      }
    }

    await this.browser.act(action, page, text);
    this.pendingText = null;
    this.earlyWaits = 0;
    this.probeConsulted = false;

    const entry: HistoryEntry = {
      step: this.history.length + 1,
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
      executed_ms: this.elapsed(),
      elapsed_ms: this.elapsed(),
    };

    this.history.push(entry);
    this.staleStreak = 0;
    this.phase = "settle";
    this.settleContext = { action, page, text, decision };
    this.settleEntry = entry;
  }

  private async settleStep(): Promise<void> {
    const ctx = this.settleContext;
    const entry = this.settleEntry;

    if (!ctx || !entry) throw new Error("Settle without an executed action");
    const { action, page, text, decision } = ctx;
    this.settleContext = null;
    this.settleEntry = null;

    if (["click", "context", "select", "press"].includes(action.kind)) {
      const navDeadline = Date.now() + 2500;

      for (let i = 0; i < 2 && !this.browser.pendingNav?.(); i++) await sleep(80);

      while (this.browser.pendingNav?.() && Date.now() < navDeadline) await sleep(120);
    }

    this.page = await this.browser.observe();
    entry.page_changed = this.page.fingerprint !== page.fingerprint || this.page.dialog !== undefined;

    const doc = String(Array.isArray(page.page_key) ? page.page_key[0] : page.page_key);

    if (this.domDoc !== doc) {
      this.domDoc = doc;
      this.domRetried.clear();
      this.domDead.clear();
    }

    if (
      entry.page_changed === false &&
      (action.kind === "click" ||
        action.kind === "hover" ||
        action.kind === "drag" ||
        action.kind === "fill") &&
      action.node !== undefined &&
      !this.domRetried.has(action.node)
    ) {
      this.domRetried.add(action.node);

      try {
        await this.browser.domClick(action, page, text);
        const retried = await this.browser.observe();

        if (retried.fingerprint !== page.fingerprint) {
          this.page = retried;
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
      this.domDead.set(action.node, (this.domDead.get(action.node) ?? 0) + 1);
    }

    const REVEAL_KINDS = new Set(["scroll", "wait", "hover", "back", "forward"]);

    if (
      decision.follow_up &&
      decision.follow_up !== "NONE" &&
      !(decision.follow_up === "DONE_AFTER" && REVEAL_KINDS.has(action.kind))
    ) {
      this.followUp = {
        type: decision.follow_up === "DONE_AFTER" ? "DONE" : decision.follow_up,
        text,
        prevNodes: new Set(
          page.actions.flatMap((a) => (a.node === undefined ? [] : [a.node])),
        ),
      };
    }

    entry.pending_requests = this.page.pending_requests ?? 0;
    entry.url = this.page.url;
    entry.elapsed_ms = this.elapsed();
    this.fingerprints.push(this.page.fingerprint);

    const repeated = this.history.slice(-3);

    let idleMs = 0;
    const last = this.history[this.history.length - 1];

    for (let i = this.history.length - 1; i >= 0; i--) {
      const h = this.history[i];

      if (h.page_changed !== false || (h.pending_requests ?? 0) > 0) break;
      idleMs = (last?.elapsed_ms ?? 0) - h.elapsed_ms;
    }

    const trail = this.fingerprints
      .slice(-14)
      .filter((f, i, a) => i === 0 || f !== a[i - 1]);

    const seen = trail.filter((f) => f === this.page.fingerprint).length;

    const fused =
      (repeated.length === 3 &&
        repeated.every((h) => h.page_changed === false && h.kind !== "wait")) ||
      idleMs >= 10_000 ||
      seen >= 4 ||
      this.cycling();

    if (!fused) {
      this.fuseConsulted = false;
      this.phase = "decide";
    } else if (!this.fuseConsulted) {
      this.fuseConsulted = true;
      this.repairHint =
        "Your recent actions made no progress. Try a different approach — scroll, hover, a different element — or claim BLOCKED.";
      this.phase = "decide";
    } else {
      this.blockedCause = "no_progress";
      this.phase = "blocked";
    }
  }

  private cycling(): boolean {
    const f = this.fingerprints;
    const n = f.length;

    return (
      (n >= 6 && f[n - 1] === f[n - 3] && f[n - 3] === f[n - 5] &&
        f[n - 2] === f[n - 4] && f[n - 4] === f[n - 6] && f[n - 1] !== f[n - 2]) ||
      (n >= 6 && f[n - 1] === f[n - 4] && f[n - 4] !== f[n - 2] &&
        f[n - 2] === f[n - 5] && f[n - 3] === f[n - 6] && f[n - 1] !== f[n - 3])
    );
  }

  private waitEntry(action: string, page: PageState): HistoryEntry {
    const entry: HistoryEntry = {
      step: this.history.length + 1,
      action,
      kind: "wait",
      choice: "wait",
      probability: 0,
      confidence: 0,
      latency_ms: 0,
      text: null,
      text_helper: null,
      text_latency_ms: 0,
      operation: "WAIT",
      target: null,
      page_changed: null,
      url: page.url,
      usage: null,
      executed_ms: this.elapsed(),
      elapsed_ms: this.elapsed(),
    };

    this.history.push(entry);
    this.staleStreak = 0;

    return entry;
  }

  private deadPageReason(page: PageState): string | null {
    if (page.actions.some((a) => a.node !== undefined)) return null;

    if (page.url.startsWith("chrome-error://")) {
      return `Browser error page: ${page.title || page.url}`;
    }

    if (page.challenge) return "Bot challenge with no solvable controls";

    return null;
  }

  async run(onEvent?: (event: { type: string; [k: string]: JsonValue }) => void): Promise<RunResult> {
    let emitted = 0;
    this.onEvent = onEvent;

    if (!this.startedAt) this.startedAt = performance.now();
    const dead = this.deadPageReason(this.page);

    if (dead) {
      this.blockedCause = "dead_page";
      this.phase = "blocked";
      this.terminalError = dead;
      onEvent?.({
        type: "step",
        status: this.status,
        phase: this.phase,
        elapsed_ms: this.elapsed(),
        operation: "BLOCKED",
        reason: dead,
        url: this.page.url,
      });
    }

    while (
      this.phase !== "done" &&
      this.phase !== "blocked" &&
      this.phase !== "error"
    ) {
      try {
        switch (this.phase) {
          case "observe":
            await this.observeStep();
            break;
          case "decide":
            await this.decideStep();
            break;
          case "act":
            await this.actStep();
            break;
          case "settle":
            await this.settleStep();
            break;
        }
      } catch (error) {
        if (error instanceof StalePage) {
          this.decision = null;
          this.staleStreak++;

          if (this.staleStreak >= 8) {
            if (this.fuseConsulted) {
              this.blockedCause = "stale_storm";
              this.phase = "blocked";
            } else {
              this.fuseConsulted = true;
              this.repairHint = this.giveUpHint(this.page);
              this.phase = "observe";
            }
          } else {
            this.phase = "observe";
          }

          onEvent?.({
            type: "stale",
            status: this.status,
            phase: this.phase,
            elapsed_ms: this.elapsed(),
            operation: this.lastOperation,
            reason: error.message,
            url: this.page.url,
          });
        } else {
          throw error;
        }
      }

      if (this.history.length !== emitted || this.status !== "ready") {
        emitted = this.history.length;
        const last = this.history[this.history.length - 1];
        onEvent?.({
          type: "step",
          status: this.status,
          phase: this.phase,
          elapsed_ms: this.elapsed(),
          action: last?.action,
          kind: last?.kind,
          operation: this.lastOperation,
          url: this.page.url,
        });
      }
    }

    if (this.status !== "ready" && !this.terminalError) {
      try {
        for (let i = 0; i < 8; i++) {
          const latest = await this.browser.observe();

          const settled =
            latest.url === this.page.url &&
            latest.title === this.page.title &&
            Boolean(latest.text);

          this.page = latest;

          if (settled) break;

          await (this.browser.settle?.(350, 120) ?? sleep(350));
        }
      } catch {
      }
    }

    let answer: string | undefined;
    let answerNote: string | undefined;

    if (this.status !== "done") {
      answerNote = "run did not reach done";
    } else if (!Agent.goalAsksForAnswer(this.goal)) {
      answerNote = "goal does not ask for an answer";
    } else {
      try {
        const extracted = await extractAnswer(this.goal, this.page);

        answer = extracted.answer ?? undefined;

        if (answer === undefined) answerNote = "helper read the page and returned no answer";
      } catch (error) {
        answerNote = `helper failed: ${String(error).slice(0, 160)}`;
      }
    }

    const result: RunResult = {
      status: this.status === "ready" ? "blocked" : this.status,
      goal: this.goal,
      url: this.startUrl,
      final_url: this.page.url,
      steps: this.history.length,
      decisions: this.decisions.length,
      elapsed_ms: this.elapsed(),
      history: this.history,
      final_text: this.page.text,
    };

    if (answer !== undefined) result.answer = answer;
    else if (answerNote) result.answer_note = answerNote;

    if (this.terminalError) result.error = this.terminalError;

    if (this.blockedCause) result.blocked_cause = this.blockedCause;

    const state = stateSummary(this.page);

    if (state) result.final_state = state;

    if (this.page.downloads?.length) result.downloads = this.page.downloads;

    return result;
  }

  private static goalAsksForAnswer(goal: string): boolean {
    return /\?|(?:^|[.;:!,]\s*|\b(?:tell me|find out|report)\s+)(what|which|who|whom|whose|when|where|why|how (many|much|old|tall|long|far))\b|(?:^|[.;:!,]\s*|\b(?:and|then)\s+)(name|list|report|tell me|find out|extract|read)\b[^\n]{0,80}\b(price|version|date|number|name|title|count|population|email|phone|author|score|address|link|url|size|status|message|text|error|reason|value|winner|top|latest|first|total)s?\b/i.test(
      goal,
    );
  }

  async close(): Promise<void> {
    await this.browser?.close();
  }

  snapshot() {
    return {
      status: this.status,
      phase: this.phase,
      goal: this.goal,
      page: this.page,
      history: this.history,
      decisions: this.decisions,
      text_calls: this.textCalls,
      elements: this.page ? actionSpace(this.page.actions).elements : [],
    };
  }
}
