
import { execSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { fingerprint, markerMatches } from "../json.ts";
import { loadSnapshotJs } from "../snapshot-loader.ts";
import {
  StalePage,
  type ActResult,
  type BrowserDriver,
  type JsonObject,
  type JsonValue,
  type ObservedAction,
  type PageState,
} from "../types.ts";
import { findChrome } from "./chrome.ts";
import {
  browserWsUrl,
  CdpSocket,
  freePort,
  sleep,
  type TargetList,
} from "./socket.ts";

const READ_STATE = loadSnapshotJs();

const MARKER = `(() => { const state=${READ_STATE}; return state?.marker ?? null; })()`;

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

const KEY_TYPED_INPUTS = new Set(["date", "time", "datetime-local", "month", "week"]);

const LONG_LIVED_REQUESTS = new Set([
  "WebSocket",
  "EventSource",
  "Media",
  "Ping",
  "CSPViolationReport",
  "Other",
]);

const PENDING_GRACE_MS = 10_000;

const VIEWPORT_W = 1120;

const VIEWPORT_H = 780;

const SCROLL_DELTA = Math.round(VIEWPORT_H * 0.8);

const WAIT_BUDGET_MS = 1500;

const QUIET_MS = 250;

const WAIT_POLL_MS = 100;

const DRAG_STEPS = 8;

function splitShellWords(input: string): string[] {
  const out: string[] = [];

  let cur = "",
    quote: string | null = null,
    started = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (quote !== null) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
    } else if (ch === "\\" && i + 1 < input.length) {
      cur += input[++i];
      started = true;
    } else if (/\s/.test(ch)) {
      if (started || cur) {
        out.push(cur);
        cur = "";
        started = false;
      }
    } else {
      cur += ch;
      started = true;
    }
  }

  if (started || cur) out.push(cur);

  return out;
}

function reapProfileChrome(profileDir: string): boolean {
  try {
    const escaped = profileDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const out = execSync(`pgrep -f "user-data-dir=${escaped}([[:space:]]|$)"`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });

    const pids = out.trim().split(/\s+/).filter(Boolean);

    for (const pid of pids) {
      try {
        process.kill(Number(pid), "SIGKILL");
      } catch {
      }
    }

    return pids.length > 0;
  } catch {
    return false;
  }
}

export interface CdpOptions {
  cdpUrl?: string;
  headed?: boolean;
  profileDir?: string;
}

export class CdpBrowser implements BrowserDriver {
  private socket!: CdpSocket;
  private session!: string;
  private target!: string;
  private proc: ChildProcess | null = null;
  private launchProfileDir: string | null = null;
  private afterInput: ObservedAction | null = null;
  private seen = new Set<string>();
  private adopted: string[] = [];
  private sessions = new Map<string, string>();
  private pending = new Map<string, Map<string, number>>();
  private navPending = new Map<string, number>();
  private mainFrame = new Map<string, string>();
  private lastDialog: { type: string; message: string } | null = null;
  private selectAllModifier = 2;
  private downloadGuids = new Map<string, string>();
  private downloads: string[] = [];

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
      else
        args.push(`--window-size=${VIEWPORT_W},${VIEWPORT_H + 120}`, "--window-position=40,40");

      if (process.getuid?.() === 0) {
        args.push("--no-sandbox");
        process.stderr.write(
          "jev-browse: running as root — Chrome launched with --no-sandbox, " +
            "renderer containment is off. Attach to a non-root Chrome via JEV_CDP_URL to keep it.\n",
        );
      }

      for (const extra of splitShellWords(process.env.JEV_CHROME_ARGS ?? "")) {
        args.push(extra);
      }

      browser.proc = spawn(findChrome(), [...args, "about:blank"], { stdio: "ignore" });
      browser.proc.on("error", () => {});
      browser.launchProfileDir = profileDir;
    }

    try {
      let wsUrl: string;

      if (opts.cdpUrl) {
        const base = opts.cdpUrl.replace(/\/+$/, "");

        const info = (await (await fetch(`${base}/json/version`)).json()) as {
          webSocketDebuggerUrl?: string;
        };

        if (!info.webSocketDebuggerUrl) {
          throw new Error(`${base} did not report a webSocketDebuggerUrl`);
        }

        wsUrl = info.webSocketDebuggerUrl;
      } else {
        try {
          wsUrl = await browserWsUrl(port!);
        } catch (error) {
          if (!browser.launchProfileDir || !reapProfileChrome(browser.launchProfileDir)) {
            throw error;
          }

          port = await freePort();

          const args2 = browser.proc!.spawnargs.map((a) =>
            a.startsWith("--remote-debugging-port=") ? `--remote-debugging-port=${port}` : a,
          );

          browser.proc = spawn(args2[0], args2.slice(1), { stdio: "ignore" });
          browser.proc.on("error", () => {});
          wsUrl = await browserWsUrl(port);
        }
      }

      browser.socket = await CdpSocket.connect(wsUrl);

      if (browser.proc) {
        await browser.socket
          .call("Browser.setDownloadBehavior", {
            behavior: "allow",
            downloadPath: mkdtempSync(join(tmpdir(), "jev-downloads-")),
            eventsEnabled: true,
          })
          .catch(() => {});
      }

      browser.socket.onEvent("Page.javascriptDialogOpening", (p, sessionId) => {
        if (!sessionId) return;

        browser.lastDialog = {
          type: String(p.type ?? "dialog"),
          message: String(p.message ?? ""),
        };
        browser.socket
          .call("Page.handleJavaScriptDialog", { accept: true }, sessionId)
          .catch(() => {});
      });
      browser.socket.onEvent("Network.requestWillBeSent", (p, sessionId) => {
        if (sessionId && !LONG_LIVED_REQUESTS.has(String(p.type))) {
          (
            browser.pending.get(sessionId) ??
            browser.pending.set(sessionId, new Map()).get(sessionId)!
          ).set(p.requestId, Date.now());
        }
      });
      browser.socket.onEvent("Network.loadingFinished", (p, sessionId) => {
        if (sessionId) browser.pending.get(sessionId)?.delete(p.requestId);
      });
      browser.socket.onEvent("Network.loadingFailed", (p, sessionId) => {
        if (sessionId) browser.pending.get(sessionId)?.delete(p.requestId);
      });
      browser.socket.onEvent("Page.frameStartedNavigating", (p, sessionId) => {
        if (sessionId && p.frameId === browser.mainFrame.get(sessionId)) {
          browser.navPending.set(sessionId, (browser.navPending.get(sessionId) ?? 0) + 1);
        }
      });
      browser.socket.onEvent("Page.frameNavigated", (p, sessionId) => {
        if (sessionId && p.frame?.id === browser.mainFrame.get(sessionId)) {
          browser.navPending.set(sessionId, Math.max(0, (browser.navPending.get(sessionId) ?? 0) - 1));
        }
      });
      browser.socket.onEvent("Page.frameStoppedLoading", (p, sessionId) => {
        if (sessionId && p.frameId === browser.mainFrame.get(sessionId)) {
          browser.navPending.set(sessionId, 0);
        }
      });
      browser.socket.onEvent("Browser.downloadWillBegin", (p) => {
        browser.downloadGuids.set(String(p.guid), String(p.suggestedFilename ?? p.url ?? "download"));
      });
      browser.socket.onEvent("Browser.downloadProgress", (p) => {
        const name = browser.downloadGuids.get(String(p.guid));

        if (name && p.state === "completed") browser.downloads.push(name);

        if (name && p.state !== "inProgress") browser.downloadGuids.delete(String(p.guid));
      });

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
      browser.sessions.set(browser.target, browser.session);
      await browser.call("Page.enable").catch(() => {});
      await browser.call("Network.enable").catch(() => {});

      await browser
        .call("Page.addScriptToEvaluateOnNewDocument", {
          source: `(() => {
            const map = new WeakMap();
            const orig = EventTarget.prototype.addEventListener;

            EventTarget.prototype.addEventListener = function (type, listener, options) {
              if (typeof type === "string" && this !== null && this !== undefined &&
                  (this instanceof Node || this === window)) {
                let s = map.get(this);

                if (!s) map.set(this, (s = new Set()));

                s.add(type);
              }

              return orig.call(this, type, listener, options);
            };

            Object.defineProperty(window, "__jevListeners", { value: map, configurable: true });
          })()`,
        })
        .catch(() => {});

      await browser.learnMainFrame();

      const version = await browser.socket
        .call<{ userAgent?: string }>("Browser.getVersion")
        .catch(() => null);

      browser.selectAllModifier = /mac os x|macintosh/i.test(version?.userAgent ?? "") ? 4 : 2;

      const { targetInfos } = await browser.socket
        .call<TargetList>("Target.getTargets")
        .catch((): TargetList => ({ targetInfos: [] }));

      for (const t of targetInfos) browser.seen.add(t.targetId);
      await browser.call("Emulation.setDeviceMetricsOverride", {
        width: VIEWPORT_W,
        height: VIEWPORT_H,
        deviceScaleFactor: 1,
        mobile: false,
      });
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

  private async call<T>(method: string, params: JsonObject = {}): Promise<T> {
    try {
      return await this.socket.call<T>(method, params, this.session);
    } catch (error) {
      if (
        this.adopted.includes(this.target) &&
        /no session|session.{0,20}(not found|gone)|detach|renderer crashed/i.test(
          error instanceof Error ? error.message : String(error),
        )
      ) {
        throw new StalePage("Adopted tab is gone. Observe again.");
      }

      throw error;
    }
  }

  private async learnMainFrame(): Promise<void> {
    const tree = await this.call<{ frameTree?: { frame?: { id?: string } } }>(
      "Page.getFrameTree",
    ).catch(() => null);

    if (tree?.frameTree?.frame?.id) this.mainFrame.set(this.session, tree.frameTree.frame.id);
  }

  private async evaluate<T>(expression: string, awaitPromise = false): Promise<T | undefined> {
    const response = await this.call<{
      exceptionDetails?: { exception?: { description?: string }; text?: string };
      result?: { value?: T };
    }>("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise,
    });

    if (response.exceptionDetails) {
      const description =
        response.exceptionDetails.exception?.description ?? response.exceptionDetails.text ?? "";

      if (/context.{0,20}destroy|execution context|navigat|detach/i.test(description)) {
        throw new StalePage("Document changed during evaluation");
      }

      throw new Error(`Evaluation failed: ${description.slice(0, 300)}`);
    }

    return response.result?.value;
  }

  private async adoptNewTarget(): Promise<void> {
    const { targetInfos } = await this.socket
      .call<TargetList>("Target.getTargets")
      .catch((): TargetList => ({ targetInfos: [] }));

    const fresh = targetInfos.filter(
      (t) => t.type === "page" && !this.seen.has(t.targetId) && t.openerId === this.target,
    );

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
        this.sessions.set(t.targetId, sessionId);
        this.adopted.push(t.targetId);
        await this.call("Page.enable").catch(() => {});
        await this.call("Network.enable").catch(() => {});
        await this.call("Emulation.setDeviceMetricsOverride", {
          width: VIEWPORT_W,
          height: VIEWPORT_H,
          deviceScaleFactor: 1,
          mobile: false,
        }).catch(() => {});
        await this.call("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
        await this.learnMainFrame();
      } catch {
      }
    }
  }

  private async listTabs(): Promise<{ targetId: string; title: string; url: string }[]> {
    const { targetInfos } = await this.socket
      .call<TargetList>("Target.getTargets")
      .catch((): TargetList => ({ targetInfos: [] }));

    return targetInfos
      .filter((t) => t.type === "page" && this.sessions.has(t.targetId))
      .map((t) => ({ targetId: t.targetId, title: t.title ?? "", url: t.url ?? "" }));
  }

  async observe(): Promise<PageState> {
    await this.adoptNewTarget();

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
          }))(${JSON.stringify(action)})`, true);
      } catch {
      }
    }

    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        const info = await this.evaluate<PageState | null>(READ_STATE);

        if (info === null || info === undefined) throw new StalePage("Document is navigating");
        info.fingerprint = fingerprint(info);
        info.pending_requests = this.pendingCount(this.session);
        info.pending_nav = (this.navPending.get(this.session) ?? 0) > 0;

        if (this.downloads.length) info.downloads = [...this.downloads];

        const tabs = await this.listTabs();

        if (tabs.length > 1) {
          info.tabs = tabs.map((t) => ({
            title: (t.title ?? "").slice(0, 80),
            url: (t.url ?? "").slice(0, 200),
            ...(t.targetId === this.target && { current: true }),
          }));
          tabs.forEach((t, i) => {
            if (t.targetId !== this.target)
              info.actions.push({
                id: `focus_tab_${i}`,
                kind: "focus_tab",
                label: `Switch to tab: ${(t.title || t.url).slice(0, 90)}`,
                value: t.targetId,
              });
          });
        }

        if (this.lastDialog) {
          info.dialog = `${this.lastDialog.type}: ${this.lastDialog.message}`.slice(0, 240);
          this.lastDialog = null;
        }

        return info;
      } catch (error) {
        if (!(error instanceof StalePage) || attempt === 99) throw error;
        await sleep(40);
      }
    }

    throw new StalePage("Page did not settle");
  }

  private pendingCount(session: string): number {
    const requests = this.pending.get(session);

    if (!requests) return 0;

    const now = Date.now();
    let count = 0;

    for (const [id, started] of requests) {
      if (now - started > PENDING_GRACE_MS) requests.delete(id);
      else count++;
    }

    return count;
  }

  async settle(budgetMs: number, quietMs: number = QUIET_MS): Promise<void> {
    const quiet = await this.evaluate<boolean>(
      `(() => {const w = window.__jevFast && window.__jevFast.wake;
        if (!w || !w.quiet) return false;

        return w.quiet(${Math.min(quietMs, budgetMs)}, ${budgetMs}).then(() => true);})()`,
      true,
    ).catch(() => false);

    if (quiet !== true) await sleep(budgetMs);
  }

  pendingNav(): boolean {
    return (this.navPending.get(this.session) ?? 0) > 0;
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

      return (
        JSON.stringify(current) === JSON.stringify([page.page_key, page.guards[String(node)]])
      );
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
    if (!(await this.fresh(page, action, "page"))) {
      throw new StalePage("Page changed since this decision. Observe again.");
    }

    const kind = action.kind;

    if (kind === "wait") {
      const deadline = Date.now() + WAIT_BUDGET_MS;
      const hadRequests = this.pendingCount(this.session) > 0;

      while (Date.now() < deadline) {
        await sleep(WAIT_POLL_MS);

        if (!(await this.fresh(page))) break;

        if (hadRequests && this.pendingCount(this.session) === 0) break;
      }

      return { executed: action.id };
    }

    if (kind === "scroll" && action.node !== undefined) {
      const moved = await this.evaluate(
        `(() => {
          const e=window.__jevFast?.node(${JSON.stringify(action.node)});
          if (!e?.isConnected) return null;
          const b=e.scrollTop;
          e.scrollBy({top:${JSON.stringify(action.delta ?? SCROLL_DELTA)},behavior:'instant'});
          return e.scrollTop!==b;
        })()`,
      ).catch(() => null);

      if (moved === null) throw new StalePage("Scroll region is gone. Observe again.");

      this.afterInput = action;

      return { executed: action.id };
    }

    if (kind === "scroll") {
      await this.evaluate(
        `(delta => {
          const sign=Math.sign(delta)||1;
          const dy=Math.round(sign*innerHeight*0.8);
          const moved=(n,by)=>{const b=n.scrollTop;n.scrollBy({top:by,behavior:'instant'});return n.scrollTop!==b;};
          for (const fx of [0.5,0.3,0.7,0.15,0.85]) {
            const x=Math.round(innerWidth*fx), y=Math.round(innerHeight*0.6);
            const e=window.__jevFast?.deepHit(document,x,y);
            for (let n=e; n && n!==document.documentElement && n!==document.body; n=n.parentElement||n.getRootNode()?.host) {
              if (n.tagName==='IFRAME') {
                try { const w=n.contentWindow, b=w.scrollY; w.scrollBy({top:dy,behavior:'instant'}); if (w.scrollY!==b) return 'iframe'; } catch {}
                continue;
              }
              const cs=getComputedStyle(n);
              if (/(auto|scroll)/.test(cs.overflowY) && n.scrollHeight>n.clientHeight+1 && moved(n,dy)) return 'element';
            }
          }
          const b=scrollY; scrollBy({top:dy,behavior:'instant'});
          return scrollY!==b ? 'window' : 'none';
        })(${JSON.stringify(action.delta ?? SCROLL_DELTA)})`,
      ).catch(() => null);

      this.afterInput = action;

      return { executed: action.id };
    }

    if (kind === "back" || kind === "forward") {
      await this.evaluate(`history.${kind === "back" ? "back" : "forward"}()`);

      return { executed: action.id };
    }

    if (kind === "focus_tab") {
      const targetId = String(action.value ?? "");
      const sessionId = this.sessions.get(targetId);

      if (!sessionId) throw new StalePage("Tab is gone. Observe again.");

      await this.socket.call("Target.activateTarget", { targetId }).catch(() => {});
      this.target = targetId;
      this.session = sessionId;

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
    let target: { x: number; y: number; type?: string; why?: string } | null | undefined;

    try {
      target = await this.evaluate(`(action => {
        const e=window.__jevFast?.node(action.node);
        // Visibility alone doesn't decide clickability — opacity:0 custom
        // controls fail checkVisibility yet win their own hit test. The
        // covered check below is the real arbiter.
        if (!e?.isConnected) return {why:'gone'};
        if (e.matches(':disabled') || e.closest('[aria-disabled="true"],[inert]')) return {why:'disabled'};
        if (action.kind==='fill' && (e.readOnly || e.getAttribute('aria-readonly')==='true')) return {why:'readonly'};
        const d=e.ownerDocument, w=d.defaultView||window;
        let r=e.getBoundingClientRect(), lx=r.x+r.width/2, ly=r.y+r.height/2;
        // Observed targets drift out of the viewport between snapshot and input
        // (async layout, sticky chrome). One instant re-scroll beats a stale-page
        // re-decision; a still-offscreen or covered target stays fatal.
        if (r.width && r.height && (lx<0 || ly<0 || lx>=w.innerWidth || ly>=w.innerHeight)) {
          e.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
          r=e.getBoundingClientRect(); lx=r.x+r.width/2; ly=r.y+r.height/2;
        }
        if (!r.width || !r.height || lx<0 || ly<0 || lx>=w.innerWidth || ly>=w.innerHeight) return {why:'offscreen'};
        const c=window.__jevFast, deepHit=()=>c.deepHit(d,lx,ly);
        let hit=deepHit();
        // A hit on the target's own ancestor is clipping by a scroll
        // container (a long suggestion list, an overflow pane), not cover:
        // bring the target into view once and test again.
        if (hit && hit!==e && c.composedContains(hit,e)) {
          e.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
          r=e.getBoundingClientRect(); lx=r.x+r.width/2; ly=r.y+r.height/2;
          hit=deepHit();
        }
        // Not covered when the hit is the target or inside it across shadow
        // boundaries, or is one of e's own shadow hosts. An unrelated overlay
        // in the same shadow root still counts as covered.
        const hosts=new Set(); for (let sr=e.getRootNode();sr instanceof ShadowRoot;sr=sr.host.getRootNode()) hosts.add(sr.host);
        if (!c.composedContains(e,hit) && !hosts.has(hit)) return {why:'covered by '+(hit?hit.tagName.toLowerCase():'nothing')};
        if (action.kind==='select') {
          if (e.tagName!=='SELECT' || ![...e.options].some(o=>o.value===action.value &&
              !o.disabled && !o.closest('optgroup[disabled]'))) return {why:'no such option'};
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

    if (target === null || target === undefined || target.why !== undefined) {
      if (kind === "select") {
        throw new Error("Dropdown execution was not confirmed; inspect before retrying.");
      }

      throw new StalePage(`Target ${JSON.stringify(action.label.slice(0, 40))} ${target?.why ?? "changed"}. Observe again.`);
    }

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

    if (kind === "drag" && action.dragTo !== undefined) {
      const destFrame = page.actions.find((a) => a.node === action.dragTo)?.frame;

      const dest = await this.evaluate<{ x: number; y: number } | null>(`(() => {
        const e=window.__jevFast?.node(${action.dragTo});
        if (!e?.isConnected) return null;
        const r=e.getBoundingClientRect();
        return {x:r.x+r.width/2+${destFrame?.x ?? 0},y:r.y+r.height/2+${destFrame?.y ?? 0}};
      })()`);

      if (!dest) throw new StalePage("Drag destination changed. Observe again.");

      await this.call("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: target.x,
        y: target.y,
        button: "left",
        clickCount: 1,
      });

      for (let i = 1; i <= DRAG_STEPS; i++) {
        await this.call("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x: target.x + ((dest.x - target.x) * i) / DRAG_STEPS,
          y: target.y + ((dest.y - target.y) * i) / DRAG_STEPS,
          button: "left",
          buttons: 1,
        });
      }

      await this.call("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: dest.x,
        y: dest.y,
        button: "left",
        clickCount: 1,
      });
      this.afterInput = action;

      return { executed: action.id };
    }

    if (kind !== "select") {
      for (const type of ["mousePressed", "mouseReleased"]) {
        await this.call("Input.dispatchMouseEvent", {
          type,
          x: target.x,
          y: target.y,
          button: kind === "context" ? "right" : "left",
          clickCount: 1,
        });
      }

      if (kind === "click" || kind === "context" || kind === "fill") {
        await this.evaluate(`(() => {
          const e=window.__jevFast?.node(${action.node});
          if (!e?.isConnected) return;
          const r=e.getBoundingClientRect(), w=e.ownerDocument.defaultView||window;
          if (r.top<0 || r.left<0 || r.bottom>w.innerHeight || r.right>w.innerWidth)
            e.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
        })()`).catch(() => {});
      }

      if (kind === "fill") {
        if (target.type && KEY_TYPED_INPUTS.has(target.type)) {
          for (const ch of text ?? "") {
            await this.call("Input.dispatchKeyEvent", { type: "char", text: ch });
          }
        } else {
          const modifiers = this.selectAllModifier;
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

  async domClick(
    action: ObservedAction,
    page: PageState,
    text?: string | null,
  ): Promise<ActResult> {
    if (!(await this.fresh(page, action))) {
      throw new StalePage("Page changed since this decision. Observe again.");
    }

    if (!action.node) {
      return { executed: action.id };
    }

    if (action.kind === "fill") {
      await this.evaluate(
        `(() => {
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
        })()`,
      );
      this.afterInput = action;

      return { executed: action.id };
    }

    if (action.kind === "drag" && action.dragTo !== undefined) {
      await this.evaluate(
        `(() => {
          const c=window.__jevFast;
          const src=c?.node(${action.node}), dst=c?.node(${action.dragTo});
          if (!src || !dst) return "stale";
          const dt=new DataTransfer();
          const fire=(t,el)=>el.dispatchEvent(new DragEvent(t,{bubbles:true,cancelable:true,dataTransfer:dt}));
          fire("dragstart",src); fire("dragenter",dst); fire("dragover",dst);
          fire("drop",dst); fire("dragend",src);
          return "ok";
        })()`,
      );
      this.afterInput = action;

      return { executed: action.id };
    }

    const types =
      action.kind === "hover"
        ? ["mouseover", "mousemove"]
        : ["pointerdown", "mousedown", "pointerup", "mouseup", "click"];

    await this.evaluate(
      `(() => {
        const e=window.__jevFast?.node(${action.node});
        if (!e) return "stale";
        const r=e.getBoundingClientRect();
        const opts={bubbles:true,cancelable:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2,button:0};
        for (const t of ${JSON.stringify(types)}) {
          const Ev = t.startsWith("pointer") ? PointerEvent : MouseEvent;
          e.dispatchEvent(new Ev(t,opts));
        }
        return "ok";
      })()`,
    );
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

      this.sessions.clear();
    } catch {
    }

    this.socket?.close();

    if (this.proc) {
      try {
        this.proc.kill("SIGTERM");
      } catch {
      }

      this.proc = null;
    }
  }
}
