import { integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
  error: text("error"),
  exportVersion: text("export_version"),
  recordsSeen: integer("records_seen"),
  recordsInserted: integer("records_inserted"),
  recordsDeduped: integer("records_deduped"),
  durationMs: integer("duration_ms"),
  exportDate: text("export_date"),
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

export const dailyMetrics = sqliteTable(
  "daily_metrics",
  {
    metric: text("metric").notNull(),
    sourceName: text("source_name").notNull(),
    day: text("day").notNull(),
    method: text("method").notNull(),
    unit: text("unit"),
    value: real("value").notNull(),
    sampleCount: integer("sample_count").notNull(),
    computedAt: text("computed_at").notNull(),
    importId: integer("import_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.metric, t.sourceName, t.day] })],
);

export const deviceEvents = sqliteTable("device_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").notNull(),
  sourceName: text("source_name").notNull(),
  metric: text("metric"),
  occurredOn: text("occurred_on").notNull(),
  details: text("details"),
  importId: integer("import_id").notNull(),
});

export const findings = sqliteTable("findings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  importId: integer("import_id").notNull(),
  anchorDay: text("anchor_day").notNull(),
  kind: text("kind").notNull(),
  metric: text("metric").notNull(),
  sourceName: text("source_name").notNull(),
  windowDays: integer("window_days").notNull(),
  baseline: real("baseline"),
  recent: real("recent"),
  unit: text("unit"),
  z: real("z"),
  severity: text("severity").notNull(),
  evidence: text("evidence").notNull(),
  createdAt: text("created_at").notNull(),
});
