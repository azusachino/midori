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

const KIND_PRIORITY: Record<PrimaryKind, number> = { watch: 3, phone: 2, app: 1, other: 1 };
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
          units.filter((unit) => unit.unitDay === nextDay && nonMinor.has(unit.epochId)),
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
export function deriveStints(units: readonly MetricUnit[]): Stint[] {
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
    const candidateEpochIds = [...new Set(candidates.map((unit) => unit.epochId))];
    const candidateDaysByEpoch = new Map<number, Set<string>>();
    const kindByEpoch = new Map<number, PrimaryKind>();
    for (const unit of candidates) {
      const present = candidateDaysByEpoch.get(unit.epochId) ?? new Set<string>();
      present.add(unit.unitDay);
      candidateDaysByEpoch.set(unit.epochId, present);
      kindByEpoch.set(unit.epochId, unit.epochKind);
    }

    for (let index = days.indexOf(startDay) + 1; index < days.length; index++) {
      const day = days[index];
      if (day === undefined) continue;
      const qualifying: Array<{ day: string; epochId: number; priority: number }> = [];
      for (const candidateId of candidateEpochIds) {
        if (candidateId === primary) continue;
        const candidateDays = candidateDaysByEpoch.get(candidateId);
        if (!candidateDays || index + SWITCH_RUN > days.length) continue;
        const runPresent = Array.from(
          { length: SWITCH_RUN },
          (_, offset) => days[index + offset],
        ).every((runDay) => runDay !== undefined && candidateDays.has(runDay));
        if (!runPresent) continue;
        const candidateKind = kindByEpoch.get(candidateId) ?? "other";
        const incumbentKind = kindByEpoch.get(primary) ?? "other";
        const higher = KIND_PRIORITY[candidateKind] > KIND_PRIORITY[incumbentKind];
        const incumbentDays = candidateDaysByEpoch.get(primary) ?? new Set<string>();
        const sameRankAndAbsent =
          KIND_PRIORITY[candidateKind] === KIND_PRIORITY[incumbentKind] &&
          Array.from({ length: SWITCH_RUN }, (_, offset) => days[index + offset]).every(
            (runDay) => runDay !== undefined && !incumbentDays.has(runDay),
          );
        if (higher || sameRankAndAbsent)
          qualifying.push({ day, epochId: candidateId, priority: KIND_PRIORITY[candidateKind] });
      }
      const preferred = qualifying.sort(
        (a, b) => b.priority - a.priority || a.epochId - b.epochId,
      )[0];
      let choice = preferred ? { day: preferred.day, epochId: preferred.epochId } : null;
      if (choice === null && index + INCUMBENT_GAP <= days.length) {
        const incumbentDays = candidateDaysByEpoch.get(primary) ?? new Set<string>();
        let gapHasIncumbent = false;
        for (let offset = 0; offset < INCUMBENT_GAP; offset++) {
          const gapDay = days[index + offset];
          if (gapDay !== undefined && incumbentDays.has(gapDay)) {
            gapHasIncumbent = true;
            break;
          }
        }
        if (!gapHasIncumbent) {
          const gap = days.slice(index, index + INCUMBENT_GAP);
          const gapDays = new Set(gap);
          const other = candidates
            .filter((unit) => unit.epochId !== primary && gapDays.has(unit.unitDay))
            .sort((a, b) => a.unitDay.localeCompare(b.unitDay) || a.epochId - b.epochId)[0];
          if (other) {
            const otherDays = candidateDaysByEpoch.get(other.epochId) ?? new Set<string>();
            choice = {
              day: gap.find((gapDay) => otherDays.has(gapDay)) ?? day,
              epochId: other.epochId,
            };
          }
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
