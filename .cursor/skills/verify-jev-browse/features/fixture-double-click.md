# Fixture double-click

Open a report preview with a double-click on a main-page, shadow, covered, or framed control. The fixture confirms two click events and the double-click result.

## Sub-features

- `fx-double-main`: main-page report preview.
- `fx-double-shadow`: shadow report preview.
- `fx-double-covered`: covered report preview.
- `fx-double-frame`: framed report preview.

## How to get to it (user POV)

- Open `evals/fixtures/double-click.html` and double-click the named report.
- Run the four `fx-double-*` eval tasks with either browser engine.

## Driving it with control-jev-browse

Preconditions:

- Complete the baseline launch, doctor, and env steps in the feature index.
- Set `JEV_PROVIDER=openrouter` with a valid OpenRouter key.

- **CDP.** Run `control-jev-browse eval -- --tasks fx-double-main,fx-double-shadow,fx-double-covered,fx-double-frame --engine cdp --trace --label verify-double-cdp`. Require four verified, zero unverifiable, zero failed.
- **Agent-browser.** Run the same command with `--engine agent-browser --label verify-double-ab`. Require the same counts.
- **Proof.** Save the result JSON. Each task must end with its named preview opened with two clicks; a button label or agent completion claim is insufficient.

## Gotchas

- Single-click and Enter do not satisfy the double-click result.
- Agent-browser uses synthetic events; pages requiring trusted double-click events are not covered by these fixtures.
- Keep failure traces. Repeated attempts can increase the fixture click counter and invalidate the expected sequence.
