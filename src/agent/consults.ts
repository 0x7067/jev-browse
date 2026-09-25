import { sleep } from "../sleep.ts";
import { StalePage, type BrowserDriver, type HistoryEntry, type PageState } from "../types.ts";
import { giveUpHint } from "./fuses.ts";

const STEP_KINDS: [RegExp, string[]][] = [
  [/\b(type|enter|fill|upload)\b/i, ["fill"]],
  [/\bdrag\b/i, ["drag"]],
  [/\bpress\b/i, ["press"]],
  [/\bwait for\b/i, ["wait"]],
];

const REPAIR_DONE =
  "Before claiming DONE, check each part of the goal against the page. If every part is visibly satisfied, claim DONE; if a part remains, act on it.";

export function prematureDone(
  history: HistoryEntry[],
  goal: string,
  doneConsults: number,
): string | null {
  const acted = history.filter((h) => h.operation !== "WAIT");
  const MUTATING = new Set(["click", "context", "select", "fill", "drag", "press"]);
  const unproven = acted.length < 2 || !acted.some((h) => MUTATING.has(h.kind));

  if (doneConsults >= 1 || !unproven) return null;

  const steps = goal.match(
    /\b(click|type|press|select|activate|enter|fill|upload|submit|check|uncheck|drag|open|go to|navigate|mark|complete|choose|toggle|switch|wait for)\b/gi,
  );

  const skipped = STEP_KINDS.some(
    ([step, kinds]) => step.test(goal) && !history.some((h) => kinds.includes(h.kind)),
  );

  if ((steps?.length ?? 0) < 2 && !skipped) return null;

  return REPAIR_DONE;
}

export async function confirmDone(browser: BrowserDriver, page: PageState): Promise<void> {
  if (page.pending_nav || browser.pendingNav?.()) {
    const deadline = Date.now() + 2500;

    while (Date.now() < deadline && browser.pendingNav?.()) {
      if (!(await browser.fresh(page, undefined, "structure"))) {
        throw new StalePage("Navigation committed while confirming DONE. Choose again.");
      }

      await sleep(120);
    }

    if (!(await browser.fresh(page, undefined, "structure"))) {
      throw new StalePage("Page changed while confirming DONE. Choose again.");
    }
  }

  const window_ = (page.pending_requests ?? 0) > 0 ? 1500 : 400;

  await (browser.settle?.(window_) ?? sleep(window_));

  if (!(await browser.fresh(page, undefined, "structure"))) {
    throw new StalePage("Page changed while confirming DONE. Choose again.");
  }
}

export interface ProbeOutcome {
  changed: boolean;
  entry: HistoryEntry;
  latest: PageState;
  hint: string | null;
}

export async function blockedProbe(
  browser: BrowserDriver,
  page: PageState,
  history: HistoryEntry[],
  elapsed: () => number,
  waitEntry: (action: string, page: PageState) => HistoryEntry,
): Promise<ProbeOutcome> {
  const entry = waitEntry("Wait for the page to update", page);
  const started = Date.now();
  let deadline = started + 4_000;

  for (;;) {
    await sleep(800);
    const latest = await browser.observe();

    if ((latest.pending_requests ?? 0) > 0) deadline = started + 10_000;

    const changed = latest.fingerprint !== page.fingerprint;

    if (changed || Date.now() >= deadline) {
      entry.page_changed = changed;
      entry.url = latest.url;
      entry.elapsed_ms = elapsed();

      return { changed, entry, latest, hint: changed ? null : giveUpHint(history, page) };
    }
  }
}
