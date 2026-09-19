/**
 * The indexed action space: one element index per observed DOM node, one
 * valid target set per operation. Element ids stay bound to nodes, so the
 * model can only name things that were actually observed.
 */

import type { ActionKind, JsonValue, ObservedAction } from "../types.ts";

/** One candidate element as presented to the choice model. */
export type ElementChoice = {
  index: string;
  label: string;
  operations: string[];
  role?: string;
  value?: string;
  checked?: string;
  selected?: string;
  expanded?: string;
  options?: { index: string; label: string; value: JsonValue }[];
};

export function actionSpace(actions: ObservedAction[]) {
  const elements: any[] = [];
  const indices = new Map<number, string>();
  const targets: Record<string, Record<string, ObservedAction>> = {};
  const controls: Record<string, ObservedAction> = {};

  const operations: Partial<Record<ActionKind, string>> = {
    click: "CLICK",
    fill: "TYPE_TEXT",
    select: "SELECT",
    hover: "HOVER",
  };

  for (const action of actions) {
    const kind = action.kind;
    const operation = operations[kind];

    if (operation === undefined) {
      controls[action.id.toUpperCase()] = action;
      continue;
    }

    const node = action.node!;
    let index = indices.get(node);

    if (index === undefined) {
      index = String(elements.length + 1);
      indices.set(node, index);

      const element: ElementChoice = {
        index,
        label: action.label.split(" → ")[0],
        operations: [],
      };

      for (const k of ["role", "value", "checked", "selected", "expanded"] as const) {
        const v = action[k];

        if (v !== undefined) element[k] = v;
      }

      if (kind === "select") {
        element.value = action.current_value ?? "";
        element.options = [];
      }

      elements.push(element);
    }

    const group = (targets[operation] ??= {});
    const element = elements[Number(index) - 1];

    if (!element.operations.includes(operation)) element.operations.push(operation);
    let target = index;

    if (kind === "select") {
      const options = (element.options ??= []);
      target = `${index}:${options.length + 1}`;
      options.push({ index: target, label: action.label, value: action.value });
    }

    group[target] = action;
  }

  // DRAG sources and CONTEXT_CLICK targets come only from flagged elements:
  // draggable===true marks a real drag source, contextMenu===true a real
  // right-click handler. With no flags neither operation is offered — the
  // model picks CLICK instead of aiming at an element that can't respond.
  for (const action of actions) {
    if (action.node === undefined) continue;

    const index = indices.get(action.node);

    if (index === undefined) continue;

    const element = elements[Number(index) - 1];

    if (action.draggable === true) {
      (targets.DRAG ??= {})[index] = action;

      if (!element.operations.includes("DRAG")) element.operations.push("DRAG");
    }

    if (action.contextMenu === true) {
      (targets.CONTEXT_CLICK ??= {})[index] = action;

      if (!element.operations.includes("CONTEXT_CLICK")) element.operations.push("CONTEXT_CLICK");
    }
  }

  // A drag destination is wherever the source lands — drop zones are often
  // plain elements with no interactive signal of their own, so the dest
  // pool is the whole indexed set, not the flagged sources. dropZone flags
  // only make otherwise-invisible targets reachable.
  const dragDestinations = { ...targets.CLICK };

  return { elements, targets, controls, dragDestinations };
}
