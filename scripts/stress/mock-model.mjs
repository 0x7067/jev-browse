/**
 * Scripted stand-in for both model endpoints — TypeSafe systemOne and the
 * OpenAI-compatible text helper — so the browser machinery can be exercised
 * without paid keys or model variance. Each task ships a step script; the
 * mock resolves the first unsatisfied step against the observed state and
 * answers exactly as a real model would (valid choice, probabilities, heads).
 *
 * The mock is stateless per request: satisfaction is read from the page,
 * so stale re-decides, repair consults, and probes all converge on the same
 * answer. The decision path in src/ stays untouched — only the base URLs
 * point here.
 *
 * Step shape (evals/stress.json):
 *   { "op": "CLICK", "target": "regex on element label", "until": "regex on page text" }
 *   { "op": "TYPE_TEXT", "target": "regex", "text": "value", "until": { "value": ["target regex", "value regex"] } }
 *   { "op": "SELECT", "target": "regex", "option": "regex on option label", "until": ... }
 *   { "op": "PRESS_ENTER" | "SCROLL_DOWN" | "WAIT" | "GO_BACK" ..., "until": ... }
 *   { "op": "HOVER" | "CONTEXT_CLICK", "target": "regex", "until": ... }
 *   { "op": "DRAG", "source": "regex", "target": "regex", "until": ... }
 *   "until" may also be { "url": "regex" }, { "focused": true }, { "element": "label regex" },
 *   { "checked": ["label regex", "true"] }, an array of alternatives (OR),
 *   { "acted": "regex on executed action labels" } or { "acted_count": ["regex", n] }. Optional
 *   "missing": op to answer when the target is absent (default WAIT),
 *   "follow_up": speculative head answer (NONE | PRESS_ENTER | CLICK_MATCH_TYPED | DONE_AFTER).
 * When every step is satisfied, or the task's "done_when" regex matches the
 * page text, the mock answers DONE.
 */

import { createServer } from "node:http";

const CONFIDENT = 0.92;

function distribute(keys, chosen) {
  const probabilities = {};
  const rest = keys.filter((k) => k !== chosen);
  const share = rest.length ? (1 - CONFIDENT) / rest.length : 0;

  for (const k of keys) probabilities[k] = k === chosen ? (rest.length ? CONFIDENT : 1) : share;

  return { choice: chosen, confidence: CONFIDENT, probabilities };
}

const re = (pattern) => new RegExp(pattern, "i");

function satisfied(step, state) {
  const until = step.until;

  if (until === undefined) return false;

  // An array is OR: any satisfied alternative satisfies the step.
  if (Array.isArray(until)) return until.some((u) => satisfied({ until: u }, state));

  if (until.text) return re(until.text).test(state.page.text ?? "");

  if (until.element) return state.elements.some((e) => re(until.element).test(e.label));

  if (until.checked) {
    const [label, value] = until.checked;
    const element = state.elements.find((e) => re(label).test(e.label));

    return element !== undefined && String(element.checked) === value;
  }

  if (until.url) return re(until.url).test(state.page.url ?? "");

  if (until.value) {
    const [label, value] = until.value;
    const element = state.elements.find((e) => re(label).test(e.label));

    return element !== undefined && re(value).test(element.value ?? "");
  }

  if (until.focused) return state.page.focused !== undefined;

  // History-based satisfaction for steps with no page-visible effect
  // (key presses, history navigation): the executed action labels.
  const acted = (state.recent_actions ?? []).map((a) => a.action ?? "");

  if (until.acted) return acted.some((a) => re(until.acted).test(a));

  if (until.acted_count) {
    const [pattern, n] = until.acted_count;

    return acted.filter((a) => re(pattern).test(a)).length >= n;
  }

  return false;
}

function findTarget(pool, pattern) {
  for (const [index, criterion] of Object.entries(pool)) {
    // Criteria read "[7] Label" — match the label alone.
    if (re(pattern).test(criterion.element.replace(/^\[[^\]]+\] /, ""))) return index;
  }

  return null;
}

/** Resolve the systemOne answers for one observed state under one script. */
export function decide(script, body) {
  const { state, questions } = body;
  const operationKeys = Object.keys(questions.operation.criteria);
  const answers = {};

  // Every target head gets an answer — the real model answers all questions.
  for (const [name, q] of Object.entries(questions)) {
    if (name === "operation" || name === "follow_up") continue;
    const keys = Object.keys(q.criteria);
    answers[name] = distribute(keys, keys[0]);
  }

  answers.follow_up = distribute(Object.keys(questions.follow_up.criteria), "NONE");

  const finish = (op, note) => {
    answers.operation = distribute(operationKeys, op);
    answers.__note = note;

    return answers;
  };

  // A task-level done condition short-circuits the steps: after a form
  // submit the fields that carried the step conditions are gone.
  if (script.done_when && re(script.done_when).test(state.page.text ?? "")) {
    return finish("DONE", "done_when matched");
  }

  const step = script.find((s) => !satisfied(s, state));

  if (!step) return finish("DONE", "all steps satisfied");

  const op = step.op;

  if (!operationKeys.includes(op)) {
    const fallback = step.missing ?? "WAIT";

    return finish(operationKeys.includes(fallback) ? fallback : "WAIT", `${op} not offered`);
  }

  if (step.follow_up && step.follow_up in questions.follow_up.criteria) {
    answers.follow_up = distribute(Object.keys(questions.follow_up.criteria), step.follow_up);
  }

  const head = questions[`${op.toLowerCase()}_target`];

  if (!head) return finish(op, `control ${op}`);

  if (op === "DRAG") {
    const dest = findTarget(head.criteria, step.target);
    const source = findTarget(questions.drag_source.criteria, step.source);

    if (dest === null || source === null) {
      return finish(operationKeys.includes(step.missing ?? "WAIT") ? step.missing ?? "WAIT" : "WAIT", "drag ends absent");
    }

    answers.drag_target = distribute(Object.keys(head.criteria), dest);
    answers.drag_source = distribute(Object.keys(questions.drag_source.criteria), source);

    return finish(op, `drag ${source} → ${dest}`);
  }

  let index = findTarget(head.criteria, step.target);

  if (op === "SELECT" && index !== null && step.option) {
    // SELECT targets are "index:option" pairs; narrow to the option label.
    index =
      Object.keys(head.criteria).find(
        (k) => k.startsWith(`${index.split(":")[0]}:`) && re(step.option).test(head.criteria[k].element),
      ) ?? null;
  }

  if (index === null) {
    const fallback = step.missing ?? "WAIT";

    return finish(operationKeys.includes(fallback) ? fallback : "WAIT", `target /${step.target}/ absent`);
  }

  answers[`${op.toLowerCase()}_target`] = distribute(Object.keys(head.criteria), index);

  return finish(op, `${op} ${index}`);
}

/** Resolve the text-helper value: the first TYPE_TEXT step whose target matches the field. */
export function fieldValue(script, context) {
  const step = script.find(
    (s) => s.op === "TYPE_TEXT" && s.target && re(s.target).test(context.field.label),
  );

  return step?.text ?? null;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (d) => (data += d));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(e);
      }
    });
  });
}

/**
 * Start the mock. `scripts` maps goal text → step script; `opts.latencyMs`
 * adds an artificial model round-trip so timing stays honest about what is
 * machinery and what is the model. Resolves to { port, calls, close }.
 */
/** Task JSON writes a bare string for a page-text match; give it its key here. */
export function normalizeScript(script, doneWhen) {
  const norm = (u) => (Array.isArray(u) ? u.map(norm) : u instanceof Object ? u : { text: u });
  const steps = script.map((step) => ("until" in step ? { ...step, until: norm(step.until) } : step));

  if (doneWhen) steps.done_when = doneWhen;

  return steps;
}

export function startMock(rawScripts, opts = {}) {
  const scripts = new Map(
    [...rawScripts].map(([goal, { script, done_when }]) => [goal, normalizeScript(script, done_when)]),
  );

  const calls = { decide: 0, text: 0, unmatched: 0, log: [] };
  const goalOf = (goal) => goal.split("\n\n")[0].trim();

  const server = createServer(async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (req.method === "HEAD") return void res.end();

    let body;

    try {
      body = await readJson(req);
    } catch {
      return send(400, { error: "bad json" });
    }

    if (opts.latencyMs) await new Promise((r) => setTimeout(r, opts.latencyMs));

    if (req.url === "/v1/systemone") {
      calls.decide++;
      const goal = goalOf(body.questions?.operation?.instructions?.goal ?? "");
      const script = scripts.get(goal);

      if (!script) {
        calls.unmatched++;

        return send(400, { error: `no script for goal: ${goal.slice(0, 80)}` });
      }

      const answers = decide(script, body);
      const note = answers.__note;
      delete answers.__note;
      calls.log.push({ goal, op: answers.operation.choice, note, elements: body.state.elements.length });

      return send(200, { answers, model: "mock-jev", usage: { input_tokens: 0, output_tokens: 0 } });
    }

    if (req.url === "/v1/chat/completions") {
      calls.text++;
      const context = JSON.parse(body.messages[1].content);
      const script = scripts.get(goalOf(context.goal));
      const text = script ? fieldValue(script, context) : null;

      return send(200, {
        choices: [{ message: { content: JSON.stringify({ text }) } }],
        usage: {},
      });
    }

    send(404, { error: "unknown route" });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        port: server.address().port,
        calls,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync } = await import("node:fs");
  const tasks = JSON.parse(readFileSync(process.argv[2] ?? "evals/stress.json", "utf8"));
  const scripts = new Map(tasks.map((t) => [t.goal.trim(), { script: t.script, done_when: t.done_when }]));
  const mock = await startMock(scripts);
  console.log(`mock model on http://127.0.0.1:${mock.port}`);
}
