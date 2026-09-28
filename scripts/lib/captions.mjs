import { writeFileSync } from "node:fs";
import { join } from "node:path";

export const PAGE_W = 1120;

export const PAGE_H = 780;

export const PAD = 16;

export const HEADER_H = 60;

export const FOOTER_H = 92;

export const CANVAS_W = PAGE_W + PAD * 2;

export const CANVAS_H = HEADER_H + PAGE_H + FOOTER_H;

const LEAD_S = 0.4;

const TERMINAL = new Set(["DONE", "BLOCKED"]);

const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;

export function captionStates({ events, history, t0, endAt, status, elapsedMs, actions }) {
  const pool = [...history];
  const steps = [];

  for (const e of events) {
    if (e.type !== "step" || !e.action) continue;
    const at = pool.findIndex((h) => h.action === e.action);
    const entry = at >= 0 ? pool.splice(0, at + 1).pop() : null;
    steps.push({
      at: Math.max(0, e.wall - t0 - LEAD_S),
      step: entry?.step ?? steps.length + 1,
      operation: entry?.operation ?? e.operation ?? "",
      label: TERMINAL.has(e.operation) ? "" : e.action.replace(/\s+/g, " ").trim(),
      text: entry?.text ?? null,
      elapsedMs: e.elapsed_ms ?? 0,
    });
  }

  const states = [{ at: 0, kind: "start" }];

  for (const s of steps) {
    const prev = states[states.length - 1].at;
    states.push({ ...s, kind: "step", at: Math.max(s.at, prev + 0.25) });
  }

  const finalAt = Math.max(states[states.length - 1].at + 0.6, endAt - 2.5);
  states.push({ at: finalAt, kind: "final", status, elapsedMs, actions });

  return states.map((s, i) => ({ ...s, until: i + 1 < states.length ? states[i + 1].at : endAt }));
}

function footerHtml(state) {
  if (state.kind === "start") {
    return `<span class="muted">Reading the page</span>`;
  }

  if (state.kind === "final") {
    const ok = state.status === "done";

    return `<span class="chip ${ok ? "ok" : "bad"}">${ok ? "DONE" : escapeHtml(String(state.status).toUpperCase())}</span>
      <span class="muted">${state.actions} actions</span>
      <span class="time">${seconds(state.elapsedMs)}</span>`;
  }

  const typed = state.text ? `<span class="typed">“${escapeHtml(state.text)}”</span>` : "";

  return `<span class="step">${String(state.step).padStart(2, "0")}</span>
    <span class="chip">${escapeHtml(state.operation)}</span>
    <span class="label">${escapeHtml(state.label)}</span>${typed}
    <span class="time">${seconds(state.elapsedMs)}</span>`;
}

function pageHtml(state, goal) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; width: ${CANVAS_W}px; height: ${CANVAS_H}px; background: transparent; overflow: hidden;
      font-family: -apple-system, "SF Pro Text", "Helvetica Neue", sans-serif; color: #e8eaf0; }
    .hole { position: absolute; left: ${PAD}px; top: ${HEADER_H}px; width: ${PAGE_W}px; height: ${PAGE_H}px;
      border-radius: 12px; box-shadow: 0 0 0 3000px #0e1015, 0 0 0 3001px #262a33; }
    header, footer { position: absolute; left: ${PAD + 4}px; right: ${PAD + 4}px; display: flex; align-items: center; gap: 14px; }
    header { top: 0; height: ${HEADER_H}px; }
    footer { bottom: 0; height: ${FOOTER_H}px; font-size: 21px; }
    .brand { font: 600 17px "SF Mono", Menlo, monospace; color: #9ecbff; white-space: nowrap; }
    .goal { font-size: 15px; color: #a4aab8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .step { font: 500 17px "SF Mono", Menlo, monospace; color: #6b7280; }
    .chip { font: 600 15px "SF Mono", Menlo, monospace; padding: 6px 11px; border-radius: 7px;
      background: #1f3a5f; color: #9ecbff; white-space: nowrap; }
    .chip.ok { background: #16432b; color: #7ee2a8; }
    .chip.bad { background: #4a1d1d; color: #ffa3a3; }
    .label { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 560px; }
    .typed { color: #f5c26b; white-space: nowrap; }
    .muted { color: #8a90a0; }
    .time { margin-left: auto; font: 500 19px "SF Mono", Menlo, monospace; color: #c9ccd6; }
  </style></head><body>
    <div class="hole"></div>
    <header><span class="brand">jev-browse</span><span class="goal">${escapeHtml(goal)}</span></header>
    <footer>${footerHtml(state)}</footer>
  </body></html>`;
}

export async function renderCaptions(send, states, goal, dir) {
  await send("Emulation.setDeviceMetricsOverride", {
    width: CANVAS_W,
    height: CANVAS_H,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
  const { frameTree } = await send("Page.getFrameTree");
  const lines = [];

  for (const [i, state] of states.entries()) {
    await send("Page.setDocumentContent", { frameId: frameTree.frame.id, html: pageHtml(state, goal) });
    await send("Runtime.evaluate", { expression: "document.fonts.ready.then(() => true)", awaitPromise: true });
    const { data } = await send("Page.captureScreenshot", { format: "png" });
    const file = join(dir, `c_${String(i).padStart(3, "0")}.png`);
    writeFileSync(file, Buffer.from(data, "base64"));
    lines.push(`file ${file}\nduration ${Math.max(0.04, state.until - state.at).toFixed(3)}`);
  }

  const last = join(dir, `c_${String(states.length - 1).padStart(3, "0")}.png`);
  const concat = join(dir, "captions.txt");
  writeFileSync(concat, `${lines.join("\n")}\nfile ${last}\n`);

  return concat;
}
