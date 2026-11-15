import { parseHealthKitDate } from "../domain/dates";
import { METRICS } from "../domain/metrics";
import type { RecordRow } from "../domain/types";
import { devicePart, type XmlRecordRow } from "./parser";

/**
 * Record → typed row mapping (T5). Unknown HK types map to rows with a null
 * metric key — stored, never aggregated. Malformed dates are surfaced, never
 * silently repaired.
 */

/** type identifier → metric key, from the registry. */
const TYPE_TO_METRIC: ReadonlyMap<string, string> = new Map(
  Object.values(METRICS).flatMap((spec) => spec.types.map((t) => [t, spec.key] as const)),
);

export interface MappedRecord {
  row: RecordRow;
  /** null when the type is not in the metric registry (still stored). */
  metricKey: string | null;
  /** Calendar day of startDate in the record's own offset. */
  localDay: string;
}

export type MapResult =
  | { ok: true; record: MappedRecord }
  | { ok: false; reason: "malformed_date"; raw: XmlRecordRow; detail: string };

export function mapRecord(raw: XmlRecordRow): MapResult {
  const start = parseHealthKitDate(raw.startDate);
  if (!start.ok)
    return { ok: false, reason: "malformed_date", raw, detail: `startDate:${start.reason}` };
  const end = parseHealthKitDate(raw.endDate);
  if (!end.ok) return { ok: false, reason: "malformed_date", raw, detail: `endDate:${end.reason}` };

  const numeric = raw.value !== null ? Number(raw.value) : null;
  const isQuantity = numeric !== null && Number.isFinite(numeric) && raw.value?.trim() !== "";

  return {
    ok: true,
    record: {
      row: {
        type: raw.type,
        sourceName: raw.sourceName,
        unit: raw.unit,
        startAt: start.date.utcIso,
        endAt: end.date.utcIso,
        startOffsetMin: start.date.offsetMinutes,
        endOffsetMin: end.date.offsetMinutes,
        value: isQuantity ? numeric : null,
        valueStr: isQuantity ? null : raw.value,
        deviceHw: devicePart(raw.device, "hardware"),
        deviceSw: devicePart(raw.device, "software"),
        metaJson: Object.keys(raw.metadata).length > 0 ? JSON.stringify(raw.metadata) : null,
      },
      metricKey: TYPE_TO_METRIC.get(raw.type) ?? null,
      localDay: start.date.localDay,
    },
  };
}
