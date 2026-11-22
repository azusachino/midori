import { integer, primaryKey, real, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";

/**
 * Typed mirror of the SQL migrations for drizzle-orm queries.
 * The SQL migrations are the source of truth; src/db/db.test.ts asserts the two
 * cannot drift (column sets must match).
 */

export const imports = sqliteTable("imports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  createdAt: text("created_at").notNull(),
  zipName: text("zip_name").notNull(),
  zipSize: integer("zip_size").notNull(),
  status: text("status").notNull().default("queued"),
  stage: text("stage"),
  progress: integer("progress"),
  error: text("error"),
  exportVersion: text("export_version"),
  recordsSeen: integer("records_seen"),
  recordsInserted: integer("records_inserted"),
  recordsDeduped: integer("records_deduped"),
  durationMs: integer("duration_ms"),
  exportDate: text("export_date"),
  olderThanStored: integer("older_than_stored"),
  progressTotal: integer("progress_total"),
  newUsableNights: integer("new_usable_nights"),
  newEpochs: text("new_epochs"),
  asOfDay: text("as_of_day"),
});

export const sources = sqliteTable("sources", {
  name: text("name").primaryKey(),
  firstSeenAt: text("first_seen_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
  recordCount: integer("record_count").notNull().default(0),
  lastImportId: integer("last_import_id").notNull(),
});

export const records = sqliteTable("records", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type").notNull(),
  sourceName: text("source_name").notNull(),
  unit: text("unit"),
  startAt: text("start_at").notNull(),
  endAt: text("end_at").notNull(),
  startOffsetMin: integer("start_offset_min"),
  endOffsetMin: integer("end_offset_min"),
  value: real("value"),
  valueStr: text("value_str"),
  importId: integer("import_id").notNull(),
  deviceHw: text("device_hw"),
  deviceSw: text("device_sw"),
  metaJson: text("meta_json"),
});

export const epochs = sqliteTable(
  "epochs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sourceName: text("source_name").notNull(),
    deviceHw: text("device_hw").notNull(),
    kind: text("kind").notNull(),
    firstDay: text("first_day").notNull(),
    lastDay: text("last_day").notNull(),
    daysPresent: integer("days_present").notNull(),
  },
  (t) => [unique().on(t.sourceName, t.deviceHw)],
);

export const epochEvents = sqliteTable("epoch_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  epochId: integer("epoch_id").notNull(),
  day: text("day").notNull(),
  kind: text("kind").notNull(),
  detail: text("detail").notNull(),
});

export const stints = sqliteTable("stints", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  metric: text("metric").notNull(),
  epochId: integer("epoch_id").notNull(),
  startDay: text("start_day").notNull(),
  endDay: text("end_day"),
});

export const nights = sqliteTable("nights", {
  date: text("date").primaryKey(),
  zone: text("zone").notNull(),
  tzChange: integer("tz_change").notNull().default(0),
  partialReason: text("partial_reason"),
  asleepS: real("asleep_s").notNull().default(0),
  coreS: real("core_s").notNull().default(0),
  deepS: real("deep_s").notNull().default(0),
  remS: real("rem_s").notNull().default(0),
  inBedS: real("in_bed_s").notNull().default(0),
});

export const metricValues = sqliteTable(
  "metric_values",
  {
    metric: text("metric").notNull(),
    epochId: integer("epoch_id").notNull(),
    unitDay: text("unit_day").notNull(),
    unitKind: text("unit_kind").notNull(),
    value: real("value").notNull(),
    n: integer("n").notNull(),
    usable: integer("usable").notNull(),
  },
  (t) => [primaryKey({ columns: [t.metric, t.epochId, t.unitDay] })],
);

export const findings = sqliteTable("findings", {
  metric: text("metric").primaryKey(),
  state: text("state").notNull(),
  z: real("z"),
  severity: text("severity"),
  confidence: text("confidence"),
  onsetDay: text("onset_day"),
  onsetOpen: integer("onset_open"),
  recent: real("recent"),
  baseline: real("baseline"),
  kOutside: integer("k_outside"),
  checksJson: text("checks_json").notNull().default("[]"),
  asofDay: text("asof_day").notNull(),
  stintId: integer("stint_id"),
});

export const notes = sqliteTable("notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  startDay: text("start_day").notNull(),
  endDay: text("end_day").notNull(),
  category: text("category").notNull(),
  label: text("label").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * B-P1–B-P2: owner-authored agent context, a singleton row (`id = 1`). derive()
 * and imports never clear or modify it.
 */
export const profileContext = sqliteTable("profile_context", {
  id: integer("id").primaryKey(),
  goals: text("goals").notNull().default(""),
  routine: text("routine").notNull().default(""),
  medicalContext: text("medical_context").notNull().default(""),
  updatedAt: text("updated_at").notNull(),
});

export const findingSnapshots = sqliteTable(
  "finding_snapshots",
  {
    importId: integer("import_id").notNull(),
    metric: text("metric").notNull(),
    state: text("state").notNull(),
    z: real("z"),
    severity: text("severity"),
    direction: text("direction"),
    confidence: text("confidence"),
    asofDay: text("asof_day").notNull(),
  },
  (t) => [primaryKey({ columns: [t.importId, t.metric] })],
);

export const seamSteps = sqliteTable(
  "seam_steps",
  {
    metric: text("metric").notNull(),
    seamDay: text("seam_day").notNull(),
    kind: text("kind").notNull(),
    value: real("value").notNull(),
    nOld: integer("n_old").notNull(),
    nNew: integer("n_new").notNull(),
  },
  (t) => [primaryKey({ columns: [t.metric, t.seamDay] })],
);
