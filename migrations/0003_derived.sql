-- Replace v0 caches with the v1 derived model. Raw imports and records are retained.
DROP TABLE daily_metrics;
DROP TABLE device_events;
DROP TABLE findings;

CREATE TABLE epochs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_name TEXT NOT NULL,
  device_hw TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('watch','phone','app','other')),
  first_day TEXT NOT NULL,
  last_day TEXT NOT NULL,
  days_present INTEGER NOT NULL CHECK (days_present >= 1),
  UNIQUE (source_name, device_hw)
);

CREATE TABLE epoch_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  epoch_id INTEGER NOT NULL REFERENCES epochs(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('os_update')),
  detail TEXT NOT NULL
);
CREATE INDEX ix_epoch_events_epoch_day ON epoch_events(epoch_id, day);

CREATE TABLE stints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  metric TEXT NOT NULL,
  epoch_id INTEGER NOT NULL REFERENCES epochs(id) ON DELETE CASCADE,
  start_day TEXT NOT NULL,
  end_day TEXT
);
CREATE INDEX ix_stints_metric_start ON stints(metric, start_day);

CREATE TABLE nights (
  date TEXT PRIMARY KEY,
  zone TEXT NOT NULL,
  tz_change INTEGER NOT NULL DEFAULT 0 CHECK (tz_change IN (0,1)),
  partial_reason TEXT,
  asleep_s REAL NOT NULL DEFAULT 0,
  core_s REAL NOT NULL DEFAULT 0,
  deep_s REAL NOT NULL DEFAULT 0,
  rem_s REAL NOT NULL DEFAULT 0,
  in_bed_s REAL NOT NULL DEFAULT 0
);

CREATE TABLE metric_values (
  metric TEXT NOT NULL,
  epoch_id INTEGER NOT NULL REFERENCES epochs(id) ON DELETE CASCADE,
  unit_day TEXT NOT NULL,
  unit_kind TEXT NOT NULL CHECK (unit_kind IN ('night','day')),
  value REAL NOT NULL,
  n INTEGER NOT NULL,
  usable INTEGER NOT NULL CHECK (usable IN (0,1)),
  PRIMARY KEY (metric, epoch_id, unit_day)
);
CREATE INDEX ix_metric_values_epoch_day ON metric_values(epoch_id, unit_day);

CREATE TABLE findings (
  metric TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  z REAL,
  severity TEXT,
  confidence TEXT,
  onset_day TEXT,
  onset_open INTEGER CHECK (onset_open IS NULL OR onset_open IN (0,1)),
  recent REAL,
  baseline REAL,
  k_outside INTEGER,
  checks_json TEXT NOT NULL DEFAULT '[]',
  asof_day TEXT NOT NULL,
  stint_id INTEGER REFERENCES stints(id)
);

CREATE TABLE seam_steps (
  metric TEXT NOT NULL,
  seam_day TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('offset','step')),
  value REAL NOT NULL,
  n_old INTEGER NOT NULL,
  n_new INTEGER NOT NULL,
  PRIMARY KEY (metric, seam_day)
);
