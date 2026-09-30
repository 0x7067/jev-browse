import type { TypeSafeClient, ChoiceQuestion, SystemOneRequest } from "@typesafe-ai/sdk";
import { trace } from "../trace.ts";
import { validateChoice } from "./decide.ts";

export async function choiceRequest<Q extends Record<string, ChoiceQuestion>>(
  client: TypeSafeClient,
  request: SystemOneRequest<Q>,
  purpose: string,
) {
  for (let attempt = 0; ; attempt++) {
    const response = await client.systemOne(request);
    trace(`${purpose}_response`, response);

    try {
      for (const [name, question] of Object.entries(request.questions)) {
        const answer = response.answers[name];

        if (answer?.type !== "choice") throw new Error("Invalid choice response type");
        validateChoice(answer, new Set(Object.keys(question.criteria)));
      }

      return response;
    } catch (error) {
      trace("choice_validation_error", { purpose, attempt, error: String(error) });

      if (attempt === 1) throw error;
    }
  }
}
