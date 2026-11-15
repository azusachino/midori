import { type ReactNode, useCallback, useEffect, useState } from "react";
import { apiClient } from "@/api/client";
import type { ChangesDTO } from "@/api/types";
import { loadShellChanges, ShellContext, type ShellState } from "@/lib/shell-context";

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

    void loadShellChanges(apiClient, ac.signal).then((result) => {
      if (result.status === "aborted") return;
      if (result.status === "ready") {
        setChanges(result.changes);
        setStatus("ready");
      } else {
        setChanges(null);
        setErrorMessage(result.errorMessage);
        setStatus("error");
      }
    });

    return () => ac.abort();
  }, [nonce]);

  return (
    <ShellContext.Provider value={{ status, changes, errorMessage, refresh }}>
      {children}
    </ShellContext.Provider>
  );
}
