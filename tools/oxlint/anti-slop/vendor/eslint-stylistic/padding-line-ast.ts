import type { ESTree, SourceCode, Token as SyntaxToken, Comment, Location } from "@oxlint/plugins";

type Token = SyntaxToken | Comment;

export const LINEBREAKS = new Set(["\r\n", "\r", "\n", "\u2028", "\u2029"]);

export const isClosingBraceToken = (token: Token): boolean =>
  token.type === "Punctuator" && token.value === "}";

export const isSemicolonToken = (token: Token): boolean =>
  token.type === "Punctuator" && token.value === ";";

export const isNotSemicolonToken = (token: Token): boolean => !isSemicolonToken(token);

export const isTokenOnSameLine = (left: { loc: Location }, right: { loc: Location }): boolean =>
  left.loc.end.line === right.loc.start.line;

export const isFunction = (node: ESTree.Node): boolean =>
  node.type === "FunctionDeclaration" ||
  node.type === "FunctionExpression" ||
  node.type === "ArrowFunctionExpression";

export const isSingleLine = (node: ESTree.Node): boolean =>
  node.loc.start.line === node.loc.end.line;

export const skipChainExpression = (node: ESTree.Node): ESTree.Node =>
  node.type === "ChainExpression" ? node.expression : node;

export const isTopLevelExpressionStatement = (
  node: ESTree.Node,
): node is ESTree.ExpressionStatement =>
  node.type === "ExpressionStatement" &&
  (node.parent.type === "Program" ||
    (node.parent.type === "BlockStatement" && isFunction(node.parent.parent)));

export function isParenthesized(node: ESTree.Node, sourceCode: SourceCode): boolean {
  const before = sourceCode.getTokenBefore(node);
  const after = sourceCode.getTokenAfter(node);
  return before?.value === "(" && after?.value === ")";
}
