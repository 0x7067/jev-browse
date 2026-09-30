import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function reportedUsage(dir) {
  const path = join(dir, "trace.jsonl");
  const calls = [];
  const seen = new Set();

  if (!existsSync(path)) return { coverage: "trace_unavailable", calls, reported_cost_usd: null };

  for (const line of readFileSync(path, "utf8").split("\n").filter(Boolean)) {
    let event;

    try { event = JSON.parse(line); } catch { continue; }

    if (!["model_response", "completion_response", "answer_review_response", "text_helper_response", "shortlist_response", "answer_scope_response"].includes(event.type)) continue;
    const response = event.data;
    const id = response.id ?? `trace-${event.sequence}`;

    if (seen.has(id)) continue;
    seen.add(id);
    const usage = response.usage ?? {};
    calls.push({ id, source: event.type, model: response.model ?? null, input_tokens: usage.input_tokens ?? usage.prompt_tokens ?? null, output_tokens: usage.output_tokens ?? usage.completion_tokens ?? null, cost_usd: Number.isFinite(usage.cost) ? usage.cost : null });
  }

  return {
    coverage: "reported_responses_only; transport failures and unreported provider charges are unknown",
    calls,
    models: [...new Set(calls.flatMap((call) => call.model ? [call.model] : []))],
    responses_without_cost: calls.filter((call) => call.cost_usd === null).length,
    reported_cost_usd: calls.some((call) => call.cost_usd !== null) ? calls.reduce((sum, call) => sum + (call.cost_usd ?? 0), 0) : null,
  };
}
