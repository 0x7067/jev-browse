import { AsyncLocalStorage } from "node:async_hooks";
import { closeSync, mkdirSync, openSync, writeSync } from "node:fs";
import { dirname, resolve } from "node:path";

interface TraceRun {
  fd: number | null;
  started: number;
  sequence: number;
}

const runs = new AsyncLocalStorage<TraceRun>();

const purposes = new AsyncLocalStorage<string>();

export function tracing(): boolean {
  return runs.getStore() !== undefined;
}

export function trace<T>(type: string, data: T): void {
  const run = runs.getStore();

  if (!run || run.fd === null) return;

  writeSync(run.fd, JSON.stringify({
    sequence: ++run.sequence,
    elapsed_ms: Math.round(performance.now() - run.started),
    type,
    purpose: purposes.getStore(),
    data,
  }) + "\n");
}

export function tracePurpose(): string | undefined {
  return purposes.getStore();
}

export function inPurpose<T>(purpose: string, operation: () => T): T {
  return purposes.run(purpose, operation);
}

export async function withTrace<T>(path: string | undefined, operation: () => Promise<T>): Promise<T> {
  if (!path) return operation();

  const target = resolve(path);
  mkdirSync(dirname(target), { recursive: true });
  const fd = openSync(target, "wx", 0o600);

  const run: TraceRun = { fd, started: performance.now(), sequence: 0 };

  try {
    return await runs.run(run, async () => {
      trace("run_start", { pid: process.pid, trace_file: target });

      try {
        const result = await operation();
        trace("run_result", result);

        return result;
      } catch (error) {
        trace("run_error", { error: String(error) });
        throw error;
      }
    });
  } finally {
    run.fd = null;
    closeSync(fd);
  }
}
