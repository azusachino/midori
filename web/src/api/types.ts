import type { TrustLabel } from "@midori/domain/types";

/**
 * v1 REST API DTOs (docs/design.md "Interfaces").
 * Reconciled with server DTOs once Slice 9 merges.
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
  exportVersion: string | null;
  exportDate?: string | null;
  recordsSeen: number | null;
  recordsInserted: number | null;
  recordsDeduped: number | null;
  newUsableNights?: number | null;
  newEpochs?: string[];
  olderThanStored?: boolean;
  retryable?: boolean;
  durationMs: number | null;
  createdAt: string;
}

export interface UploadAcceptedDTO {
  importId: number;
  status: ImportStatus;
}

export interface ErrorResponse {
  error: string;
  importId?: number;
  retryable: boolean;
}

export type MetricKind = "overnight" | "daytime" | "trendOnly";
export type EpochKind = "watch" | "phone" | "app" | "other";
export type FindingState = "computed" | "warming_up" | "insufficient" | "stale";
export type FindingSeverity = "within" | "notable" | "alert";
export type FindingDirection = "higher" | "lower" | "within";
export type ConfidenceLevel = "high" | "medium" | "low";
export type MetricRange = "90d" | "180d" | "1y" | "all";
export type MetricTab = "chart" | "long";

export type CheckKey =
  | "device_change"
  | "os_update"
  | "partial_nights"
  | "tz_change"
  | "missing_nights"
  | "low_trust";

export interface CheckResultDTO {
  key: CheckKey;
  flagged: boolean;
  detailKey?: string;
  day?: string;
  count?: number;
}

export interface OnsetDTO {
  day: string;
  openEnded: boolean;
}

export interface WarmupProgressDTO {
  current: number;
  target: number;
  estimatedReadyDay: string | null;
}

export interface SparklinePointDTO {
  day: string;
  value: number | null;
  z: number | null;
  usable: boolean;
}

export interface FindingRowDTO {
  metric: string;
  kind: MetricKind;
  unit: string;
  trust: TrustLabel;
  trustNote: string;
  epochId: number | null;
  epochLabel: string | null;
  state: FindingState;
  direction: FindingDirection | null;
  severity: FindingSeverity;
  confidence: ConfidenceLevel | null;
  z: number | null;
  recentMedian: number | null;
  baselineMedian: number | null;
  baselineLow: number | null;
  baselineHigh: number | null;
  kOutside: number | null;
  recentCount: number;
  baselineCount: number;
  warmup: WarmupProgressDTO | null;
  onset: OnsetDTO | null;
  checks: CheckResultDTO[];
  sparkline: SparklinePointDTO[];
  caveats: string[];
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

export interface StaleBannerDTO {
  daysSinceImport: number;
  windowFrom: string;
  windowTo: string;
}

export interface WarmingNoticeDTO {
  metric: string;
  current: number;
  target: number;
  estimatedReadyDay: string | null;
}

export interface PrimaryWatchSummaryDTO {
  epochId: number;
  label: string;
  hardware: string;
  colorIndex: number;
  warmingUp: { current: number; target: number } | null;
}

export interface FreshnessSummaryDTO {
  asOfDay: string | null;
  lastImportAt: string | null;
  daysSinceImport: number | null;
}

export interface ChangesDTO {
  hasImports: boolean;
  asOfDay: string | null;
  freshness: FreshnessSummaryDTO;
  activeImport: ImportDTO | null;
  primaryWatch: PrimaryWatchSummaryDTO | null;
  staleBanner: StaleBannerDTO | null;
  warmingNotice: WarmingNoticeDTO | null;
  overnight: FindingRowDTO[];
  daytime: FindingRowDTO[];
  lastNight: LastNightDTO | null;
}

export interface WeeklySeriesPointDTO {
  weekStart: string;
  median: number | null;
  epochId: number | null;
  hasPartial: boolean;
}

export interface MetricIndexEntryDTO {
  metric: string;
  kind: MetricKind;
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
  kind: EpochKind;
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

export interface BandPointDTO {
  day: string;
  low: number;
  high: number;
  median: number;
}

export interface StintDTO {
  epochId: number;
  startDay: string;
  endDay: string;
}

export interface SeamStepDTO {
  seamDay: string;
  fromEpochId: number;
  toEpochId: number;
  kind: "offset" | "step";
  value: number;
  nOld: number;
  nNew: number;
}

export interface OsUpdateEventDTO {
  epochId: number;
  day: string;
  fromSw: string | null;
  toSw: string;
}

export interface MetricSeriesDTO {
  metric: string;
  kind: MetricKind;
  unit: string;
  trust: TrustLabel;
  trustNote: string;
  range: MetricRange;
  asOfDay: string | null;
  finding: FindingRowDTO | null;
  epochs: EpochRefDTO[];
  units: MetricUnitPointDTO[];
  band: BandPointDTO[];
  stints: StintDTO[];
  seams: SeamStepDTO[];
  osUpdates: OsUpdateEventDTO[];
}

export interface SamplePointDTO {
  timestamp: string;
  localTime: string;
  value: number;
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
  samples: SamplePointDTO[];
  sleep: {
    startLocal: string;
    endLocal: string;
    asleepH: number;
    deepH: number;
    remH: number;
    coreH: number;
  } | null;
  alsoRecordedBy: EpochRefDTO[];
}

export interface EpochMetricRoleDTO {
  metric: string;
  role: "primary" | "candidate" | "minor";
  baselineState: "full" | "early" | "warming_up" | "insufficient" | "trend_only";
  warmup: { current: number; target: number } | null;
  seamFromPrevious: SeamStepDTO | null;
}

export interface EpochCardDTO {
  id: number;
  sourceName: string;
  deviceHw: string;
  label: string;
  kind: EpochKind;
  colorIndex: number | null;
  minor: boolean;
  firstDay: string;
  lastDay: string;
  daysPresent: string[];
  daysPresentCount: number;
  primaryMetricCount: number;
  metrics: EpochMetricRoleDTO[];
  osUpdates: OsUpdateEventDTO[];
}

export interface EpochsDTO {
  hasImports: boolean;
  asOfDay: string | null;
  epochs: EpochCardDTO[];
}

export interface NightSummaryDTO {
  date: string;
  zone: string;
  tzChange: boolean;
  partialReason: string | null;
  asleepS: number;
  coreS: number;
  deepS: number;
  remS: number;
  inBedS: number;
}

export interface NightsDTO {
  from: string;
  to: string;
  nights: NightSummaryDTO[];
}
