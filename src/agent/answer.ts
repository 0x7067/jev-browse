import { requiresAnswer } from "../model/answer-scope.ts";
import { clockContext } from "../model/clock.ts";
import { answerReviewModel, reviewAnswer } from "../model/answer-review.ts";
import type { Agent } from "../agent.ts";
import { extractAnswer } from "../model/text.ts";
import { trace } from "../trace.ts";
import { type ProgressObservation, outcomeObservation, compactObservations } from "./progress.ts";

export type AnswerResult =
  | { status: "supported"; answer: string }
  | { status: "not_requested" }
  | { status: "missing_evidence"; reason: string }
  | { status: "unverified"; reason: string };

export function answerReviewContext(goal: string, answer: string | null, current: ReturnType<typeof outcomeObservation>, observedProgress: ProgressObservation[]) {
  return { ...clockContext(), user_goal: goal, proposed_answer: answer, current, observed_progress: compactObservations(observedProgress, current.tables) };
}

export async function prepareAnswer(agent: Agent): Promise<AnswerResult> {
  if (!(await requiresAnswer(agent.client, agent.goal))) return { status: "not_requested" };
  let feedback: string | undefined;

  for (let attempt = 0; attempt < 2; attempt++) {
    let answer: string | null = null;
    let generationError: string | undefined;

    try {
      const generated = await extractAnswer(agent.goal, agent.page, agent.progressObservations, feedback, answerReviewModel());
      answer = generated.answer;
    } catch (error) {
      generationError = String(error);
    }

    if (generationError) return { status: "unverified", reason: generationError };
    const context = answerReviewContext(agent.goal, answer, outcomeObservation(agent.page), agent.progressObservations);

    trace("answer_review_request", context);
    const response = await reviewAnswer(context);
    trace("answer_review_verdict", response);

    if (response.verdict === "NOT_REQUESTED") return { status: "not_requested" };

    if (response.verdict === "SUPPORTED" && answer) return { status: "supported", answer };

    if (response.verdict === "MISSING_EVIDENCE") return { status: "missing_evidence", reason: response.reason };

    feedback = `Review feedback: ${response.reason} Provide the complete requested information from observations, with no placeholders or unsupported claims. Return null if evidence is missing.`;
  }

  return { status: "unverified", reason: "Answer failed evidence review after regeneration" };
}
