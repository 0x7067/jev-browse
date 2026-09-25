
import { type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fingerprint } from "../json.ts";
import { loadSnapshotJs } from "../snapshot-loader.ts";
import {
  StalePage,
  type ActResult,
  type BrowserDriver,
  type JsonObject,
  type ObservedAction,
  type PageState,
} from "../types.ts";
import { CdpEvents } from "./events.ts";
import { fresh, settle } from "./fresh.ts";
import { act, domClick, QUIET_MS, VIEWPORT_H, VIEWPORT_W } from "./input.ts";
import { resolveWsUrl, spawnChrome, type CdpOptions } from "./launch.ts";
import { CdpSocket, sleep, type TargetList } from "./socket.ts";

const READ_STATE = loadSnapshotJs();

export class CdpBrowser implements BrowserDriver {
  private socket!: CdpSocket;
  session!: string;
  target!: string;
  private proc: ChildProcess | null = null;
  private launchProfileDir: string | null = null;
  afterInput: ObservedAction | null = null;
  private seen = new Set<string>();
  private adopted: string[] = [];
  private sessions = new Map<string, string>();
  readonly events = new CdpEvents();
  selectAllModifier = 2;

  private constructor() {}

  static async open(url: string, opts: CdpOptions = {}): Promise<CdpBrowser> {
    const browser = new CdpBrowser();
    const spawned = await spawnChrome(opts);

    if (spawned) {
      browser.proc = spawned.proc;
      browser.launchProfileDir = spawned.profileDir;
    }

    try {
      const wsUrl = await resolveWsUrl(opts, spawned);

      if (spawned) browser.proc = spawned.proc;

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

      browser.events.wire(browser.socket);

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

  async call<T>(method: string, params: JsonObject = {}): Promise<T> {
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

    if (tree?.frameTree?.frame?.id) this.events.setMainFrame(this.session, tree.frameTree.frame.id);
  }

  async evaluate<T>(expression: string, awaitPromise = false): Promise<T | undefined> {
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
        info.pending_requests = this.events.pendingCount(this.session);
        info.pending_nav = this.events.pendingNav(this.session);

        if (this.events.downloads.length) info.downloads = [...this.events.downloads];

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

        const dialog = this.events.takeDialog();

        if (dialog) info.dialog = dialog;

        return info;
      } catch (error) {
        if (!(error instanceof StalePage) || attempt === 99) throw error;
        await sleep(40);
      }
    }

    throw new StalePage("Page did not settle");
  }

  async settle(budgetMs: number, quietMs: number = QUIET_MS): Promise<void> {
    return settle(this, budgetMs, quietMs);
  }

  pendingNav(): boolean {
    return this.events.pendingNav(this.session);
  }

  async fresh(
    page: PageState,
    action?: ObservedAction,
    level: "full" | "page" | "structure" = "full",
  ): Promise<boolean> {
    return fresh(this, page, action, level);
  }

  async act(action: ObservedAction, page: PageState, text?: string | null): Promise<ActResult> {
    if (action.kind === "focus_tab") {
      const targetId = String(action.value ?? "");
      const sessionId = this.sessions.get(targetId);

      if (!sessionId) throw new StalePage("Tab is gone. Observe again.");

      await this.socket.call("Target.activateTarget", { targetId }).catch(() => {});
      this.target = targetId;
      this.session = sessionId;

      return { executed: action.id };
    }

    return act(this, action, page, text);
  }

  async domClick(
    action: ObservedAction,
    page: PageState,
    text?: string | null,
  ): Promise<ActResult> {
    return domClick(this, action, page, text);
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
