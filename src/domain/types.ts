/**
 * Domain contracts for midori (T4). These types are the pinned interface between
 * ingest, stats, http, mcp and web. Nothing downstream may invent its own shape.
 */

export type FindingKind = "deviation" | "recalibration" | "coverage";

/** info = coverage/recalibration notes; notable/alert = |z| bands for deviations. */
export type Severity = "info" | "notable" | "alert";

export type DeviceEventKind = "first_seen" | "last_seen" | "switch";

export type TrustLabel = "high" | "moderate" | "low";

/** Points at the rows that justify a finding. Never narrative — evidence only. */
export interface EvidenceRef {
  kind: "metric_day" | "source_span" | "import";
  metric: string;
  sourceName?: string;
  day?: string; // 'YYYY-MM-DD', record-local
  fromDay?: string;
  toDay?: string;
  importId?: number;
  detail?: string;
}

export interface Finding {
  kind: FindingKind;
  metric: string;
  sourceName: string;
  anchorDay: string; // 'YYYY-MM-DD', last data day for this metric+source
  windowDays: number; // recent window length in days (14)
  baseline: number | null; // null for coverage findings
  recent: number | null;
  unit: string | null;
  z: number | null; // null for recalibration/coverage findings
  severity: Severity;
  evidence: EvidenceRef[];
}

/** One parsed export.xml <Record>, normalized (T5 fills these). */
export interface RecordRow {
  type: string; // HK type identifier, verbatim
  sourceName: string;
  unit: string | null;
  startAt: string; // UTC ISO 8601 fixed-width
  endAt: string;
  startOffsetMin: number; // original local offset (e.g. 540 for +09:00)
  endOffsetMin: number;
  value: number | null; // quantity
  valueStr: string | null; // category
  deviceHw: string | null;
  deviceSw: string | null;
  metaJson: string | null;
}

export interface SourceSpan {
  sourceName: string;
  firstDay: string; // 'YYYY-MM-DD' record-local
  lastDay: string;
  sampleCount: number;
}

export type BoundaryKind = "series_start" | "switch" | "gap";

export interface CoverageBoundary {
  kind: BoundaryKind;
  metric: string;
  sourceName: string; // the newly appearing (or continuing) source
  counterpartSource: string | null; // previous source for switch/gap
  boundaryDay: string;
  gapDays: number | null; // days between previous span end and this span start (gap only)
}

export interface DailyMetric {
  metric: string;
  sourceName: string;
  day: string;
  method: "median" | "sum";
  unit: string | null;
  value: number;
  sampleCount: number;
}
