import type { HistoryEntry, PageState } from "../types.ts";

export function cycling(f: string[]): boolean {
  const n = f.length;

  return (
    (n >= 6 && f[n - 1] === f[n - 3] && f[n - 3] === f[n - 5] &&
      f[n - 2] === f[n - 4] && f[n - 4] === f[n - 6] && f[n - 1] !== f[n - 2]) ||
    (n >= 6 && f[n - 1] === f[n - 4] && f[n - 4] !== f[n - 2] &&
      f[n - 2] === f[n - 5] && f[n - 3] === f[n - 6] && f[n - 1] !== f[n - 3])
  );
}

export function fusedNow(
  history: HistoryEntry[],
  fingerprints: string[],
  current: string,
): boolean {
  const repeated = history.slice(-3);

  let idleMs = 0;
  const last = history[history.length - 1];

  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];

    if (h.page_changed !== false || (h.pending_requests ?? 0) > 0) break;
    idleMs = (last?.elapsed_ms ?? 0) - h.elapsed_ms;
  }

  const trail = fingerprints
    .slice(-14)
    .filter((f, i, a) => i === 0 || f !== a[i - 1]);

  const seen = trail.filter((f) => f === current).length;

  return (
    (repeated.length === 3 &&
      repeated.every((h) => h.page_changed === false && h.kind !== "wait")) ||
    idleMs >= 10_000 ||
    seen >= 4 ||
    cycling(fingerprints)
  );
}

export function giveUpHint(history: HistoryEntry[], page: PageState): string {
  const base =
    "Your recent actions made no progress. Try a different approach — scroll, hover, a different element — or claim BLOCKED.";

  const scrolled = history.some((h) => h.kind === "scroll");

  if (!scrolled && (page.scroll?.height ?? 0) > page.h * 1.1) {
    return base + " The page extends below the visible area and you have not scrolled — the goal's content is likely below the fold.";
  }

  return base;
}
