import { createContext, useContext } from "react";
import type { ChangesDTO } from "@/api/types";

export interface ShellState {
  status: "loading" | "ready" | "error";
  changes: ChangesDTO | null;
  errorMessage: string | null;
  refresh: () => void;
}

export const ShellContext = createContext<ShellState | null>(null);

export function useShell(): ShellState {
  const ctx = useContext(ShellContext);
  if (!ctx) {
    throw new Error("useShell must be used within ShellProvider");
  }
  return ctx;
}
