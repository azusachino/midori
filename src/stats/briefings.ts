import type { Database } from "bun:sqlite";
import type { BriefingDTO } from "../domain/api";
import { METRICS } from "../domain/metrics";
import { isCalendarDay, validateAuthorName } from "./notes";

/**
 * Agent briefings (B-B1–B-B2): dated, evidence-cited analysis cards an agent publishes
 * over MCP `save_briefing`. They render on Changes and are dismissed by the owner with
 * `DELETE /api/briefings/:id`. derive() and imports never clear or modify them, and a
 * briefing never asserts a cause (B-F9).
 */

export const BRIEFING_LIMIT_DEFAULT = 10;
export const BRIEFING_LIMIT_MAX = 50;

export const BRIEFING_TITLE_MAX_LENGTH = 120;
export const BRIEFING_SUMMARY_MAX_LENGTH = 4000;
export const BRIEFING_MAX_CITED_NIGHTS = 30;
export const BRIEFING_MAX_CITED_METRICS = 20;

const KNOWN_METRICS = new Set(Object.keys(METRICS));

export interface BriefingFields {
  asOfDay: string;
  title: string;
  summary: string;
  citedNights: string[];
  citedMetrics: string[];
  authorName: string;
}

export type BriefingValidation = { ok: true; value: BriefingFields } | { ok: false; error: string };

/** B-B1/B-A6: `limit` must be an integer 1..50. */
export function isValidBriefingLimit(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= BRIEFING_LIMIT_MAX
  );
}

function hasOwn(input: object, key: string): boolean {
  return Object.hasOwn(input, key);
}

function stringList(
  raw: unknown,
  key: string,
  max: number,
  isValid: (value: unknown) => boolean,
  describe: string,
): { ok: true; value: string[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, error: `${key} must be an array` };
  if (raw.length > max) return { ok: false, error: `${key} must contain at most ${max} entries` };
  const value: string[] = [];
  for (const item of raw) {
    if (!isValid(item)) return { ok: false, error: `${key} entries must be ${describe}` };
    value.push(item as string);
  }
  return { ok: true, value };
}

/**
 * B-B1: validates a briefing body. `asOfDay` must be a real calendar day, `title` and
 * `summary` are trimmed and bounded, `authorName` is required here (MCP defaults it to
 * `"agent"`), and the optional citation lists are bounded and validated.
 */
export function validateBriefingFields(input: unknown): BriefingValidation {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, error: "briefing body must be an object" };
  }
  const body = input as Record<string, unknown>;

  if (!isCalendarDay(body.asOfDay)) return { ok: false, error: "asOfDay must be a calendar date" };

  if (typeof body.title !== "string") return { ok: false, error: "title is required" };
  const title = body.title.trim();
  if (title.length < 1 || title.length > BRIEFING_TITLE_MAX_LENGTH) {
    return { ok: false, error: `title must be 1–${BRIEFING_TITLE_MAX_LENGTH} characters` };
  }

  if (typeof body.summary !== "string") return { ok: false, error: "summary is required" };
  const summary = body.summary.trim();
  if (summary.length < 1 || summary.length > BRIEFING_SUMMARY_MAX_LENGTH) {
    return { ok: false, error: `summary must be 1–${BRIEFING_SUMMARY_MAX_LENGTH} characters` };
  }

  if (!hasOwn(body, "authorName") || body.authorName === null || body.authorName === undefined) {
    return { ok: false, error: "authorName is required" };
  }
  const authorName = validateAuthorName(body.authorName);
  if (!authorName.ok) return { ok: false, error: authorName.error };

  const citedNights = stringList(
    body.citedNights,
    "citedNights",
    BRIEFING_MAX_CITED_NIGHTS,
    isCalendarDay,
    "calendar dates",
  );
  if (!citedNights.ok) return { ok: false, error: citedNights.error };

  const citedMetrics = stringList(
    body.citedMetrics,
    "citedMetrics",
    BRIEFING_MAX_CITED_METRICS,
    (value) => typeof value === "string" && KNOWN_METRICS.has(value),
    "known metric keys",
  );
  if (!citedMetrics.ok) return { ok: false, error: citedMetrics.error };

  return {
    ok: true,
    value: {
      asOfDay: body.asOfDay,
      title,
      summary,
      citedNights: citedNights.value,
      citedMetrics: citedMetrics.value,
      authorName: authorName.value,
    },
  };
}

type BriefingRow = {
  id: number;
  asof_day: string;
  title: string;
  summary: string;
  cited_nights_json: string;
  cited_metrics_json: string;
  author_name: string;
  created_at: string;
};

function parseStringList(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [];
  } catch {
    return [];
  }
}

function toDto(row: BriefingRow): BriefingDTO {
  return {
    id: row.id,
    asOfDay: row.asof_day,
    title: row.title,
    summary: row.summary,
    citedNights: parseStringList(row.cited_nights_json),
    citedMetrics: parseStringList(row.cited_metrics_json),
    authorName: row.author_name,
    createdAt: row.created_at,
  };
}

/** B-B1: newest-first briefings, at most `limit`. */
export function listBriefings(db: Database, limit: number = BRIEFING_LIMIT_DEFAULT): BriefingDTO[] {
  return (
    db
      .query("SELECT * FROM briefings ORDER BY created_at DESC, id DESC LIMIT ?")
      .all(limit) as BriefingRow[]
  ).map(toDto);
}

/** B-B1: the newest briefing, or null when none was published. */
export function latestBriefing(db: Database): BriefingDTO | null {
  const row = db
    .query("SELECT * FROM briefings ORDER BY created_at DESC, id DESC LIMIT 1")
    .get() as BriefingRow | null;
  return row ? toDto(row) : null;
}

export function getBriefing(db: Database, id: number): BriefingDTO | null {
  const row = db.query("SELECT * FROM briefings WHERE id = ?").get(id) as BriefingRow | null;
  return row ? toDto(row) : null;
}

/** B-B1: inserts a briefing row and returns its DTO. */
export function createBriefing(db: Database, value: BriefingFields): BriefingDTO {
  db.run(
    `INSERT INTO briefings
       (asof_day, title, summary, cited_nights_json, cited_metrics_json, author_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      value.asOfDay,
      value.title,
      value.summary,
      JSON.stringify(value.citedNights),
      JSON.stringify(value.citedMetrics),
      value.authorName,
      new Date().toISOString(),
    ],
  );
  const id = Number((db.query("SELECT last_insert_rowid() AS id").get() as { id: number }).id);
  const row = db.query("SELECT * FROM briefings WHERE id = ?").get(id) as BriefingRow;
  return toDto(row);
}

/** B-B1: deletes one briefing; false when the id does not exist. */
export function deleteBriefing(db: Database, id: number): boolean {
  return db.run("DELETE FROM briefings WHERE id = ?", [id]).changes > 0;
}
