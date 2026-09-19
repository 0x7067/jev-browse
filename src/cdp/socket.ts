/**
 * Minimal CDP JSON-RPC client over a browser-level WebSocket, plus the
 * process-level helpers needed to reach one (free port, /json/version poll).
 */

import { createServer } from "node:net";

import type { JsonObject } from "../types.ts";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A command with no response after this long means the target is wedged. */
const CALL_TIMEOUT_MS = 30_000;

export class CdpSocket {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<
    number,
    { sessionId?: string; resolve: (v: any) => void; reject: (e: Error) => void }
  >();
  private listeners = new Map<string, Set<(params: any, sessionId?: string) => void>>();
  /** Sessions whose renderer died; calls against them reject, the socket lives. */
  private crashed = new Set<string>();
  private closed = false;

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(String(event.data));

      if (
        msg.method === "Inspector.targetCrashed" ||
        msg.method === "Target.targetCrashed"
      ) {
        const sessionId: string | undefined = msg.sessionId;

        if (sessionId) {
          // One dead renderer must not kill calls on sibling sessions.
          this.crashed.add(sessionId);

          for (const [id, p] of this.pending) {
            if (p.sessionId === sessionId) {
              this.pending.delete(id);
              p.reject(new Error("Renderer crashed"));
            }
          }

          return;
        }

        // A browser-level crash never answers again — refuse new calls too.
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

        return;
      }

      if (msg.method) {
        for (const cb of this.listeners.get(msg.method) ?? []) cb(msg.params, msg.sessionId);
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

  onEvent(method: string, cb: (params: any, sessionId?: string) => void): void {
    let set = this.listeners.get(method);

    if (!set) this.listeners.set(method, (set = new Set()));
    set.add(cb);
  }

  call<T>(method: string, params: JsonObject = {}, sessionId?: string): Promise<T> {
    if (this.closed) return Promise.reject(new Error("CDP connection closed"));

    if (sessionId && this.crashed.has(sessionId)) {
      return Promise.reject(new Error("Renderer crashed"));
    }

    const id = this.nextId++;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error("CDP call timed out"));
      }, CALL_TIMEOUT_MS);

      this.pending.set(id, {
        sessionId,
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
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

export function freePort(): Promise<number> {
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

export async function browserWsUrl(port: number, timeoutMs = 15000): Promise<string> {
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
export interface TargetInfo {
  targetId: string;
  type: string;
  /** Set when another target opened this one (window.open, target=_blank). */
  openerId?: string;
  title?: string;
  url?: string;
}

export interface TargetList {
  targetInfos: TargetInfo[];
}
