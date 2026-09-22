#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  ROOT,
  collectCommentRanges,
  listFiles,
} from "./lib/comments.mjs";

function stripComments(text, fileName) {
  let shebang = "";
  let body = text;
  if (body.startsWith("#!")) {
    const nl = body.indexOf("\n");
    if (nl === -1) return text;
    shebang = body.slice(0, nl + 1);
    body = body.slice(nl + 1);
  }

  const ranges = collectCommentRanges(body, fileName).sort(
    (a, b) => b.pos - a.pos,
  );
  if (ranges.length === 0) return text;

  let next = body;
  for (const range of ranges) {
    const before = next.slice(0, range.pos);
    const after = next.slice(range.end);
    const lineStart = before.lastIndexOf("\n") + 1;
    const prefix = before.slice(lineStart);
    const suffixMatch = after.match(/^[^\S\n]*/);
    const suffixWs = suffixMatch ? suffixMatch[0] : "";
    const rest = after.slice(suffixWs.length);
    const onlyWhitespaceAround =
      prefix.trim().length === 0 &&
      (rest.length === 0 || rest.startsWith("\n") || rest.startsWith("\r\n"));

    if (onlyWhitespaceAround) {
      let end = range.end + suffixWs.length;
      if (rest.startsWith("\r\n")) end += 2;
      else if (rest.startsWith("\n")) end += 1;
      next = next.slice(0, lineStart) + next.slice(end);
      continue;
    }

    const trimmedBefore = before.replace(/[^\S\n]+$/, "");
    const trimmedAfter = after.replace(/^[^\S\n]+/, "");
    const needsSpace =
      trimmedBefore.length > 0 &&
      !trimmedBefore.endsWith("\n") &&
      trimmedAfter.length > 0 &&
      !trimmedAfter.startsWith("\n") &&
      /\S$/.test(trimmedBefore) &&
      /^\S/.test(trimmedAfter);
    next = trimmedBefore + (needsSpace ? " " : "") + trimmedAfter;
  }

  next = next.replace(/[^\S\n]+$/gm, "");
  next = next.replace(/\n{3,}/g, "\n\n");
  if (text.endsWith("\n") && !next.endsWith("\n")) next += "\n";
  return shebang + next;
}

function main() {
  const files =
    process.argv.slice(2).length > 0
      ? process.argv.slice(2).map((p) => path.resolve(p))
      : listFiles(ROOT);
  let changed = 0;
  for (const file of files) {
    const original = fs.readFileSync(file, "utf8");
    const stripped = stripComments(original, path.basename(file));
    if (stripped !== original) {
      fs.writeFileSync(file, stripped);
      changed += 1;
      console.log(`stripped ${path.relative(ROOT, file)}`);
    }
  }
  console.log(`updated ${changed} file(s)`);
}

main();
