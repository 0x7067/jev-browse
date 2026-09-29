import type { TypeSafeClient } from "@typesafe-ai/sdk";
import { choiceRequest } from "./choice-request.ts";

export async function requiresAnswer(client: TypeSafeClient, goal: string): Promise<boolean> {
  const response = await choiceRequest(client, {
    state: { user_goal: goal },
    questions: {
      answer_required: {
        type: "choice",
        criteria: {
          YES: "The user requests information to return: a finding, name, value, explanation, summary, comparison, or other answer.",
          NO: "The user requests only browser actions or a stopping state, with no information to return.",
        },
        instructions: { goal: "Determine whether user_goal requires a written informational answer in addition to browser actions.", rules: "Classify the user's request, not whether the browser task has succeeded. Finding or researching an item requires identifying it; merely opening a specified page does not require an answer." },
      },
    },
  }, "answer_scope");

  return response.answers.answer_required.choice === "YES";
}
