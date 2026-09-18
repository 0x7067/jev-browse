/**
 * The complete agent loop. Typed choices, observable state, bounded execution.
 * Driver-agnostic port of jev-ultrafast's agent.py: predict (one systemOne
 * call) -> act (guarded mutation) -> observe, until DONE/BLOCKED or budget.
 */

import { MAX_STEPS } from "./questions.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

import { actionSpace, choose, fieldContext, fieldText, type Decision } from "./model.ts";
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

export class Agent {
  readonly goal: string;
  private browser!: BrowserDriver;
  private page!: PageState;
  private decision: Decision | null = null;
  private history: HistoryEntry[] = [];
  private decisions: Decision[] = [];
  private earlyWaits = 0;
  private textCalls: any[] = [];
  private pendingText: [unknown, string, { model: string; latency_ms: number }] | null = null;
  private status: "ready" | "done" | "blocked" = "ready";
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
    agent.browser = await agent.openDriver(opts.url);

    try {
      agent.page = await agent.browser.observe();
    } catch (error) {
      await agent.browser.close();
      throw error;
    }

    return agent;
  }

  private elapsed(): number {
    return Math.round(performance.now() - this.startedAt);
  }

  /** One predict+act cycle. Equivalent to the reference `tick`. */
  private async tick(): Promise<void> {
    try {
      await this.predict();
      await this.act();
    } catch (error) {
      if (error instanceof StalePage) {
        // Re-observe and let the loop choose again on the fresh page.
        this.decision = null;
        this.status = "ready";
        this.page = await this.browser.observe();

        return;
      }

      throw error;
    }
  }

  private async predict(): Promise<void> {
    if (!this.startedAt) this.startedAt = performance.now();

    if (!(await this.browser.fresh(this.page))) {
      this.page = await this.browser.observe();
    }

    this.decision = null;

    if (this.status !== "ready") return;

    if (this.decisions.length >= this.maxSteps * 2) {
      throw new Error("Reached the model-call budget");
    }

    this.decision = await choose(this.client, this.page, this.goal, this.history);
    this.decisions.push(this.decision);
  }

  private async act(): Promise<void> {
    const decision = this.decision;
    const page = this.page;

    if (!decision) throw new Error("Choose before acting");
    // Consume once, before any mutation or model call. A retry cannot double-click.
    this.decision = null;
    const selected = decision.choice;

    if (selected === "DONE" || selected === "BLOCKED") {
      if (!(await this.browser.fresh(page))) {
        this.status = "ready";
        throw new StalePage("Page changed since the decision. Choose again.");
      }

      // A BLOCKED claim before any real action — or on an empty snapshot —
      // is a give-up we can afford to second-guess: wait, re-observe, ask
      // again. Bounded by earlyWaits; mutating retries stay forbidden.
      if (
        selected === "BLOCKED" &&
        this.earlyWaits < 3 &&
        (page.actions.length === 0 || this.history.every((h) => h.kind === "wait"))
      ) {
        this.earlyWaits++;
        const entry = this.waitEntry("Wait for the page to update", page);
        await sleep(700);
        this.page = await this.browser.observe();
        entry.page_changed = this.page.fingerprint !== page.fingerprint;
        entry.url = this.page.url;
        entry.elapsed_ms = this.elapsed();
        this.status = "ready";

        return;
      }

      this.status = selected === "DONE" ? "done" : "blocked";

      return;
    }

    const action = page.actions.find((a) => a.id === selected);

    if (!action) throw new Error(`Decision selected unknown action ${selected}`);

    if (this.history.length >= this.maxSteps) {
      this.status = "blocked";
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
        const generated = await fieldText(context);

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
      page_changed: null,
      url: page.url,
      usage: decision.usage,
      executed_ms: this.elapsed(),
      elapsed_ms: this.elapsed(),
    };

    this.history.push(entry);

    this.page = await this.browser.observe();
    entry.page_changed = this.page.fingerprint !== page.fingerprint;
    entry.url = this.page.url;
    entry.elapsed_ms = this.elapsed();

    const repeated = this.history.slice(-3);
    this.status =
      repeated.length === 3 &&
      repeated.every((h) => h.page_changed === false && h.kind !== "wait")
        ? "blocked"
        : "ready";
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
    while (this.status === "ready") {
      await this.tick();
      const last = this.history[this.history.length - 1];
      onEvent?.({
        type: "step",
        status: this.status,
        elapsed_ms: this.elapsed(),
        action: last?.action,
        kind: last?.kind,
        operation: this.decisions[this.decisions.length - 1]?.operation,
        url: this.page.url,
      });
    }

    return {
      status: this.status,
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
      goal: this.goal,
      page: this.page,
      history: this.history,
      decisions: this.decisions,
      text_calls: this.textCalls,
      elements: this.page ? actionSpace(this.page.actions).elements : [],
    };
  }
}
