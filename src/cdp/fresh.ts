import { markerMatches } from "../json.ts";
import { loadSnapshotJs } from "../snapshot-loader.ts";
import type { JsonValue, ObservedAction, PageState } from "../types.ts";
import { QUIET_MS } from "./input.ts";
import { sleep } from "./socket.ts";

const READ_STATE = loadSnapshotJs();

const MARKER = `(() => { const state=${READ_STATE}; return state?.marker ?? null; })()`;

export interface FreshHost {
  evaluate<T>(expression: string, awaitPromise?: boolean): Promise<T | undefined>;
}

export async function settle(
  host: FreshHost,
  budgetMs: number,
  quietMs: number = QUIET_MS,
): Promise<void> {
  const quiet = await host
    .evaluate<boolean>(
      `(() => {const w = window.__jevFast && window.__jevFast.wake;
        if (!w || !w.quiet) return false;

        return w.quiet(${Math.min(quietMs, budgetMs)}, ${budgetMs}).then(() => true);})()`,
      true,
    )
    .catch(() => false);

  if (quiet !== true) await sleep(budgetMs);
}

export async function fresh(
  host: FreshHost,
  page: PageState,
  action?: ObservedAction,
  level: "full" | "page" | "structure" = "full",
): Promise<boolean> {
  if (action && (action.kind === "click" || action.kind === "select")) {
    const node = action.node;

    if (node === undefined) return false;

    const current = await host.evaluate(
      `(() => { const c=window.__jevFast; return c ? [c.pageKey(),c.guard(c.node(${node}))] : null; })()`,
    );

    return JSON.stringify(current) === JSON.stringify([page.page_key, page.guards[String(node)]]);
  }

  if (level === "page") {
    const current = await host.evaluate(
      `(() => { const c=window.__jevFast; return c ? c.pageKey() : null; })()`,
    );

    return JSON.stringify(current) === JSON.stringify(page.page_key);
  }

  return markerMatches(level, await host.evaluate<JsonValue>(MARKER), page.marker);
}
