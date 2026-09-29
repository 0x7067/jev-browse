import type { ChildProcess } from "node:child_process";

export async function stopChrome(proc: ChildProcess): Promise<void> {
  if (proc.pid === undefined || proc.exitCode !== null || proc.signalCode !== null) return;

  await new Promise<void>(resolve => {
    const timer = setTimeout(() => proc.kill("SIGKILL"), 2000);

    proc.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    proc.kill("SIGTERM");
  });
}
