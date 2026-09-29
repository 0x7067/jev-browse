import { inPurpose, trace, tracing } from "../trace.ts";
import { StalePage, type JsonObject } from "../types.ts";

interface Evaluation<T> {
  exceptionDetails?: { exception?: { description?: string }; text?: string };
  result?: { value?: T };
}

interface TimedValue<T> {
  value: T;
  execution_ms: number;
  started_epoch_ms: number;
  visibility: string;
  ready_state: string;
}

interface EvaluationHost {
  call<T>(method: string, params: JsonObject): Promise<T>;
}

function valueOf<T>(response: Evaluation<T>): T | undefined {
  if (response.exceptionDetails) {
    const description = response.exceptionDetails.exception?.description ?? response.exceptionDetails.text ?? "";

    if (/context.{0,20}destroy|execution context|navigat|detach/i.test(description)) {
      throw new StalePage("Document changed during evaluation");
    }

    throw new Error(`Evaluation failed: ${description.slice(0, 300)}`);
  }

  return response.result?.value;
}

export async function evaluate<T>(host: EvaluationHost, expression: string, awaitPromise: boolean, purpose: string): Promise<T | undefined> {
  return inPurpose(purpose, async () => {
    if (!tracing()) {
      return valueOf(await host.call<Evaluation<T>>("Runtime.evaluate", {
        expression, returnByValue: true, awaitPromise,
      }));
    }

    const started = performance.now();
    const sentEpoch = Date.now();

    const instrumented = `(() => {
      const start=performance.now(),epoch=Date.now();
      const finish=value=>({value,execution_ms:performance.now()-start,started_epoch_ms:epoch,
        visibility:document.visibilityState,ready_state:document.readyState});
      const value=(${expression});
      return ${awaitPromise ? "Promise.resolve(value).then(finish)" : "finish(value)"};
    })()`;

    const result = valueOf(await host.call<Evaluation<TimedValue<T>>>("Runtime.evaluate", {
      expression: instrumented, returnByValue: true, awaitPromise,
    }));

    if (result) {
      trace("evaluation_timing", {
        purpose,
        elapsed_ms: Math.round(performance.now() - started),
        execution_ms: result.execution_ms,
        dispatch_delay_ms: result.started_epoch_ms - sentEpoch,
        visibility: result.visibility,
        ready_state: result.ready_state,
      });
    }

    return result?.value;
  });
}
