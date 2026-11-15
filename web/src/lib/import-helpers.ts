import type { ImportDTO, ImportStatus } from "../api/types";

export const IMPORT_STAGES = ["queued", "unpacking", "parsing", "storing", "deriving"] as const;

export type ImportStageKey = (typeof IMPORT_STAGES)[number];

export function isActiveImportStatus(status: ImportStatus): boolean {
  return status !== "done" && status !== "failed";
}

/**
 * Computes a clamped 0..100 percentage from `progress / progressTotal`,
 * returning `null` when either field is absent, non-finite, or `progressTotal <= 0`.
 */
export function computeImportProgressPct(
  progress: number | null | undefined,
  progressTotal: number | null | undefined,
): number | null {
  if (
    typeof progress !== "number" ||
    !Number.isFinite(progress) ||
    typeof progressTotal !== "number" ||
    !Number.isFinite(progressTotal) ||
    progressTotal <= 0
  ) {
    return null;
  }
  return Math.max(0, Math.min(100, (progress / progressTotal) * 100));
}

/**
 * Resolves the 0..4 stepper index and optional 0..100 progress percentage,
 * tolerating v0 ImportDTO rows where `stage`, `progress`, and `progressTotal` are absent.
 */
export function resolveJobStage(row: ImportDTO): {
  stageIndex: number;
  stageKey: ImportStageKey;
  progressPct: number | null;
  barValue: number;
} {
  const rawStage = (row.stage ?? row.status) as string;
  const idx = (IMPORT_STAGES as readonly string[]).indexOf(rawStage);
  const stageIndex = row.status === "done" ? IMPORT_STAGES.length : Math.max(idx, 0);
  const stageKey = IMPORT_STAGES[Math.min(stageIndex, IMPORT_STAGES.length - 1)] ?? "queued";

  const progressPct = computeImportProgressPct(row.progress, row.progressTotal);

  const barValue =
    progressPct !== null
      ? Math.round(progressPct)
      : row.status === "done"
        ? 100
        : Math.round(((stageIndex + 0.5) / IMPORT_STAGES.length) * 100);

  return { stageIndex, stageKey, progressPct, barValue };
}

const BAD_EXPORT_RE =
  /export\.xml|not a health export|end of central directory|central directory|not a zip|invalid zip/i;

export function isBadExportMessage(message: string | null | undefined): boolean {
  return typeof message === "string" && BAD_EXPORT_RE.test(message);
}

export function formatMegabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 10 ? `${mb.toFixed(0)} MB` : `${mb.toFixed(1)} MB`;
}

export function formatDurationClock(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export function formatDurationMs(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}
