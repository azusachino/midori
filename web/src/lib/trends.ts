import type { HealthContextDTO } from "../api/types";
import { clampNotesToAxis, type NoteAxisBand } from "./metric-chart";

/**
 * B-T1 chart data for the Trends page. `GET /api/context` returns `recentNights` newest
 * first (B-A5); every time series must run chronologically left to right, and
 * `clampNotesToAxis` requires an ascending axis, so the nights are ordered ascending
 * before any x-axis, series, or note band is built.
 */

export type TrendsRangeDays = 14 | 30;

export interface TrendsNight {
  date: string;
  zone: string;
  partialReason: string | null;
  tzChange: boolean;
  deepH: number | null;
  remH: number | null;
  coreH: number | null;
  asleepH: number | null;
  hrvSdnn: number | null;
  rhr: number | null;
  wristTemp: number | null;
  noteLabels: string[];
}

export interface TrendsData {
  /** Chronological ascending night keys, oldest first. */
  days: string[];
  nights: TrendsNight[];
  noteBands: NoteAxisBand[];
  /** Primary-stint usual sleep median (hours), or null when no baseline exists. */
  usualSleepMedian: number | null;
  partialDays: string[];
  hasSleep: boolean;
  hasVitals: boolean;
}

function ascending(a: { date: string }, b: { date: string }): number {
  if (a.date < b.date) return -1;
  if (a.date > b.date) return 1;
  return 0;
}

/** B-T1: derives ascending chart series, note bands and the usual-sleep median. */
export function buildTrendsData(context: HealthContextDTO): TrendsData {
  const nights: TrendsNight[] = [...context.recentNights].sort(ascending).map((night) => ({
    date: night.date,
    zone: night.zone,
    partialReason: night.partialReason,
    tzChange: night.tzChange,
    deepH: night.sleep?.deepH ?? null,
    remH: night.sleep?.remH ?? null,
    coreH: night.sleep?.coreH ?? null,
    asleepH: night.sleep?.asleepH ?? null,
    hrvSdnn: night.metrics.hrv_sdnn ?? null,
    rhr: night.metrics.rhr ?? null,
    wristTemp: night.metrics.wrist_temp ?? null,
    noteLabels: night.notes.map((note) => note.label),
  }));
  const days = nights.map((night) => night.date);
  const usualSleepMedian =
    context.findings.find((finding) => finding.metric === "sleep_h")?.baselineMedian ?? null;
  return {
    days,
    nights,
    noteBands: clampNotesToAxis(context.recentNotes, days),
    usualSleepMedian,
    partialDays: nights.filter((night) => night.partialReason !== null).map((night) => night.date),
    hasSleep: nights.some((night) => night.asleepH !== null),
    hasVitals: nights.some(
      (night) => night.hrvSdnn !== null || night.rhr !== null || night.wristTemp !== null,
    ),
  };
}

/** B-T1: `days` values per column, using null for a night without that value. */
export function seriesFor(
  data: TrendsData,
  key: "deepH" | "remH" | "coreH" | "asleepH" | "hrvSdnn" | "rhr" | "wristTemp",
): Array<number | null> {
  return data.nights.map((night) => night[key]);
}
