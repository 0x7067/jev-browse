import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

export const ROOT = path.resolve(import.meta.dirname, "../..");

export const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

export const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "bundled",
  "evals",
]);

export function listFiles(dir) {
  const out = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      out.push(...listFiles(full));
      continue;
    }

    if (!EXTENSIONS.has(path.extname(entry.name))) continue;
    out.push(full);
  }

  return out;
}

export function scriptKindFor(filePath) {
  switch (path.extname(filePath)) {
    case ".ts":
      return ts.ScriptKind.TS;
    case ".tsx":
      return ts.ScriptKind.TSX;
    case ".jsx":
      return ts.ScriptKind.JSX;
    default:
      return ts.ScriptKind.JS;
  }
}

export function collectCommentRanges(body, fileName) {
  const sourceFile = ts.createSourceFile(
    fileName,
    body,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(fileName),
  );

  const byKey = new Map();

  const add = (ranges) => {
    for (const range of ranges ?? []) {
      byKey.set(`${range.pos}:${range.end}`, {
        pos: range.pos,
        end: range.end,
        text: body.slice(range.pos, range.end),
      });
    }
  };

  const visit = (node) => {
    add(ts.getLeadingCommentRanges(body, node.getFullStart()));
    add(ts.getTrailingCommentRanges(body, node.end));

    for (const child of node.getChildren(sourceFile)) {
      visit(child);
    }
  };

  visit(sourceFile);
  add(ts.getLeadingCommentRanges(body, 0));

  return [...byKey.values()];
}
