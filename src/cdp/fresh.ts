import { markerMatches } from "../json.ts";
import { loadSnapshotJs } from "../snapshot-loader.ts";
import type { JsonValue, ObservedAction, PageState } from "../types.ts";
import { QUIET_MS } from "./input.ts";
import { sleep } from "./socket.ts";

const READ_STATE = loadSnapshotJs();

const MARKER = `(() => { const state=${READ_STATE}; return state?.marker ?? null; })()`;

export interface FreshHost {
  evaluate<T>(expression: string, awaitPromise?: boolean, purpose?: string): Promise<T | undefined>;
}

export async function settle(
  host: FreshHost,
  budgetMs: number,
  quietMs: number = QUIET_MS,
): Promise<void> {
  const deadline = performance.now() + budgetMs;
  let quietSince = performance.now();
  let previous: number | undefined;

  while (performance.now() < deadline) {
    const revision = await host.evaluate<number>(
      "window.__jevFast?.wake?.rev", false, "settle",
    ).catch(() => undefined);

    if (revision === undefined) {
      await sleep(Math.max(0, deadline - performance.now()));

      return;
    }

    if (previous !== revision) quietSince = performance.now();
    previous = revision;
    const now = performance.now();

    if (now - quietSince >= quietMs) return;
    await sleep(Math.max(0, Math.min(50, deadline - now, quietMs - (now - quietSince))));
  }
}

export async function fresh(
  host: FreshHost,
  page: PageState,
  action?: ObservedAction,
  level: "full" | "page" | "structure" | "completion" = "full",
): Promise<boolean> {
  if (action && (action.kind === "click" || action.kind === "double_click" || action.kind === "select")) {
    const node = action.node;

    if (node === undefined) return false;

    const current = await host.evaluate(
      `(() => { const c=window.__jevFast; return c ? [c.pageKey(),c.guard(c.node(${node}))] : null; })()`,
      false,
      "freshness",
    );

    return JSON.stringify(current) === JSON.stringify([page.page_key, page.guards[String(node)]]);
  }

  if (level === "page") {
    const current = await host.evaluate(
      `(() => { const c=window.__jevFast; return c ? c.pageKey() : null; })()`,
      false,
      "freshness",
    );

    return JSON.stringify(current) === JSON.stringify(page.page_key);
  }

  return markerMatches(level, await host.evaluate<JsonValue>(MARKER, false, "freshness"), page.marker);
}
