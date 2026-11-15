import type { Database } from "bun:sqlite";
import type {
  ChangesDTO,
  EpochMetricRoleDTO,
  EpochsDTO,
  ImportDTO,
  MetricSeriesDTO,
  MetricsIndexDTO,
  NightsDTO,
  UnitEvidenceDTO,
} from "../domain/api";
import { METRICS } from "../domain/metrics";
import { readFindings } from "../stats/findings";
import { type MetricUnit, minorEpochs } from "../stats/stints";

// Retained for src/mcp/server.ts until Slice 10 drops v0 MCP source tools.
export interface SourceDTO {
  name: string;
  firstSeenAt: string;
  lastSeenAt: string;
  recordCount: number;
}
export function listSources(db: Database): SourceDTO[] {
  return (
    db
      .query(
        "SELECT name,first_seen_at,last_seen_at,record_count FROM sources ORDER BY record_count DESC",
      )
      .all() as {
      name: string;
      first_seen_at: string;
      last_seen_at: string;
      record_count: number;
    }[]
  ).map((r) => ({
    name: r.name,
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
    recordCount: r.record_count,
  }));
}

function parseEpochLabels(value: string | null): string[] {
  if (value === null) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [];
  } catch {
    return [];
  }
}

export function listImports(db: Database): ImportDTO[] {
  return (
    db
      .query(`SELECT id, created_at, zip_name, zip_size, status, stage, progress, progress_total,
      new_usable_nights, new_epochs, error, export_version, export_date, older_than_stored,
      records_seen, records_inserted, records_deduped, duration_ms FROM imports ORDER BY id DESC`)
      .all() as ImportRow[]
  ).map((r) => importDto(r));
}

type ImportRow = {
  id: number;
  created_at: string;
  zip_name: string;
  zip_size: number;
  status: string;
  stage: string | null;
  progress: number | null;
  progress_total: number | null;
  new_usable_nights: number | null;
  new_epochs: string | null;
  error: string | null;
  export_version: string | null;
  export_date: string | null;
  older_than_stored: number | null;
  records_seen: number | null;
  records_inserted: number | null;
  records_deduped: number | null;
  duration_ms: number | null;
};
function importDto(r: ImportRow): ImportDTO {
  return {
    id: r.id,
    zipName: r.zip_name,
    zipSize: r.zip_size,
    status: r.status as ImportDTO["status"],
    stage: r.stage,
    progress: r.progress,
    progressTotal: r.progress_total,
    newUsableNights: r.new_usable_nights,
    newEpochs: parseEpochLabels(r.new_epochs),
    error: r.error,
    exportVersion: r.export_version,
    exportDate: r.export_date,
    olderThanStored: r.older_than_stored === 1,
    recordsSeen: r.records_seen,
    recordsInserted: r.records_inserted,
    recordsDeduped: r.records_deduped,
    durationMs: r.duration_ms,
    createdAt: r.created_at,
  };
}
export function getImport(db: Database, id: number): ImportDTO | null {
  const row = db
    .query(`SELECT id, created_at, zip_name, zip_size, status, stage, progress, progress_total,
      new_usable_nights, new_epochs, error, export_version, export_date, older_than_stored,
      records_seen, records_inserted, records_deduped, duration_ms FROM imports WHERE id=?`)
    .get(id) as ImportRow | null;
  return row ? importDto(row) : null;
}
const hasImports = (db: Database) =>
  Number((db.query("SELECT COUNT(*) n FROM imports").get() as { n: number }).n) > 0;
const asOf = (db: Database) =>
  (
    db
      .query("SELECT MAX(unit_day) day FROM metric_values WHERE metric='sleep_h' AND usable=1")
      .get() as { day: string | null }
  ).day;
const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
type EpochTrait = { colorIndex: number | null };
type EpochTraits = {
  byEpoch: Map<number, EpochTrait>;
  minorByMetric: Map<string, Set<number>>;
};

function apiFindings(db: Database, includeWithinDaytime = false) {
  const rows = readFindings(db, includeWithinDaytime);
  const names = new Map(
    (
      db.query("SELECT id,source_name FROM epochs").all() as Array<{
        id: number;
        source_name: string;
      }>
    ).map((epoch) => [epoch.id, epoch.source_name]),
  );
  return rows.map((row) => ({
    ...row,
    epochLabel: row.epochId === null ? null : (names.get(row.epochId) ?? row.epochLabel),
  }));
}

function getEpochTraits(db: Database): EpochTraits {
  const rows = db
    .query(
      `SELECT v.metric,v.epoch_id,v.unit_day,v.unit_kind,v.value,v.n,e.kind
       FROM metric_values v JOIN epochs e ON e.id=v.epoch_id
       ORDER BY v.metric,v.unit_day`,
    )
    .all() as Array<{
    metric: string;
    epoch_id: number;
    unit_day: string;
    unit_kind: "night" | "day";
    value: number;
    n: number;
    kind: "watch" | "phone" | "app" | "other";
  }>;
  const unitsByMetric = new Map<string, MetricUnit[]>();
  for (const row of rows) {
    const units = unitsByMetric.get(row.metric) ?? [];
    units.push({
      metric: row.metric,
      epochId: row.epoch_id,
      epochKind: row.kind,
      unitDay: row.unit_day,
      unitKind: row.unit_kind,
      value: row.value,
      n: row.n,
    });
    unitsByMetric.set(row.metric, units);
  }
  const minorByMetric = new Map<string, Set<number>>();
  const nonMinorEpochs = new Set<number>();
  for (const [metric, units] of unitsByMetric) {
    const minor = minorEpochs(units);
    minorByMetric.set(metric, minor);
    for (const unit of units) if (!minor.has(unit.epochId)) nonMinorEpochs.add(unit.epochId);
  }
  const epochs = db.query("SELECT id FROM epochs ORDER BY first_day,id").all() as Array<{
    id: number;
  }>;
  const byEpoch = new Map<number, EpochTrait>();
  let colorIndex = 0;
  for (const epoch of epochs) {
    const isNonMinor = nonMinorEpochs.has(epoch.id);
    byEpoch.set(epoch.id, { colorIndex: isNonMinor ? colorIndex++ : null });
  }
  return { byEpoch, minorByMetric };
}

const median = (v: number[]) => {
  const a = [...v].sort((x, y) => x - y);
  const middle = Math.floor(a.length / 2);
  const right = a[middle];
  if (right === undefined) return null;
  if (a.length % 2 === 1) return right;
  const left = a[middle - 1];
  return left === undefined ? null : (left + right) / 2;
};
const latestImport = (db: Database) =>
  db.query("SELECT created_at FROM imports WHERE status='done' ORDER BY id DESC LIMIT 1").get() as {
    created_at: string;
  } | null;
function freshness(db: Database, day: string | null) {
  const last = latestImport(db);
  const days = last
    ? Math.max(0, Math.floor((Date.now() - Date.parse(last.created_at)) / 86400000))
    : null;
  return { asOfDay: day, lastImportAt: last?.created_at ?? null, daysSinceImport: days };
}

export function getChanges(db: Database): ChangesDTO {
  const day = asOf(db),
    imported = hasImports(db),
    rows = apiFindings(db);
  const days = freshness(db, day).daysSinceImport;
  const warming = rows.find((r) => r.state === "warming_up" && r.warmup !== null);
  const active = db
    .query("SELECT id FROM imports WHERE status NOT IN ('done','failed') ORDER BY id DESC LIMIT 1")
    .get() as { id: number } | null;
  const firstRecent =
    rows
      .flatMap((r) =>
        r.sparkline
          .filter((p) => p.usable)
          .slice(-7)
          .map((p) => p.day),
      )
      .sort()[0] ?? day;
  const night = day
    ? (db
        .query(
          "SELECT date, asleep_s,deep_s,rem_s,core_s,partial_reason FROM nights WHERE date<=? AND date>=? ORDER BY date DESC LIMIT 1",
        )
        .get(day, addDays(day, -14)) as {
        date: string;
        asleep_s: number;
        deep_s: number;
        rem_s: number;
        core_s: number;
        partial_reason: string | null;
      } | null)
    : null;
  const primary = day
    ? (db
        .query(
          `SELECT e.id,e.source_name,e.device_hw,e.kind FROM stints s JOIN epochs e ON e.id=s.epoch_id WHERE s.metric='sleep_h' AND s.start_day<=? AND (s.end_day IS NULL OR s.end_day>=?) ORDER BY s.start_day DESC LIMIT 1`,
        )
        .get(day, day) as {
        id: number;
        source_name: string;
        device_hw: string;
        kind: string;
      } | null)
    : null;
  const primaryColorIndex =
    primary?.kind === "watch" ? (getEpochTraits(db).byEpoch.get(primary.id)?.colorIndex ?? 0) : 0;
  return {
    hasImports: imported,
    asOfDay: day,
    freshness: freshness(db, day),
    activeImport: active ? getImport(db, active.id) : null,
    primaryWatch:
      primary?.kind === "watch"
        ? {
            epochId: primary.id,
            label: primary.source_name,
            hardware: primary.device_hw,
            colorIndex: primaryColorIndex,
            warmingUp:
              rows.find((r) => r.epochId === primary.id && r.warmup !== null)?.warmup ?? null,
          }
        : null,
    staleBanner:
      day !== null && days !== null && days > 30
        ? { daysSinceImport: days, windowFrom: firstRecent ?? day, windowTo: day }
        : null,
    warmingNotice: warming?.warmup
      ? {
          metric: warming.metric,
          current: warming.warmup.current,
          target: warming.warmup.target,
          estimatedReadyDay: warming.warmup.estimatedReadyDay,
        }
      : null,
    overnight: rows.filter((r) => r.kind === "overnight"),
    daytime: rows.filter((r) => r.kind === "daytime"),
    lastNight: night
      ? {
          date: night.date,
          asleepH: night.asleep_s / 3600,
          deepH: night.deep_s / 3600,
          remH: night.rem_s / 3600,
          coreH: night.core_s / 3600,
          skippedPartialDay: night.partial_reason ? night.date : null,
          skippedPartialReason:
            night.partial_reason === "export_cut" ? ("export_cut" as const) : null,
        }
      : null,
  };
}
function weekly(db: Database, metric: string) {
  const rows = db
    .query(
      `SELECT v.unit_day,v.value,v.epoch_id,v.usable,n.partial_reason
       FROM metric_values v LEFT JOIN nights n ON n.date=v.unit_day
       WHERE v.metric=? ORDER BY v.unit_day`,
    )
    .all(metric) as {
    unit_day: string;
    value: number;
    epoch_id: number;
    usable: number;
    partial_reason: string | null;
  }[];
  const buckets = new Map<string, { values: number[]; epochs: number[]; hasPartial: boolean }>();
  for (const r of rows) {
    const d = new Date(`${r.unit_day}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    const key = d.toISOString().slice(0, 10);
    const b = buckets.get(key) ?? { values: [], epochs: [], hasPartial: false };
    if (r.usable === 1) {
      b.values.push(r.value);
      b.epochs.push(r.epoch_id);
    }
    b.hasPartial ||= r.partial_reason !== null;
    buckets.set(key, b);
  }
  return [...buckets].map(([weekStart, b]) => ({
    weekStart,
    median: median(b.values),
    epochId: b.epochs.every((x) => x === b.epochs[0]) ? (b.epochs[0] ?? null) : null,
    hasPartial: b.hasPartial,
  }));
}
function weeklyByEpoch(db: Database, metric: string) {
  const rows = db
    .query(
      `SELECT v.unit_day,v.value,v.epoch_id,v.usable,n.partial_reason
       FROM metric_values v LEFT JOIN nights n ON n.date=v.unit_day
       WHERE v.metric=? ORDER BY v.unit_day,v.epoch_id`,
    )
    .all(metric) as Array<{
    unit_day: string;
    value: number;
    epoch_id: number;
    usable: number;
    partial_reason: string | null;
  }>;
  const buckets = new Map<
    string,
    { weekStart: string; epochId: number; values: number[]; hasPartial: boolean }
  >();
  for (const row of rows) {
    const date = new Date(`${row.unit_day}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    const weekStart = date.toISOString().slice(0, 10);
    const key = `${weekStart}:${row.epoch_id}`;
    const bucket = buckets.get(key) ?? {
      weekStart,
      epochId: row.epoch_id,
      values: [],
      hasPartial: false,
    };
    if (row.usable === 1) bucket.values.push(row.value);
    bucket.hasPartial ||= row.partial_reason !== null;
    buckets.set(key, bucket);
  }
  return [...buckets.values()]
    .map((bucket) => ({ ...bucket, median: median(bucket.values) }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart) || a.epochId - b.epochId);
}
export function getMetrics(db: Database): MetricsIndexDTO {
  const rows = apiFindings(db, true);
  return {
    hasImports: hasImports(db),
    asOfDay: asOf(db),
    metrics: Object.values(METRICS).map((s) => ({
      metric: s.key,
      kind: s.kind,
      unit: s.unit,
      trust: s.trust,
      trustNote: s.trustNote,
      hasData:
        Number(
          (
            db.query("SELECT COUNT(*) n FROM metric_values WHERE metric=?").get(s.key) as {
              n: number;
            }
          ).n,
        ) > 0,
      finding: rows.find((r) => r.metric === s.key) ?? null,
      weeklySeries: weekly(db, s.key),
      seams: db
        .query("SELECT seam_day day,kind FROM seam_steps WHERE metric=? ORDER BY seam_day")
        .all(s.key) as { day: string; kind: "offset" | "step" }[],
    })),
  };
}
export function getSeries(db: Database, metric: string, range: string): MetricSeriesDTO | null {
  const spec = METRICS[metric];
  if (!spec) return null;
  const day = asOf(db);
  const epochTraits = getEpochTraits(db);
  const metricMinor = epochTraits.minorByMetric.get(metric) ?? new Set<number>();
  const from =
    range === "all" || !day
      ? null
      : range === "90d"
        ? addDays(day, -89)
        : range === "1y"
          ? addDays(day, -364)
          : addDays(day, -179);
  const epochs = db
    .query(
      "SELECT DISTINCT e.id,e.source_name,e.device_hw,e.kind,e.first_day,e.last_day FROM epochs e JOIN metric_values v ON v.epoch_id=e.id WHERE v.metric=? ORDER BY e.first_day,e.id",
    )
    .all(metric) as {
    id: number;
    source_name: string;
    device_hw: string;
    kind: string;
    first_day: string;
    last_day: string;
  }[];
  const units = db
    .query(
      `SELECT v.unit_day day,v.epoch_id,v.value,v.n,v.usable,n.partial_reason AS partialReason,
              COALESCE(n.tz_change,0) AS tzChange
       FROM metric_values v LEFT JOIN nights n ON n.date=v.unit_day
       WHERE v.metric=? AND v.unit_day<=? ${from ? "AND v.unit_day>=?" : ""} ORDER BY v.unit_day`,
    )
    .all(...(from ? [metric, day, from] : [metric, day ?? "9999-12-31"])) as {
    day: string;
    epoch_id: number;
    value: number;
    n: number;
    usable: number;
    partialReason: string | null;
    tzChange: number;
  }[];
  const rows = apiFindings(db, true);
  const row = rows.find((r) => r.metric === metric) ?? null;
  const recentDays = new Set(
    row?.sparkline
      .filter((point) => point.usable)
      .slice(-7)
      .map((point) => point.day) ?? [],
  );
  const band = units.flatMap((unit) => {
    const low = row?.baselineLow;
    const high = row?.baselineHigh;
    const center = row?.baselineMedian;
    return unit.usable && low != null && high != null && center != null
      ? [{ day: unit.day, low, high, median: center }]
      : [];
  });
  const dispersion =
    row && row.baselineLow !== null && row.baselineHigh !== null
      ? (row.baselineHigh - row.baselineLow) / 3
      : null;
  const stints = db
    .query(
      `SELECT epoch_id epochId,start_day startDay,COALESCE(end_day,(SELECT MAX(unit_day) FROM metric_values WHERE metric=? AND epoch_id=stints.epoch_id)) endDay FROM stints WHERE metric=? ORDER BY start_day`,
    )
    .all(metric, metric) as Array<{ epochId: number; startDay: string; endDay: string }>;
  const seams = db
    .query(
      `SELECT s.seam_day seamDay,s.kind,s.value,s.n_old nOld,s.n_new nNew,
        (SELECT epoch_id FROM stints WHERE metric=s.metric AND start_day < s.seam_day ORDER BY start_day DESC LIMIT 1) fromEpochId,
        (SELECT epoch_id FROM stints WHERE metric=s.metric AND start_day = s.seam_day ORDER BY start_day DESC LIMIT 1) toEpochId
       FROM seam_steps s WHERE s.metric=? AND s.seam_day<=? ${from ? "AND s.seam_day>=?" : ""} ORDER BY s.seam_day`,
    )
    .all(...(from ? [metric, day ?? "9999-12-31", from] : [metric, day ?? "9999-12-31"])) as {
    seamDay: string;
    kind: "offset" | "step";
    value: number;
    nOld: number;
    nNew: number;
    fromEpochId: number | null;
    toEpochId: number;
  }[];
  const updateRows = db
    .query(
      `SELECT ev.epoch_id epochId,ev.day,ev.detail FROM epoch_events ev
       WHERE ev.kind='os_update' AND ev.day<=? ${from ? "AND ev.day>=?" : ""}
         AND EXISTS (SELECT 1 FROM stints st WHERE st.metric=? AND st.epoch_id=ev.epoch_id
           AND st.start_day<=ev.day AND (st.end_day IS NULL OR st.end_day>=ev.day))
       ORDER BY ev.day`,
    )
    .all(...(from ? [day ?? "9999-12-31", from, metric] : [day ?? "9999-12-31", metric])) as {
    epochId: number;
    day: string;
    detail: string;
  }[];
  return {
    metric,
    kind: spec.kind,
    unit: spec.unit,
    trust: spec.trust,
    trustNote: spec.trustNote,
    range: range as MetricSeriesDTO["range"],
    asOfDay: day,
    finding: row,
    epochs: epochs.map((e) => ({
      id: e.id,
      sourceName: e.source_name,
      deviceHw: e.device_hw,
      label: e.source_name,
      kind: e.kind as MetricSeriesDTO["epochs"][number]["kind"],
      colorIndex: epochTraits.byEpoch.get(e.id)?.colorIndex ?? null,
      minor: metricMinor.has(e.id),
    })),
    units:
      range === "all"
        ? weeklyByEpoch(db, metric).map((point) => ({
            day: point.weekStart,
            epochId: point.epochId,
            value: point.median,
            n: 0,
            usable: point.median !== null,
            partialReason: null,
            tzChange: false,
            z: null,
            isRecent: false,
          }))
        : units.map((u) => ({
            day: u.day,
            epochId: u.epoch_id,
            value: u.value,
            n: u.n,
            usable: u.usable === 1,
            partialReason: u.partialReason,
            tzChange: u.tzChange === 1,
            z:
              row && row.baselineMedian !== null && dispersion !== null && dispersion > 0
                ? Math.max(-10, Math.min(10, (u.value - row.baselineMedian) / dispersion))
                : null,
            isRecent: recentDays.has(u.day),
          })),
    band,
    stints,
    seams,
    osUpdates: updateRows
      .filter((e) => epochs.some((x) => x.id === e.epochId))
      .map((e) => {
        const [fromSw, toSw] = e.detail.split(" → ");
        return { epochId: e.epochId, day: e.day, fromSw: fromSw ?? null, toSw: toSw ?? e.detail };
      }),
  };
}
export function getUnitEvidence(db: Database, metric: string, day: string): UnitEvidenceDTO | null {
  const spec = METRICS[metric],
    asof = asOf(db);
  if (!spec || !asof || day > asof) return null;
  const value = db
    .query(
      "SELECT v.epoch_id,v.value,v.n,v.usable,v.unit_kind FROM metric_values v WHERE v.metric=? AND v.unit_day=? ORDER BY v.usable DESC LIMIT 1",
    )
    .get(metric, day) as {
    epoch_id: number;
    value: number;
    n: number;
    usable: number;
    unit_kind: string;
  } | null;
  const night = db
    .query("SELECT zone,partial_reason,asleep_s,deep_s,rem_s,core_s FROM nights WHERE date=?")
    .get(day) as {
    zone: string;
    partial_reason: string | null;
    asleep_s: number;
    deep_s: number;
    rem_s: number;
    core_s: number;
  } | null;
  const ep = value
    ? (db
        .query("SELECT id,source_name,device_hw,kind FROM epochs WHERE id=?")
        .get(value.epoch_id) as {
        id: number;
        source_name: string;
        device_hw: string;
        kind: string;
      } | null)
    : null;
  const epochTraits = getEpochTraits(db);
  const primaryEpoch = ep
    ? {
        id: ep.id,
        sourceName: ep.source_name,
        deviceHw: ep.device_hw,
        label: ep.source_name,
        kind: ep.kind as NonNullable<UnitEvidenceDTO["primaryEpoch"]>["kind"],
        colorIndex: epochTraits.byEpoch.get(ep.id)?.colorIndex ?? null,
        minor: epochTraits.minorByMetric.get(metric)?.has(ep.id) ?? true,
      }
    : null;
  const samples = spec.types.length
    ? (db
        .query(
          `SELECT start_at timestamp,start_offset_min offsetMinutes,value,unit FROM records
           WHERE source_name=? AND type IN (${spec.types.map(() => "?").join(",")})
             AND date(start_at,printf('%+d minutes',COALESCE(start_offset_min,0))) IN (?,?)
           ORDER BY start_at LIMIT 500`,
        )
        .all(ep?.source_name ?? "", ...spec.types, day, addDays(day, 1)) as {
        timestamp: string;
        offsetMinutes: number | null;
        value: number | null;
        unit: string | null;
      }[])
    : [];
  const localStamp = (stamp: string, offset: number) => {
    const shifted = new Date(Date.parse(stamp) + offset * 60000).toISOString();
    return `${shifted.slice(0, 10)}T${shifted.slice(11, 16)}`;
  };
  const sleepRecords = ep
    ? (db
        .query(`SELECT start_at startAt,end_at endAt,start_offset_min offsetMinutes FROM records
        WHERE type=? AND source_name=? AND date(start_at,printf('%+d minutes',COALESCE(start_offset_min,0))) IN (?,?) ORDER BY start_at`)
        .all("HKCategoryTypeIdentifierSleepAnalysis", ep.source_name, day, addDays(day, 1)) as {
        startAt: string;
        endAt: string;
        offsetMinutes: number | null;
      }[])
    : [];
  const assignedSleep = sleepRecords.filter((record) => {
    const start = localStamp(record.startAt, record.offsetMinutes ?? 0);
    const localDay = start.slice(0, 10),
      time = start.slice(11);
    return (
      (localDay === day && time >= "15:00") || (localDay === addDays(day, 1) && time < "09:00")
    );
  });
  const otherEpochs = db
    .query(`SELECT DISTINCT e.id,e.source_name,e.device_hw,e.kind
      FROM metric_values v JOIN epochs e ON e.id=v.epoch_id
      WHERE v.metric=? AND v.unit_day=? AND v.epoch_id<>? ORDER BY e.id`)
    .all(metric, day, value?.epoch_id ?? -1) as {
    id: number;
    source_name: string;
    device_hw: string;
    kind: string;
  }[];
  const deviceSw =
    ep && spec.types.length
      ? ((
          db
            .query(
              `SELECT device_sw FROM records WHERE source_name=? AND type IN (${spec.types.map(() => "?").join(",")}) AND device_sw IS NOT NULL AND date(start_at,printf('%+d minutes',COALESCE(start_offset_min,0)))<=? ORDER BY start_at DESC LIMIT 1`,
            )
            .get(ep.source_name, ...spec.types, asof) as { device_sw: string } | null
        )?.device_sw ?? null)
      : null;
  return {
    metric,
    day,
    unitKind: (value?.unit_kind ??
      (spec.kind === "daytime" ? "day" : "night")) as UnitEvidenceDTO["unitKind"],
    zone: night?.zone ?? "UTC",
    value: value?.value ?? null,
    sampleCount: value?.n ?? 0,
    usable: value?.usable === 1,
    partialReason: night?.partial_reason ?? null,
    primaryEpoch,
    deviceSw,
    samples: samples.flatMap((s) =>
      s.value === null
        ? []
        : [
            {
              timestamp: s.timestamp,
              localTime: new Date(Date.parse(s.timestamp) + (s.offsetMinutes ?? 0) * 60000)
                .toISOString()
                .slice(11, 19),
              value: s.value,
            },
          ],
    ),
    sleep:
      night && assignedSleep.length
        ? {
            startLocal:
              assignedSleep.map((r) => localStamp(r.startAt, r.offsetMinutes ?? 0)).sort()[0] ?? "",
            endLocal:
              assignedSleep
                .map((r) => localStamp(r.endAt, r.offsetMinutes ?? 0))
                .sort()
                .at(-1) ?? "",
            asleepH: night.asleep_s / 3600,
            deepH: night.deep_s / 3600,
            remH: night.rem_s / 3600,
            coreH: night.core_s / 3600,
          }
        : null,
    alsoRecordedBy: otherEpochs.map((other) => ({
      id: other.id,
      sourceName: other.source_name,
      deviceHw: other.device_hw,
      label: other.source_name,
      kind: other.kind as NonNullable<UnitEvidenceDTO["primaryEpoch"]>["kind"],
      colorIndex: epochTraits.byEpoch.get(other.id)?.colorIndex ?? null,
      minor: epochTraits.minorByMetric.get(metric)?.has(other.id) ?? true,
    })),
  };
}
export function getEpochs(db: Database): EpochsDTO {
  const day = asOf(db);
  const epochTraits = getEpochTraits(db);
  const epochs = db.query("SELECT * FROM epochs ORDER BY first_day,id").all() as {
    id: number;
    source_name: string;
    device_hw: string;
    kind: string;
    first_day: string;
    last_day: string;
    days_present: number;
  }[];
  return {
    hasImports: hasImports(db),
    asOfDay: day,
    epochs: epochs.map((e) => {
      const presence = db
        .query(
          "SELECT unit_day FROM metric_values WHERE epoch_id=? AND unit_day<=? GROUP BY unit_day ORDER BY unit_day",
        )
        .all(e.id, day ?? "9999-12-31") as { unit_day: string }[];
      const recordedMetrics = new Set(
        (
          db
            .query("SELECT metric FROM metric_values WHERE epoch_id=? GROUP BY metric")
            .all(e.id) as Array<{ metric: string }>
        ).map((row) => row.metric),
      );
      const metrics = Object.values(METRICS)
        .filter((spec) => recordedMetrics.has(spec.key))
        .map((s) => {
          const stint = db
            .query(
              "SELECT id,start_day,end_day FROM stints WHERE metric=? AND epoch_id=? AND start_day<=? AND (end_day IS NULL OR end_day>=?) ORDER BY start_day DESC LIMIT 1",
            )
            .get(s.key, e.id, day ?? "9999-12-31", day ?? "9999-12-31") as {
            id: number;
            start_day: string;
            end_day: string | null;
          } | null;
          const role: EpochMetricRoleDTO["role"] = stint
            ? "primary"
            : epochTraits.minorByMetric.get(s.key)?.has(e.id)
              ? "minor"
              : "candidate";
          const metricFinding =
            role === "primary" && stint
              ? (db
                  .query("SELECT state FROM findings WHERE metric=? AND stint_id=?")
                  .get(s.key, stint.id) as { state: string } | null)
              : null;
          const currentStintUnits =
            role === "primary" && stint
              ? Number(
                  (
                    db
                      .query(`SELECT COUNT(*) AS count FROM metric_values
                        WHERE metric=? AND epoch_id=? AND unit_day>=? AND unit_day<=? AND usable=1`)
                      .get(s.key, e.id, stint.start_day, day ?? "9999-12-31") as { count: number }
                  ).count,
                )
              : 0;
          const seam = db
            .query(`SELECT ss.seam_day seamDay,ss.kind,ss.value,ss.n_old nOld,ss.n_new nNew,
          (SELECT epoch_id FROM stints WHERE metric=ss.metric AND start_day<ss.seam_day ORDER BY start_day DESC LIMIT 1) fromEpochId,
          (SELECT epoch_id FROM stints WHERE metric=ss.metric AND start_day=ss.seam_day LIMIT 1) toEpochId
          FROM seam_steps ss JOIN stints target ON target.metric=ss.metric AND target.start_day=ss.seam_day
          WHERE ss.metric=? AND target.epoch_id=? AND ss.seam_day<=? ORDER BY ss.seam_day DESC LIMIT 1`)
            .get(s.key, e.id, day ?? "9999-12-31") as EpochMetricRoleDTO["seamFromPrevious"];
          const baselineState: EpochMetricRoleDTO["baselineState"] =
            role !== "primary"
              ? null
              : s.kind === "trendOnly"
                ? "trend_only"
                : metricFinding?.state === "warming_up"
                  ? "warming_up"
                  : metricFinding?.state === "computed"
                    ? Math.max(0, Math.min(28, currentStintUnits - 7)) >= 14
                      ? "full"
                      : "early"
                    : "insufficient";
          return {
            metric: s.key,
            role,
            baselineState,
            warmup:
              role === "primary" && metricFinding?.state === "warming_up"
                ? { current: currentStintUnits, target: 14 }
                : null,
            seamFromPrevious: seam,
          };
        });
      const events = db
        .query(
          "SELECT epoch_id epochId,day,detail FROM epoch_events WHERE epoch_id=? AND day<=? ORDER BY day",
        )
        .all(e.id, day ?? "9999-12-31") as { epochId: number; day: string; detail: string }[];
      return {
        id: e.id,
        sourceName: e.source_name,
        deviceHw: e.device_hw,
        label: e.source_name,
        kind: e.kind as EpochsDTO["epochs"][number]["kind"],
        colorIndex: epochTraits.byEpoch.get(e.id)?.colorIndex ?? null,
        minor: metrics.every((m) => m.role === "minor"),
        firstDay: e.first_day,
        lastDay: e.last_day,
        daysPresent: presence.map((p) => p.unit_day),
        daysPresentCount: e.days_present,
        primaryMetricCount: metrics.filter((m) => m.role === "primary").length,
        metrics,
        osUpdates: events.map((v) => {
          const [fromSw, toSw] = v.detail.split(" → ");
          return { epochId: v.epochId, day: v.day, fromSw: fromSw ?? null, toSw: toSw ?? v.detail };
        }),
      };
    }),
  };
}
export function getNights(db: Database, from: string, to: string): NightsDTO | null | false {
  const fromTime = Date.parse(`${from}T00:00:00Z`);
  const toTime = Date.parse(`${to}T00:00:00Z`);
  const days = (toTime - fromTime) / 86400000;
  if (
    !/^\d{4}-\d\d-\d\d$/.test(from) ||
    !/^\d{4}-\d\d-\d\d$/.test(to) ||
    !Number.isFinite(fromTime) ||
    !Number.isFinite(toTime) ||
    new Date(fromTime).toISOString().slice(0, 10) !== from ||
    new Date(toTime).toISOString().slice(0, 10) !== to ||
    days < 0
  )
    return null;
  if (days > 400) return false;
  const rows = db
    .query(
      "SELECT date,zone,tz_change,partial_reason,asleep_s,core_s,deep_s,rem_s,in_bed_s FROM nights WHERE date>=? AND date<=? ORDER BY date",
    )
    .all(from, to) as {
    date: string;
    zone: string;
    tz_change: number;
    partial_reason: string | null;
    asleep_s: number;
    core_s: number;
    deep_s: number;
    rem_s: number;
    in_bed_s: number;
  }[];
  return {
    from,
    to,
    nights: rows.map((night) => ({
      date: night.date,
      zone: night.zone,
      tzChange: night.tz_change === 1,
      partialReason: night.partial_reason,
      asleepS: night.asleep_s,
      coreS: night.core_s,
      deepS: night.deep_s,
      remS: night.rem_s,
      inBedS: night.in_bed_s,
    })),
  };
}
