# OpenRouter pilot, September 29, 2026

29 public tasks attempted from the fixed 30-task sample. Google Search--15
was excluded because it requests credential use. Travel dates use the updated
2026 instructions in pilot.json.

Independent custom judge: 3 verified, 15 failed, 11 unverifiable among attempted
tasks. The raw report counts 12 unverifiable because it includes the exclusion.
Verified fraction of attempted tasks: 3/29 (10.3%). This is a pilot observation,
not an official WebVoyager score or a full-dataset estimate.

Verified tasks: Amazon--10, Coursera--12, Huggingface--28.

Provider: OpenRouter; decision model: jev-latest (default, no override);
text helper: inception/mercury-2.5; vision judge: openai/gpt-4o.
Limits: 30 steps and 180 seconds per task. No retries or tuning during the run.

Evidence: evals/results/webvoyager-openrouter-current-v1/report.json and
per-task run.json, trace.jsonl, screenshots, and judge-response.json.
These files remain local and gitignored. Lint passed after harness changes.

Caveats: security blocks were inconsistently labeled failed vs unverifiable
by the judge. Last-five-screenshot evidence can omit earlier accomplishments.
SDK/text-helper errors are counted as unverifiable, so that category includes
agent execution failures as well as insufficient evidence. None are counted
as successes. Review raw evidence before publishing any score. Complete cost
is unavailable; per-action usage and judge usage are retained where returned.
