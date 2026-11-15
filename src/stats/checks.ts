import type { Database } from "bun:sqlite";
import type { MetricSpec } from "../domain/metrics";

export type CheckKey =
  | "device_change"
  | "os_update"
  | "partial_nights"
  | "tz_change"
  | "missing_nights"
  | "low_trust";

export interface CheckDTO {
  key: CheckKey;
  flagged: boolean;
  detailKey?: string;
  day?: string;
  count?: number;
}

const LOOKBACK_DAYS = 35;

/** Build the six finding confounder checks using only rows at or before as-of. */
export function deriveChecks(
  db: Database,
  metric: string,
  epochId: number,
  asOfDay: string,
  spec: MetricSpec,
  recentDays: readonly string[],
): CheckDTO[] {
  const since = new Date(Date.parse(`${asOfDay}T00:00:00Z`) - (LOOKBACK_DAYS - 1) * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const seam = db
    .query(
      `SELECT start_day AS day FROM stints
       WHERE metric = ? AND start_day > (SELECT MIN(start_day) FROM stints WHERE metric = ?)
         AND start_day >= ? AND start_day <= ? ORDER BY start_day DESC LIMIT 1`,
    )
    .get(metric, metric, since, asOfDay) as { day: string } | null;
  const event = db
    .query(
      `SELECT day FROM epoch_events WHERE epoch_id = ? AND kind = 'os_update'
       AND day >= ? AND day <= ? ORDER BY day DESC LIMIT 1`,
    )
    .get(epochId, since, asOfDay) as { day: string } | null;
  const recent = [...new Set(recentDays)].filter((day) => day <= asOfDay);
  const placeholders = recent.map(() => "?").join(",");
  const orderedRecentDays = [...recent].sort();
  const oldestRecentDay = orderedRecentDays[0] ?? null;
  const newestRecentDay = orderedRecentDays.at(-1) ?? null;
  const partialCount =
    oldestRecentDay && newestRecentDay
      ? Number(
          (
            db
              .query(
                `SELECT COUNT(*) AS count FROM metric_values
                 WHERE metric = ? AND epoch_id = ? AND usable = 0
                   AND unit_day >= ? AND unit_day <= ? AND unit_day <= ?`,
              )
              .get(metric, epochId, oldestRecentDay, newestRecentDay, asOfDay) as { count: number }
          ).count,
        )
      : 0;
  const tzChangeCount = recent.length
    ? Number(
        (
          db
            .query(
              `SELECT COUNT(*) AS count FROM nights WHERE date IN (${placeholders})
               AND date <= ? AND tz_change = 1`,
            )
            .get(...recent, asOfDay) as { count: number }
        ).count,
      )
    : 0;
  const span =
    oldestRecentDay && newestRecentDay
      ? (Date.parse(`${newestRecentDay}T00:00:00Z`) - Date.parse(`${oldestRecentDay}T00:00:00Z`)) /
          86_400_000 +
        1
      : 0;
  return [
    { key: "device_change", flagged: seam !== null, ...(seam ? { day: seam.day } : {}) },
    { key: "os_update", flagged: event !== null, ...(event ? { day: event.day } : {}) },
    {
      key: "partial_nights",
      flagged: partialCount > 0,
      ...(partialCount ? { count: partialCount } : {}),
    },
    {
      key: "tz_change",
      flagged: tzChangeCount > 0,
      ...(tzChangeCount ? { count: tzChangeCount } : {}),
    },
    { key: "missing_nights", flagged: span > 10, ...(span > 10 ? { count: span } : {}) },
    { key: "low_trust", flagged: spec.trust === "low" },
  ];
}
