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

/** Bounds for the first-observation settle (see settleFirstObservation). */
const FIRST_SETTLE_MS = 1500;

const FIRST_SETTLE_POLL_MS = 150;

/** The page offers something to read or something to operate — anything past
 *  the baseline scroll/wait/press/back/forward controls is element-backed. */
function hasContent(page: PageState): boolean {
  return Boolean(page.text.trim()) || page.actions.some((a) => a.node !== undefined);
}

/** An SPA can commit its document before painting anything: the first snapshot
 *  then carries no text and no controls, and the first decision is spent on a
 *  WAIT. Re-observe until content appears or the network goes quiet, bounded
 *  so a genuinely empty page costs no more than FIRST_SETTLE_MS. Pages that
 *  already have content return untouched. */
async function settleFirstObservation(
  browser: BrowserDriver,
  page: PageState,
): Promise<PageState> {
  if (hasContent(page)) return page;
  const deadline = performance.now() + FIRST_SETTLE_MS;
  let latest = page;

  while (performance.now() < deadline) {
    await sleep(FIRST_SETTLE_POLL_MS);
    latest = await browser.observe();

    if (hasContent(latest)) break;

    // Nothing in flight and still nothing rendered — waiting buys nothing.
    if (!latest.pending_requests && !latest.pending_nav) break;
  }

  return latest;
}

/** True when `needle` occurs in `haystack` starting at a word boundary —
 *  "pari" matches "Paris, France" but "art" does not match "Start". */
/** Labels that undo a selection rather than offer one. */
const UNDO_LABEL = /^\s*(remove|delete|clear|deselect|unselect|undo|×|✕|✖|x)\b/i;

function atWordBoundary(haystack: string, needle: string): boolean {
  let i = haystack.indexOf(needle);

  while (i !== -1) {
    if (i === 0 || !/[\p{L}\p{N}]/u.test(haystack[i - 1])) return true;
    i = haystack.indexOf(needle, i + 1);
  }

  return false;
}

import { choose, type Decision } from "./model/decide.ts";
import { warmModelEndpoints } from "./model/endpoints.ts";
import { actionSpace } from "./model/space.ts";
import { extractAnswer, fieldContext, fieldText } from "./model/text.ts";
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
  /** Page text at terminal state — lets verifiers check outcomes, not claims. */
  final_text?: string;
  /** Direct answer for interrogative/extractive goals, extracted at done. */
  answer?: string;
  /** Filenames downloaded during the run. */
  downloads?: string[];
  error?: string;
  /** Which exit ended a blocked run — a model give-up, an exhausted budget,
   *  a stale storm and a dead page each call for a different fix. */
  blocked_cause?: string;
  /** Element state at the terminal page — checked boxes, chosen options,
   *  field values. Page text cannot show these, so without it a checkbox
   *  task can only be verified by the clicks it made, not by how it ended. */
  final_state?: string;
  /** Why `answer` is absent. An unset answer used to be indistinguishable
   *  from an unasked one, so a missed extraction looked like a wrong page. */
  answer_note?: string;
}

/** One line per element that carries state, for `expect.state_match`. */
function stateSummary(page: PageState): string {
  const lines: string[] = [];

  for (const element of actionSpace(page.actions).elements) {
    const state = (["checked", "selected", "expanded", "value"] as const).flatMap((k) =>
      element[k] === undefined || element[k] === "" ? [] : [`${k}=${element[k]}`],
    );

    // Labels can carry a whole page's text; the state is the point here.
    if (state.length) lines.push(`${String(element.label).slice(0, 60)} ${state.join(" ")}`);
  }

  return lines.join("\n");
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

  /** Set for the lifetime of run(); lets the decide path report the action
   *  space it actually offered, which the step events cannot show. */
  private onEvent?: (event: { type: string; [k: string]: JsonValue }) => void;

  /** Why the loop stopped short. A bare "blocked" cannot distinguish a model
   *  give-up from an exhausted budget or a stale storm, and the three call
   *  for different fixes. */
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
    warmModelEndpoints();
    const agent = new Agent(opts);
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

    if (this.decisions.length >= this.maxSteps * 2) {
      this.blockedCause = "decision_budget";
      this.phase = "blocked";

      return;
    }

    if (!(await this.browser.fresh(this.page))) {
      throw new StalePage("Page changed since the last observation. Choose again.");
    }

    this.decision = null;

    // A confident speculation skips the decision call entirely: resolve the
    // follow-up against the post-action state into a synthetic decision, and
    // let the normal act path execute it (freshness, entries, fuses intact).
    if (this.followUp) {
      const fu = this.followUp;
      this.followUp = null;

      if (fu.type === "DONE") {
        // The consult is a cheap decision; the stability window is not.
        // Ask first, so a claim that gets re-decided never pays the window.
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

    // A probe, fuse, or stale storm asked for one repair consult: say it
    // plainly, then consume it — the hint applies to exactly this decide.
    // The history already shows the failed pattern; the model needs the
    // nudge to try a different approach instead of repeating it once more.
    const toggle = this.toggleHint();
    const repair = this.repairHint ?? toggle;
    this.repairHint = null;

    const goal = repair ? `${this.goal}\n\n${repair}` : this.goal;

    // A toggle loop is structural, not just a wording problem — the same
    // control keeps winning the decide. Present this one consult without it:
    // the next observation puts it back if it was really needed.
    const page = toggle
      ? {
          ...this.page,
          actions: this.page.actions.filter(
            (a) =>
              a.label !==
              this.history[this.history.length - 1]?.action.replace(/ \(dom\)$/, ""),
          ),
        }
      : this.page;

    this.decision = await choose(this.client, page, goal, this.history);
    this.decisions.push(this.decision);
    this.reportDecision(page, Boolean(repair));
    this.lastOperation = this.decision.operation;
    this.phase = "act";
  }

  /** What the model was given and what it picked. The offered counts expose
   *  fixed action-space overhead — controls that are listed on every page
   *  whether or not they can do anything — which step events never show. */
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

  /**
   * A done claim behind an imperative goal is a claim without evidence when
   * the run barely acted — or when it only navigated (scroll/hover/wait)
   * and never touched the element the goal names. One confirmation consult
   * before accepting; a second claim stands. Observe-only goals skip it.
   */
  private prematureDone(): boolean {
    const acted = this.history.filter((h) => h.operation !== "WAIT");
    const MUTATING = new Set(["click", "context", "select", "fill", "drag", "press"]);
    const unproven = acted.length < 2 || !acted.some((h) => MUTATING.has(h.kind));

    // Consult twice at most: the second consult names this the last check,
    // then a repeated claim stands. Observe-only goals skip it entirely.
    if (this.doneConsults >= 2 || !unproven) return false;

    if (
      !/\b(click|type|press|select|activate|enter|fill|upload|submit|check|uncheck|drag|open|go to|navigate|mark|complete|choose|toggle|switch)\b/i.test(
        this.goal,
      )
    ) {
      return false;
    }

    this.doneConsults++;
    this.onEvent?.({
      type: "done_consult",
      elapsed_ms: this.elapsed(),
      consult: this.doneConsults,
      acted: acted.length,
      url: this.page.url,
    });
    this.repairHint =
      this.doneConsults === 1
        ? "If the goal asks you to interact with the page, do it — a done claim without evidence is premature. Claim DONE again only if the goal state is already visibly satisfied."
        : "Final check — the goal's action still has no effect on the page. If it is already satisfied, claim DONE; otherwise act on the element now.";

    return true;
  }

  /** Detect a click-toggle loop: the same control clicked twice in a row
   *  with the page changing each time means it opened then closed — the
   *  reveal is in the table and the model keeps pressing the switch. */
  private toggleHint(): string | null {
    const tail = this.history.slice(-2);

    // history labels carry a " (dom)" suffix when the in-page retry was the
    // path that landed — normalize before comparing.
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

  /** One-line nudge for a give-up claim, tailored to what the run hasn't
   *  tried — a taller-than-viewport page never scrolled is the common miss. */
  private giveUpHint(page: PageState): string {
    const base =
      "Your recent actions made no progress. Try a different approach — scroll, hover, a different element — or claim BLOCKED.";

    const scrolled = this.history.some((h) => h.kind === "scroll");

    if (!scrolled && (page.scroll?.height ?? 0) > page.h * 1.1) {
      return base + " The page extends below the visible area and you have not scrolled — the goal's content is likely below the fold.";
    }

    return base;
  }

  /** Map a speculative follow-up to an action id on the current page. */
  private resolveFollowUp(fu: {
    type: string;
    text: string | null;
    prevNodes: Set<number>;
  }): string | null {
    if (fu.type === "PRESS_ENTER") {
      return this.page.actions.find((a) => a.id === "press_enter")?.id ?? null;
    }

    if (fu.type === "CLICK_MATCH_TYPED") {
      // Autocomplete suggestions are the elements that appeared in response
      // to typing — ids are positional and recycle between observations, so
      // diff by node identity. Without a label match, resolve only an
      // unambiguous single newcomer — page chrome appearing mid-typing is
      // not the suggestion.
      // A pick of its own makes a newcomer appear: the chip's remove control.
      // It matches the typed text as well as the suggestion did, so without
      // this the follow-up undoes the selection it was meant to confirm.
      const appeared = this.page.actions.filter(
        (a) =>
          a.kind === "click" &&
          a.node !== undefined &&
          !fu.prevNodes.has(a.node) &&
          !UNDO_LABEL.test(a.label),
      );

      if (fu.text && fu.text.length >= 3) {
        const tokens = fu.text
          .toLowerCase()
          .split(/[^\p{L}\p{N}]+/u)
          .filter((t) => t.length >= 3);

        const matched = appeared.find((a) =>
          tokens.some((t) => atWordBoundary(a.label.toLowerCase(), t)),
        );

        if (matched) return matched.id;
      }

      if (appeared.length === 1) return appeared[0].id;
    }

    return null;
  }

  // --- act -----------------------------------------------------------------

  /**
   * Confirm a DONE claim. A click-triggered navigation in flight means the
   * claim verifies the page the action just left: poll freshness through a
   * commit window — the commit fails fresh() and sends the machine back to
   * decide on the new page. The deadline falls through, never vetoes: busy
   * pages (perpetual connections, stuck counters) would otherwise loop a
   * done claim forever. The stability window below is the real arbiter —
   * requests in flight (Turbo-style swaps land without navigation events)
   * widen it, because a swap during the claim fails fresh().
   */
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

    await sleep(window_);

    if (!(await this.browser.fresh(page, undefined, "structure"))) {
      throw new StalePage("Page changed while confirming DONE. Choose again.");
    }
  }

  private async actStep(): Promise<void> {
    const decision = this.decision;
    const page = this.page;

    if (!decision) throw new Error("Choose before acting");
    // Consume once, before any mutation or model call. A retry cannot double-click.
    this.decision = null;
    const selected = decision.choice;

    if (selected === "DONE" || selected === "BLOCKED") {
      // A claim must describe the live page: structure freshness compares
      // controls, form state, and digit-normalized text — a clock can't
      // stale-loop DONE, but a "Processing" → "failed" swap can.
      if (!(await this.browser.fresh(page, undefined, "structure"))) {
        throw new StalePage("Page changed since the decision. Choose again.");
      }

      // Any BLOCKED claim is a give-up worth second-guessing: poll until the
      // page moves (recovery — re-decide) or the patience a WAIT-loop would
      // buy expires (accept the claim). Bounded by earlyWaits; mutating
      // retries stay forbidden.
      // One full patience window per stuck episode: a claim repeated after
      // the repair consult, with nothing having moved, is accepted as is.
      if (selected === "BLOCKED" && this.earlyWaits < 3 && !this.probeConsulted) {
        this.earlyWaits++;
        const entry = this.waitEntry("Wait for the page to update", page);
        const started = Date.now();
        // Patience scales with evidence of work: a page with requests in
        // flight earns the full window; an idle page earns a shorter one.
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

            // An unchanged page after a full patience window is a real
            // give-up signal — but a single borderline claim still earns one
            // hinted re-decide before the claim is accepted.
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

      // Dropping an element on itself is a malformed answer, not an action —
      // re-decide instead of executing a guaranteed no-op.
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
      // Same document and field state is what the helper's context needs;
      // ambient text churn is not a reason to re-decide.
      if (!(await this.browser.fresh(page, undefined, "page"))) {
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
    this.probeConsulted = false;

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
    this.staleStreak = 0;
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

    // A navigation the action just triggered may not have committed — an
    // observation taken mid-flight reads the page the click is leaving and
    // the change reads as nothing. Watch briefly for the nav to begin, then
    // wait out the commit before measuring.
    if (["click", "context", "select", "press"].includes(action.kind)) {
      const navDeadline = Date.now() + 2500;

      for (let i = 0; i < 2 && !this.browser.pendingNav?.(); i++) await sleep(80);

      while (this.browser.pendingNav?.() && Date.now() < navDeadline) await sleep(120);
    }

    this.page = await this.browser.observe();
    entry.page_changed = this.page.fingerprint !== page.fingerprint;

    // Node ids restart at 1 in every document — a retry budget keyed by
    // node must reset when the document does.
    const doc = String(Array.isArray(page.page_key) ? page.page_key[0] : page.page_key);

    if (this.domDoc !== doc) {
      this.domDoc = doc;
      this.domRetried.clear();
    }

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

    // DONE_AFTER is only honored on actions that can complete a goal —
    // scroll/hover/wait/navigation only position the view, so a completion
    // prediction on them is malformed on its face and gets ignored.
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
      this.fuseConsulted = false;
      this.phase = "decide";
    } else if (!this.fuseConsulted) {
      // Repair before verdict: one consult with the stuck signal spelled out.
      this.fuseConsulted = true;
      this.repairHint =
        "Your recent actions made no progress. Try a different approach — scroll, hover, a different element — or claim BLOCKED.";
      this.phase = "decide";
    } else {
      this.blockedCause = "no_progress";
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
    this.staleStreak = 0;

    return entry;
  }

  /** A page nothing can be done on: a Chrome error page, or a bot wall that
   *  offers no control to solve it. A challenge with a checkbox or button is
   *  still worth attempting, so only the empty case short-circuits. */
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
    // Nothing to read and nothing to click — spend no decisions on it.
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
          // Re-observe and let the machine choose again on the fresh page.
          // A stale-redo loop records nothing and spends no budget, so the
          // decisions cap never reaches it — count consecutive cycles and
          // stop the storm: one hinted consult, then blocked.
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

    // Truth before reporting: a committing navigation or a trailing render
    // can outlive the last observation (SPA URL commits land after the DONE
    // stability window). One final read so final_url/final_text describe the
    // page the run actually ended on.
    if (this.status !== "ready" && !this.terminalError) {
      try {
        // SPA commits can land a beat after the DONE confirm window — re-read
        // until url/title settle, bounded so reporting never hangs.
        for (let i = 0; i < 8; i++) {
          const latest = await this.browser.observe();

          const settled =
            latest.url === this.page.url &&
            latest.title === this.page.title &&
            Boolean(latest.text);

          this.page = latest;

          if (settled) break;

          await sleep(350);
        }
      } catch {
        // keep the last good page
      }
    }

    // Interrogative goals earn a direct answer, not just a done claim —
    // extraction is best-effort and never fails an otherwise-good run.
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
        // no configured helper or an unusable answer — report without it
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

  /** True when the goal asks for information rather than only a state —
   *  those runs extract an answer off the terminal page. */
  private static goalAsksForAnswer(goal: string): boolean {
    return /\?|\b(what|which|who|whom|whose|when|where|why|how (many|much|old|tall|long|far))\b|\b(name|list|report|tell me|find out|extract|read)\b[^\n]{0,80}\b(price|version|date|number|name|title|count|population|email|phone|author|score|address|link|url|size|status|message|text|error|reason|value|winner|top|latest|first|total)s?\b/i.test(
      goal,
    );
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
