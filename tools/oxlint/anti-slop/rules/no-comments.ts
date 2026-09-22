import { defineRule } from "@oxlint/plugins";

export const noCommentsRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow line, block, and JSDoc comments in implementation source.",
    },
    messages: {
      noComments:
        "Code comments are banned. Prefer clear names and structure; document intent in AGENTS.md or docs/ when needed.",
    },
  },
  createOnce(context) {
    return {
      Program() {
        const text = context.sourceCode.getText();
        for (const comment of context.sourceCode.getAllComments()) {
          if (comment.range[0] === 0 && text.startsWith("#!")) continue;
          context.report({
            loc: comment.loc,
            messageId: "noComments",
          });
        }
      },
    };
  },
});
