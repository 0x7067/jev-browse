/**
 * Agent-browser engine: the same agent loop, but observation and input go
 * through the `agent-browser` CLI (managed Chrome session). snapshot.js runs
 * via `eval`; code-owned node ids are tagged to data-jev-node attributes and
 * mutated with agent-browser's trusted click/fill/select.
 */

import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { fingerprint, isJsonObject, markerMatches } from "./json.ts";
import { loadSnapshotJs } from "./snapshot-loader.ts";
import {
  StalePage,
  type ActResult,
  type BrowserDriver,
  type JsonValue,
  type ObservedAction,
  type PageState,
} from "./types.ts";

const execFileAsync = promisify(execFile);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const READ_STATE = loadSnapshotJs();

const MARKER = `(() => { const state=${READ_STATE}; return state?.marker ?? null; })()`;

const TAG_ATTR = "data-jev-node";

/** agent-browser press takes DOM key names; the action table uses lowercase ids. */
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

/** stderr/envelope wording that means the page left — bare words like
 *  "closed" or "stale" also match ordinary messages ("reading 'closed'"). */
const STALE_ERROR =
  /context.{0,20}destroy|execution context|navigat|detach|target.{0,20}(closed|crash)|page.{0,20}(closed|crash)|tab_gone/i;

/** Fallback wheel amount when the observed action carried no delta. */
const SCROLL_DELTA = 560;

export interface AgentBrowserOptions {
  /** agent-browser binary; default "agent-browser" on PATH. */
  bin?: string;
  /** Explicit session name; default jev-<pid>. */
  session?: string;
  /** Extra launch-scoped args for the first open, e.g. ["--headed"]. */
  launchArgs?: string[];
}

export class AgentBrowser implements BrowserDriver {
  private bin: string;
  private session: string;
  private launchArgs: string[];
  private afterInput: ObservedAction | null = null;
  private opened = false;

  private constructor(opts: AgentBrowserOptions) {
    this.bin = opts.bin ?? process.env.JEV_AGENT_BROWSER_BIN ?? "agent-browser";
    this.session = opts.session ?? `jev-${process.pid}-${Math.floor(Math.random() * 1e6)}`;
    this.launchArgs = opts.launchArgs ?? [];
  }

  static async open(url: string, opts: AgentBrowserOptions = {}): Promise<AgentBrowser> {
    const browser = new AgentBrowser(opts);

    // A dedicated persistent profile keeps this session off the shared
    // agent-browser Main profile (SingletonLock) while preserving logins.
    const profile =
      process.env.JEV_AB_PROFILE ?? join(homedir(), ".jev-browse", "agent-browser-profile");

    try {
      // open with no URL first: the session binds to its own tab. open <url> at
      // launch can leave the bound tab on about:blank while the page loads in a
      // detached target.
      await browser.run(["--profile", profile, ...browser.launchArgs, "open"]);
      // From here a live session exists; mark before the navigation so close()
      // still tears it down if `open <url>` fails.
      browser.opened = true;
      await browser.run(["open", url]);
    } catch (error) {
      await browser.close();
      throw error;
    }

    // Give the first document a beat before the first snapshot eval.
    for (let i = 0; i < 150; i++) {
      const ready = await browser
        .evaluate("document.readyState")
        .catch(() => null);

      if (ready === "complete") break;
      await sleep(100);
    }

    return browser;
  }

  /** Child env without ambient session/profile pointers — the jev session is self-owned. */
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
        // A mutation that triggers navigation must look stale, not fatal: the
        // agent loop re-observes and decides again on the new page.
        throw new StalePage(`agent-browser ${args[0]} hit a changed page`);
      }

      throw new Error(`agent-browser ${args[0]} failed: ${detail.slice(-500)}`);
    }

    // A success:false envelope whose error describes a dead page is stale too.
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
    // eval --stdin keeps large scripts out of argv.
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
      // A page that navigates mid-eval reports success:false with context errors.
      if (STALE_ERROR.test(String(error?.message))) {
        throw new StalePage("Document changed during evaluation");
      }

      throw error;
    }

    // --json envelope: {success, data:{result: <eval value>}}
    if (isJsonObject(parsed) && "result" in parsed) {
      // SAFETY: the evaluated expression's return contract is declared by each call site's T.
      return parsed.result as T;
    }

    // SAFETY: same contract — a bare eval value rather than an envelope payload.
    return parsed as T | undefined;
  }

  async observe(): Promise<PageState> {
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
        // settle wait is best-effort; the snapshot below is the real read
      }
    }

    // Brief navigations (redirect chains, post-load location changes)
    // outlast a few hundred ms; the retry budget must cover real ones.
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        const info = await this.evaluate<PageState | null>(READ_STATE);

        if (info === null || info === undefined) throw new StalePage("Document is navigating");
        info.fingerprint = fingerprint(info);
        // CLI selectors cannot reach iframe/shadow elements — hide them so the
        // model can't pick unexecutable actions.
        info.actions = info.actions.filter((a) => !a.frame && !a.shadow);

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
    level: "full" | "page" | "structure" = "full",
  ): Promise<boolean> {
    if (action && (action.kind === "click" || action.kind === "select")) {
      const node = action.node;

      if (node === undefined) return false;

      const current = await this.evaluate(
        `(() => { const c=window.__jevFast; return c ? [c.pageKey(),c.guard(c.node(${node}))] : null; })()`,
      );

      return JSON.stringify(current) === JSON.stringify([page.page_key, page.guards[String(node)]]);
    }

    // 'page' level: same document and field state, ignoring text churn.
    if (level === "page") {
      const current = await this.evaluate(
        `(() => { const c=window.__jevFast; return c ? c.pageKey() : null; })()`,
      );

      return JSON.stringify(current) === JSON.stringify(page.page_key);
    }

    return markerMatches(level, await this.evaluate<JsonValue>(MARKER), page.marker);
  }

  async act(action: ObservedAction, page: PageState, text?: string | null): Promise<ActResult> {
    // Guard compare for click/select; document key for everything else.
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
      await this.run(["scroll", delta > 0 ? "down" : "up", String(Math.abs(delta))]);
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

    // Tag the observed node so agent-browser can target it by selector. The
    // model never emits selectors; code maps its own node id to an attribute.
    const tagged = await this.evaluate<string | false>(`(() => {
      const e=window.__jevFast?.node(${action.node});
      // Visibility alone doesn't decide clickability — the covered check
      // below arbitrates; opacity:0 controls win their own hit test.
      if (!e?.isConnected || e.matches(':disabled') || e.closest('[aria-disabled="true"],[inert]')) return false;
      if (${JSON.stringify(kind)}==='fill' && (e.readOnly || e.getAttribute('aria-readonly')==='true')) return false;
      const r=e.getBoundingClientRect(), x=r.x+r.width/2, y=r.y+r.height/2;
      if (!r.width || !r.height || x<0 || y<0 || x>=innerWidth || y>=innerHeight) return false;
      if (!e.contains(document.elementFromPoint(x,y))) return false;
      if (${JSON.stringify(kind)}==='select' &&
          (e.tagName!=='SELECT' || ![...e.options].some(o=>o.value===${JSON.stringify(String(action.value))} &&
              !o.disabled && !o.closest('optgroup[disabled]')))) return false;
      e.setAttribute(${JSON.stringify(TAG_ATTR)}, ${JSON.stringify(String(action.node))});
      return e.tagName==='INPUT' ? e.type : '';
    })()`);

    if (tagged === false || tagged === undefined) {
      if (kind === "select") {
        throw new Error("Dropdown execution was not confirmed; inspect before retrying.");
      }

      throw new StalePage("Target changed or is covered. Observe again.");
    }

    const selector = `[${TAG_ATTR}="${action.node}"]`;

    try {
      if (kind === "drag" && action.dragTo !== undefined) {
        await this.evaluate(`(() => {
          const c=window.__jevFast;
          const src=c?.node(${action.node}), dst=c?.node(${action.dragTo});
          if (!src || !dst) return "stale";
          const dt=new DataTransfer();
          const fire=(t,el)=>el.dispatchEvent(new DragEvent(t,{bubbles:true,cancelable:true,dataTransfer:dt}));
          fire("dragstart",src); fire("dragenter",dst); fire("dragover",dst);
          fire("drop",dst); fire("dragend",src);
          return "ok";
        })()`);
      } else if (kind === "context") {
        // A lone contextmenu event misses hover/down handlers — send the
        // full right-button sequence a real mouse produces.
        await this.evaluate(`(() => {
          const e=document.querySelector(${JSON.stringify(selector)});
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
      } else if (kind === "click") {
        await this.run(["click", selector]);
      } else if (kind === "hover") {
        await this.run(["hover", selector]);
      } else if (kind === "fill") {
        if (tagged === "file") {
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
      await this.evaluate(
        `(() => { document.querySelector('[${TAG_ATTR}]')?.removeAttribute('${TAG_ATTR}'); return true; })()`,
      ).catch(() => {});
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
        : ["pointerdown", "mousedown", "pointerup", "mouseup", "click"];

    await this.evaluate(`(() => {
      const e=window.__jevFast?.node(${action.node});
      if (!e) return "stale";
      const r=e.getBoundingClientRect();
      const opts={bubbles:true,cancelable:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2,button:0};
      for (const t of ${JSON.stringify(types)}) {
        const Ev = t.startsWith("pointer") ? PointerEvent : MouseEvent;
        e.dispatchEvent(new Ev(t,opts));
      }
      return "ok";
    })()`);
    this.afterInput = action;

    return { executed: action.id };
  }

  async close(): Promise<void> {
    if (!this.opened) return;

    try {
      await this.run(["close"]);
    } catch {
      // session already gone
    }

    this.opened = false;
  }
}

/** agent-browser --json prints {success, data, error}; fall back to raw JSON/text. */
function parseOutput(stdout: string): JsonValue {
  const text = stdout.trim();

  if (!text) return null;

  try {
    const parsed = JSON.parse(text);

    if (isJsonObject(parsed) && "success" in parsed) {
      if (parsed.success === false) {
        throw new Error(String(parsed.error ?? "agent-browser call failed").slice(0, 500));
      }

      return parsed.data;
    }

    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) {
      const match = /[{[].*$/s.exec(text);

      if (match) {
        try {
          return JSON.parse(match[0]);
        } catch {
          // give up below
        }
      }

      return text;
    }

    throw error;
  }
}
