/**
 * The complete agent loop. Typed choices, observable state, bounded execution.
 * Driver-agnostic port of jev-ultrafast's agent.py: predict (one systemOne
 * call) -> act (guarded mutation) -> observe, until DONE/BLOCKED or budget.
 *
 * The loop is an explicit phase machine. States:
 *
 *   observe  → refresh the page snapshot after staleness or a give-up probe
 *   decide   → produce a decision: model call or resolved follow-up
 *   act      → execute the decision (guarded mutation, DONE/BLOCKED claims)
 *   settle   → post-action observation, dom fallback, stalemate fuses
 *   done | blocked | error → terminal
 *
 * Transitions:
 *   observe → decide          (fresh snapshot in hand)
 *   decide  → act             (decision made — model or synthetic follow-up)
 *   decide  → done            (DONE_AFTER follow-up survived its stability check)
 *   act     → settle          (action executed)
 *   act     → observe         (BLOCKED claim probed; StalePage anywhere)
 *   act     → done | blocked  (claim confirmed after probes/stability)
 *   settle  → decide          (page still converging)
 *   settle  → blocked         (a stalemate fuse fired)
 *   any     → error           (fatal: budgets, dead helper, unknown action)
 */

import { MAX_STEPS } from "./questions.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

import { choose, type Decision } from "./model/decide.ts";
import { warmModelEndpoints } from "./model/endpoints.ts";
import { actionSpace } from "./model/space.ts";
import { fieldContext, fieldText } from "./model/text.ts";
import { makeClient } from "./env.ts";
import { StalePage, type BrowserDriver, type JsonValue, type PageState } from "./types.ts";

export interface AgentOptions {
  url: string;
  goal: string | string[];
  /** Browser engine factory. */
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
  error?: string;
}

/** Non-terminal phases; terminal status is reported as done/blocked/error. */
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
  private followUp: { type: string; text: string | null; prevIds: Set<string> } | null = null;
  private textCalls: any[] = [];
  private pendingText: [unknown, string, { model: string; latency_ms: number }] | null = null;
  private settleContext: {
    action: PageState["actions"][number];
    page: PageState;
    text: string | null;
    decision: Decision;
  } | null = null;
  private settleEntry: HistoryEntry | null = null;
  private stuckRetried = false;
  private lastOperation: string | null = null;
  private phase: Phase = "observe";
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
    warmModelEndpoints();
    const agent = new Agent(opts);
    agent.browser = await agent.openDriver(opts.url);

    try {
      agent.page = await agent.browser.observe();
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

  /** Terminal status for results and adapters. */
  private get status(): "ready" | "done" | "blocked" | "error" {
    if (this.phase === "done" || this.phase === "blocked" || this.phase === "error") {
      return this.phase;
    }

    return "ready";
  }

  // --- observe -------------------------------------------------------------

  private async observeStep(): Promise<void> {
    this.page = await this.browser.observe();
    this.phase = "decide";
  }

  // --- decide --------------------------------------------------------------

  private async decideStep(): Promise<void> {
    if (!this.startedAt) this.startedAt = performance.now();

    if (!(await this.browser.fresh(this.page))) {
      this.phase = "observe";

      return;
    }

    this.decision = null;

    if (this.decisions.length >= this.maxSteps * 2) {
      throw new Error("Reached the model-call budget");
    }

    // A confident speculation skips the decision call entirely: resolve the
    // follow-up against the post-action state into a synthetic decision, and
    // let the normal act path execute it (freshness, entries, fuses intact).
    if (this.followUp) {
      const fu = this.followUp;
      this.followUp = null;

      if (fu.type === "DONE") {
        await sleep(400);

        if (await this.browser.fresh(this.page)) {
          this.phase = "done";

          return;
        }
      } else {
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
    }

    // A fuse asked for one repair consult: say it plainly. The history
    // already shows the failed pattern; the model needs the nudge to try a
    // different approach instead of repeating it once more.
    const goal = this.stuckRetried
      ? `${this.goal}\n\nYour recent actions made no progress. Try a different approach — scroll, hover, a different element — or claim BLOCKED.`
      : this.goal;

    this.decision = await choose(this.client, this.page, goal, this.history);
    this.decisions.push(this.decision);
    this.lastOperation = this.decision.operation;
    this.phase = "act";
  }

  /** Map a speculative follow-up to an action id on the current page. */
  private resolveFollowUp(fu: {
    type: string;
    text: string | null;
    prevIds: Set<string>;
  }): string | null {
    if (fu.type === "PRESS_ENTER") {
      return this.page.actions.find((a) => a.id === "press_enter")?.id ?? null;
    }

    if (fu.type === "CLICK_MATCH_TYPED") {
      // Autocomplete suggestions are the elements that appeared in response
      // to typing — ids absent from the pre-typed set. Prefer a suggestion
      // whose label matches the typed text; without text, resolve only an
      // unambiguous single newcomer — page chrome appearing mid-typing is
      // not the suggestion.
      const appeared = this.page.actions.filter(
        (a) => a.kind === "click" && a.node !== undefined && !fu.prevIds.has(a.id),
      );

      if (fu.text) {
        const tokens = fu.text
          .toLowerCase()
          .split(/[^\p{L}\p{N}]+/u)
          .filter((t) => t.length >= 3);

        const matched = appeared.find((a) =>
          tokens.some((t) => a.label.toLowerCase().includes(t)),
        );

        if (matched) return matched.id;

        const labeled = this.page.actions.find(
          (a) => a.kind === "click" && a.label.toLowerCase().includes(fu.text!.toLowerCase()),
        );

        if (labeled) return labeled.id;
      }

      if (appeared.length === 1) return appeared[0].id;
    }

    return null;
  }

  // --- act -----------------------------------------------------------------

  private async actStep(): Promise<void> {
    const decision = this.decision;
    const page = this.page;

    if (!decision) throw new Error("Choose before acting");
    // Consume once, before any mutation or model call. A retry cannot double-click.
    this.decision = null;
    const selected = decision.choice;

    if (selected === "DONE" || selected === "BLOCKED") {
      if (!(await this.browser.fresh(page))) {
        throw new StalePage("Page changed since the decision. Choose again.");
      }

      // Any BLOCKED claim is a give-up worth second-guessing: wait, re-observe,
      // ask again. A premature blocked ends the task; a probe costs ~1s.
      // Bounded by earlyWaits; mutating retries stay forbidden.
      if (selected === "BLOCKED" && this.earlyWaits < 3) {
        this.earlyWaits++;
        // A give-up claim is a stuck signal too — the re-decide carries the
        // repair hint so it tries a different approach instead of repeating
        // the same claim.
        this.stuckRetried = true;
        const entry = this.waitEntry("Wait for the page to update", page);
        await sleep(700);
        this.page = await this.browser.observe();
        entry.page_changed = this.page.fingerprint !== page.fingerprint;
        entry.url = this.page.url;
        entry.elapsed_ms = this.elapsed();
        this.phase = "decide";

        return;
      }

      if (selected === "DONE") {
        // A DONE claim while a click-triggered navigation is still in flight
        // verifies the page the click just left. Give the commit a short
        // window to land — once it does, fresh() fails and the machine
        // re-decides on the navigated page.
        if (page.pending_nav || this.browser.pendingNav?.()) {
          const navDeadline = Date.now() + 2500;

          while (Date.now() < navDeadline) {
            if (!(await this.browser.fresh(page))) {
              throw new StalePage("Navigation committed while confirming DONE. Choose again.");
            }

            await sleep(120);
          }
        }

        // A DONE claim on a just-clicked link can land before the navigation
        // it triggered starts. Require the page to stay put across a short
        // window, not just one freshness check.
        await sleep(400);

        if (!(await this.browser.fresh(page))) {
          throw new StalePage("Page changed while confirming DONE. Choose again.");
        }
      }

      this.phase = selected === "DONE" ? "done" : "blocked";

      return;
    }

    let action = page.actions.find((a) => a.id === selected);

    if (!action) throw new Error(`Decision selected unknown action ${selected}`);

    // CONTEXT_CLICK shares the click candidate set — re-tag the resolved
    // element so the driver dispatches a right-button press, not a click.
    if (decision.operation === "CONTEXT_CLICK") {
      action = { ...action, kind: "context" };
    }

    // DRAG resolves two ends: the choice is the source, target2 the
    // destination. Re-tag with the destination node for the driver.
    if (decision.operation === "DRAG" && decision.target2) {
      const dest = page.actions.find((a) => a.id === decision.target2);

      if (!dest?.node) throw new Error(`Drag destination ${decision.target2} is not an element`);
      action = { ...action, kind: "drag", dragTo: dest.node };
    }

    if (this.history.length >= this.maxSteps) {
      this.phase = "blocked";
      throw new Error(`Stopped at the ${this.maxSteps}-action budget`);
    }

    let text: string | null = null;
    let helper: { model: string; latency_ms: number; usage?: unknown } | null = null;

    if (action.kind === "fill") {
      if (!(await this.browser.fresh(page))) {
        throw new StalePage("Page changed before text generation. Choose again.");
      }

      const context = fieldContext(this.goal, action, page, this.history);

      if (this.pendingText && JSON.stringify(this.pendingText[0]) === JSON.stringify(context)) {
        [, text, helper] = this.pendingText;
      } else {
        let generated;

        // An empty helper answer hasn't typed anything — fresh asks are safe.
        for (let attempt = 0; ; attempt++) {
          try {
            generated = await fieldText(context);
            break;
          } catch (error) {
            if (!String(error).includes("no valid field value") || attempt >= 2) throw error;
          }
        }

        // Fail fast: an empty helper answer means nothing was typed; looping
        // on TYPE_TEXT just burns the action budget.
        if (!generated.text) {
          throw new Error("Text helper returned no valid field value; nothing typed.");
        }

        text = generated.text;
        helper = generated.helper;
        this.pendingText = [context, text, helper];
        this.textCalls.push({ ...helper, field: action.label, value: text });
      }
    }

    // act() re-checks freshness immediately before input, after text generation.
    await this.browser.act(action, page, text);
    this.pendingText = null;
    this.earlyWaits = 0;

    // Record execution before observing; a stale post-action observation must
    // not erase the action.
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
    this.phase = "settle";
    this.settleContext = { action, page, text, decision };
    this.settleEntry = entry;
  }

  // --- settle --------------------------------------------------------------

  private async settleStep(): Promise<void> {
    const ctx = this.settleContext;
    const entry = this.settleEntry;

    if (!ctx || !entry) throw new Error("Settle without an executed action");
    const { action, page, text, decision } = ctx;
    this.settleContext = null;
    this.settleEntry = null;

    this.page = await this.browser.observe();
    entry.page_changed = this.page.fingerprint !== page.fingerprint;

    // Trusted input can silently deliver nothing — seen after a canceled
    // provisional navigation leaves the renderer's input pipeline dead.
    // Before counting a no-change strike, retry once via in-page event
    // synthesis; an element that does nothing on click is unaffected.
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
        // StalePage or a dead element — the no-change path below stands.
      }
    }

    if (decision.follow_up && decision.follow_up !== "NONE") {
      this.followUp = {
        type: decision.follow_up === "DONE_AFTER" ? "DONE" : decision.follow_up,
        text,
        prevIds: new Set(page.actions.map((a) => a.id)),
      };
    }

    entry.pending_requests = this.page.pending_requests ?? 0;
    entry.url = this.page.url;
    entry.elapsed_ms = this.elapsed();
    this.fingerprints.push(this.page.fingerprint);

    const repeated = this.history.slice(-3);

    // Stalemate bounds: quick give-up on repeated no-op actions; a
    // time-based fuse for idle no-change streaks (a client-side timer is
    // indistinguishable from a stuck page — only patience and a deadline
    // separate them); and cycle detection for back-and-forth loops that
    // evade both. In-flight requests reset the streak: the page is working.
    let idleMs = 0;
    const last = this.history[this.history.length - 1];

    for (let i = this.history.length - 1; i >= 0; i--) {
      const h = this.history[i];

      if (h.page_changed !== false || (h.pending_requests ?? 0) > 0) break;
      idleMs = (last?.elapsed_ms ?? 0) - h.elapsed_ms;
    }

    // Revisit fuse: wandering loops need not be periodic — a page seen 4+
    // times in the last 14 distinct observations means the agent isn't
    // converging. Consecutive identical fingerprints collapse to one, so
    // waits during a legit client-side timer don't count as revisits.
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
      this.stuckRetried = false;
      this.phase = "decide";
    } else if (!this.stuckRetried) {
      // Repair before verdict: one consult with the stuck signal spelled out.
      this.stuckRetried = true;
      this.phase = "decide";
    } else {
      this.phase = "blocked";
    }
  }

  /** True when the recent fingerprint trail is a short cycle repeated whole. */
  private cycling(): boolean {
    const f = this.fingerprints;
    const n = f.length;

    // Period 2 needs the pair thrice (x,y,x,y,x,y); period 3 twice (x,y,z,x,y,z).
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

    return entry;
  }

  async run(onEvent?: (event: { type: string; [k: string]: JsonValue }) => void): Promise<RunResult> {
    let emitted = 0;

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
          // Re-observe and let the machine choose again on the fresh page.
          this.decision = null;
          this.phase = "observe";
          onEvent?.({
            type: "stale",
            status: this.status,
            phase: this.phase,
            elapsed_ms: this.elapsed(),
            operation: this.lastOperation,
            url: this.page.url,
          });
        } else {
          throw error;
        }
      }

      // One event per recorded action (or terminal transition) — phase
      // boundaries without a new entry are loop internals, not steps.
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

    return {
      status: this.status === "ready" ? "blocked" : this.status,
      goal: this.goal,
      url: this.startUrl,
      final_url: this.page.url,
      steps: this.history.length,
      decisions: this.decisions.length,
      elapsed_ms: this.elapsed(),
      history: this.history,
    };
  }

  async close(): Promise<void> {
    await this.browser?.close();
  }

  /** Introspection for adapters/tests. */
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
