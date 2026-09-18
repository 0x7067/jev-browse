/** Shared types for the driver-agnostic agent loop. */

export type ActionKind =
  | "click"
  | "fill"
  | "select"
  | "scroll"
  | "wait"
  | "hover"
  | "press"
  | "back"
  | "forward";

export interface ObservedAction {
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
  checked?: string;
  selected?: string;
  expanded?: string;
  [extra: string]: unknown;
}

export interface PageState {
  url: string;
  title: string;
  w: number;
  h: number;
  text: string;
  scroll: { y: number; height: number };
  actions: ObservedAction[];
  marker: unknown;
  page_key: unknown;
  guards: Record<string, unknown>;
  omitted_actions: number;
  fingerprint: string;
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
  /** Is `page` still the live document? With an action, compare only its guard. */
  fresh(page: PageState, action?: ObservedAction): Promise<boolean>;
  /** Execute an observed action. Must re-check freshness before input. */
  act(action: ObservedAction, page: PageState, text?: string | null): Promise<unknown>;
  close(): Promise<void>;
}
