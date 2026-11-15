import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { apiClient } from "@/api/client";
import type { ChangesDTO } from "@/api/types";
import { loadShellChanges, ShellContext, type ShellState } from "@/lib/shell-context";

const ACTIVE_IMPORT_POLL_MS = 1500;

export function ShellProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ShellState["status"]>("loading");
  const [changes, setChanges] = useState<ChangesDTO | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const statusRef = useRef<ShellState["status"]>("loading");
  statusRef.current = status;

  const refresh = useCallback(() => {
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    void nonce;
    const ac = new AbortController();
    const isSilentRefresh = statusRef.current === "ready";
    if (!isSilentRefresh) {
      setStatus("loading");
      setErrorMessage(null);
    }

    void loadShellChanges(apiClient, ac.signal).then((result) => {
      if (result.status === "aborted") return;
      if (result.status === "ready") {
        setChanges(result.changes);
        setStatus("ready");
        setErrorMessage(null);
      } else if (!isSilentRefresh) {
        setChanges(null);
        setErrorMessage(result.errorMessage);
        setStatus("error");
      }
    });

    return () => ac.abort();
  }, [nonce]);

  const hasActiveImport = status === "ready" && changes?.activeImport != null;

  useEffect(() => {
    if (!hasActiveImport) return;
    let cancelled = false;
    let timerId: number | null = null;
    let activeAbort: AbortController | null = null;

    const tick = () => {
      if (cancelled) return;
      activeAbort?.abort();
      const ac = new AbortController();
      activeAbort = ac;
      void loadShellChanges(apiClient, ac.signal).then((result) => {
        if (cancelled || result.status === "aborted") return;
        if (result.status === "ready") {
          setChanges(result.changes);
          setStatus("ready");
          setErrorMessage(null);
        }
        if (!cancelled && (result.status !== "ready" || result.changes.activeImport != null)) {
          timerId = window.setTimeout(tick, ACTIVE_IMPORT_POLL_MS);
        }
      });
    };

    timerId = window.setTimeout(tick, ACTIVE_IMPORT_POLL_MS);

    return () => {
      cancelled = true;
      if (timerId !== null) window.clearTimeout(timerId);
      activeAbort?.abort();
    };
  }, [hasActiveImport]);

  return (
    <ShellContext.Provider value={{ status, changes, errorMessage, refresh }}>
      {children}
    </ShellContext.Provider>
  );
}
