/** Shared types for the driver-agnostic agent loop. */

/** A value that survives a JSON round trip — the shape of page- and wire-boundary data. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

export type ActionKind =
  | "click"
  | "context"
  | "drag"
  | "fill"
  | "select"
  | "scroll"
  | "wait"
  | "hover"
  | "press"
  | "back"
  | "forward";

export type ObservedAction = {
  id: string; // "e1".."e250", "scroll_down", "scroll_up", "wait"
  kind: ActionKind;
  label: string;
  node?: number; // code-owned identity into window.__jevFast.nodes
  role?: string;
  value?: string; // select: option value; click/fill: current field value
  current_value?: string;
  delta?: number; // scroll
  key?: string; // press: key name
  frame?: { x: number; y: number }; // iframe: viewport offset for absolute coords
  shadow?: boolean; // element lives in a shadow root
  dragTo?: number; // drag: destination node id into window.__jevFast.nodes
  /** Element matched [draggable="true"] — a DRAG source candidate. */
  draggable?: boolean;
  /** Element matched [oncontextmenu] — a CONTEXT_CLICK candidate. */
  contextMenu?: boolean;
  /** Element carries a drop handler — a DRAG destination candidate. */
  dropZone?: boolean;
  checked?: string;
  selected?: string;
  expanded?: string;
  [extra: string]: JsonValue;
};

export interface PageState {
  url: string;
  title: string;
  w: number;
  h: number;
  text: string;
  scroll: { y: number; height: number };
  actions: ObservedAction[];
  marker: JsonValue;
  page_key: JsonValue;
  guards: Record<string, JsonValue>;
  omitted_actions: number;
  fingerprint: string;
  /** In-flight network requests at observation time (0 or absent when the engine can't tell). */
  pending_requests?: number;
  /** A main-frame navigation was initiated but hasn't committed yet. */
  pending_nav?: boolean;
  /** Last auto-accepted JS dialog message, when one fired since the previous observation. */
  dialog?: string;
  /** Offered-id or short label of the element holding focus, when identifiable. */
  focused?: string;
}

/** Result of executing one observed action. */
export interface ActResult {
  executed: string;
}

/** A decision no longer refers to the observed page. */
export class StalePage extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StalePage";
  }
}

/**
 * One browser backend. The agent loop only sees this surface; engines differ
 * in how they observe and mutate, not in what they expose.
 */
export interface BrowserDriver {
  /** Atomic read of visible content, controls, guards, and marker. */
  observe(): Promise<PageState>;
  /** Is `page` still the live document? With an action, compare only its guard.
   *  level "page" compares just the document key (for actions that don't care
   *  about text churn); "full" (default) includes text and scroll. */
  fresh(page: PageState, action?: ObservedAction, level?: "full" | "page"): Promise<boolean>;
  /** Execute an observed action. Must re-check freshness before input. */
  act(action: ObservedAction, page: PageState, text?: string | null): Promise<ActResult>;
  /** In-page event synthesis, used when trusted input delivers nothing. */
  domClick(action: ObservedAction, page: PageState, text?: string | null): Promise<ActResult>;

  /** A main-frame navigation has started but not committed (CDP only). */
  pendingNav?(): boolean;
  close(): Promise<void>;
}
