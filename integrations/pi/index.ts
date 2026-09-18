// Pi extension for jev-browse. Registers a `jev_browse` tool that runs the Jev
// driver loop in-process and streams step events as tool-call updates.
//
// Dev: this file resolves ../../src/* relative to itself inside the repo
// (needs `npm install` in drive/ once). Packaged installs bundle it into a
// self-contained file — see scripts/install.mjs.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

import { runAgent } from "../../src/cli.ts";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "jev_browse",
    label: "Jev Browse",
    description:
      "Drive a real browser autonomously toward one goal. TypeSafe Jev picks each operation " +
      "and target from the live page (a helper LLM writes field text for TYPE_TEXT). Returns " +
      "final status, URL, and the action history. Prefer this over step-by-step agent_browser " +
      "use for bounded web goals — search, filter, navigate, fill a form.",
    promptSnippet: "Drive a browser toward a bounded goal with Jev as the decision model",
    promptGuidelines: [
      "Use jev_browse for self-contained web tasks with a clear done condition; keep step-by-step agent_browser for exploratory or interactive work.",
      "Give jev_browse a starting url on the target site — the driver navigates in-page and cannot reach the address bar.",
    ],
    parameters: Type.Object({
      goal: Type.String({ description: "One natural-language goal with an explicit stop condition." }),
      url: Type.String({ description: "Starting http(s) URL on the target site." }),
      engine: Type.Optional(
        StringEnum(["cdp", "agent-browser"] as const, {
          description: "Browser backend. cdp launches/attaches Chrome directly (default).",
        }),
      ),
      max_steps: Type.Optional(Type.Number({ description: "Action budget, default 60." })),
    }),
    async execute(_toolCallId, params, signal, onUpdate) {
      const result = await runAgent(
        {
          url: params.url,
          goals: [params.goal],
          engine: params.engine ?? "cdp",
          headed: false,
          maxSteps: params.max_steps,
        },
        {
          signal,
          onEvent: (event) =>
            onUpdate?.({
              content: [
                {
                  type: "text",
                  text: `${event.elapsed_ms ?? "?"}ms ${event.operation ?? event.type} ${event.action ?? ""} — ${event.url ?? ""}`.trim(),
                },
              ],
              details: {},
            }),
        },
      );

      if (result.status === "error") {
        // Throw so the call is marked as a tool error, not a prose result.
        throw new Error(result.error ?? "jev-browse run failed");
      }

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  });
}
