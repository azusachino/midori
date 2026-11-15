import type { ImportSummary, RunImportOptions } from "./import";

interface WorkerResponse {
  type: "done";
  summary: ImportSummary;
}
interface WorkerFailure {
  type: "error";
  error: string;
}

/** Runs all CPU-heavy import phases off the HTTP event loop on a WAL connection. */
export function runImportInWorker(
  dbPath: string,
  zipPath: string,
  options: RunImportOptions,
): Promise<ImportSummary> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./import-worker.ts", import.meta.url));
    let settled = false;
    const finish = (error?: Error, summary?: ImportSummary) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener("abort", onAbort);
      worker.terminate();
      if (error) reject(error);
      else if (summary) resolve(summary);
      else reject(new Error("import worker finished without a result"));
    };
    const onAbort = () => {
      worker.postMessage({
        type: "abort",
        reason: String(options.signal?.reason ?? "aborted"),
      });
    };
    worker.onmessage = (event: MessageEvent<WorkerResponse | WorkerFailure>) => {
      const message = event.data;
      if (message.type === "done") finish(undefined, message.summary);
      else finish(new Error(message.error));
    };
    worker.onerror = (event) => finish(new Error(event.message));
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) onAbort();
    worker.postMessage({
      type: "run",
      dbPath,
      zipPath,
      importId: options.importId,
      deriveSpinMs: options.deriveSpinMs,
    });
  });
}
