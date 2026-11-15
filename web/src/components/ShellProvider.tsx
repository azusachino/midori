import { type ReactNode, useCallback, useEffect, useState } from "react";
import { ApiError, apiClient } from "@/api/client";
import type { ChangesDTO } from "@/api/types";
import { copy } from "@/copy";
import { ShellContext, type ShellState } from "@/lib/shell-context";

export function ShellProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ShellState["status"]>("loading");
  const [changes, setChanges] = useState<ChangesDTO | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => {
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    void nonce;
    const ac = new AbortController();
    setStatus("loading");
    setErrorMessage(null);

    apiClient
      .changes(ac.signal)
      .then((data) => {
        if (ac.signal.aborted) return;
        setChanges(data);
        setStatus("ready");
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        if (err instanceof ApiError && err.kind === "aborted") return;
        const msg = err instanceof Error ? err.message : copy.api.unknownError;
        setErrorMessage(msg);
        setStatus("error");
      });

    return () => ac.abort();
  }, [nonce]);

  return (
    <ShellContext.Provider value={{ status, changes, errorMessage, refresh }}>
      {children}
    </ShellContext.Provider>
  );
}
