# Calibrated saved-run comparison — September 29, 2026

| Captured run | Verified | Failed | Unverifiable | Excluded |
| --- | ---: | ---: | ---: | ---: |
| Original baseline | 2 | 27 | 0 | 1 |
| Intermediate remediated build | 11 | 17 | 1 | 1 |

Both have 29 attempted tasks. Automatic verification is 6.9% versus 37.9%
under the same V7 evaluator, GPT-5.4 on OpenRouter, prompt, and task-derived
requirements. Evidence: `evals/results/webvoyager-comparison-v7.json`.
Each row records the exact source judgment and its hash. Unchanged rubric
results were reused; nine changed rubrics were rejudged on both captures.

These are saved browser runs, not a fresh benchmark of the current worktree.
The candidate was captured from bundle
`9d6a53e50da7cf07985d12b9c7a40589d64a26d29ee512e8457e247ee39a6994`;
the older baseline did not record a bundle hash. Subsequent date, clipping,
tab, field-memory, and navigation-context fixes are not measured here.
Live sites and one attempt per task limit causal and statistical conclusions.
This is not an official leaderboard score or a completed held-out evaluation.

The evaluator passed 14 controlled calibration cases, including partial answers,
unsupported limits, absent answers, browser-only tasks, dates, access blocks,
and qualifying facts that need not be repeated in the final response. The
previous false-positive missing-affiliation answer now fails. The unsupported
GPU ceiling is unverifiable; the three-place summary passes without a city-only
restriction. Model judgments remain fallible and require evidence review.

Current evidence and remaining work are recorded in REMEDIATION.md.

---

# Earlier raw evaluator output — retained for audit

OpenRouter, 30 selected WebVoyager tasks, 29 attempted, one credential task excluded.
Automatic custom-judge v2 results: **11 verified, 18 failed, 0 unverifiable** (37.9%).
Five attempts were classified as site blocks.

Evidence: `evals/results/webvoyager-remediated-full-v2/report.json`.
Per-task directories retain instructions, traces, screenshots, raw responses and verdicts.
Travel dates were updated; historical research dates were preserved.

This is not an official leaderboard score. Booking--35 has a disputed failure;
GitHub--5 has an incorrect date rationale. Later rejudgments are separate and
have not replaced these results. Do not compare directly to the original 3/29
pilot: evidence and scoring protocols differ.

The agent still fails navigation and complete evidence collection, and can accept
unsupported answers. Remediation is ongoing. The current-date context fix and
about:blank tab capture fix landed after this frozen pilot; neither is measured
by its score. Four clock/answer/navigation fixture tasks and the independent
multi-tab capture check passed afterward. See REMEDIATION.md for details.

## Evaluator reliability audit

There is no audited pass rate yet. A later ArXiv--24 run was automatically
marked verified despite returning no answer and omitting the required author
affiliation; the judge explicitly acknowledged the omission in its reason.
See `evals/results/webvoyager-navigation-v2/ArXiv--24/adjudication.json`.
Both false negatives from omitted control evidence and false positives from
partial completion have now been observed. The figures above are preserved raw
automatic labels, not a reliable estimate of task success. Requirement-by-
requirement evaluation and calibration remain necessary before publication.
