import { trustFor } from "./metrics";
import type { Finding, Severity, TrustLabel } from "./types";

/**
 * Wire DTOs for REST + MCP (T4). One contract for both surfaces; MCP tools
 * return exactly these shapes. Every payload carries as-of/trust information —
 * never strip it in a consumer.
 */

export type ImportStatus = "queued" | "unpacking" | "parsing" | "storing" | "done" | "failed";

export const IMPORT_STATUSES: readonly ImportStatus[] = [
  "queued",
  "unpacking",
  "parsing",
  "storing",
  "done",
  "failed",
];

export interface ImportDTO {
  id: number;
  zipName: string;
  zipSize: number;
  status: ImportStatus;
  error: string | null;
  exportVersion: string | null;
  recordsSeen: number | null;
  recordsInserted: number | null;
  recordsDeduped: number | null;
  durationMs: number | null;
  createdAt: string;
}

/** 202 Accepted body for POST /api/imports. */
export interface UploadAcceptedDTO {
  importId: number;
  status: ImportStatus;
}

/** Failure body for any endpoint. */
export interface ErrorResponse {
  error: string;
  importId?: number;
  retryable: boolean;
}

export interface FindingDTO {
  kind: Finding["kind"];
  metric: string;
  sourceName: string;
  anchorDay: string;
  windowDays: number;
  baseline: number | null;
  recent: number | null;
  unit: string | null;
  z: number | null;
  severity: Severity;
  evidence: Finding["evidence"];
}

export interface SourceDTO {
  name: string;
  firstSeenAt: string;
  lastSeenAt: string;
  recordCount: number;
}

export interface AsOfEntry {
  sourceName: string;
  day: string;
}

export interface BriefingDTO {
  anchorDay: string;
  asOf: Record<string, AsOfEntry>;
  findings: FindingDTO[];
  sources: SourceDTO[];
  lastImport: ImportDTO | null;
  /** e.g. "last import 34 days ago" — nudge shown when staleness exceeds the cadence target. */
  importCadenceHint: string | null;
}

export interface MetricDailyPointDTO {
  day: string;
  value: number;
  sampleCount: number;
}

export interface MetricDailyDTO {
  metric: string;
  sourceName: string;
  unit: string | null;
  method: "median" | "sum";
  trust: TrustLabel;
  trustNote: string;
  asOfDay: string;
  points: MetricDailyPointDTO[];
}

export type SuppressionReason = "cross_source" | "insufficient_data" | "coverage_gap";

export interface DeviationDTO {
  metric: string;
  sourceName: string;
  unit: string | null;
  baseline: number | null;
  /** Robust \u00b11.5\u03c3 band around `baseline` (null when suppressed) — the "inside normal" envelope. */
  baselineLow: number | null;
  baselineHigh: number | null;
  recent: number | null;
  z: number | null;
  severity: Severity;
  nBaseline: number;
  nRecent: number;
  trust: TrustLabel;
  suppressed: SuppressionReason | null;
}

/** Upload limits pinned by contract (single-user instance). */
export const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;

export function trustFields(metric: string): Pick<DeviationDTO, "trust"> & { trustNote: string } {
  const { label, note } = trustFor(metric);
  return { trust: label, trustNote: note };
}
