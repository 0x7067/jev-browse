#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

const ROOT = path.resolve(import.meta.dirname, "..");
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "bundled",
  "evals",
]);

function listFiles(dir) {
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

function scriptKindFor(filePath) {
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

function collectCommentRanges(text, fileName) {
  let body = text;
  let offset = 0;
  if (body.startsWith("#!")) {
    const nl = body.indexOf("\n");
    if (nl === -1) return [];
    offset = nl + 1;
    body = body.slice(offset);
  }

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
        pos: range.pos + offset,
        end: range.end + offset,
        text: body.slice(range.pos, range.end),
      });
    }
  };

  const visit = (node) => {
    add(ts.getLeadingCommentRanges(body, node.getFullStart()));
    add(ts.getTrailingCommentRanges(body, node.end));

    if (ts.isBlock(node) && node.statements.length === 0) {
      const innerStart = node.getStart(sourceFile) + 1;
      const inner = body.slice(innerStart, node.end - 1);
      const pattern = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;
      let match;
      while ((match = pattern.exec(inner)) !== null) {
        const pos = innerStart + match.index;
        const end = pos + match[0].length;
        byKey.set(`${pos}:${end}`, {
          pos: pos + offset,
          end: end + offset,
          text: body.slice(pos, end),
        });
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  add(ts.getLeadingCommentRanges(body, 0));

  return [...byKey.values()];
}

function lineOf(text, pos) {
  return text.slice(0, pos).split(/\r?\n/).length;
}

const violations = [];
for (const file of listFiles(ROOT)) {
  const text = fs.readFileSync(file, "utf8");
  for (const range of collectCommentRanges(text, path.basename(file))) {
    violations.push({
      file: path.relative(ROOT, file),
      line: lineOf(text, range.pos),
      snippet: range.text.slice(0, 80).replace(/\s+/g, " "),
    });
  }
}

if (violations.length > 0) {
  console.error(`Code comments are banned (${violations.length} found):`);
  for (const v of violations.slice(0, 50)) {
    console.error(`  ${v.file}:${v.line}: ${v.snippet}`);
  }
  if (violations.length > 50) {
    console.error(`  ... and ${violations.length - 50} more`);
  }
  process.exit(1);
}

console.log("check-no-comments: ok");
