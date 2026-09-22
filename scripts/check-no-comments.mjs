#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  ROOT,
  collectCommentRanges,
  listFiles,
} from "./lib/comments.mjs";

function shebangOffset(text) {
  if (!text.startsWith("#!")) return 0;
  const nl = text.indexOf("\n");
  return nl === -1 ? text.length : nl + 1;
}

function lineOf(text, pos) {
  return text.slice(0, pos).split(/\r?\n/).length;
}

const violations = [];
for (const file of listFiles(ROOT)) {
  const text = fs.readFileSync(file, "utf8");
  const offset = shebangOffset(text);
  if (offset > 0 && offset >= text.length) continue;
  const body = text.slice(offset);
  for (const range of collectCommentRanges(body, path.basename(file))) {
    violations.push({
      file: path.relative(ROOT, file),
      line: lineOf(text, range.pos + offset),
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
