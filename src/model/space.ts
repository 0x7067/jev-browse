
import type { ActionKind, JsonValue, ObservedAction } from "../types.ts";

export type ElementChoice = {
  index: string;
  label: string;
  operations: string[];
  role?: string;
  value?: string;
  checked?: string;
  selected?: string;
  expanded?: string;
  position?: string;
  below?: boolean;
  options?: { index: string; label: string; value: JsonValue }[];
};

export function actionSpace(actions: ObservedAction[], delegatedContextmenu = false) {
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

      for (const k of ["role", "value", "checked", "selected", "expanded", "position"] as const) {
        const v = action[k];

        if (v !== undefined) element[k] = v;
      }

      if (action.below === true) element.below = true;

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

  if (delegatedContextmenu) {
    for (const [index, action] of Object.entries(targets.CLICK ?? {})) {
      (targets.CONTEXT_CLICK ??= {})[index] = action;

      const element = elements[Number(index) - 1];

      if (!element.operations.includes("CONTEXT_CLICK")) element.operations.push("CONTEXT_CLICK");
    }
  }

  const dragDestinations = { ...targets.CLICK, ...targets.DRAG };

  return { elements, targets, controls, dragDestinations };
}
