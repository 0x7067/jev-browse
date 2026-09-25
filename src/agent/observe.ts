import { actionSpace } from "../model/space.ts";
import { sleep } from "../sleep.ts";
import type { BrowserDriver, PageState } from "../types.ts";

const FIRST_SETTLE_MS = 1500;

const FIRST_SETTLE_CONTENT_MS = 4000;

const FIRST_SETTLE_PENDING_MS = 12_000;

const FIRST_SETTLE_POLL_MS = 150;

function hasContent(page: PageState): boolean {
  return Boolean(page.text.trim()) || page.actions.some((a) => a.node !== undefined);
}

export async function settleFirstObservation(
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

export function stateSummary(page: PageState): string {
  const lines: string[] = [];

  for (const element of actionSpace(page.actions).elements) {
    const state = (["checked", "selected", "expanded", "value", "position"] as const).flatMap((k) =>
      element[k] === undefined || element[k] === "" ? [] : [`${k}=${element[k]}`],
    );

    if (state.length) lines.push(`${String(element.label).slice(0, 60)} ${state.join(" ")}`);
  }

  return lines.join("\n");
}
