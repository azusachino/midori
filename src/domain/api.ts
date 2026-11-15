import { trustFor } from "./metrics";
import type { Finding, TrustLabel } from "./types";

/**
 * Wire DTOs for REST + MCP (T4). One contract for both surfaces; MCP tools
 * return exactly these shapes. Every payload carries as-of/trust information —
 * never strip it in a consumer.
 */

export type ImportStatus =
  | "queued"
  | "unpacking"
  | "parsing"
  | "storing"
  | "deriving"
  | "done"
  | "failed";

export const IMPORT_STATUSES: readonly ImportStatus[] = [
  "queued",
  "unpacking",
  "parsing",
  "storing",
  "deriving",
  "done",
  "failed",
];

export interface ImportDTO {
  id: number;
  zipName: string;
  zipSize: number;
  status: ImportStatus;
  stage?: string | null;
  progress?: number | null;
  error: string | null;
  exportDate?: string | null;
  retryable?: boolean;
  olderThanStored?: boolean;
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

export type LegacySeverity = "within" | "notable" | "alert";

/** Kept for the pre-v1 read routes until Slice 11 removes them. */
export interface LegacyFindingDTO {
  kind: Finding["kind"];
  metric: string;
  sourceName: string;
  anchorDay: string;
  windowDays: number;
  baseline: number | null;
  recent: number | null;
  unit: string | null;
  z: number | null;
  severity: LegacySeverity;
  evidence: Finding["evidence"];
}

export type FindingState = "computed" | "warming_up" | "insufficient" | "stale";
export type FindingDirection = "higher" | "lower" | "within";
export type FindingSeverity = "within" | "notable" | "alert";

export interface CheckDTO {
  key:
    | "device_change"
    | "os_update"
    | "partial_nights"
    | "tz_change"
    | "missing_nights"
    | "low_trust";
  flagged: boolean;
  detailKey?: string;
  day?: string;
  count?: number;
}

export type CheckResultDTO = CheckDTO;

/** Shape consumed by the v1 Changes and metric detail UI. */
export interface FindingRowDTO {
  metric: string;
  kind: "overnight" | "daytime" | "trendOnly";
  unit: string;
  trust: TrustLabel;
  trustNote: string;
  epochId: number | null;
  epochLabel: string | null;
  state: FindingState;
  direction: FindingDirection | null;
  severity: FindingSeverity;
  confidence: "high" | "medium" | "low" | null;
  z: number | null;
  recentMedian: number | null;
  baselineMedian: number | null;
  baselineLow: number | null;
  baselineHigh: number | null;
  kOutside: number | null;
  recentCount: number;
  baselineCount: number;
  warmup: { current: number; target: number; estimatedReadyDay: string | null } | null;
  onset: { day: string; openEnded: boolean } | null;
  checks: CheckDTO[];
  sparkline: Array<{ day: string; value: number | null; z: number | null; usable: boolean }>;
  caveats: string[];
}

export type FindingDTO = FindingRowDTO;

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
  findings: LegacyFindingDTO[];
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
  severity: LegacySeverity;
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
