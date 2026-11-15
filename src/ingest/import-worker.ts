import { runImport } from "./import";

interface RunMessage {
  type: "run";
  dbPath: string;
  zipPath: string;
  importId: number;
  holdDerive?: boolean;
}
interface ContinueMessage {
  type: "continue-derive";
}
interface AbortMessage {
  type: "abort";
  reason: string;
}

const controller = new AbortController();
const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<RunMessage | ContinueMessage | AbortMessage>) => void) | null;
  postMessage: (message: unknown) => void;
};
let continueDerive: (() => void) | undefined;
workerScope.onmessage = async (
  event: MessageEvent<RunMessage | ContinueMessage | AbortMessage>,
) => {
  const message = event.data;
  if (message.type === "continue-derive") {
    continueDerive?.();
    continueDerive = undefined;
    return;
  }
  if (message.type === "abort") {
    controller.abort(new Error(message.reason));
    continueDerive?.();
    continueDerive = undefined;
    return;
  }
  try {
    const summary = await runImport(message.dbPath, message.zipPath, {
      importId: message.importId,
      signal: controller.signal,
      ...(message.holdDerive
        ? {
            beforeDerive: () =>
              new Promise<void>((resolve) => {
                continueDerive = resolve;
                workerScope.postMessage({ type: "derive-stage" });
              }),
          }
        : {}),
    });
    workerScope.postMessage({ type: "done", summary });
  } catch (error) {
    workerScope.postMessage({
      type: "error",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
