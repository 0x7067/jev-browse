import { atWordBoundary, fold } from "../model/text.ts";
import type { HistoryEntry, ObservedAction } from "../types.ts";

export const UNDO_LABEL = /^\s*(remove|delete|clear|deselect|unselect|undo|×|✕|✖|x)\b/i;

export function resolveFollowUp(
  fu: { type: string; text: string | null; prevNodes: Set<number> },
  actions: ObservedAction[],
): string | null {
  if (fu.type === "PRESS_ENTER") {
    return actions.find((a) => a.id === "press_enter")?.id ?? null;
  }

  if (fu.type === "CLICK_MATCH_TYPED") {
    const appeared = actions.filter(
      (a) =>
        a.kind === "click" &&
        a.node !== undefined &&
        !fu.prevNodes.has(a.node) &&
        !UNDO_LABEL.test(a.label),
    );

    if (fu.text && fu.text.length >= 3) {
      const tokens = fold(fu.text)
        .split(/[^\p{L}\p{N}]+/u)
        .filter((t) => t.length >= 3);

      const matched = appeared.find((a) =>
        tokens.some((t) => atWordBoundary(fold(a.label), t)),
      );

      if (matched) return matched.id;
    }

    if (appeared.length === 1) return appeared[0].id;
  }

  return null;
}

export function toggleHint(history: HistoryEntry[]): string | null {
  const tail = history.slice(-2);

  const norm = (s: string) => s.replace(/ \(dom\)$/, "");

  if (
    tail.length === 2 &&
    tail[0].kind === "click" &&
    tail[1].kind === "click" &&
    norm(tail[0].action) === norm(tail[1].action) &&
    tail[0].page_changed === true &&
    tail[1].page_changed === true
  ) {
    return `"${norm(tail[1].action)}" is a toggle: clicking it again just re-closes what it opened. The items it revealed are in the table — act on one of them instead.`;
  }

  return null;
}
