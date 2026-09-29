import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function spread(items, limit) {
  if (items.length <= limit) return items;

  return Array.from({ length: limit }, (_, i) => items[Math.round(i * (items.length - 1) / (limit - 1))]);
}

export function trajectory(dir, run) {
  const path = join(dir, "trace.jsonl");
  const pages = new Map();
  let malformed = 0;

  if (existsSync(path)) {
    for (const line of readFileSync(path, "utf8").split("\n").filter(Boolean)) {
      let event;

      try { event = JSON.parse(line); } catch { malformed++; continue; }

      const page = event.type === "observation" ? event.data : event.type === "phase_end" ? event.data?.page : null;

      if (!page?.url || (!page.text && !page.actions?.length)) continue;
      const controls = (page.actions ?? []).filter(action => action.node !== undefined).map(({ label, role, value, checked, selected, kind, below }) => ({ label, role, value, checked, selected, kind, below }));
      const key = JSON.stringify([page.url, page.text, controls, page.downloads, page.frames]);

      if (!pages.has(key)) pages.set(key, { elapsed_ms: event.elapsed_ms, url: page.url, title: page.title, text: (page.text ?? "").slice(0, 6000), text_truncated: (page.text?.length ?? 0) > 6000, controls: controls.slice(0, 100), controls_truncated: controls.length > 100, frames: page.frames ?? [], downloads: page.downloads ?? [] });
    }
  }

  const all = [...pages.values()];
  const observations = spread(all, 20);
  const screenshots = spread(run.screenshots ?? [], 12);

  return { observations, screenshots, coverage: { distinct_observations: all.length, supplied_observations: observations.length, screenshots: run.screenshots?.length ?? 0, supplied_screenshots: screenshots.length, malformed_trace_lines: malformed, sampling: "Evenly spaced chronological records, including first and last; up to 6000 text characters and 100 observed controls per observation" } };
}

export function executionFailure(run) {
  if (run.interrupted) return { verdict: "unverifiable", category: "interrupted", reason: "Attempt was interrupted; retained without retry" };

  if (run.timed_out) return { verdict: "failed", category: "timeout", reason: "Agent exceeded the task time budget" };

  if (run.result?.status === "error") return { verdict: "failed", category: "execution_error", reason: run.result.error ?? "Agent execution error" };

  return null;
}

export function counts(results, selected) {
  return {
    selected,
    attempted: results.filter((r) => r.verdict !== "excluded").length,
    unattempted: selected - results.length,
    ...Object.fromEntries(["verified", "failed", "unverifiable", "excluded"].map((v) => [v, results.filter((r) => r.verdict === v).length])),
  };
}
