-- Persistent owner profile/context for agent advice (B-P1–B-P2).
-- Singleton row (id = 1); never cleared or modified by derive() or imports.
CREATE TABLE profile_context (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  goals TEXT NOT NULL DEFAULT '',
  routine TEXT NOT NULL DEFAULT '',
  medical_context TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
