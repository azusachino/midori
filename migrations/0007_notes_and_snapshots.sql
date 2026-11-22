-- Own notes as confounders (B-U1–B-U4, B-C7) and per-import finding snapshots for the
-- import-to-import diff (B-I13, B-F15). Notes are owner-authored and never touched by derive().

CREATE TABLE notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  start_day TEXT NOT NULL,
  end_day TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('illness', 'travel', 'alcohol', 'medication', 'stress', 'other')),
  label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (end_day >= start_day)
);
CREATE INDEX idx_notes_range ON notes (start_day, end_day);

CREATE TABLE finding_snapshots (
  import_id INTEGER NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  metric TEXT NOT NULL,
  state TEXT NOT NULL,
  z REAL,
  severity TEXT,
  direction TEXT,
  confidence TEXT,
  asof_day TEXT NOT NULL,
  PRIMARY KEY (import_id, metric)
);
CREATE INDEX idx_finding_snapshots_asof ON finding_snapshots (asof_day, import_id);

-- Backfill the latest done import on upgraded v1 databases so the first v2 import has a
-- baseline to diff against. direction mirrors src/stats/findings.ts.
INSERT OR IGNORE INTO finding_snapshots (import_id, metric, state, z, severity, direction, confidence, asof_day)
SELECT
  (SELECT MAX(id) FROM imports WHERE status = 'done'),
  metric,
  state,
  z,
  severity,
  CASE
    WHEN state != 'computed' OR z IS NULL THEN NULL
    WHEN severity = 'within' THEN 'within'
    WHEN z > 0 THEN 'higher'
    ELSE 'lower'
  END,
  confidence,
  asof_day
FROM findings
WHERE (SELECT MAX(id) FROM imports WHERE status = 'done') IS NOT NULL;
