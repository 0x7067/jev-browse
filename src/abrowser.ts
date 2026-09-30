import { doubleClickScript } from "./double-click.ts";
import { parseOutput } from "./ab-output.ts";
import { BrowserTabs } from "./ab-tabs.ts";
import { tagTarget, clearTarget, actBoundary, type TargetProbe } from "./ab-target.ts";
import { createListenerInit } from "./listeners.ts";
import { targetDetails } from "./target-details.ts";

import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { fingerprint, isJsonObject, markerMatches } from "./json.ts";
import { loadSnapshotJs } from "./snapshot-loader.ts";
import { sleep } from "./sleep.ts";
import {
  StalePage,
  type ActResult,
  type BrowserDriver,
  type JsonValue,
  type ObservedAction,
  type PageState,
} from "./types.ts";

const execFileAsync = promisify(execFile);

const READ_STATE = loadSnapshotJs();

const MARKER = `(() => { const state=${READ_STATE}; return state?.marker ?? null; })()`;

const TAG_ATTR = "data-jev-node";

const PRESS_KEYS: ReadonlyMap<string, string> = new Map(
  Object.entries({
    enter: "Enter",
    tab: "Tab",
    escape: "Escape",
    backspace: "Backspace",
    delete: "Delete",
    arrowup: "ArrowUp",
    arrowdown: "ArrowDown",
    arrowleft: "ArrowLeft",
    arrowright: "ArrowRight",
    home: "Home",
    end: "End",
    pageup: "PageUp",
    pagedown: "PageDown",
    space: "Space",
  }),
);

const STALE_ERROR =
  /context.{0,20}destroy|execution context|navigat|detach|target.{0,20}(closed|crash)|page.{0,20}(closed|crash)|tab_gone/i;

const SCROLL_DELTA = 560;

export interface AgentBrowserOptions {
  bin?: string;
  session?: string;
  launchArgs?: string[];
}

export class AgentBrowser implements BrowserDriver {
  private bin: string;
  private session: string;
  private launchArgs: string[];
  private tabs = new BrowserTabs(args => this.run(args));
  private afterInput: ObservedAction | null = null;
  private opened = false;
  private listenerInit = createListenerInit();

  private constructor(opts: AgentBrowserOptions) {
    this.bin = opts.bin ?? process.env.JEV_AGENT_BROWSER_BIN ?? "agent-browser";
    this.session = opts.session ?? `jev-${process.pid}-${Math.floor(Math.random() * 1e6)}`;
    this.launchArgs = opts.launchArgs ?? [];
  }

  static async open(url: string, opts: AgentBrowserOptions = {}): Promise<AgentBrowser> {
    const browser = new AgentBrowser(opts);

    const profile =
      process.env.JEV_AB_PROFILE ?? join(homedir(), ".jev-browse", "agent-browser-profile");

    try {
      await browser.run(["--profile", profile, "--init-script", browser.listenerInit.path, ...browser.launchArgs, "open"]);
      browser.opened = true;
      await browser.run(["open", url]);
      await browser.tabs.refresh();
    } catch (error) {
      await browser.close();
      throw error;
    }

    for (let i = 0; i < 150; i++) {
      const ready = await browser
        .evaluate("document.readyState")
        .catch(() => null);

      if (ready === "complete") break;
      await sleep(100);
    }

    return browser;
  }

  private env(): NodeJS.ProcessEnv {
    const env = { ...process.env };
    delete env.AGENT_BROWSER_PROFILE;
    delete env.AGENT_BROWSER_SESSION;

    return env;
  }

  private async run(args: string[]): Promise<JsonValue> {
    const argv = ["--session", this.session, "--json", ...args];
    let stdout: string;

    try {
      const result = await execFileAsync(this.bin, argv, {
        maxBuffer: 32 * 1024 * 1024,
        timeout: 120_000,
        env: this.env(),
      });

      stdout = result.stdout;
    } catch (error: any) {
      const detail = (error?.stderr || error?.stdout || error?.message || "").toString().trim();

      if (STALE_ERROR.test(detail)) {
        throw new StalePage(`agent-browser ${args[0]} hit a changed page`);
      }

      throw new Error(`agent-browser ${args[0]} failed: ${detail.slice(-500)}`);
    }

    try {
      return parseOutput(stdout);
    } catch (error) {
      if (error instanceof Error && STALE_ERROR.test(error.message)) {
        throw new StalePage(`agent-browser ${args[0]} hit a changed page`);
      }

      throw error;
    }
  }

  private async evaluate<T>(expression: string): Promise<T | undefined> {
    const argv = ["--session", this.session, "--json", "eval", "--stdin"];
    let stdout: string;

    try {
      const result = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        const child = execFile(
          this.bin,
          argv,
          { maxBuffer: 32 * 1024 * 1024, timeout: 60_000, env: this.env() },
          (error, stdout, stderr) =>
            error
              ? reject(Object.assign(error, { stdout, stderr }))
              : resolve({ stdout, stderr }),
        );

        child.stdin!.end(expression);
      });

      stdout = result.stdout;
    } catch (error: any) {
      const detail = (error?.stderr || error?.stdout || "").toString();

      if (STALE_ERROR.test(detail)) {
        throw new StalePage("Document changed during evaluation");
      }

      throw new Error(`agent-browser eval failed: ${detail.slice(-500) || error?.message}`);
    }

    let parsed: any;

    try {
      parsed = parseOutput(stdout);
    } catch (error: any) {
      if (STALE_ERROR.test(String(error?.message))) {
        throw new StalePage("Document changed during evaluation");
      }

      throw error;
    }

    if (isJsonObject(parsed) && "result" in parsed) {
      return parsed.result as T;
    }

    return parsed as T | undefined;
  }

  async inspectTarget(node: number): Promise<JsonValue> {
    return this.evaluate(targetDetails(node));
  }

  async observe(): Promise<PageState> {
    const tabs = await this.tabs.refresh();

    if (this.afterInput) {
      const action = this.afterInput;
      this.afterInput = null;

      try {
        await this.evaluate(`(action => new Promise(resolve => {
          const field=window.__jevFast?.node(action.node);
          const autocomplete=action.kind==='fill' && field?.getAttribute('role')==='combobox';
          let frames=0, stopped=false;
          const finish=()=>{stopped=true;resolve()};
          setTimeout(finish,autocomplete ? 200 : 50);
          const ready=()=>{
            if (stopped) return;
            const ids=(field?.getAttribute('aria-controls')||field?.getAttribute('aria-owns')||'')
              .split(/\\s+/).filter(Boolean);
            const roots=ids.length ? ids.map(id=>document.getElementById(id)).filter(Boolean) : [document];
            const options=roots.flatMap(root=>[...root.querySelectorAll('[role="option"]')]);
            if (++frames>=2 && (!autocomplete || options.some(e=>{
              const r=e.getBoundingClientRect();
              return r.width && r.height && r.bottom>0 && r.top<innerHeight &&
                e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true});
            }))) finish();
            else requestAnimationFrame(ready);
          };
          requestAnimationFrame(ready);
        }))(${JSON.stringify(action)})`);
      } catch {
      }
    }

    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        const info = await this.evaluate<PageState | null>(READ_STATE);

        if (info === null || info === undefined) throw new StalePage("Document is navigating");
        this.tabs.decorate(info, tabs);
        info.fingerprint = fingerprint(info);

        return info;
      } catch (error) {
        if (!(error instanceof StalePage) || attempt === 99) throw error;
        await sleep(40);
      }
    }

    throw new StalePage("Page did not settle");
  }

  async fresh(
    page: PageState,
    action?: ObservedAction,
    level: "full" | "page" | "structure" | "completion" = "full",
  ): Promise<boolean> {
    if (action && (action.kind === "click" || action.kind === "double_click" || action.kind === "select")) {
      const node = action.node;

      if (node === undefined) return false;

      const current = await this.evaluate(
        `(() => { const c=window.__jevFast; return c ? [c.pageKey(),c.guard(c.node(${node}))] : null; })()`,
      );

      return JSON.stringify(current) === JSON.stringify([page.page_key, page.guards[String(node)]]);
    }

    if (level === "page") {
      const current = await this.evaluate(
        `(() => { const c=window.__jevFast; return c ? c.pageKey() : null; })()`,
      );

      return JSON.stringify(current) === JSON.stringify(page.page_key);
    }

    return markerMatches(level, await this.evaluate<JsonValue>(MARKER), page.marker);
  }

  async act(action: ObservedAction, page: PageState, text?: string | null): Promise<ActResult> {
    if (action.kind === "focus_tab") {
      await this.tabs.focus(String(action.value ?? ""));

      return { executed: action.id };
    }

    if (!(await this.fresh(page, action, "page"))) {
      throw new StalePage("Page changed since this decision. Observe again.");
    }

    const kind = action.kind;

    if (kind === "wait") {
      await this.run(["wait", "100"]);

      return { executed: action.id };
    }

    if (kind === "scroll") {
      const delta = action.delta ?? SCROLL_DELTA;

      if (action.node === undefined) await this.run(["scroll", delta > 0 ? "down" : "up", String(Math.abs(delta))]);
      else {
        const present = await this.evaluate(`(() => {
          const e=window.__jevFast?.node(${action.node});
          if (!e?.isConnected) return false;
          e.scrollBy({top:${JSON.stringify(delta)},behavior:'instant'});
          return true;
        })()`);

        if (!present) throw new StalePage("Scroll region is gone. Observe again.");
      }

      this.afterInput = action;

      return { executed: action.id };
    }

    if (kind === "back" || kind === "forward") {
      await this.run([kind]);

      return { executed: action.id };
    }

    if (kind === "press") {
      const key = PRESS_KEYS.get(String(action.key));

      if (!key) throw new Error(`Unknown key ${action.key}`);
      await this.run(["press", key]);
      this.afterInput = action;

      return { executed: action.id };
    }

    if (action.node === undefined) throw new Error("Invalid observed node");

    const tagged = await this.evaluate<TargetProbe>(tagTarget(action));

    if (tagged && "blocked" in tagged && (kind === "click" || kind === "double_click" || kind === "hover" || kind === "context")) {
      return this.dispatchDom(action, text);
    }

    if (!tagged || "blocked" in tagged) {
      if (kind === "select") {
        throw new Error("Dropdown execution was not confirmed; inspect before retrying.");
      }

      throw new StalePage("Target changed or is covered. Observe again.");
    }

    const selector = `[${TAG_ATTR}="${action.node}"]`;

    try {
      if (await actBoundary(action, tagged, text, async (args) => { await this.run(args); }, async (expression) => { await this.evaluate(expression); })) {
        this.afterInput = action;

        return { executed: action.id };
      }

      if (kind === "drag" && action.dragTo !== undefined) {
        await this.evaluate(`(() => {
          const c=window.top.__jevFast;
          const src=c?.node(${action.node}), dst=c?.node(${action.dragTo});
          if (!src || !dst) return "stale";
          const dt=new DataTransfer();
          const fire=(t,el)=>el.dispatchEvent(new DragEvent(t,{bubbles:true,cancelable:true,dataTransfer:dt}));
          fire("dragstart",src); fire("dragenter",dst); fire("dragover",dst);
          fire("drop",dst); fire("dragend",src);
          return "ok";
        })()`);
      } else if (kind === "context") {
        await this.evaluate(`(() => {
          const e=window.top.__jevFast?.node(${action.node});
          if (!e) return "stale";
          const r=e.getBoundingClientRect();
          const base={bubbles:true,cancelable:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2};
          const seq=[
            ["pointerover",PointerEvent,{}],
            ["mouseover",MouseEvent,{}],
            ["pointerdown",PointerEvent,{button:2,buttons:2}],
            ["mousedown",MouseEvent,{button:2,buttons:2}],
            ["pointerup",PointerEvent,{button:2,buttons:0}],
            ["mouseup",MouseEvent,{button:2,buttons:0}],
            ["contextmenu",MouseEvent,{button:2}],
          ];
          for (const [t,Ev,extra] of seq) e.dispatchEvent(new Ev(t,{...base,...extra}));
          return "ok";
        })()`);
      } else if (kind === "double_click") {
        await this.evaluate(doubleClickScript(action.node));
      } else if (kind === "click") {
        await this.run(["click", selector]);
      } else if (kind === "hover") {
        await this.run(["hover", selector]);
      } else if (kind === "fill") {
        if (tagged.inputType === "file") {
          await this.run(["upload", selector, text ?? ""]);
        } else {
          await this.run(["fill", selector, text ?? ""]);
        }
      } else if (kind === "select") {
        await this.run(["select", selector, String(action.value)]);
      }
    } catch (error) {
      if (kind === "select") {
        throw new Error("Dropdown execution was not confirmed; inspect before retrying.");
      }

      throw error;
    } finally {
      await this.evaluate(clearTarget(action.node)).catch(() => {});
    }

    this.afterInput = action;

    return { executed: action.id };
  }

  async domClick(
    action: ObservedAction,
    page: PageState,
    text?: string | null,
  ): Promise<ActResult> {
    if (!(await this.fresh(page, action)) || action.node === undefined) {
      throw new StalePage("Page changed since this decision. Observe again.");
    }

    return this.dispatchDom(action, text);
  }

  private async dispatchDom(action: ObservedAction, text?: string | null): Promise<ActResult> {
    if (action.kind === "double_click" && action.node !== undefined) {
      await this.evaluate(doubleClickScript(action.node));
      this.afterInput = action;

      return { executed: action.id };
    }

    if (action.kind === "fill") {
      await this.evaluate(`(() => {
        const e=window.__jevFast?.node(${action.node});
        if (!e?.isConnected) return "stale";
        if (e.isContentEditable) {
          e.innerText=${JSON.stringify(text ?? "")};
        } else {
          const proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement:HTMLInputElement;
          Object.getOwnPropertyDescriptor(proto.prototype,'value').set.call(e,${JSON.stringify(text ?? "")});
        }
        e.dispatchEvent(new Event('input',{bubbles:true}));
        e.dispatchEvent(new Event('change',{bubbles:true}));
        return "ok";
      })()`);
      this.afterInput = action;

      return { executed: action.id };
    }

    const types =
      action.kind === "hover"
        ? ["mouseover", "mousemove"]
        : action.kind === "context"
          ? ["pointerdown", "mousedown", "pointerup", "mouseup", "contextmenu"]
          : ["pointerdown", "mousedown", "pointerup", "mouseup", "click"];

    await this.evaluate(`(() => {
      const e=window.__jevFast?.node(${action.node});
      if (!e) return "stale";
      const r=e.getBoundingClientRect(), w=e.ownerDocument.defaultView;
      const opts={bubbles:true,cancelable:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2,button:${action.kind === "context" ? 2 : 0}};
      for (const t of ${JSON.stringify(types)}) {
        const Ev = t.startsWith("pointer") ? w.PointerEvent : w.MouseEvent;
        e.dispatchEvent(new Ev(t,opts));
      }
      return "ok";
    })()`);
    this.afterInput = action;

    return { executed: action.id };
  }

  async close(): Promise<void> {
    this.listenerInit.dispose();

    if (!this.opened) return;

    try {
      await this.run(["close"]);
    } catch {
    }

    this.opened = false;
  }
}
