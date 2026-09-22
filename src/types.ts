
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
  | "forward"
  | "focus_tab";

export type ObservedAction = {
  id: string;
  kind: ActionKind;
  label: string;
  node?: number;
  role?: string;
  value?: string;
  current_value?: string;
  delta?: number;
  key?: string;
  frame?: { x: number; y: number };
  shadow?: boolean;
  dragTo?: number;
  draggable?: boolean;
  position?: string;
  contextMenu?: boolean;
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
  pending_requests?: number;
  pending_nav?: boolean;
  dialog?: string;
  focused?: string;
  downloads?: string[];
  challenge?: boolean;
  delegatedContextmenu?: boolean;
  tabs?: { title: string; url: string; current?: boolean }[];
}

export interface ActResult {
  executed: string;
}

export class StalePage extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StalePage";
  }
}

export interface BrowserDriver {
  observe(): Promise<PageState>;
  fresh(
    page: PageState,
    action?: ObservedAction,
    level?: "full" | "page" | "structure",
  ): Promise<boolean>;
  act(action: ObservedAction, page: PageState, text?: string | null): Promise<ActResult>;
  domClick(action: ObservedAction, page: PageState, text?: string | null): Promise<ActResult>;

  pendingNav?(): boolean;
  settle?(budgetMs: number, quietMs?: number): Promise<void>;
  close(): Promise<void>;
}
