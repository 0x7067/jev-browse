import type { PageState } from "../types.ts";
import { stateSummary } from "./observe.ts";

export function outcomeObservation(page: PageState) {
  return {
    url: page.url,
    title: page.title,
    text: page.text.slice(0, 6000),
    control_state: stateSummary(page).slice(0, 4000),
    available_actions: page.actions.filter(action => action.node !== undefined).slice(0, 60).map(action => action.label),
    frames: (page.frames ?? []).map(frame => ({ ...frame })),
    downloads: page.downloads ?? [],
    dialog: page.dialog ?? null,
    pending_nav: page.pending_nav ?? false,
    pending_requests: page.pending_requests ?? 0,
    challenge: page.challenge ?? false,
    challenge_reasons: page.challenge_reasons ?? [],
  };
}

export type ProgressObservation = ReturnType<typeof outcomeObservation> & { after_step: number };

export const OUTCOME_CRITERIA = {
  SATISFIED: "Observed evidence supports every requested outcome or the user's explicit stopping boundary. No required work remains.",
  INCOMPLETE: "The observations show unfinished requested work, such as setup, unapplied input, an unopened destination, or only some requested outcomes.",
  UNCERTAIN: "The requested outcome cannot be established from the available observations. Neither success nor a specific missing outcome is supported.",
};

export type GoalAssessment = {
  status: keyof typeof OUTCOME_CRITERIA;
  basis: "CURRENT_STATE" | "OBSERVED_HISTORY" | "ACTION_ONLY" | "NONE" | "EXPLICIT_CONDITIONS";
  after_step: number;
  url: string;
};

export function rememberObservation(observations: ProgressObservation[], page: PageState, step: number): void {
  const observed = outcomeObservation(page);
  const next = { ...observed, text: observed.text.slice(0, 1500), control_state: observed.control_state.slice(0, 1000), available_actions: observed.available_actions.slice(0, 20), after_step: step };
  const previous = observations.at(-1);

  if (previous && JSON.stringify(previous) === JSON.stringify(next)) return;
  observations.push(next);

  if (observations.length > 8) observations.splice(1, observations.length - 8);
}

export function progressHint(assessment: GoalAssessment | null): string {
  if (!assessment || assessment.status === "SATISFIED") return "";

  return `At step ${assessment.after_step}, goal review found ${assessment.status} (basis: ${assessment.basis}). Reassess against new observations. Preserve satisfied requirements; pursue remaining work or inspect the outcome. Do not repeat an irreversible action merely because its outcome is uncertain. If no supported observation or action can resolve uncertainty, report BLOCKED. The original goal defines scope; do not add requirements.`;
}
