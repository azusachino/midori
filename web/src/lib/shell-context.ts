import { createContext, useContext } from "react";
import { type ApiClient, ApiError } from "../api/client";
import type { ChangesDTO } from "../api/types";
import { copy } from "../copy";

export interface ShellState {
  status: "loading" | "ready" | "error";
  changes: ChangesDTO | null;
  errorMessage: string | null;
  refresh: () => void;
}

export type ShellLoadResult =
  | { status: "ready"; changes: ChangesDTO; errorMessage: null }
  | { status: "error"; changes: null; errorMessage: string }
  | { status: "aborted" };

/**
 * Loads shell/changes state and maps errors (including 404 in production) to
 * the read-error state instead of synthetic data.
 */
export async function loadShellChanges(
  client: Pick<ApiClient, "changes">,
  signal?: AbortSignal,
): Promise<ShellLoadResult> {
  try {
    const changes = await client.changes(signal);
    if (signal?.aborted) return { status: "aborted" };
    return { status: "ready", changes, errorMessage: null };
  } catch (err) {
    if (signal?.aborted) return { status: "aborted" };
    if (err instanceof ApiError && err.kind === "aborted") return { status: "aborted" };
    return {
      status: "error",
      changes: null,
      errorMessage: err instanceof Error ? err.message : copy.api.unknownError,
    };
  }
}

export const ShellContext = createContext<ShellState | null>(null);

export function useShell(): ShellState {
  const ctx = useContext(ShellContext);
  if (!ctx) {
    throw new Error("useShell must be used within ShellProvider");
  }
  return ctx;
}
