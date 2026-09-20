/**
 * CDP browser driver: launch or attach to Chrome, then expose the shared
 * observe/fresh/act contract over a page-level session. Trusted input,
 * atomic snapshots, semantic freshness guards.
 */

import { execSync, spawn, type ChildProcess } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

import { fingerprint, structureOf } from "../json.ts";
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

/** CDP resource types that stay open by design — counting them pins pending forever. */
const LONG_LIVED_REQUESTS = new Set([
  "WebSocket",
  "EventSource",
  "Media",
  "Ping",
  "CSPViolationReport",
  "Other",
]);

/** A request in flight longer than this is hung or long-lived noise (a CDN
 *  stream that never completes) — it can't pin pending_requests forever. */
const PENDING_GRACE_MS = 10_000;

/** Forced page viewport. The launch window is 120px taller: headed Chrome
 *  spends the difference on browser chrome, leaving ~780px for content. */
const VIEWPORT_W = 1120;

const VIEWPORT_H = 780;

/** Fallback wheel delta: roughly a pane's worth of the forced viewport. */
const SCROLL_DELTA = Math.round(VIEWPORT_H * 0.8);

/** WAIT polls the page for this long before handing control back. */
const WAIT_BUDGET_MS = 1500;

const WAIT_POLL_MS = 100;

/** Interpolated mouseMoved events between drag press and release. */
const DRAG_STEPS = 8;

/** Kill Chrome instances still bound to our profile dir. True when any were reaped. */
function reapProfileChrome(profileDir: string): boolean {
  try {
    // pgrep -f is a regex: an unescaped profile path matches profile-backup,
    // profile2, and treats '.' as any-char. Escape and anchor the arg end.
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
        /* already gone */
      }
    }

    return pids.length > 0;
  } catch {
    return false;
  }
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
  private launchProfileDir: string | null = null;
  private afterInput: ObservedAction | null = null;
  private seen = new Set<string>();
  private adopted: string[] = [];
  /** In-flight request ids per session — the "is the page actually working" signal. */
  /** In-flight requests per session: requestId → start time for age pruning. */
  private pending = new Map<string, Map<string, number>>();
  /** Uncommitted main-frame navigations per session — click → commit is a gap. */
  private navPending = new Map<string, number>();
  /** Each session's main frame id — iframe nav events must not count as pending. */
  private mainFrame = new Map<string, string>();
  /** The last auto-accepted JS dialog, surfaced on the next observation. */
  private lastDialog: { type: string; message: string } | null = null;
  /** CDP key modifier for select-all — Meta (4) on a macOS browser, Control (2) else. */
  private selectAllModifier = 2;

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
        // Smooth scrolling animates wheel input; CDP acks the wheel event
        // only when the animation lands, ~750ms per scroll step.
        "--disable-smooth-scrolling",
      ];

      if (!opts.headed) args.push("--headless=new");
      else
        args.push(`--window-size=${VIEWPORT_W},${VIEWPORT_H + 120}`, "--window-position=40,40");

      // Chrome refuses to start as root without --no-sandbox (containers, CI).
      // JEV_CHROME_ARGS appends operator flags, whitespace-separated.
      if (process.getuid?.() === 0) args.push("--no-sandbox");

      for (const extra of (process.env.JEV_CHROME_ARGS ?? "").split(/\s+/)) {
        if (extra) args.push(extra);
      }

      browser.proc = spawn(findChrome(), [...args, "about:blank"], { stdio: "ignore" });
      browser.proc.on("error", () => {});
      browser.launchProfileDir = profileDir;
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
        try {
          wsUrl = await browserWsUrl(port!);
        } catch (error) {
          // A crashed predecessor can hold the profile dir hostage: Chrome's
          // SingletonLock makes the new process defer to the stale instance
          // and no CDP port ever appears. Reap ours, then retry the launch
          // once on a fresh port.
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
      // A JS dialog (alert/confirm/prompt) blocks the whole page until
      // answered — accept and keep the run moving. The message is kept so the
      // next observation reports what was auto-accepted.
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
      // Document navigations: a click-triggered commit isn't visible in the
      // old document's state, so DONE needs socket-level nav tracking to
      // avoid declaring success mid-flight. Only the session's main frame
      // counts — iframe starts/stops would fake and cancel real pending navs.
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
      await browser.call("Page.enable").catch(() => {});
      await browser.call("Network.enable").catch(() => {});
      await browser.learnMainFrame();

      // The select-all shortcut must match the browser's OS, not the agent's.
      const version = await browser.socket
        .call<{ userAgent?: string }>("Browser.getVersion")
        .catch(() => null);

      browser.selectAllModifier = /mac os x|macintosh/i.test(version?.userAgent ?? "") ? 4 : 2;

      // Tabs that pre-date the run (e.g. the launch tab) are not adoptable.
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

  private async call<T>(method: string, params: JsonObject = {}): Promise<T> {
    try {
      return await this.socket.call<T>(method, params, this.session);
    } catch (error) {
      // An adopted tab that closed or crashed leaves a dead session behind —
      // the page we decided on is gone, but the browser itself is fine.
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

  /** Record the session's main frame so iframe nav events don't fake a pending nav. */
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

      // Only navigation/context-destruction means a stale page; an ordinary
      // page exception is a real error worth surfacing verbatim.
      if (/context.{0,20}destroy|execution context|navigat|detach/i.test(description)) {
        throw new StalePage("Document changed during evaluation");
      }

      throw new Error(`Evaluation failed: ${description.slice(0, 300)}`);
    }

    return response.result?.value;
  }

  /** Follow newly opened tabs — the driver observes what the user would see. */
  private async adoptNewTarget(): Promise<void> {
    const { targetInfos } = await this.socket
      .call<TargetList>("Target.getTargets")
      .catch((): TargetList => ({ targetInfos: [] }));

    // Only pages our current tab opened are candidates — anything else that
    // appears (another tab's popup, external windows) must not hijack the run.
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
        this.adopted.push(t.targetId);
        await this.call("Page.enable").catch(() => {});
        await this.call("Network.enable").catch(() => {});
        // Adopted tabs need the same viewport/focus emulation as the main one.
        await this.call("Emulation.setDeviceMetricsOverride", {
          width: VIEWPORT_W,
          height: VIEWPORT_H,
          deviceScaleFactor: 1,
          mobile: false,
        }).catch(() => {});
        await this.call("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
        await this.learnMainFrame();
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
        // evaluate() checks exceptionDetails — a field disconnecting
        // mid-wait throws there instead of inside the page script.
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
        // settle wait is best-effort; the snapshot below is the real read
      }
    }

    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        const info = await this.evaluate<PageState | null>(READ_STATE);

        if (info === null || info === undefined) throw new StalePage("Document is navigating");
        info.fingerprint = fingerprint(info);
        info.pending_requests = this.pendingCount(this.session);
        info.pending_nav = (this.navPending.get(this.session) ?? 0) > 0;

        // Report the dialog we auto-accepted since the last observation, once.
        if (this.lastDialog) {
          info.dialog = `${this.lastDialog.type}: ${this.lastDialog.message}`.slice(0, 240);
          this.lastDialog = null;
        }

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

  /** Requests still young enough to count as in-flight work; older entries
   *  are reaped — a request that outlives the grace window is hung, not
   *  settling. */
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

    // 'structure' level: same document, field state, title, and offered
    // controls — text churn (clocks, tickers, counters) is ignored, a
    // navigation or a content swap that changes the control set is not.
    if (level === "structure") {
      const current = await this.evaluate<JsonValue>(MARKER);

      return JSON.stringify(structureOf(current)) === JSON.stringify(structureOf(page.marker));
    }

    // 'page' level: same document and field state, ignoring text churn.
    if (level === "page") {
      const current = await this.evaluate(
        `(() => { const c=window.__jevFast; return c ? c.pageKey() : null; })()`,
      );

      return JSON.stringify(current) === JSON.stringify(page.page_key);
    }

    return JSON.stringify(await this.evaluate(MARKER)) === JSON.stringify(page.marker);
  }

  async act(action: ObservedAction, page: PageState, text?: string | null): Promise<ActResult> {
    // Guard compare for click/select; document key for everything else —
    // press/scroll/fill must not fail on unrelated text churn.
    if (!(await this.fresh(page, action, "page"))) {
      throw new StalePage("Page changed since this decision. Observe again.");
    }

    const kind = action.kind;

    if (kind === "wait") {
      // A wait is a bet that the page is working. Poll for the outcome
      // instead of sleeping a fixed slice: return as soon as the document
      // key or text/marker moves, or the network goes idle after activity,
      // or the patience budget runs out. Each early return saves a decision.
      const deadline = Date.now() + WAIT_BUDGET_MS;
      const hadRequests = this.pendingCount(this.session) > 0;

      while (Date.now() < deadline) {
        await sleep(WAIT_POLL_MS);

        if (!(await this.fresh(page))) break;

        if (hadRequests && this.pendingCount(this.session) === 0) break;
      }

      return { executed: action.id };
    }

    if (kind === "scroll") {
      // Programmatic scroll, not a wheel event: headless Chrome drops the
      // first wheel after launch and acks every later one only after ~1s.
      // scrollBy is instant and still fires scroll events (infinite feeds
      // listen to those). Prefer an inner scroller under the probe points
      // (overflow panes, same-origin iframes); fall back to the window.
      await this.evaluate(
        `(delta => {
          const sign=Math.sign(delta)||1;
          const dy=Math.round(sign*innerHeight*0.8);
          const moved=(n,by)=>{const b=n.scrollTop;n.scrollBy({top:by,behavior:'instant'});return n.scrollTop!==b;};
          for (const fx of [0.5,0.3,0.7,0.15,0.85]) {
            const x=Math.round(innerWidth*fx), y=Math.round(innerHeight*0.6);
            let e=document.elementFromPoint(x,y);
            while (e?.shadowRoot) { const d=e.shadowRoot.elementFromPoint(x,y); if (!d||d===e) break; e=d; }
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
        // elementFromPoint stops at the outermost shadow host; descend
        // through open roots so nested shadow content can be hit directly.
        const deepHit=()=>{
          let h=d.elementFromPoint(lx,ly);
          while (h?.shadowRoot) { const deeper=h.shadowRoot.elementFromPoint(lx,ly); if (!deeper||deeper===h) break; h=deeper; }
          return h;
        };
        const composedContains=(a,n)=>{for(let x=n;x;){if(x===a)return true;const r=x.getRootNode();x=x.parentElement??(r instanceof ShadowRoot?r.host:null);}return false;};
        let hit=deepHit();
        // A hit on the target's own ancestor is clipping by a scroll
        // container (a long suggestion list, an overflow pane), not cover:
        // bring the target into view once and test again.
        if (hit && hit!==e && !e.contains(hit) && composedContains(hit,e)) {
          e.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
          r=e.getBoundingClientRect(); lx=r.x+r.width/2; ly=r.y+r.height/2;
          hit=deepHit();
        }
        // Composed containment: not covered when the hit is the target, is
        // inside it across shadow boundaries (walk hit's host chain up to e),
        // or is one of e's own shadow hosts. An unrelated overlay in the
        // same shadow root still counts as covered.
        const inside=h=>composedContains(e,h);
        const hosts=new Set(); for (let r=e.getRootNode();r instanceof ShadowRoot;r=r.host.getRootNode()) hosts.add(r.host);
        const covered = !(hit===e || e.contains(hit) || inside(hit) || hosts.has(hit));
        if (covered) return {why:'covered by '+(hit?hit.tagName+(hit.id?'#'+hit.id:'')+'.'+String(hit.className).slice(0,40):'nothing')+
          ' (target '+e.tagName+' '+[r.x,r.y,r.width,r.height].map(Math.round).join(',')+' hitInTarget='+composedContains(e,hit)+' targetInHit='+composedContains(hit,e)+')'};
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

    if (target === null || target === undefined || target.why !== undefined) {
      if (kind === "select") {
        throw new Error("Dropdown execution was not confirmed; inspect before retrying.");
      }

      throw new StalePage(`Target ${JSON.stringify(action.label.slice(0, 40))} ${target?.why ?? "changed"}. Observe again.`);
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

    if (kind === "drag" && action.dragTo !== undefined) {
      const dest = await this.evaluate<{ x: number; y: number } | null>(`(() => {
        const e=window.__jevFast?.node(${action.dragTo});
        if (!e?.isConnected) return null;
        const r=e.getBoundingClientRect();
        return {x:r.x+r.width/2,y:r.y+r.height/2};
      })()`);

      if (!dest) throw new StalePage("Drag destination changed. Observe again.");

      // Real mouse drag: press on the source, ease toward the destination,
      // release. Stepped moves let hover-based handlers see a path.
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

      // An element clipped by the viewport edge often renders its response
      // just out of view — bring it fully on-screen so the next observation
      // sees what the input caused.
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
          // Date/time inputs ignore insertText; drive them with real key events.
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

  /**
   * Fallback when trusted input silently delivers nothing — seen on pages
   * where a canceled provisional navigation leaves the input pipeline dead
   * (same document, all dispatch* calls no-op). Dispatches the pointer/mouse
   * sequence in-page; untrusted events still run ordinary handlers.
   */
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
      // Controlled inputs track value through the prototype setter — plain
      // e.value= is invisible to React-style frameworks.
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
      // HTML5 DnD runs on its own event family — synthesize the sequence.
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
