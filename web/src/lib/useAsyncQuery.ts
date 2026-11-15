import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@/api/client";
import { copy } from "@/copy";

export type QueryState<T> =
  | { status: "loading"; data: null; error: null; retry: () => void }
  | { status: "error"; data: null; error: string; retry: () => void }
  | { status: "ready"; data: T; error: null; retry: () => void };

/**
 * Shared abort-safe async loader for page queries with manual retry.
 */
export function useAsyncQuery<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  depsKey: string,
): QueryState<T> {
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const retry = useCallback(() => {
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    void depsKey;
    void nonce;
    const ac = new AbortController();
    setPhase("loading");
    setError(null);

    loaderRef
      .current(ac.signal)
      .then((result) => {
        if (ac.signal.aborted) return;
        setData(result);
        setPhase("ready");
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        if (err instanceof ApiError && err.kind === "aborted") return;
        setError(err instanceof Error ? err.message : copy.api.unknownError);
        setPhase("error");
      });

    return () => ac.abort();
  }, [depsKey, nonce]);

  if (phase === "error") {
    return { status: "error", data: null, error: error ?? copy.api.unknownError, retry };
  }
  if (phase === "ready" && data !== null) {
    return { status: "ready", data, error: null, retry };
  }
  return { status: "loading", data: null, error: null, retry };
}
