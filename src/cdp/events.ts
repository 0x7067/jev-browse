import type { CdpSocket } from "./socket.ts";

const LONG_LIVED_REQUESTS = new Set([
  "WebSocket",
  "EventSource",
  "Media",
  "Ping",
  "CSPViolationReport",
  "Other",
]);

const PENDING_GRACE_MS = 10_000;

export class CdpEvents {
  private pending = new Map<string, Map<string, number>>();
  private navPending = new Map<string, number>();
  private mainFrame = new Map<string, string>();
  private lastDialog: { type: string; message: string } | null = null;
  private downloadGuids = new Map<string, string>();
  readonly downloads: string[] = [];

  wire(socket: CdpSocket): void {
    socket.onEvent("Page.javascriptDialogOpening", (p, sessionId) => {
      if (!sessionId) return;

      this.lastDialog = {
        type: String(p.type ?? "dialog"),
        message: String(p.message ?? ""),
      };
      socket.call("Page.handleJavaScriptDialog", { accept: true }, sessionId).catch(() => {});
    });
    socket.onEvent("Network.requestWillBeSent", (p, sessionId) => {
      if (sessionId && !LONG_LIVED_REQUESTS.has(String(p.type))) {
        (
          this.pending.get(sessionId) ??
          this.pending.set(sessionId, new Map()).get(sessionId)!
        ).set(p.requestId, Date.now());
      }
    });
    socket.onEvent("Network.loadingFinished", (p, sessionId) => {
      if (sessionId) this.pending.get(sessionId)?.delete(p.requestId);
    });
    socket.onEvent("Network.loadingFailed", (p, sessionId) => {
      if (sessionId) this.pending.get(sessionId)?.delete(p.requestId);
    });
    socket.onEvent("Page.frameStartedNavigating", (p, sessionId) => {
      if (sessionId && p.frameId === this.mainFrame.get(sessionId)) {
        this.navPending.set(sessionId, (this.navPending.get(sessionId) ?? 0) + 1);
      }
    });
    socket.onEvent("Page.frameNavigated", (p, sessionId) => {
      if (sessionId && p.frame?.id === this.mainFrame.get(sessionId)) {
        this.navPending.set(sessionId, Math.max(0, (this.navPending.get(sessionId) ?? 0) - 1));
      }
    });
    socket.onEvent("Page.frameStoppedLoading", (p, sessionId) => {
      if (sessionId && p.frameId === this.mainFrame.get(sessionId)) {
        this.navPending.set(sessionId, 0);
      }
    });
    socket.onEvent("Browser.downloadWillBegin", (p) => {
      this.downloadGuids.set(String(p.guid), String(p.suggestedFilename ?? p.url ?? "download"));
    });
    socket.onEvent("Browser.downloadProgress", (p) => {
      const name = this.downloadGuids.get(String(p.guid));

      if (name && p.state === "completed") this.downloads.push(name);

      if (name && p.state !== "inProgress") this.downloadGuids.delete(p.guid);
    });
  }

  setMainFrame(session: string, frameId: string): void {
    this.mainFrame.set(session, frameId);
  }

  pendingCount(session: string): number {
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

  pendingNav(session: string): boolean {
    return (this.navPending.get(session) ?? 0) > 0;
  }

  takeDialog(): string | null {
    if (!this.lastDialog) return null;

    const text = `${this.lastDialog.type}: ${this.lastDialog.message}`.slice(0, 240);
    this.lastDialog = null;

    return text;
  }
}
