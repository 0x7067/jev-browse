
import { tool } from "@opencode-ai/plugin";

import { runAgent } from "../../src/cli.ts";

export const jev_browse = async () => ({
  tool: {
    jev_browse: tool({
      description:
        "Drive a real browser autonomously toward one goal. TypeSafe Jev picks each " +
        "operation and target from the live page; a small helper model writes field " +
        "text. Returns final status, URL, and action history. Prefer this for bounded " +
        "web goals over step-by-step browsing.",
      args: {
        goal: tool.schema
          .string()
          .describe("One natural-language goal with an explicit stop condition."),
        url: tool.schema.string().describe("Starting http(s) URL on the target site."),
        engine: tool.schema.enum(["cdp", "agent-browser"]).optional(),
        max_steps: tool.schema.number().optional(),
      },
      async execute(args, context) {
        const result = await runAgent(
          {
            url: args.url,
            goals: [args.goal],
            engine: args.engine === "agent-browser" ? "agent-browser" : "cdp",
            headed: false,
            maxSteps: args.max_steps,
          },
          { signal: context?.abort },
        );

        if (result.status === "error") {
          throw new Error(result.error ?? "jev-browse run failed");
        }

        return JSON.stringify(result, null, 2);
      },
    }),
  },
});
