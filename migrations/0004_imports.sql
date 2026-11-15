-- Persist import lifecycle details and allow the atomic derived-data phase.
PRAGMA defer_foreign_keys = ON;

CREATE TABLE imports_v4 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  zip_name TEXT NOT NULL,
  zip_size INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','unpacking','parsing','storing','deriving','done','failed')),
  stage TEXT,
  progress INTEGER CHECK (progress IS NULL OR progress >= 0),
  error TEXT,
  export_version TEXT,
  export_date TEXT,
  older_than_stored INTEGER CHECK (older_than_stored IS NULL OR older_than_stored IN (0,1)),
  records_seen INTEGER,
  records_inserted INTEGER,
  records_deduped INTEGER,
  duration_ms INTEGER
);

INSERT INTO imports_v4 (
  id, created_at, zip_name, zip_size, status, error, export_version,
  records_seen, records_inserted, records_deduped, duration_ms
)
SELECT id, created_at, zip_name, zip_size, status, error, export_version,
       records_seen, records_inserted, records_deduped, duration_ms
FROM imports;

DROP TABLE imports;
ALTER TABLE imports_v4 RENAME TO imports;
