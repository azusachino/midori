import type { Database } from "bun:sqlite";
import type { NoteCategory, NoteDTO } from "../domain/api";

/**
 * Owner notes as confounders (B-U1–B-U4, B-C7). Notes are owner-authored rows: derive()
 * and imports never clear or modify them, and reads never assert a cause (B-F9).
 */

export const NOTE_CATEGORIES: readonly NoteCategory[] = [
  "illness",
  "travel",
  "alcohol",
  "medication",
  "stress",
  "other",
];

const MAX_LABEL_LENGTH = 140;

export interface NoteFields {
  startDay: string;
  endDay: string;
  category: NoteCategory;
  label: string;
}

export type NoteValidation = { ok: true; value: NoteFields } | { ok: false; error: string };

/** A real calendar day (`YYYY-MM-DD`), validated by a UTC round-trip. */
export function isCalendarDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

function isNoteCategory(value: unknown): value is NoteCategory {
  return typeof value === "string" && (NOTE_CATEGORIES as readonly string[]).includes(value);
}

function hasOwn(input: object, key: string): boolean {
  return Object.hasOwn(input, key);
}

/**
 * Validates a create body, or a patch merged over the existing row (B-U1/B-U2).
 * Impossible calendar dates, inverted ranges, bad categories and blank/oversized labels
 * are rejected with a neutral message.
 */
export function validateNoteFields(input: unknown, existing?: NoteFields): NoteValidation {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, error: "note body must be an object" };
  }
  const body = input as Record<string, unknown>;
  const startRaw = hasOwn(body, "startDay") ? body.startDay : existing?.startDay;
  const endRaw = hasOwn(body, "endDay") ? body.endDay : existing?.endDay;
  const categoryRaw = hasOwn(body, "category") ? body.category : existing?.category;
  const labelRaw = hasOwn(body, "label") ? body.label : existing?.label;

  if (!isCalendarDay(startRaw)) return { ok: false, error: "startDay must be a calendar date" };
  const endDay = endRaw === undefined || endRaw === null ? startRaw : endRaw;
  if (!isCalendarDay(endDay)) return { ok: false, error: "endDay must be a calendar date" };
  if (endDay < startRaw) return { ok: false, error: "endDay must be on or after startDay" };
  if (!isNoteCategory(categoryRaw))
    return { ok: false, error: `category must be one of: ${NOTE_CATEGORIES.join(", ")}` };
  if (typeof labelRaw !== "string") return { ok: false, error: "label is required" };
  const label = labelRaw.trim();
  if (label.length < 1 || label.length > MAX_LABEL_LENGTH)
    return { ok: false, error: `label must be 1–${MAX_LABEL_LENGTH} characters` };

  return {
    ok: true,
    value: { startDay: startRaw, endDay, category: categoryRaw, label },
  };
}

type NoteRow = {
  id: number;
  start_day: string;
  end_day: string;
  category: string;
  label: string;
  created_at: string;
  updated_at: string;
};

function toDto(row: NoteRow): NoteDTO {
  return {
    id: row.id,
    startDay: row.start_day,
    endDay: row.end_day,
    category: row.category as NoteCategory,
    label: row.label,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Notes overlapping `[from, to]` (inclusive), or all notes when bounds are omitted. */
export function listNotes(db: Database, from?: string | null, to?: string | null): NoteDTO[] {
  const clauses: string[] = [];
  const params: string[] = [];
  if (from !== undefined && from !== null && from !== "") {
    clauses.push("end_day >= ?");
    params.push(from);
  }
  if (to !== undefined && to !== null && to !== "") {
    clauses.push("start_day <= ?");
    params.push(to);
  }
  const where = clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
  return (
    db
      .query(`SELECT * FROM notes${where} ORDER BY start_day DESC, id DESC`)
      .all(...params) as NoteRow[]
  ).map(toDto);
}

export function getNote(db: Database, id: number): NoteDTO | null {
  const row = db.query("SELECT * FROM notes WHERE id = ?").get(id) as NoteRow | null;
  return row ? toDto(row) : null;
}

export function createNote(db: Database, value: NoteFields): NoteDTO {
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO notes (start_day, end_day, category, label, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [value.startDay, value.endDay, value.category, value.label, now, now],
  );
  const id = Number((db.query("SELECT last_insert_rowid() AS id").get() as { id: number }).id);
  const row = db.query("SELECT * FROM notes WHERE id = ?").get(id) as NoteRow;
  return toDto(row);
}

export function updateNote(db: Database, id: number, value: NoteFields): NoteDTO {
  db.run(
    `UPDATE notes SET start_day = ?, end_day = ?, category = ?, label = ?, updated_at = ?
     WHERE id = ?`,
    [value.startDay, value.endDay, value.category, value.label, new Date().toISOString(), id],
  );
  const row = db.query("SELECT * FROM notes WHERE id = ?").get(id) as NoteRow;
  return toDto(row);
}

export function deleteNote(db: Database, id: number): boolean {
  const result = db.run("DELETE FROM notes WHERE id = ?", [id]);
  return result.changes > 0;
}

export function noteFields(note: NoteDTO): NoteFields {
  return {
    startDay: note.startDay,
    endDay: note.endDay,
    category: note.category,
    label: note.label,
  };
}

export interface UserNoteCheck {
  flagged: boolean;
  day?: string;
  count?: number;
}

/**
 * B-C7: flag `user_note` when at least one note overlaps the clamped recent window.
 * `day` is `MAX(note.start_day, oldestRecentDay)` for the latest overlapping note, so
 * ChecksPanel always links inside `[oldestRecentDay, newestRecentDay]`.
 */
export function userNoteCheck(
  db: Database,
  oldestRecentDay: string | null,
  newestRecentDay: string | null,
): UserNoteCheck {
  if (!oldestRecentDay || !newestRecentDay) return { flagged: false };
  const rows = db
    .query(
      `SELECT start_day, end_day FROM notes
       WHERE start_day <= ? AND end_day >= ?
       ORDER BY start_day DESC, id DESC`,
    )
    .all(newestRecentDay, oldestRecentDay) as Array<{ start_day: string; end_day: string }>;
  if (rows.length === 0) return { flagged: false };
  const latest = rows[0];
  if (!latest) return { flagged: false };
  const day = latest.start_day > oldestRecentDay ? latest.start_day : oldestRecentDay;
  return { flagged: true, day, count: rows.length };
}
