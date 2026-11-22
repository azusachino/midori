import { trustFor } from "./metrics";
import type { TrustLabel } from "./types";

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
  progressTotal?: number | null;
  error: string | null;
  exportDate?: string | null;
  /** Newest usable sleep night in the atomically derived snapshot. */
  asOfDay?: string | null;
  retryable?: boolean;
  olderThanStored?: boolean;
  exportVersion: string | null;
  recordsSeen: number | null;
  recordsInserted: number | null;
  recordsDeduped: number | null;
  newUsableNights: number | null;
  newEpochs: string[];
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

/** B-R5 build identity returned by `GET /api/health` and shown in the UI shell. */
export interface HealthDTO {
  ok: true;
  version: string;
  revision: string;
}

/** B-P1 owner-authored agent context, a singleton (`id = 1`). */
export interface ProfileContextDTO {
  goals: string;
  routine: string;
  medicalContext: string;
  updatedAt: string | null;
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
    | "low_trust"
    | "user_note";
  flagged: boolean;
  detailKey?: string;
  day?: string;
  count?: number;
}

export type NoteCategory = "illness" | "travel" | "alcohol" | "medication" | "stress" | "other";

export interface NoteDTO {
  id: number;
  startDay: string;
  endDay: string;
  category: NoteCategory;
  label: string;
  createdAt: string;
  updatedAt: string;
}

export type FindingsDiffClassification =
  | "direction_reversed"
  | "newly_notable"
  | "returned_to_usual"
  | "shifted_further"
  | "baseline_ready";

export interface FindingSnapshotSummaryDTO {
  state: FindingState;
  severity: FindingSeverity;
  direction: FindingDirection | null;
  z: number | null;
  confidence: "high" | "medium" | "low" | null;
}

export interface FindingsDiffItemDTO {
  metric: string;
  kind: "overnight" | "daytime";
  classification: FindingsDiffClassification;
  previous: FindingSnapshotSummaryDTO;
  current: FindingSnapshotSummaryDTO;
}

export interface FindingsDiffDTO {
  fromImportId: number;
  toImportId: number;
  fromAsOfDay: string;
  toAsOfDay: string;
  unchangedCount: number;
  items: FindingsDiffItemDTO[];
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

export interface FreshnessSummaryDTO {
  asOfDay: string | null;
  lastImportAt: string | null;
  daysSinceImport: number | null;
}
export interface LastNightDTO {
  date: string;
  asleepH: number;
  deepH: number;
  remH: number;
  coreH: number;
  skippedPartialDay: string | null;
  skippedPartialReason: "export_cut" | null;
}
export interface ChangesDTO {
  hasImports: boolean;
  asOfDay: string | null;
  freshness: FreshnessSummaryDTO;
  activeImport: ImportDTO | null;
  primaryWatch: {
    epochId: number;
    label: string;
    hardware: string;
    colorIndex: number;
    warmingUp: { current: number; target: number } | null;
  } | null;
  staleBanner: { daysSinceImport: number; windowFrom: string; windowTo: string } | null;
  warmingNotice: {
    metric: string;
    current: number;
    target: number;
    estimatedReadyDay: string | null;
  } | null;
  overnight: FindingRowDTO[];
  daytime: FindingRowDTO[];
  lastNight: LastNightDTO | null;
  sinceLastImport: FindingsDiffDTO | null;
  recentNotes: NoteDTO[];
}
export interface WeeklySeriesPointDTO {
  weekStart: string;
  median: number | null;
  epochId: number;
  hasPartial: boolean;
}
export interface MetricIndexEntryDTO {
  metric: string;
  kind: "overnight" | "daytime" | "trendOnly";
  unit: string;
  trust: TrustLabel;
  trustNote: string;
  hasData: boolean;
  finding: FindingRowDTO | null;
  weeklySeries: WeeklySeriesPointDTO[];
  seams: Array<{ day: string; kind: "offset" | "step" }>;
}
export interface MetricsIndexDTO {
  hasImports: boolean;
  asOfDay: string | null;
  metrics: MetricIndexEntryDTO[];
}
export interface EpochRefDTO {
  id: number;
  sourceName: string;
  deviceHw: string;
  label: string;
  kind: "watch" | "phone" | "app" | "other";
  colorIndex: number | null;
  minor: boolean;
}
export interface MetricUnitPointDTO {
  day: string;
  epochId: number;
  value: number | null;
  n: number;
  usable: boolean;
  partialReason: string | null;
  tzChange: boolean;
  z: number | null;
  isRecent: boolean;
}
export interface MetricSeriesDTO {
  metric: string;
  kind: "overnight" | "daytime" | "trendOnly";
  unit: string;
  trust: TrustLabel;
  trustNote: string;
  range: "90d" | "180d" | "1y" | "all";
  asOfDay: string | null;
  finding: FindingRowDTO | null;
  epochs: EpochRefDTO[];
  units: MetricUnitPointDTO[];
  /** Points are limited to baseline ranks 8–35 of the current stint (B-F1). */
  band: Array<{ day: string; low: number; high: number; median: number }>;
  stints: Array<{ epochId: number; startDay: string; endDay: string }>;
  seams: Array<{
    seamDay: string;
    fromEpochId: number | null;
    toEpochId: number;
    kind: "offset" | "step";
    value: number;
    nOld: number;
    nNew: number;
  }>;
  osUpdates: Array<{ epochId: number; day: string; fromSw: string | null; toSw: string }>;
  notes: NoteDTO[];
}
export interface UnitEvidenceDTO {
  metric: string;
  day: string;
  unitKind: "night" | "day";
  zone: string;
  value: number | null;
  sampleCount: number;
  usable: boolean;
  partialReason: string | null;
  primaryEpoch: EpochRefDTO | null;
  deviceSw: string | null;
  samples: Array<{ timestamp: string; localTime: string; value: number }>;
  sleep: {
    startLocal: string;
    endLocal: string;
    asleepH: number;
    deepH: number;
    remH: number;
    coreH: number;
  } | null;
  alsoRecordedBy: EpochRefDTO[];
  notes: NoteDTO[];
}
export interface EpochMetricRoleDTO {
  metric: string;
  role: "primary" | "candidate" | "minor";
  baselineState: "full" | "early" | "warming_up" | "insufficient" | "trend_only" | null;
  warmup: { current: number; target: number } | null;
  seamFromPrevious: MetricSeriesDTO["seams"][number] | null;
}
export interface EpochCardDTO extends EpochRefDTO {
  firstDay: string;
  lastDay: string;
  daysPresent: string[];
  daysPresentCount: number;
  primaryMetricCount: number;
  metrics: EpochMetricRoleDTO[];
  osUpdates: MetricSeriesDTO["osUpdates"];
}
export interface EpochsDTO {
  hasImports: boolean;
  asOfDay: string | null;
  epochs: EpochCardDTO[];
}
export interface NightsDTO {
  from: string;
  to: string;
  nights: Array<{
    date: string;
    zone: string;
    tzChange: boolean;
    partialReason: string | null;
    asleepS: number;
    coreS: number;
    deepS: number;
    remS: number;
    inBedS: number;
  }>;
}

/** Upload limits pinned by contract (single-user instance). */
export const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;

/**
 * B-A3: every MCP tool description ends with this cautious-evidence guidance, and the
 * B-A5 dossier repeats it as `guidance` so one agent call carries it too.
 */
export const AGENT_GUIDANCE =
  "Cite the specific nights behind findings. Device changes, OS updates, partial data, travel, and personal notes are confounders; midori does not assert causes.";

/** B-A5 primary-stint long-term baseline medians for one finding (90 days and 1 year). */
export interface LongTermBaselineDTO {
  median90d: number | null;
  median1y: number | null;
  n90d: number;
  n1y: number;
}

/** B-A5 one night aligned across sleep stages, primary-stint vitals and notes. */
export interface AlignedNightDTO {
  date: string;
  zone: string;
  tzChange: boolean;
  partialReason: string | null;
  sleep: { asleepH: number; deepH: number; remH: number; coreH: number } | null;
  metrics: Record<string, number | null>;
  notes: Array<{ id: number; category: NoteCategory; label: string }>;
}

/** B-A5 one-call dossier: findings + long-term baselines + aligned nights + profile. */
export interface HealthContextDTO {
  asOfDay: string | null;
  freshness: FreshnessSummaryDTO;
  primaryWatch: ChangesDTO["primaryWatch"];
  profile: ProfileContextDTO;
  summary: {
    standsOut: number;
    closeToEdge: number;
    within: number;
    other: number;
    sharedConfounders: string[];
  };
  findings: Array<FindingRowDTO & { longTerm: LongTermBaselineDTO }>;
  sinceLastImport: FindingsDiffDTO | null;
  recentNights: AlignedNightDTO[];
  recentNotes: NoteDTO[];
  guidance: string;
}

export function trustFields(metric: string): Pick<FindingRowDTO, "trust" | "trustNote"> {
  const { label, note } = trustFor(metric);
  return { trust: label, trustNote: note };
}
