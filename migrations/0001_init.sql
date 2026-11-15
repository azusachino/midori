-- midori initial schema (T2).
-- Idempotent: guarded with IF NOT EXISTS; the runner tracks applied count via PRAGMA user_version.

CREATE TABLE IF NOT EXISTS imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,                -- UTC ISO 8601
  zip_name TEXT NOT NULL,
  zip_size INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','unpacking','parsing','storing','done','failed')),
  error TEXT,
  export_version TEXT,                     -- HealthKit Export Version from export.xml
  records_seen INTEGER,
  records_inserted INTEGER,
  records_deduped INTEGER,
  duration_ms INTEGER
);

CREATE TABLE IF NOT EXISTS sources (
  name TEXT PRIMARY KEY,                   -- sourceName attribute, verbatim
  first_seen_at TEXT NOT NULL,             -- min(start_at) UTC
  last_seen_at TEXT NOT NULL,              -- max(end_at) UTC
  record_count INTEGER NOT NULL DEFAULT 0,
  last_import_id INTEGER NOT NULL REFERENCES imports(id)
);

CREATE TABLE IF NOT EXISTS records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,                      -- HK type identifier, verbatim
  source_name TEXT NOT NULL,
  unit TEXT,                               -- unit attribute (quantity records); NULL for category
  start_at TEXT NOT NULL,                  -- UTC ISO 8601, fixed-width sortable
  end_at TEXT NOT NULL,                    -- UTC ISO 8601
  start_offset_min INTEGER,                -- original local UTC offset in minutes (e.g. +540)
  end_offset_min INTEGER,
  value REAL,                              -- quantity value; 60 and 60.0 normalize to the same REAL
  value_str TEXT,                          -- category value (e.g. HKCategoryValueSleepAnalysisAsleepCore)
  import_id INTEGER NOT NULL REFERENCES imports(id)
);

-- Dedup key: (type, source_name, start_at, end_at, effective value).
-- coalesce(value, value_str, '<NULL>') pins the two edge behaviors:
--   * records with no value at all collapse to the sentinel -> exact duplicates are rejected
--   * quantity values ride REAL affinity -> 60 === 60.0
CREATE UNIQUE INDEX IF NOT EXISTS uq_records_dedup
  ON records(type, source_name, start_at, end_at, coalesce(value, value_str, '<NULL>'));

CREATE INDEX IF NOT EXISTS ix_records_type_source_start
  ON records(type, source_name, start_at);

CREATE TABLE IF NOT EXISTS daily_metrics (
  metric TEXT NOT NULL,                    -- short metric key, e.g. rhr, hrv_sdnn, wrist_temp
  source_name TEXT NOT NULL,
  day TEXT NOT NULL,                       -- record-local calendar date 'YYYY-MM-DD'
  method TEXT NOT NULL CHECK (method IN ('median','sum')),
  unit TEXT,
  value REAL NOT NULL,
  sample_count INTEGER NOT NULL,
  computed_at TEXT NOT NULL,
  import_id INTEGER NOT NULL REFERENCES imports(id),
  PRIMARY KEY (metric, source_name, day)
);

CREATE TABLE IF NOT EXISTS device_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('first_seen','last_seen','switch')),
  source_name TEXT NOT NULL,
  metric TEXT,                             -- switch events carry the metric; first/last_seen are global
  occurred_on TEXT NOT NULL,               -- local calendar date 'YYYY-MM-DD'
  details TEXT,                            -- JSON blob (e.g. counterpart source, overlap span)
  import_id INTEGER NOT NULL REFERENCES imports(id)
);
-- NULL metric must still dedup: coalesce to '' so metric-less events stay unique per day.
CREATE UNIQUE INDEX IF NOT EXISTS uq_device_events
  ON device_events(kind, source_name, coalesce(metric, ''), occurred_on);

CREATE TABLE IF NOT EXISTS findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_id INTEGER NOT NULL REFERENCES imports(id),
  anchor_day TEXT NOT NULL,                -- analysis anchor (last data day), local date
  kind TEXT NOT NULL CHECK (kind IN ('deviation','recalibration','coverage')),
  metric TEXT NOT NULL,
  source_name TEXT NOT NULL,
  window_days INTEGER NOT NULL,
  baseline REAL,                           -- NULL allowed for coverage findings
  recent REAL,
  unit TEXT,
  z REAL,                                  -- NULL for recalibration/coverage findings
  severity TEXT NOT NULL CHECK (severity IN ('within','notable','alert')),
  evidence TEXT NOT NULL,                  -- JSON array of EvidenceRef (src/domain)
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_findings_import ON findings(import_id);
