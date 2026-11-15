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

function isoDayOffset(anchor: string, offsetDays: number): string {
  const dt = new Date(`${anchor}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + offsetDays);
  return dt.toISOString().slice(0, 10);
}

function buildLinearSparkline(
  base: number,
  recent: number,
  sigma: number,
  options?: { partialLast?: boolean; clippedLastZ?: number },
): FindingRowDTO["sparkline"] {
  const points: FindingRowDTO["sparkline"] = [];
  for (let i = 0; i < 35; i++) {
    const day = isoDayOffset("2026-03-01", -(34 - i));
    const isRecent = i >= 28;
    const wave = ((i % 5) - 2) * (sigma * 0.18);
    const value = Number(((isRecent ? recent : base) + wave).toFixed(2));
    let z = Number(((value - base) / Math.max(0.01, sigma)).toFixed(2));
    if (options?.clippedLastZ !== undefined && i === 34) {
      z = options.clippedLastZ;
    }
    const usable = !(options?.partialLast && i === 34);
    points.push({ day, value, z, usable });
  }
  return points;
}

function buildStubFinding(metric: string, overrides?: Partial<FindingRowDTO>): FindingRowDTO {
  const spec = METRICS[metric];
  const baseRow: FindingRowDTO = {
    metric,
    kind: metricKindFor(metric),
    unit: spec?.unit ?? (metric === "sleep_hr" ? "count/min" : ""),
    trust: spec?.trust ?? "moderate",
    trustNote: spec?.trustNote ?? "Trend metric.",
    epochId: 2,
    epochLabel: "Synthetic Watch B",
    state: "insufficient",
    direction: null,
    severity: "within",
    confidence: null,
    z: null,
    recentMedian: null,
    baselineMedian: null,
    baselineLow: null,
    baselineHigh: null,
    kOutside: null,
    recentCount: 0,
    baselineCount: 0,
    warmup: null,
    onset: null,
    checks: [],
    sparkline: [],
    caveats: [],
  };

  let row: FindingRowDTO;
  switch (metric) {
    case "hrv_sdnn":
      row = {
        ...baseRow,
        state: "computed",
        direction: "lower",
        severity: "alert",
        confidence: "medium",
        z: -3.1,
        recentMedian: 42,
        baselineMedian: 55,
        baselineLow: 49,
        baselineHigh: 61,
        kOutside: 5,
        recentCount: 7,
        baselineCount: 21,
        onset: { day: "2026-02-23", openEnded: false },
        checks: [{ key: "partial_nights", flagged: true, day: "2026-03-01", count: 1 }],
        sparkline: buildLinearSparkline(55, 42, 4, { partialLast: true }),
      };
      break;
    case "sleep_hr":
      row = {
        ...baseRow,
        state: "computed",
        direction: "higher",
        severity: "notable",
        confidence: "high",
        z: 1.9,
        recentMedian: 58,
        baselineMedian: 54,
        baselineLow: 51,
        baselineHigh: 57,
        kOutside: 4,
        recentCount: 7,
        baselineCount: 28,
        onset: { day: "2026-02-25", openEnded: false },
        sparkline: buildLinearSparkline(54, 58, 2),
      };
      break;
    case "sleep_h":
      row = {
        ...baseRow,
        state: "computed",
        direction: "within",
        severity: "within",
        confidence: "high",
        z: -0.4,
        recentMedian: 6.9,
        baselineMedian: 7.1,
        baselineLow: 6.4,
        baselineHigh: 7.8,
        kOutside: 1,
        recentCount: 7,
        baselineCount: 28,
        sparkline: buildLinearSparkline(7.1, 6.9, 0.4),
      };
      break;
    case "deep_h":
      row = {
        ...baseRow,
        state: "computed",
        direction: "within",
        severity: "within",
        confidence: "high",
        z: 0.2,
        recentMedian: 1.0,
        baselineMedian: 0.9,
        baselineLow: 0.6,
        baselineHigh: 1.2,
        kOutside: 0,
        recentCount: 7,
        baselineCount: 28,
        sparkline: buildLinearSparkline(0.9, 1.0, 0.2),
      };
      break;
    case "rem_h":
      row = {
        ...baseRow,
        state: "computed",
        direction: "within",
        severity: "within",
        confidence: "high",
        z: 0.3,
        recentMedian: 1.5,
        baselineMedian: 1.4,
        baselineLow: 1.1,
        baselineHigh: 1.7,
        kOutside: 1,
        recentCount: 7,
        baselineCount: 28,
        sparkline: buildLinearSparkline(1.4, 1.5, 0.2),
      };
      break;
    case "rhr":
      row = {
        ...baseRow,
        state: "computed",
        direction: "within",
        severity: "within",
        confidence: "high",
        z: 0.5,
        recentMedian: 56,
        baselineMedian: 55,
        baselineLow: 52,
        baselineHigh: 58,
        kOutside: 1,
        recentCount: 7,
        baselineCount: 28,
        sparkline: buildLinearSparkline(55, 56, 2),
      };
      break;
    case "resp_rate":
      row = {
        ...baseRow,
        state: "computed",
        direction: "within",
        severity: "within",
        confidence: "medium",
        z: -0.2,
        recentMedian: 14.3,
        baselineMedian: 14.5,
        baselineLow: 13.7,
        baselineHigh: 15.3,
        kOutside: 0,
        recentCount: 7,
        baselineCount: 20,
        sparkline: buildLinearSparkline(14.5, 14.3, 0.5),
      };
      break;
    case "wrist_temp":
      row = {
        ...baseRow,
        state: "warming_up",
        recentCount: 7,
        baselineCount: 2,
        warmup: { current: 9, target: 14, estimatedReadyDay: "2026-03-06" },
        checks: [{ key: "device_change", flagged: true, day: "2026-02-22" }],
        sparkline: SYNTHETIC_DAYS.map((day, idx) => ({
          day,
          value: SYNTHETIC_WRIST_TEMP_VALUES[idx] ?? null,
          z: null,
          usable: true,
        })),
      };
      break;
    case "spo2":
      row = {
        ...baseRow,
        state: "insufficient",
        recentCount: 3,
        baselineCount: 18,
      };
      break;
    case "steps":
      row = {
        ...baseRow,
        state: "computed",
        direction: "higher",
        severity: "notable",
        confidence: "high",
        z: 2.1,
        recentMedian: 9100,
        baselineMedian: 6000,
        baselineLow: 4500,
        baselineHigh: 7500,
        kOutside: 6,
        recentCount: 7,
        baselineCount: 28,
        onset: { day: "2026-02-24", openEnded: false },
        sparkline: buildLinearSparkline(6000, 9100, 1200),
      };
      break;
    case "active_kj":
      row = {
        ...baseRow,
        state: "computed",
        direction: "within",
        severity: "within",
        confidence: "low",
        z: 0.4,
        recentMedian: 1800,
        baselineMedian: 1650,
        baselineLow: 1200,
        baselineHigh: 2100,
        kOutside: 1,
        recentCount: 7,
        baselineCount: 28,
        checks: [{ key: "low_trust", flagged: true }],
        sparkline: buildLinearSparkline(1650, 1800, 300),
      };
      break;
    default:
      row = baseRow;
  }

  return overrides ? { ...row, ...overrides } : row;
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
    overnight: OVERNIGHT_ORDER.map((m) => buildStubFinding(m)),
    daytime: DAYTIME_ORDER.map((m) => buildStubFinding(m)),
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

export function allWithinChangesStub(): ChangesDTO {
  return {
    ...changesStub(),
    warmingNotice: null,
    primaryWatch: {
      epochId: 2,
      label: "Synthetic Watch B",
      hardware: "Watch7,5",
      colorIndex: 1,
      warmingUp: null,
    },
    overnight: OVERNIGHT_ORDER.map((metric) =>
      buildStubFinding(metric, {
        state: "computed",
        direction: "within",
        severity: "within",
        confidence: "high",
        z: 0.2,
        recentMedian: 50,
        baselineMedian: 50,
        baselineLow: 44,
        baselineHigh: 56,
        kOutside: 1,
        recentCount: 7,
        baselineCount: 28,
        sparkline: buildLinearSparkline(50, 50.5, 4),
      }),
    ),
    daytime: [],
  };
}

export function staleChangesStub(): ChangesDTO {
  return {
    ...changesStub(),
    freshness: {
      asOfDay: "2026-03-01",
      lastImportAt: "2026-01-27T08:00:00.000Z",
      daysSinceImport: 34,
    },
    staleBanner: {
      daysSinceImport: 34,
      windowFrom: "2026-02-23",
      windowTo: "2026-03-01",
    },
    warmingNotice: null,
    overnight: OVERNIGHT_ORDER.map((metric) =>
      metric === "hrv_sdnn"
        ? buildStubFinding(metric, {
            z: 12.4,
            severity: "alert",
            direction: "higher",
            confidence: "low",
            trust: "low",
            recentMedian: 82,
            baselineMedian: 50,
            onset: { day: "2026-01-25", openEnded: true },
            checks: [
              { key: "low_trust", flagged: true },
              { key: "missing_nights", flagged: true },
            ],
            sparkline: buildLinearSparkline(50, 82, 2, { clippedLastZ: 12.4 }),
          })
        : buildStubFinding(metric, {
            state: "stale",
            direction: null,
            severity: "within",
            confidence: null,
            z: null,
            recentMedian: null,
            baselineMedian: null,
            baselineLow: null,
            baselineHigh: null,
            kOutside: null,
            recentCount: 0,
            sparkline: [],
          }),
    ),
    daytime: [],
    lastNight: null,
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

function rangeWindowDays(range: MetricRange): number {
  if (range === "90d") return 90;
  if (range === "180d") return 180;
  if (range === "1y") return 365;
  return 210;
}

function deterministicNoise(index: number, amplitude: number): number {
  return Math.sin(index * 1.15) * amplitude * 0.65 + Math.cos(index * 0.45) * amplitude * 0.35;
}

interface MetricFixtureSpec {
  baseA: number;
  baseB: number;
  recentShift: number;
  spread: number;
  seamDay: string;
  seamKind: "offset" | "step";
  seamValue: number;
  bandLowOffset: number;
  bandHighOffset: number;
  bandMode: "currentStint" | "none";
}

function metricFixtureSpecFor(metric: string, kind: MetricSeriesDTO["kind"]): MetricFixtureSpec {
  if (metric === "wrist_temp") {
    return {
      baseA: -0.28,
      baseB: 0.24,
      recentShift: 0.04,
      spread: 0.14,
      seamDay: "2026-02-22",
      seamKind: "step",
      seamValue: 0.52,
      bandLowOffset: -0.18,
      bandHighOffset: 0.17,
      bandMode: "none",
    };
  }
  if (metric === "hrv_sdnn") {
    return {
      baseA: 60,
      baseB: 55,
      recentShift: -13,
      spread: 6.5,
      seamDay: "2026-01-24",
      seamKind: "offset",
      seamValue: -5,
      bandLowOffset: -7,
      bandHighOffset: 7,
      bandMode: "currentStint",
    };
  }
  if (metric === "spo2" || metric === "hrv_rmssd") {
    return {
      baseA: metric === "spo2" ? 97.4 : 42,
      baseB: metric === "spo2" ? 97.6 : 44,
      recentShift: 0.2,
      spread: metric === "spo2" ? 0.6 : 5,
      seamDay: "2026-02-22",
      seamKind: "offset",
      seamValue: 0.2,
      bandLowOffset: -1,
      bandHighOffset: 1,
      bandMode: "none",
    };
  }
  if (kind === "trendOnly") {
    return {
      baseA: 42.5,
      baseB: 45.2,
      recentShift: 0.8,
      spread: 1.1,
      seamDay: "2026-02-22",
      seamKind: "step",
      seamValue: 2.7,
      bandLowOffset: -1.5,
      bandHighOffset: 1.5,
      bandMode: "none",
    };
  }
  if (metric === "steps") {
    return {
      baseA: 6200,
      baseB: 6000,
      recentShift: 3100,
      spread: 1100,
      seamDay: "2026-01-24",
      seamKind: "offset",
      seamValue: -200,
      bandLowOffset: -1800,
      bandHighOffset: 1800,
      bandMode: "currentStint",
    };
  }
  if (metric === "active_kj") {
    return {
      baseA: 1700,
      baseB: 1650,
      recentShift: 150,
      spread: 260,
      seamDay: "2026-01-24",
      seamKind: "offset",
      seamValue: -50,
      bandLowOffset: -450,
      bandHighOffset: 450,
      bandMode: "currentStint",
    };
  }
  const defaults: Record<string, { base: number; spread: number; shift: number }> = {
    sleep_h: { base: 7.1, spread: 0.55, shift: -0.2 },
    deep_h: { base: 0.9, spread: 0.2, shift: 0.1 },
    rem_h: { base: 1.4, spread: 0.25, shift: 0.1 },
    sleep_hr: { base: 54, spread: 2.4, shift: 4.0 },
    rhr: { base: 55, spread: 2.2, shift: 1.0 },
    resp_rate: { base: 14.5, spread: 0.6, shift: -0.2 },
    heart_rate: { base: 70, spread: 3.5, shift: 1.0 },
  };
  const d = defaults[metric] ?? { base: 50, spread: 4, shift: 0 };
  return {
    baseA: d.base,
    baseB: d.base,
    recentShift: d.shift,
    spread: d.spread,
    seamDay: "2026-01-24",
    seamKind: "offset",
    seamValue: 0,
    bandLowOffset: -d.spread * 1.4,
    bandHighOffset: d.spread * 1.4,
    bandMode: "currentStint",
  };
}

function roundMetricVal(value: number, metric: string): number {
  if (metric === "steps" || metric === "active_kj") return Math.round(value);
  if (metric === "wrist_temp") return Number(value.toFixed(2));
  return Number(value.toFixed(1));
}

function countDaysInclusive(startDay: string, endDay: string): number {
  const diff = Math.round(
    (Date.parse(`${endDay}T00:00:00Z`) - Date.parse(`${startDay}T00:00:00Z`)) / 86_400_000,
  );
  return Math.max(1, diff + 1);
}

export function metricSeriesStub(metric: string, range: MetricRange = "180d"): MetricSeriesDTO {
  const spec = METRICS[metric];
  const kind = metricKindFor(metric);
  const asOfDay = "2026-03-01";
  const fx = metricFixtureSpecFor(metric, kind);
  const seamDay = fx.seamDay;
  const totalDays = 210;
  const visibleDays = rangeWindowDays(range);
  const cutoffDay = isoDayOffset(asOfDay, -(Math.min(visibleDays, totalDays) - 1));
  const finding = kind === "trendOnly" ? null : buildStubFinding(metric);
  const hasBaseline =
    finding !== null &&
    finding.state !== "warming_up" &&
    finding.state !== "insufficient" &&
    fx.bandMode === "currentStint";

  const epochs: MetricSeriesDTO["epochs"] = [
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
    {
      id: 3,
      sourceName: "Synthetic Phone App",
      deviceHw: "iPhone16,1",
      label: "Synthetic Phone App",
      kind: "phone",
      colorIndex: null,
      minor: true,
    },
  ];

  const units: MetricSeriesDTO["units"] = [];
  const band: MetricSeriesDTO["band"] = [];
  const minorDays = new Set(["2026-01-20", "2026-02-05", "2026-02-14", "2026-02-25"]);
  const gapDay = "2026-02-10";

  for (let i = totalDays - 1; i >= 0; i--) {
    const day = isoDayOffset(asOfDay, -i);
    if (day < cutoffDay) continue;

    const isWatchB = day >= seamDay;
    const isRecent = day >= "2026-02-23";
    const epochId = isWatchB ? 2 : 1;
    const base = isWatchB ? fx.baseB : fx.baseA;

    if (day === gapDay) {
      units.push({
        day,
        epochId,
        value: null,
        n: 0,
        usable: false,
        partialReason: "missing",
        tzChange: false,
        z: null,
        isRecent: false,
      });
    } else {
      const shift = isRecent ? fx.recentShift : 0;
      const raw = base + shift + deterministicNoise(i, fx.spread * 0.55);
      const value = roundMetricVal(raw, metric);
      const isExportCut = day === "2026-03-01";
      const isBelowMin = day === "2026-02-24";
      const usable = !(isExportCut || isBelowMin);
      const partialReason = isExportCut ? "export_cut" : isBelowMin ? "below_minimum" : null;
      const sigmaEst = Math.max(0.05, fx.spread * 0.65);
      const z = hasBaseline ? Number(((value - base) / sigmaEst).toFixed(2)) : null;

      units.push({
        day,
        epochId,
        value,
        n: usable ? 8 : 2,
        usable,
        partialReason,
        tzChange: day === "2026-02-27",
        z,
        isRecent,
      });
    }

    // Current stint baseline band only (excludes earlier stints and recent/warming states)
    if (hasBaseline && isWatchB && !isRecent) {
      band.push({
        day,
        low: roundMetricVal(fx.baseB + fx.bandLowOffset, metric),
        high: roundMetricVal(fx.baseB + fx.bandHighOffset, metric),
        median: roundMetricVal(fx.baseB, metric),
      });
    }

    if (minorDays.has(day)) {
      const minorRaw = base + fx.spread * 0.75 + deterministicNoise(i + 7, fx.spread * 0.25);
      units.push({
        day,
        epochId: 3,
        value: roundMetricVal(minorRaw, metric),
        n: 2,
        usable: true,
        partialReason: null,
        tzChange: false,
        z: null,
        isRecent: false,
      });
    }
  }

  const allSeam = {
    seamDay,
    fromEpochId: 1,
    toEpochId: 2,
    kind: fx.seamKind,
    value: fx.seamValue,
    nOld: 28,
    nNew: countDaysInclusive(seamDay, asOfDay),
  } as const;

  const allOsUpdates = [
    { epochId: 1, day: "2026-01-12", fromSw: "10.2", toSw: "10.4" },
    { epochId: 2, day: "2026-02-26", fromSw: "10.4", toSw: "11.0" },
  ];

  const prevStintEnd = isoDayOffset(seamDay, -1);
  const stints = [
    {
      epochId: 1,
      startDay: cutoffDay < seamDay ? cutoffDay : prevStintEnd,
      endDay: prevStintEnd,
    },
    { epochId: 2, startDay: seamDay, endDay: asOfDay },
  ].filter((s) => s.endDay >= cutoffDay);

  return {
    metric,
    kind,
    unit: spec?.unit ?? (metric === "sleep_hr" ? "count/min" : "degC"),
    trust: spec?.trust ?? "moderate",
    trustNote: spec?.trustNote ?? "Trend metric.",
    range,
    asOfDay,
    finding,
    epochs,
    units,
    band,
    stints,
    seams: seamDay >= cutoffDay ? [allSeam] : [],
    osUpdates: allOsUpdates.filter((u) => u.day >= cutoffDay),
  };
}

export function emptyRangeMetricSeriesStub(
  metric: string,
  range: MetricRange = "90d",
): MetricSeriesDTO {
  const base = metricSeriesStub(metric, range);
  return {
    ...base,
    units: [],
    band: [],
    stints: [],
    seams: [],
    osUpdates: [],
  };
}

function buildSyntheticSamples(
  day: string,
  metric: string,
  unitKind: "night" | "day",
  baseValue: number,
  sampleCount: number,
) {
  const spread =
    metric === "wrist_temp"
      ? 0.08
      : metric === "steps"
        ? 450
        : metric === "active_kj"
          ? 85
          : metric === "spo2"
            ? 0.6
            : metric === "resp_rate" || metric === "sleep_h"
              ? 0.4
              : 3;

  const startMinutes = unitKind === "night" ? 23 * 60 + 14 : 8 * 60 + 30;
  const stepMinutes = unitKind === "night" ? 48 : 65;

  return Array.from({ length: sampleCount }, (_, idx) => {
    const totalMin = (startMinutes + idx * stepMinutes) % (24 * 60);
    const hh = String(Math.floor(totalMin / 60)).padStart(2, "0");
    const mm = String(totalMin % 60).padStart(2, "0");
    const localTime = `${hh}:${mm}`;
    const offset = ((idx % 3) - 1) * spread;
    const raw =
      metric === "steps" || metric === "active_kj"
        ? baseValue / sampleCount + offset
        : baseValue + offset;
    const value = roundMetricVal(raw, metric);
    return {
      timestamp: `${day}T${localTime}:00+09:00`,
      localTime,
      value,
    };
  });
}

export function unitEvidenceStub(metric: string, day: string): UnitEvidenceDTO {
  const unitKind: UnitEvidenceDTO["unitKind"] =
    metricKindFor(metric) === "daytime" ? "day" : "night";
  const series = metricSeriesStub(metric, "all");
  const dayUnits = series.units.filter((u) => u.day === day);
  const primaryEpochIds = new Set(series.epochs.filter((e) => !e.minor).map((e) => e.id));
  const primaryUnit = dayUnits.find((u) => primaryEpochIds.has(u.epochId)) ?? dayUnits[0] ?? null;

  if (!primaryUnit || primaryUnit.value === null || primaryUnit.n <= 0) {
    return {
      metric,
      day,
      unitKind,
      zone: "Asia/Tokyo",
      value: null,
      sampleCount: 0,
      usable: false,
      partialReason: primaryUnit?.partialReason ?? null,
      primaryEpoch: null,
      deviceSw: null,
      samples: [],
      sleep: null,
      alsoRecordedBy: [],
    };
  }

  const primaryEpoch = series.epochs.find((e) => e.id === primaryUnit.epochId) ?? null;
  const alsoRecordedBy = dayUnits
    .filter((u) => u.epochId !== primaryUnit.epochId)
    .map((u) => series.epochs.find((e) => e.id === u.epochId))
    .filter((e): e is NonNullable<typeof e> => e !== undefined);

  const deviceSw = day >= "2026-02-26" ? "11.0" : day >= "2026-01-12" ? "10.4" : "10.2";
  const samples = buildSyntheticSamples(day, metric, unitKind, primaryUnit.value, primaryUnit.n);

  const sleep =
    unitKind === "night"
      ? {
          startLocal: "23:02",
          endLocal: primaryUnit.usable ? "06:48" : "03:45",
          asleepH: primaryUnit.usable ? 7.1 : 4.2,
          deepH: primaryUnit.usable ? 1.1 : 0.6,
          remH: primaryUnit.usable ? 1.5 : 0.8,
          coreH: primaryUnit.usable ? 4.5 : 2.8,
        }
      : null;

  return {
    metric,
    day,
    unitKind,
    zone: "Asia/Tokyo",
    value: primaryUnit.value,
    sampleCount: primaryUnit.n,
    usable: primaryUnit.usable,
    partialReason: primaryUnit.partialReason,
    primaryEpoch,
    deviceSw,
    samples,
    sleep,
    alsoRecordedBy,
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
