import type { CheckKey, CheckResultDTO, MetricSeriesDTO, UnitEvidenceDTO } from "../api/types";
import { copy } from "../copy";
import { displayUnit, formatMetricNumber, formatShortDay, unitNounFor } from "./finding-format";

export const CHECK_ORDER: readonly CheckKey[] = [
  "device_change",
  "os_update",
  "partial_nights",
  "tz_change",
  "missing_nights",
  "low_trust",
];

export interface ResolvedCheck {
  key: CheckKey;
  flagged: boolean;
  label: string;
  day?: string | undefined;
  linkToDevices: boolean;
}

function formatClearLabel(key: CheckKey, series: MetricSeriesDTO, noun: "nights" | "days"): string {
  const labels = copy.pages.metricDetail.checksClearLabels;
  switch (key) {
    case "device_change":
      return labels.device_change;
    case "os_update":
      return labels.os_update;
    case "partial_nights":
      return labels.partial_nights(noun);
    case "tz_change":
      return labels.tz_change;
    case "missing_nights":
      return labels.missing_nights(noun);
    case "low_trust":
      return labels.trust(series.trust);
  }
}

function formatFlaggedLabel(
  key: CheckKey,
  entry: CheckResultDTO | undefined,
  noun: "nights" | "days",
): string {
  const labels = copy.pages.metricDetail.checksFlaggedLabels;
  const dayLabel = entry?.day ? formatShortDay(entry.day) : undefined;
  switch (key) {
    case "device_change":
      return labels.device_change(dayLabel);
    case "os_update":
      return labels.os_update(dayLabel);
    case "partial_nights":
      return labels.partial_nights(entry?.count, noun, dayLabel);
    case "tz_change":
      return labels.tz_change(dayLabel);
    case "missing_nights":
      return labels.missing_nights(noun, dayLabel);
    case "low_trust":
      return labels.low_trust;
  }
}

/**
 * Normalizes a finding's sparse checks array into all 6 canonical confounder
 * checks (B-C1–B-C6) in display order with neutral wording (B-F9).
 */
export function resolveChecks(series: MetricSeriesDTO): ResolvedCheck[] {
  const noun = unitNounFor(series.kind);
  const byKey = new Map<CheckKey, CheckResultDTO>();
  for (const item of series.finding?.checks ?? []) {
    byKey.set(item.key, item);
  }

  return CHECK_ORDER.map((key) => {
    const entry = byKey.get(key);
    const flagged = entry?.flagged === true || (key === "low_trust" && series.trust === "low");
    const day = flagged ? entry?.day : undefined;
    const linkToDevices = flagged && (key === "device_change" || key === "os_update");

    return {
      key,
      flagged,
      label: flagged ? formatFlaggedLabel(key, entry, noun) : formatClearLabel(key, series, noun),
      day,
      linkToDevices,
    };
  });
}

const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Formats "2026-02-25" as "Wed Feb 25" in UTC so evidence titles never drift by host TZ. */
export function formatEvidenceWeekdayDate(isoDay: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDay);
  if (!m) return isoDay;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(dt.getTime())) return isoDay;
  const wd = WEEKDAYS_SHORT[dt.getUTCDay()] ?? "";
  return `${wd} ${formatShortDay(isoDay)}`;
}

/** Formats a single sample or aggregate value with its display unit. */
export function formatEvidenceValue(value: number, metric: string, unit: string): string {
  const formatted = formatMetricNumber(value, metric, unit);
  const unitLabel = displayUnit(metric, unit);
  return unitLabel ? `${formatted} ${unitLabel}` : formatted;
}

/** Formats the header line ("Night of Wed Feb 25 · HRV (SDNN)" or "Day of ..."). */
export function formatEvidenceHeading(
  unitKind: UnitEvidenceDTO["unitKind"],
  day: string,
  metric: string,
): string {
  const metricLabel = copy.metrics[metric] ?? metric;
  const dateText = formatEvidenceWeekdayDate(day);
  const prefix =
    unitKind === "day"
      ? copy.pages.metricDetail.evidence.dayPrefix(dateText)
      : copy.pages.metricDetail.evidence.nightPrefix(dateText);
  return copy.pages.metricDetail.evidence.title(prefix, metricLabel);
}

/** Formats the top summary line or returns empty-evidence notice when no samples exist. */
export function formatEvidenceSummaryLine(evidence: UnitEvidenceDTO, unit: string): string {
  const evCopy = copy.pages.metricDetail.evidence;
  if (evidence.value === null && evidence.sampleCount === 0 && evidence.samples.length === 0) {
    return evidence.unitKind === "day" ? evCopy.noSamplesDay : evCopy.noSamplesNight;
  }
  const valueText =
    evidence.value !== null ? formatEvidenceValue(evidence.value, evidence.metric, unit) : "—";
  if (evidence.unitKind === "night") {
    const windowLabel = `${evCopy.sampleWindowOvernight} ${evidence.zone}`;
    return evCopy.valueMedianSummary(valueText, evidence.sampleCount, windowLabel);
  }
  return evCopy.valueSummary(valueText, evidence.sampleCount, evidence.zone);
}

/** Translates raw partial reason codes into human-friendly neutral wording. */
export function formatEvidencePartialReason(reason: string | null): string | null {
  if (!reason) return null;
  if (reason === "export_cut") return "export taken before noon";
  if (reason === "below_minimum") return "too few samples";
  return reason;
}
