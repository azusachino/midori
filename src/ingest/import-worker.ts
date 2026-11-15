import { runImport } from "./import";

interface RunMessage {
  type: "run";
  dbPath: string;
  zipPath: string;
  importId: number;
  deriveSpinMs?: number;
}
interface AbortMessage {
  type: "abort";
  reason: string;
}

const controller = new AbortController();
const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<RunMessage | AbortMessage>) => void) | null;
  postMessage: (message: unknown) => void;
};
workerScope.onmessage = async (event: MessageEvent<RunMessage | AbortMessage>) => {
  const message = event.data;
  if (message.type === "abort") {
    controller.abort(new Error(message.reason));
    return;
  }
  try {
    const summary = await runImport(message.dbPath, message.zipPath, {
      importId: message.importId,
      signal: controller.signal,
      ...(message.deriveSpinMs === undefined ? {} : { deriveSpinMs: message.deriveSpinMs }),
    });
    workerScope.postMessage({ type: "done", summary });
  } catch (error) {
    workerScope.postMessage({
      type: "error",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
