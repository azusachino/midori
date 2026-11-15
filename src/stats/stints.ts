import type { Database } from "bun:sqlite";
import { addDays } from "../domain/dates";

export type UnitKind = "night" | "day";
export type PrimaryKind = "watch" | "phone" | "app" | "other";

export interface MetricUnit {
  metric: string;
  epochId: number;
  epochKind: PrimaryKind;
  unitDay: string;
  unitKind: UnitKind;
  value: number;
  n: number;
}

export interface Stint {
  metric: string;
  epochId: number;
  startDay: string;
  endDay: string | null;
}

export interface UsableUnit {
  metric: string;
  epochId: number;
  unitDay: string;
  unitKind: UnitKind;
  value: number;
  n: number;
}

export type UsablePredicate = (unit: UsableUnit) => boolean;

const KIND_PRIORITY: Record<PrimaryKind, number> = { watch: 4, phone: 3, app: 2, other: 1 };
const MINOR_WINDOW = 28;
const MINOR_MINIMUM = 6;
const SWITCH_RUN = 7;
const INCUMBENT_GAP = 14;

function calendarDays(observed: readonly string[]): string[] {
  const first = observed[0];
  const last = observed[observed.length - 1];
  if (!first || !last) return [];
  const days: string[] = [];
  for (let day = first; day <= last; day = addDays(day, 1)) days.push(day);
  return days;
}

function countInWindow(
  days: readonly string[],
  present: ReadonlySet<string>,
  start: number,
  size: number,
): number {
  let count = 0;
  for (let i = start; i < start + size && i < days.length; i++) {
    if (days[i] !== undefined && present.has(days[i] as string)) count++;
  }
  return count;
}

export function minorEpochs(units: readonly MetricUnit[]): Set<number> {
  const observed = [...new Set(units.map((unit) => unit.unitDay))].sort();
  const days = calendarDays(observed);
  const byEpoch = new Map<number, Set<string>>();
  for (const unit of units) {
    const present = byEpoch.get(unit.epochId) ?? new Set<string>();
    present.add(unit.unitDay);
    byEpoch.set(unit.epochId, present);
  }
  const minor = new Set<number>();
  for (const [epochId, present] of byEpoch) {
    let qualifies = false;
    for (let start = 0; start < days.length; start++) {
      if (countInWindow(days, present, start, MINOR_WINDOW) >= MINOR_MINIMUM) {
        qualifies = true;
        break;
      }
    }
    if (!qualifies) minor.add(epochId);
  }
  return minor;
}

function primaryAtStart(
  units: readonly MetricUnit[],
  nonMinor: ReadonlySet<number>,
): number | null {
  const firstDay = units.map((unit) => unit.unitDay).sort()[0];
  if (firstDay === undefined) return null;
  const initial = units.filter((unit) => unit.unitDay === firstDay && nonMinor.has(unit.epochId));
  if (initial.length === 0) {
    const nextDay = units
      .filter((unit) => nonMinor.has(unit.epochId))
      .map((unit) => unit.unitDay)
      .sort()[0];
    return nextDay === undefined
      ? null
      : selectCandidate(
          units.filter((unit) => unit.unitDay === nextDay),
          units[0]?.metric ?? "",
        );
  }
  return selectCandidate(initial, units[0]?.metric ?? "");
}

function selectCandidate(candidates: readonly MetricUnit[], metric: string): number | null {
  const byEpoch = new Map<number, MetricUnit[]>();
  for (const unit of candidates)
    byEpoch.set(unit.epochId, [...(byEpoch.get(unit.epochId) ?? []), unit]);
  return (
    [...byEpoch]
      .map(([epochId, epochUnits]) => ({
        epochId,
        kind: epochUnits[0]?.epochKind ?? "other",
        samples: epochUnits.reduce((sum, unit) => sum + unit.n, 0),
        sleep: epochUnits.reduce((sum, unit) => sum + unit.value, 0),
      }))
      .sort(
        (a, b) =>
          KIND_PRIORITY[b.kind] - KIND_PRIORITY[a.kind] ||
          (["sleep_h", "deep_h", "rem_h"].includes(metric)
            ? b.sleep - a.sleep
            : b.samples - a.samples) ||
          a.epochId - b.epochId,
      )[0]?.epochId ?? null
  );
}

/** Derive non-minor candidates, sticky primaries and their stint boundaries. */
export function deriveStints(units: readonly MetricUnit[], _usable: UsablePredicate): Stint[] {
  const byMetric = new Map<string, MetricUnit[]>();
  for (const unit of units) byMetric.set(unit.metric, [...(byMetric.get(unit.metric) ?? []), unit]);
  const result: Stint[] = [];

  for (const [metric, metricUnits] of byMetric) {
    const minor = minorEpochs(metricUnits);
    const candidates = metricUnits.filter((unit) => !minor.has(unit.epochId));
    const days = calendarDays([...new Set(metricUnits.map((unit) => unit.unitDay))].sort());
    let primary = primaryAtStart(metricUnits, new Set(candidates.map((unit) => unit.epochId)));
    if (primary === null) continue;
    const startDay = days.find((day) =>
      candidates.some((unit) => unit.epochId === primary && unit.unitDay === day),
    );
    if (startDay === undefined) continue;
    const switches: Array<{ day: string; epochId: number }> = [];

    for (let index = days.indexOf(startDay) + 1; index < days.length; index++) {
      const day = days[index];
      if (day === undefined) continue;
      const currentIndex = days.indexOf(day);
      const future = days.slice(currentIndex);
      let choice: { day: string; epochId: number } | null = null;
      for (const candidateId of [...new Set(candidates.map((unit) => unit.epochId))]) {
        if (candidateId === primary) continue;
        const candidate = candidates.find((unit) => unit.epochId === candidateId);
        if (!candidate) continue;
        const candidateDays = new Set(
          candidates.filter((unit) => unit.epochId === candidateId).map((unit) => unit.unitDay),
        );
        const incumbentDays = new Set(
          candidates.filter((unit) => unit.epochId === primary).map((unit) => unit.unitDay),
        );
        const run = future.slice(0, SWITCH_RUN);
        if (run.length === SWITCH_RUN && run.every((runDay) => candidateDays.has(runDay))) {
          const higher =
            KIND_PRIORITY[candidate.epochKind] >
            KIND_PRIORITY[
              candidates.find((unit) => unit.epochId === primary)?.epochKind ?? "other"
            ];
          const sameKindAndAbsent =
            candidate.epochKind ===
              (candidates.find((unit) => unit.epochId === primary)?.epochKind ?? "other") &&
            run.every((runDay) => !incumbentDays.has(runDay));
          if (higher || sameKindAndAbsent) choice = { day, epochId: candidateId };
        }
      }
      if (choice === null && currentIndex + INCUMBENT_GAP <= days.length) {
        const gap = days.slice(currentIndex, currentIndex + INCUMBENT_GAP);
        const incumbentDays = new Set(
          candidates.filter((unit) => unit.epochId === primary).map((unit) => unit.unitDay),
        );
        if (gap.every((gapDay) => !incumbentDays.has(gapDay))) {
          const other = candidates.find(
            (unit) => unit.epochId !== primary && gap.some((gapDay) => unit.unitDay === gapDay),
          );
          if (other)
            choice = {
              day:
                gap.find((gapDay) =>
                  candidates.some(
                    (unit) => unit.epochId === other.epochId && unit.unitDay === gapDay,
                  ),
                ) ?? day,
              epochId: other.epochId,
            };
        }
      }
      if (choice) {
        switches.push(choice);
        primary = choice.epochId;
        index = Math.max(index, days.indexOf(choice.day));
      }
    }

    const primaryTimeline = new Map<string, number>();
    let active = primaryAtStart(metricUnits, new Set(candidates.map((unit) => unit.epochId)));
    for (const day of days) {
      const change = switches.find((item) => item.day === day);
      if (change) active = change.epochId;
      if (active !== null) primaryTimeline.set(day, active);
    }
    const boundaries = [...primaryTimeline].filter(
      ([day], index, all) => index === 0 || all[index - 1]?.[1] !== primaryTimeline.get(day),
    );
    for (let i = 0; i < boundaries.length; i++) {
      const [boundaryDay, epochId] = boundaries[i] ?? [];
      if (!boundaryDay || epochId === undefined) continue;
      const nextDay = boundaries[i + 1]?.[0] ?? null;
      result.push({
        metric,
        epochId,
        startDay: boundaryDay,
        endDay: nextDay ? (days[days.indexOf(nextDay) - 1] ?? null) : null,
      });
    }
  }
  return result.sort(
    (a, b) => a.metric.localeCompare(b.metric) || a.startDay.localeCompare(b.startDay),
  );
}

/** Keep only values recorded by the primary epoch on each unit; absence stays missing. */
export function primaryUnits(stints: readonly Stint[], units: readonly MetricUnit[]): MetricUnit[] {
  return units.filter((unit) => {
    const stint = stints.find(
      (candidate) =>
        candidate.metric === unit.metric &&
        candidate.startDay <= unit.unitDay &&
        (candidate.endDay === null || candidate.endDay >= unit.unitDay),
    );
    return stint?.epochId === unit.epochId;
  });
}

export function rebuildStints(db: Database, usable: UsablePredicate): Stint[] {
  const units = db
    .prepare(
      `SELECT mv.metric, mv.epoch_id AS epochId, e.kind AS epochKind, mv.unit_day AS unitDay,
            mv.unit_kind AS unitKind, mv.value, mv.n
     FROM metric_values mv JOIN epochs e ON e.id = mv.epoch_id
     ORDER BY mv.metric, mv.unit_day, mv.epoch_id`,
    )
    .all() as MetricUnit[];
  const stints = deriveStints(units, usable);
  db.exec("DELETE FROM stints");
  const insert = db.prepare(
    "INSERT INTO stints (metric, epoch_id, start_day, end_day) VALUES (?, ?, ?, ?)",
  );
  for (const stint of stints) insert.run(stint.metric, stint.epochId, stint.startDay, stint.endDay);
  return stints;
}
