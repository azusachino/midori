/**
 * Night assembly: sleep-stage records -> one Night per night key.
 * Night rule (docs/design.md): start >= 15:00 local -> that date's night; start < 09:00 local ->
 * previous date's night; 09:00-14:59 -> nap, excluded. Stages come only from the night's
 * dominant source (no cross-source double counting).
 */
import { addDays } from "../domain/dates";

export type SleepStage =
  | "inBed"
  | "asleepCore"
  | "asleepDeep"
  | "asleepREM"
  | "asleepUnspecified"
  | "awake";

export const SLEEP_STAGES: readonly SleepStage[] = [
  "inBed",
  "asleepCore",
  "asleepDeep",
  "asleepREM",
  "asleepUnspecified",
  "awake",
];

/** Stages that count toward a source's total sleep for dominance. */
const DOMINANCE_STAGES: ReadonlySet<SleepStage> = new Set<SleepStage>([
  "inBed",
  "asleepCore",
  "asleepDeep",
  "asleepREM",
  "asleepUnspecified",
]);

const NIGHT_START_MINUTE = 15 * 60;
const NIGHT_END_MINUTE = 9 * 60;

export interface SleepRecordInput {
  source: string;
  stage: SleepStage;
  startUtcIso: string;
  endUtcIso: string;
  startLocalDay: string; // 'YYYY-MM-DD', record-local
  startLocalMinute: number; // minutes since local midnight
}

export interface Night {
  date: string; // 'YYYY-MM-DD' night key
  dominantSource: string;
  /** Seconds per stage, dominant source only. All stages present (0 when absent). */
  stageSeconds: Record<SleepStage, number>;
  /** inBed + asleep seconds per source that has records in this night (awake excluded). */
  sourceSeconds: Record<string, number>;
  /** Sleep records per source in this night (sample counts for daily metrics). */
  sourceRecordCounts: Record<string, number>;
}

/** Night key for a sleep record by its record-local start, or null for daytime naps. */
export function nightKeyForSleepRecord(
  startLocalDay: string,
  startLocalMinute: number,
): string | null {
  if (startLocalMinute >= NIGHT_START_MINUTE) return startLocalDay;
  if (startLocalMinute < NIGHT_END_MINUTE) return addDays(startLocalDay, -1);
  return null;
}

function durationSeconds(startUtcIso: string, endUtcIso: string): number {
  const seconds = (Date.parse(endUtcIso) - Date.parse(startUtcIso)) / 1000;
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}

function emptyStageSeconds(): Record<SleepStage, number> {
  return { inBed: 0, asleepCore: 0, asleepDeep: 0, asleepREM: 0, asleepUnspecified: 0, awake: 0 };
}

interface NightAccumulator {
  bySource: Map<string, Record<SleepStage, number>>;
  countsBySource: Map<string, number>;
}

/**
 * Assembles nights from sleep records. Naps are dropped. Dominant source = max inBed+asleep
 * seconds in the night; ties go to the lexicographically smallest source name. Durations come
 * from UTC instants. Output is sorted by night date ascending.
 */
export function assembleNights(sleepRecords: SleepRecordInput[]): Night[] {
  const nights = new Map<string, NightAccumulator>();

  for (const r of sleepRecords) {
    const key = nightKeyForSleepRecord(r.startLocalDay, r.startLocalMinute);
    if (key === null) continue;
    let acc = nights.get(key);
    if (!acc) {
      acc = { bySource: new Map(), countsBySource: new Map() };
      nights.set(key, acc);
    }
    acc.countsBySource.set(r.source, (acc.countsBySource.get(r.source) ?? 0) + 1);
    let stages = acc.bySource.get(r.source);
    if (!stages) {
      stages = emptyStageSeconds();
      acc.bySource.set(r.source, stages);
    }
    stages[r.stage] += durationSeconds(r.startUtcIso, r.endUtcIso);
  }

  return [...nights.keys()].sort().map((date) => {
    // biome-ignore lint/style/noNonNullAssertion: key came from nights.keys()
    const acc = nights.get(date)!;
    const sourceSeconds: Record<string, number> = {};
    const sourceRecordCounts: Record<string, number> = {};
    let dominantSource: string | null = null;
    let dominantTotal = -1;
    for (const source of [...acc.bySource.keys()].sort()) {
      // biome-ignore lint/style/noNonNullAssertion: iterating own keys
      const stages = acc.bySource.get(source)!;
      sourceRecordCounts[source] = acc.countsBySource.get(source) ?? 0;
      let total = 0;
      for (const stage of DOMINANCE_STAGES) total += stages[stage];
      sourceSeconds[source] = total;
      // Sorted iteration + strict '>' keeps the lexicographically smallest source on ties.
      if (total > dominantTotal) {
        dominantTotal = total;
        dominantSource = source;
      }
    }
    const winner = dominantSource ?? "";
    const stageSeconds = acc.bySource.get(winner) ?? emptyStageSeconds();
    return {
      date,
      dominantSource: winner,
      stageSeconds: { ...stageSeconds },
      sourceSeconds,
      sourceRecordCounts,
    };
  });
}
