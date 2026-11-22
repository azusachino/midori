-- Auditable provenance on owner/agent notes (B-A7) and agent briefings (B-B1–B-B2).
-- Neither table is cleared or modified by derive() or imports.

ALTER TABLE notes ADD COLUMN author TEXT NOT NULL DEFAULT 'owner' CHECK (author IN ('owner', 'agent'));
ALTER TABLE notes ADD COLUMN author_name TEXT;

CREATE TABLE briefings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asof_day TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  cited_nights_json TEXT NOT NULL DEFAULT '[]',
  cited_metrics_json TEXT NOT NULL DEFAULT '[]',
  author_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_briefings_created ON briefings (created_at DESC, id DESC);
