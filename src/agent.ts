
import { confirmDone, prematureDone } from "./agent/consults.ts";
import { resolveFollowUp, toggleHint } from "./agent/followup.ts";
import { giveUpHint } from "./agent/fuses.ts";
import { settleFirstObservation, stateSummary } from "./agent/observe.ts";
import { actStep, decideStep, observeStep, settleStep } from "./agent/steps.ts";
import { makeClient } from "./env.ts";
import { type Decision } from "./model/decide.ts";
import { warmModelEndpoints } from "./model/endpoints.ts";
import { actionSpace } from "./model/space.ts";
import { extractAnswer } from "./model/text.ts";
import { MAX_STEPS } from "./questions.ts";
import { sleep } from "./sleep.ts";
import {
  StalePage,
  type BrowserDriver,
  type HistoryEntry,
  type JsonValue,
  type PageState,
  type RunResult,
} from "./types.ts";

export type { RunResult } from "./types.ts";

export interface AgentOptions {
  url: string;
  goal: string | string[];
  open: (url: string) => Promise<BrowserDriver>;
  maxSteps?: number;
}

type Phase = "observe" | "decide" | "act" | "settle" | "done" | "blocked" | "error";

export class Agent {
  readonly goal: string;
  browser!: BrowserDriver;
  page!: PageState;
  decision: Decision | null = null;
  history: HistoryEntry[] = [];
  decisions: Decision[] = [];
  earlyWaits = 0;
  fingerprints: string[] = [];
  domRetried = new Set<number>();
  domDead = new Map<number, number>();
  domDoc: string | undefined;
  followUp: { type: string; text: string | null; prevNodes: Set<number> } | null = null;
  textCalls: any[] = [];
  pendingText: [unknown, string, { model: string; latency_ms: number }] | null = null;
  settleContext: {
    action: PageState["actions"][number];
    page: PageState;
    text: string | null;
    decision: Decision;
  } | null = null;
  settleEntry: HistoryEntry | null = null;
  probeConsulted = false;
  fuseConsulted = false;
  doneConsults = 0;

  onEvent?: (event: { type: string; [k: string]: JsonValue }) => void;

  blockedCause: string | null = null;
  repairHint: string | null = null;
  staleStreak = 0;
  lastOperation: string | null = null;
  phase: Phase = "observe";
  terminalError: string | null = null;
  startedAt = 0;
  maxSteps: number;
  client = makeClient();
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

  elapsed(): number {
    return Math.round(performance.now() - this.startedAt);
  }

  private get status(): "ready" | "done" | "blocked" | "error" {
    if (this.phase === "done" || this.phase === "blocked" || this.phase === "error") {
      return this.phase;
    }

    return "ready";
  }

  private async observeStep(): Promise<void> {
    return observeStep(this);
  }

  private async decideStep(): Promise<void> {
    return decideStep(this);
  }

  private async actStep(): Promise<void> {
    return actStep(this);
  }

  private async settleStep(): Promise<void> {
    return settleStep(this);
  }

  prematureDone(): boolean {
    const hint = prematureDone(this.history, this.goal, this.doneConsults);

    if (!hint) return false;

    this.doneConsults++;
    this.onEvent?.({
      type: "done_consult",
      elapsed_ms: this.elapsed(),
      consult: this.doneConsults,
      acted: this.history.filter((h) => h.operation !== "WAIT").length,
      url: this.page.url,
    });
    this.repairHint = hint;

    return true;
  }

  toggleHint(): string | null {
    return toggleHint(this.history);
  }

  giveUpHint(page: PageState): string {
    return giveUpHint(this.history, page);
  }

  resolveFollowUp(fu: {
    type: string;
    text: string | null;
    prevNodes: Set<number>;
  }): string | null {
    return resolveFollowUp(fu, this.page.actions);
  }

  async confirmDone(page: PageState): Promise<void> {
    return confirmDone(this.browser, page);
  }

  waitEntry(action: string, page: PageState): HistoryEntry {
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
