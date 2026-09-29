import type { PageState } from "../types.ts";
import { stateSummary } from "./observe.ts";

export const OBSERVED_TEXT_SCOPE = "Visible viewport sample. Offscreen, hidden, and unopened content is not represented; absence from this sample is not evidence of absence from the page or available configurations.";

export function observationViewport(page: Pick<PageState, "h" | "scroll">) {
  return { top: page.scroll?.y ?? null, height: page.h, document_height: page.scroll?.height ?? null };
}

export function outcomeObservation(page: PageState) {
  const controlState = stateSummary(page);
  const actions = page.actions.filter(action => action.node !== undefined);

  return {
    url: page.url,
    title: page.title,
    text: page.text.slice(0, 6000),
    text_scope: OBSERVED_TEXT_SCOPE,
    viewport: observationViewport(page),
    excerpt_truncated: page.text.length > 6000,
    tables: page.tables ?? [],
    omitted_tables: page.omitted_tables ?? 0,
    control_state: controlState.slice(0, 4000),
    control_state_truncated: controlState.length > 4000,
    available_actions: actions.slice(0, 60).map(action => action.label),
    omitted_available_actions: page.omitted_actions + Math.max(0, actions.length - 60),
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

export function compactObservations(observations: ProgressObservation[], currentTables: PageState["tables"]) {
  const seen = new Map([[JSON.stringify(currentTables ?? []), "current observation"]]);

  return observations.map((observation, index) => {
    if (!observation.tables.length) return observation;
    const key = JSON.stringify(observation.tables);
    const reference = seen.get(key);

    if (!reference) {
      seen.set(key, `history observation at index ${index}`);

      return observation;
    }

    const { tables: _tables, ...rest } = observation;

    return { ...rest, tables_reference: reference };
  });
}

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

  const next = {
    ...observed,
    text: observed.text.slice(0, 1500),
    excerpt_truncated: observed.excerpt_truncated || observed.text.length > 1500,
    control_state: observed.control_state.slice(0, 1000),
    control_state_truncated: observed.control_state_truncated || observed.control_state.length > 1000,
    available_actions: observed.available_actions.slice(0, 20),
    omitted_available_actions: observed.omitted_available_actions + Math.max(0, observed.available_actions.length - 20),
    after_step: step,
  };

  const previous = observations.at(-1);

  if (previous && JSON.stringify(previous) === JSON.stringify(next)) return;
  observations.push(next);

  while (observations.length > OBSERVATION_LIMIT) observations.splice(leastNovel(observations), 1);
}

export const OBSERVATION_LIMIT = 8;

function evidenceUnits(observation: ProgressObservation): string[] {
  const lines = observation.text.split("\n").map(line => line.trim().replace(/\s+/g, " ").toLowerCase()).filter(Boolean);
  const tables = observation.tables.map(table => `table:${JSON.stringify(table)}`);

  return [`url:${observation.url}`, ...lines, ...tables];
}

function leastNovel(observations: ProgressObservation[]): number {
  const units = observations.map(observation => new Set(evidenceUnits(observation)));
  const counts = new Map<string, number>();

  for (const set of units) for (const unit of set) counts.set(unit, (counts.get(unit) ?? 0) + 1);

  let selected = 1;
  let lowest = Infinity;

  for (let index = 1; index < observations.length - 1; index++) {
    let unique = 0;

    for (const unit of units[index]) if (counts.get(unit) === 1) unique += unit.length;

    if (unique < lowest) {
      lowest = unique;
      selected = index;
    }
  }

  return selected;
}

export function progressHint(assessment: GoalAssessment | null): string {
  if (!assessment || assessment.status === "SATISFIED") return "";

  return `At step ${assessment.after_step}, goal review found ${assessment.status} (basis: ${assessment.basis}). Reassess against new observations. Preserve satisfied requirements; pursue remaining work or inspect the outcome. Do not repeat an irreversible action merely because its outcome is uncertain. If no supported observation or action can resolve uncertainty, report BLOCKED. The original goal defines scope; do not add requirements.`;
}
