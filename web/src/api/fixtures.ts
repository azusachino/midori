import { METRICS } from "@midori/domain/metrics";
import { DAYTIME_ORDER, metricKindFor, OVERNIGHT_ORDER, TREND_ONLY_ORDER } from "../lib/metrics";
import type {
  ChangesDTO,
  EpochsDTO,
  FindingRowDTO,
  ImportDTO,
  MetricIndexEntryDTO,
  MetricRange,
  MetricSeriesDTO,
  MetricsIndexDTO,
  NightsDTO,
  UnitEvidenceDTO,
} from "./types";

/**
 * Deterministic synthetic fixture stubs used ONLY in dev/e2e when v1 endpoints
 * return 404 (before Slice 9 lands). Never bundled or activated in production.
 */

const SYNTHETIC_DAYS = [
  "2026-02-15",
  "2026-02-16",
  "2026-02-17",
  "2026-02-18",
  "2026-02-19",
  "2026-02-20",
  "2026-02-21",
  "2026-02-22",
  "2026-02-23",
  "2026-02-24",
  "2026-02-25",
  "2026-02-26",
  "2026-02-27",
  "2026-02-28",
  "2026-03-01",
] as const;

const SYNTHETIC_WRIST_TEMP_VALUES = [
  36.4, 36.45, 36.38, 36.42, 36.41, 36.39, 36.43, 36.91, 36.94, 36.89, 36.95, 36.92, 36.96, 36.93,
  36.97,
] as const;

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return 0;
  return Math.max(0, Math.floor((Date.now() - parsed) / 86_400_000));
}

function buildStubFinding(metric: string): FindingRowDTO {
  const spec = METRICS[metric];
  const isTemp = metric === "wrist_temp";
  return {
    metric,
    kind: metricKindFor(metric),
    unit: spec?.unit ?? (metric === "sleep_hr" ? "count/min" : ""),
    trust: spec?.trust ?? "moderate",
    trustNote: spec?.trustNote ?? "Trend metric.",
    epochId: 2,
    epochLabel: "Synthetic Watch B",
    state: isTemp ? "warming_up" : "insufficient",
    direction: null,
    severity: "within",
    confidence: null,
    z: null,
    recentMedian: null,
    baselineMedian: null,
    baselineLow: null,
    baselineHigh: null,
    kOutside: null,
    recentCount: isTemp ? 7 : 0,
    baselineCount: isTemp ? 8 : 0,
    warmup: isTemp ? { current: 9, target: 14, estimatedReadyDay: "2026-03-06" } : null,
    onset: null,
    checks: isTemp ? [{ key: "device_change", flagged: true, day: "2026-02-22" }] : [],
    sparkline: isTemp
      ? SYNTHETIC_DAYS.map((day, idx) => ({
          day,
          value: SYNTHETIC_WRIST_TEMP_VALUES[idx] ?? null,
          z: null,
          usable: true,
        }))
      : [],
    caveats: [],
  };
}

export function emptyChangesStub(): ChangesDTO {
  return {
    hasImports: false,
    asOfDay: null,
    freshness: {
      asOfDay: null,
      lastImportAt: null,
      daysSinceImport: null,
    },
    activeImport: null,
    primaryWatch: null,
    staleBanner: null,
    warmingNotice: null,
    overnight: [],
    daytime: [],
    lastNight: null,
  };
}

export function changesStub(imports: ImportDTO[] = []): ChangesDTO {
  const latestDone = imports.find((r) => r.status === "done") ?? null;
  const activeImport = imports.find((r) => r.status !== "done" && r.status !== "failed") ?? null;

  if (imports.length > 0 && !latestDone && !activeImport) {
    return emptyChangesStub();
  }

  const lastImportAt = latestDone?.createdAt ?? "2026-03-02T08:00:00.000Z";
  return {
    hasImports: true,
    asOfDay: "2026-03-01",
    freshness: {
      asOfDay: "2026-03-01",
      lastImportAt,
      daysSinceImport: daysSince(lastImportAt) ?? 0,
    },
    activeImport,
    primaryWatch: {
      epochId: 2,
      label: "Synthetic Watch B",
      hardware: "Watch7,5",
      colorIndex: 1,
      warmingUp: { current: 9, target: 14 },
    },
    staleBanner: null,
    warmingNotice: {
      metric: "wrist_temp",
      current: 9,
      target: 14,
      estimatedReadyDay: "2026-03-06",
    },
    overnight: OVERNIGHT_ORDER.map(buildStubFinding),
    daytime: [],
    lastNight: {
      date: "2026-02-28",
      asleepH: 7.2,
      deepH: 1.0,
      remH: 1.5,
      coreH: 4.7,
      skippedPartialDay: "2026-03-01",
      skippedPartialReason: "export_cut",
    },
  };
}

export function metricsIndexStub(hasImports = true): MetricsIndexDTO {
  if (!hasImports) {
    return { hasImports: false, asOfDay: null, metrics: [] };
  }
  const ordered = [...OVERNIGHT_ORDER, ...DAYTIME_ORDER, ...TREND_ONLY_ORDER];
  const entries: MetricIndexEntryDTO[] = ordered.map((metric) => {
    const spec = METRICS[metric];
    const kind = metricKindFor(metric);
    const hasData = metric === "wrist_temp";
    return {
      metric,
      kind,
      unit: spec?.unit ?? (metric === "sleep_hr" ? "count/min" : ""),
      trust: spec?.trust ?? "moderate",
      trustNote: spec?.trustNote ?? "Trend metric.",
      hasData,
      finding: kind === "trendOnly" ? null : buildStubFinding(metric),
      weeklySeries: hasData
        ? [
            { weekStart: "2026-02-16", median: 36.41, epochId: 1, hasPartial: false },
            { weekStart: "2026-02-23", median: 36.93, epochId: 2, hasPartial: false },
          ]
        : [],
      seams: hasData ? [{ day: "2026-02-22", kind: "step" }] : [],
    };
  });
  return {
    hasImports: true,
    asOfDay: "2026-03-01",
    metrics: entries,
  };
}

export function metricSeriesStub(metric: string, range: MetricRange = "180d"): MetricSeriesDTO {
  const spec = METRICS[metric];
  const kind = metricKindFor(metric);
  return {
    metric,
    kind,
    unit: spec?.unit ?? (metric === "sleep_hr" ? "count/min" : "degC"),
    trust: spec?.trust ?? "moderate",
    trustNote: spec?.trustNote ?? "Trend metric.",
    range,
    asOfDay: "2026-03-01",
    finding: kind === "trendOnly" ? null : buildStubFinding(metric),
    epochs: [
      {
        id: 1,
        sourceName: "Synthetic Watch A",
        deviceHw: "Watch6,1",
        label: "Synthetic Watch A",
        kind: "watch",
        colorIndex: 0,
        minor: false,
      },
      {
        id: 2,
        sourceName: "Synthetic Watch B",
        deviceHw: "Watch7,5",
        label: "Synthetic Watch B",
        kind: "watch",
        colorIndex: 1,
        minor: false,
      },
    ],
    units: SYNTHETIC_DAYS.map((day, idx) => ({
      day,
      epochId: idx < 7 ? 1 : 2,
      value: SYNTHETIC_WRIST_TEMP_VALUES[idx] ?? 36.4,
      n: 4,
      usable: true,
      partialReason: null,
      tzChange: false,
      z: null,
      isRecent: idx >= 8,
    })),
    band: [],
    stints: [
      { epochId: 1, startDay: "2026-02-15", endDay: "2026-02-21" },
      { epochId: 2, startDay: "2026-02-22", endDay: "2026-03-01" },
    ],
    seams: [
      {
        seamDay: "2026-02-22",
        fromEpochId: 1,
        toEpochId: 2,
        kind: "step",
        value: 0.52,
        nOld: 7,
        nNew: 8,
      },
    ],
    osUpdates: [],
  };
}

export function unitEvidenceStub(metric: string, day: string): UnitEvidenceDTO {
  return {
    metric,
    day,
    unitKind: metricKindFor(metric) === "daytime" ? "day" : "night",
    zone: "Asia/Tokyo",
    value: null,
    sampleCount: 0,
    usable: false,
    partialReason: null,
    primaryEpoch: null,
    deviceSw: null,
    samples: [],
    sleep: null,
    alsoRecordedBy: [],
  };
}

export function epochsStub(hasImports = true): EpochsDTO {
  if (!hasImports) {
    return { hasImports: false, asOfDay: null, epochs: [] };
  }
  return {
    hasImports: true,
    asOfDay: "2026-03-01",
    epochs: [
      {
        id: 2,
        sourceName: "Synthetic Watch B",
        deviceHw: "Watch7,5",
        label: "Synthetic Watch B",
        kind: "watch",
        colorIndex: 1,
        minor: false,
        firstDay: "2026-02-22",
        lastDay: "2026-03-01",
        daysPresent: SYNTHETIC_DAYS.slice(7),
        daysPresentCount: 8,
        primaryMetricCount: 1,
        metrics: [
          {
            metric: "wrist_temp",
            role: "primary",
            baselineState: "warming_up",
            warmup: { current: 9, target: 14 },
            seamFromPrevious: {
              seamDay: "2026-02-22",
              fromEpochId: 1,
              toEpochId: 2,
              kind: "step",
              value: 0.52,
              nOld: 7,
              nNew: 8,
            },
          },
        ],
        osUpdates: [],
      },
      {
        id: 1,
        sourceName: "Synthetic Watch A",
        deviceHw: "Watch6,1",
        label: "Synthetic Watch A",
        kind: "watch",
        colorIndex: 0,
        minor: false,
        firstDay: "2026-02-15",
        lastDay: "2026-02-21",
        daysPresent: SYNTHETIC_DAYS.slice(0, 7),
        daysPresentCount: 7,
        primaryMetricCount: 0,
        metrics: [],
        osUpdates: [],
      },
    ],
  };
}

export function nightsStub(from: string, to: string): NightsDTO {
  return {
    from,
    to,
    nights: [],
  };
}
