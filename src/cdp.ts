/**
 * Self-contained browser engine: a minimal CDP client over the built-in
 * WebSocket, plus Chrome launch/attach. No daemon, no external service —
 * ports jev-ultrafast's browser.py semantics (trusted input, atomic snapshot,
 * semantic freshness guards).
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { createServer } from "node:net";
import { join } from "node:path";

import { fingerprint } from "./json.ts";
import { loadSnapshotJs } from "./snapshot-loader.ts";
import {
  StalePage,
  type ActResult,
  type BrowserDriver,
  type JsonObject,
  type JsonValue,
  type ObservedAction,
  type PageState,
} from "./types.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Atomically read visible content and controls, preserving actual DOM node identity.
const READ_STATE = loadSnapshotJs();

const MARKER = `(() => { const state=${READ_STATE}; return state?.marker ?? null; })()`;

/** Input.dispatchKeyEvent params per key name (press actions). */
interface KeyEventParams {
  key: string;
  code: string;
  windowsVirtualKeyCode: number;
  text?: string;
}

const KEYS: ReadonlyMap<string, KeyEventParams> = new Map(
  Object.entries({
    enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" },
    tab: { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
    escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
    backspace: { key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 },
    delete: { key: "Delete", code: "Delete", windowsVirtualKeyCode: 46 },
    arrowup: { key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 },
    arrowdown: { key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 },
    arrowleft: { key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 },
    arrowright: { key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 },
    home: { key: "Home", code: "Home", windowsVirtualKeyCode: 36 },
    end: { key: "End", code: "End", windowsVirtualKeyCode: 35 },
    pageup: { key: "PageUp", code: "PageUp", windowsVirtualKeyCode: 33 },
    pagedown: { key: "PageDown", code: "PageDown", windowsVirtualKeyCode: 34 },
    space: { key: " ", code: "Space", windowsVirtualKeyCode: 32, text: " " },
  }),
);

/** Input types typed via real key events — insertText cannot drive them. */
const KEY_TYPED_INPUTS = new Set(["date", "time", "datetime-local", "month", "week"]);

/** Minimal CDP JSON-RPC client over a browser-level WebSocket. */
class CdpSocket {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private closed = false;

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(String(event.data));

      if (
        msg.method === "Inspector.targetCrashed" ||
        msg.method === "Target.targetCrashed"
      ) {
        // A dead renderer never answers again — refuse new calls too.
        this.closed = true;

        for (const p of this.pending.values()) p.reject(new Error("Renderer crashed"));
        this.pending.clear();

        return;
      }

      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);

        if (!p) return;
        this.pending.delete(msg.id);

        if (msg.error) p.reject(new Error(`${msg.error.message ?? "CDP error"}`));
        else p.resolve(msg.result ?? {});
      }
    });
    ws.addEventListener("close", () => {
      this.closed = true;

      for (const p of this.pending.values()) p.reject(new Error("CDP connection closed"));
      this.pending.clear();
    });
  }

  static async connect(wsUrl: string): Promise<CdpSocket> {
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", () => reject(new Error(`Cannot connect to ${wsUrl}`)), {
        once: true,
      });
    });

    return new CdpSocket(ws);
  }

  call<T>(method: string, params: JsonObject = {}, sessionId?: string): Promise<T> {
    if (this.closed) return Promise.reject(new Error("CDP connection closed"));
    const id = this.nextId++;

    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }

  close(): void {
    this.closed = true;

    try {
      this.ws.close();
    } catch {
      // already gone
    }
  }
}

const CHROME_CANDIDATES: Partial<Record<NodeJS.Platform, readonly string[]>> = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  ],
  linux: [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/microsoft-edge",
    "/snap/bin/chromium",
  ],
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ],
};

function findChrome(): string {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }

  if (platform() === "win32" && process.env.LOCALAPPDATA) {
    const perUser = join(
      process.env.LOCALAPPDATA,
      "Google\\Chrome\\Application\\chrome.exe",
    );

    if (existsSync(perUser)) return perUser;
  }

  for (const candidate of CHROME_CANDIDATES[platform()] ?? []) {
    if (existsSync(candidate)) return candidate;
  }

  // PATH fallback: catches flatpak, nix, homebrew-link, and vendor installs.
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    for (const dir of (process.env.PATH ?? "").split(process.platform === "win32" ? ";" : ":")) {
      const candidate = join(dir, name);

      if (existsSync(candidate)) return candidate;
    }
  }

  throw new Error(
    `No Chrome/Chromium found. Set CHROME_PATH, or attach to a running browser with --cdp http://host:9222`,
  );
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();

      if (address === null) {
        server.close(() => reject(new Error("Server closed before reporting a port")));

        return;
      }

      // SAFETY: a listening TCP server reports AddressInfo; the string form is only for IPC pipes.
      const port = (address as { port: number }).port;
      server.close(() => resolve(port));
    });
  });
}

async function browserWsUrl(port: number, timeoutMs = 15000): Promise<string> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);

      // SAFETY: /json/version returns a small JSON object; the only field read is checked below.
      const info = response.ok
        ? ((await response.json()) as { webSocketDebuggerUrl?: string })
        : null;

      if (info?.webSocketDebuggerUrl) return info.webSocketDebuggerUrl;
    } catch {
      // not up yet
    }

    await sleep(100);
  }

  throw new Error(`Chrome did not expose CDP on port ${port}`);
}

/** Target.getTargets payload entry (CDP TargetInfo). */
interface TargetInfo {
  targetId: string;
  type: string;
}

interface TargetList {
  targetInfos: TargetInfo[];
}

export interface CdpOptions {
  /** Attach to an existing debug endpoint (http://host:port) instead of launching. */
  cdpUrl?: string;
  /** Launch headed; default is --headless=new for the launched instance. */
  headed?: boolean;
  /** Persistent profile dir for the launched instance. */
  profileDir?: string;
}

export class CdpBrowser implements BrowserDriver {
  private socket!: CdpSocket;
  private session!: string;
  private target!: string;
  private proc: ChildProcess | null = null;
  private afterInput: ObservedAction | null = null;
  private seen = new Set<string>();
  private adopted: string[] = [];

  private constructor() {}

  static async open(url: string, opts: CdpOptions = {}): Promise<CdpBrowser> {
    const browser = new CdpBrowser();
    let port: number | null = null;

    if (!opts.cdpUrl) {
      port = await freePort();

      const profileDir =
        opts.profileDir ?? process.env.JEV_PROFILE ?? join(homedir(), ".jev-browse", "profile");

      const args = [
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${profileDir}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-session-crashed-bubble",
        "--hide-crash-restore-bubble",
      ];

      if (!opts.headed) args.push("--headless=new");
      else args.push("--window-size=1120,900", "--window-position=40,40");
      browser.proc = spawn(findChrome(), [...args, "about:blank"], { stdio: "ignore" });
      browser.proc.on("error", () => {});
    }

    try {
      // Attach or launch: either way, everything past this point cleans up via close().
      let wsUrl: string;

      if (opts.cdpUrl) {
        const base = opts.cdpUrl.replace(/\/+$/, "");

        // SAFETY: /json/version returns a small JSON object; the only field read is checked below.
        const info = (await (await fetch(`${base}/json/version`)).json()) as {
          webSocketDebuggerUrl?: string;
        };

        if (!info.webSocketDebuggerUrl) {
          throw new Error(`${base} did not report a webSocketDebuggerUrl`);
        }

        wsUrl = info.webSocketDebuggerUrl;
      } else {
        wsUrl = await browserWsUrl(port!);
      }

      browser.socket = await CdpSocket.connect(wsUrl);
      browser.target = (
        await browser.socket.call<{ targetId: string }>("Target.createTarget", {
          url: "about:blank",
          background: true,
        })
      ).targetId;
      browser.session = (
        await browser.socket.call<{ sessionId: string }>("Target.attachToTarget", {
          targetId: browser.target,
          flatten: true,
        })
      ).sessionId;
      browser.seen.add(browser.target);

      // Tabs that pre-date the run (e.g. the launch tab) are not adoptable.
      const { targetInfos } = await browser.socket
        .call<TargetList>("Target.getTargets")
        .catch((): TargetList => ({ targetInfos: [] }));

      for (const t of targetInfos) browser.seen.add(t.targetId);
      await browser.call("Emulation.setDeviceMetricsOverride", {
        width: 1120,
        height: 780,
        deviceScaleFactor: 1,
        mobile: false,
      });
      // Keep rAF/menus rendering in an owned background tab, without activating it.
      await browser.call("Emulation.setFocusEmulationEnabled", { enabled: true });
      await browser.call("Page.navigate", { url });
      const deadline = Date.now() + 15000;

      while (Date.now() < deadline) {
        if ((await browser.evaluate("document.readyState").catch(() => null)) === "complete") break;
        await sleep(20);
      }

      return browser;
    } catch (error) {
      await browser.close();
      throw error;
    }
  }

  private call<T>(method: string, params: JsonObject = {}): Promise<T> {
    return this.socket.call<T>(method, params, this.session);
  }

  private async evaluate<T>(expression: string, awaitPromise = false): Promise<T | undefined> {
    const response = await this.call<{ exceptionDetails?: JsonValue; result?: { value?: T } }>(
      "Runtime.evaluate",
      {
        expression,
        returnByValue: true,
        awaitPromise,
      },
    );

    if (response.exceptionDetails) {
      throw new StalePage("Document changed during evaluation");
    }

    return response.result?.value;
  }

  /** Follow newly opened tabs — the driver observes what the user would see. */
  private async adoptNewTarget(): Promise<void> {
    const { targetInfos } = await this.socket
      .call<TargetList>("Target.getTargets")
      .catch((): TargetList => ({ targetInfos: [] }));

    const fresh = targetInfos.filter((t) => t.type === "page" && !this.seen.has(t.targetId));

    for (const t of fresh) {
      this.seen.add(t.targetId);

      try {
        const { sessionId } = await this.socket.call<{ sessionId: string }>(
          "Target.attachToTarget",
          {
            targetId: t.targetId,
            flatten: true,
          },
        );

        this.target = t.targetId;
        this.session = sessionId;
        this.adopted.push(t.targetId);
      } catch {
        // tab raced away
      }
    }
  }

  async observe(): Promise<PageState> {
    await this.adoptNewTarget();

    if (this.afterInput) {
      const action = this.afterInput;
      this.afterInput = null;

      // Read-only settle wait; runs after execution was logged, so an
      // interrupted evaluation cannot erase the action.
      try {
        await this.call("Runtime.evaluate", {
          expression: `(action => new Promise(resolve => {
            const field=window.__jevFast?.nodes.get(action.node);
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
          }))(${JSON.stringify(action)})`,
          awaitPromise: true,
          returnByValue: true,
        });
      } catch {
        // settle wait is best-effort; the snapshot below is the real read
      }
    }

    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        const info = await this.evaluate<PageState | null>(READ_STATE);

        if (info === null || info === undefined) throw new StalePage("Document is navigating");
        info.fingerprint = fingerprint(info);

        return info;
      } catch (error) {
        // Brief navigations (redirect chains, post-load location changes)
        // outlast a few hundred ms; the retry budget must cover real ones.
        if (!(error instanceof StalePage) || attempt === 99) throw error;
        await sleep(40);
      }
    }

    throw new StalePage("Page did not settle");
  }

  async fresh(page: PageState, action?: ObservedAction): Promise<boolean> {
    if (action && (action.kind === "click" || action.kind === "select")) {
      const node = action.node;

      if (node === undefined) return false;

      const current = await this.evaluate(
        `(() => { const c=window.__jevFast; return c ? [c.pageKey(),c.guard(c.nodes.get(${node}))] : null; })()`,
      );

      return (
        JSON.stringify(current) === JSON.stringify([page.page_key, page.guards[String(node)]])
      );
    }

    return JSON.stringify(await this.evaluate(MARKER)) === JSON.stringify(page.marker);
  }

  async act(action: ObservedAction, page: PageState, text?: string | null): Promise<ActResult> {
    if (!(await this.fresh(page, action))) {
      throw new StalePage("Page changed since this decision. Observe again.");
    }

    const kind = action.kind;

    if (kind === "wait") {
      await sleep(100);

      return { executed: action.id };
    }

    if (kind === "scroll") {
      await this.call("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: 550,
        y: 650,
        deltaX: 0,
        deltaY: action.delta ?? 560,
      });
      this.afterInput = action;

      return { executed: action.id };
    }

    if (kind === "back" || kind === "forward") {
      await this.evaluate(`history.${kind === "back" ? "back" : "forward"}()`);

      return { executed: action.id };
    }

    if (kind === "press") {
      const key = KEYS.get(String(action.key));

      if (!key) throw new Error(`Unknown key ${action.key}`);
      await this.call("Input.dispatchKeyEvent", { type: "keyDown", ...key });
      await this.call("Input.dispatchKeyEvent", { type: "keyUp", ...key });
      this.afterInput = action;

      return { executed: action.id };
    }

    if (action.node === undefined) throw new Error("Invalid observed node");
    // Code-owned node IDs refer to actual observed elements, never model-generated selectors.
    // Hit-testing is frame/shadow aware: iframe elements use owner-document
    // local coords; shadow elements accept hits on the host or root siblings.
    let target: { x: number; y: number; type?: string } | null | undefined;

    try {
      target = await this.evaluate(`(action => {
        const e=window.__jevFast?.nodes.get(action.node);
        if (!e?.isConnected || e.matches(':disabled') || e.closest('[aria-disabled="true"],[inert]') ||
            !e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})) return null;
        if (action.kind==='fill' && (e.readOnly || e.getAttribute('aria-readonly')==='true')) return null;
        const d=e.ownerDocument, w=d.defaultView||window;
        let r=e.getBoundingClientRect(), lx=r.x+r.width/2, ly=r.y+r.height/2;
        // Observed targets drift out of the viewport between snapshot and input
        // (async layout, sticky chrome). One instant re-scroll beats a stale-page
        // re-decision; a still-offscreen or covered target stays fatal.
        if (r.width && r.height && (lx<0 || ly<0 || lx>=w.innerWidth || ly>=w.innerHeight)) {
          e.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
          r=e.getBoundingClientRect(); lx=r.x+r.width/2; ly=r.y+r.height/2;
        }
        if (!r.width || !r.height || lx<0 || ly<0 || lx>=w.innerWidth || ly>=w.innerHeight) return null;
        const hit=d.elementFromPoint(lx,ly), root=e.getRootNode();
        const covered = root instanceof ShadowRoot
          ? !(e.contains(hit) || hit===root.host || hit?.getRootNode()===root)
          : !e.contains(hit);
        if (covered) return null;
        if (action.kind==='select') {
          if (e.tagName!=='SELECT' || ![...e.options].some(o=>o.value===action.value &&
              !o.disabled && !o.closest('optgroup[disabled]'))) return null;
          e.value=action.value;
          e.dispatchEvent(new Event('input',{bubbles:true}));
          e.dispatchEvent(new Event('change',{bubbles:true}));
        }
        const fx=action.frame?.x||0, fy=action.frame?.y||0;
        return {x:lx+fx,y:ly+fy,type:e.tagName==='INPUT'?e.type:''};
      })(${JSON.stringify(action)})`);
    } catch (error) {
      if (kind === "select") {
        throw new Error("Dropdown execution was interrupted; inspect before retrying.");
      }

      throw error;
    }

    if (target === null || target === undefined) {
      if (kind === "select") {
        throw new Error("Dropdown execution was not confirmed; inspect before retrying.");
      }

      throw new StalePage("Target changed or is covered. Observe again.");
    }

    // File inputs: setFileInputFiles — never click (it opens a native dialog).
    if (kind === "fill" && target.type === "file") {
      const doc = await this.call<{ root: { nodeId: number } }>("DOM.getDocument", { depth: 1 });

      const found = await this.call<{ nodeId: number }>("DOM.querySelector", {
        nodeId: doc.root.nodeId,
        selector: `input[data-jev-node="${action.node}"]`,
      });

      if (!found.nodeId) throw new StalePage("File input no longer addressable. Observe again.");
      await this.call("DOM.setFileInputFiles", { files: [text ?? ""], nodeId: found.nodeId });
      this.afterInput = action;

      return { executed: action.id };
    }

    if (kind === "hover") {
      await this.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: target.x, y: target.y });
      this.afterInput = action;

      return { executed: action.id };
    }

    if (kind !== "select") {
      for (const type of ["mousePressed", "mouseReleased"]) {
        await this.call("Input.dispatchMouseEvent", {
          type,
          x: target.x,
          y: target.y,
          button: "left",
          clickCount: 1,
        });
      }

      if (kind === "fill") {
        if (target.type && KEY_TYPED_INPUTS.has(target.type)) {
          // Date/time inputs ignore insertText; drive them with real key events.
          for (const ch of text ?? "") {
            await this.call("Input.dispatchKeyEvent", { type: "char", text: ch });
          }
        } else {
          const modifiers = platform() === "darwin" ? 4 : 2;
          await this.call("Input.dispatchKeyEvent", {
            type: "keyDown",
            key: "a",
            code: "KeyA",
            modifiers,
            commands: ["selectAll"],
          });
          await this.call("Input.dispatchKeyEvent", {
            type: "keyUp",
            key: "a",
            code: "KeyA",
            modifiers,
          });
          await this.call("Input.insertText", { text: text ?? "" });
        }
      }
    }

    this.afterInput = action;

    return { executed: action.id };
  }

  async close(): Promise<void> {
    try {
      for (const t of this.adopted) {
        await this.socket.call("Target.closeTarget", { targetId: t }).catch(() => {});
      }

      if (this.target && !this.adopted.includes(this.target)) {
        await this.socket.call("Target.closeTarget", { targetId: this.target });
      }
    } catch {
      // target already gone
    }

    this.socket?.close();

    if (this.proc) {
      try {
        this.proc.kill("SIGTERM");
      } catch {
        // already exited
      }

      this.proc = null;
    }
  }
}
