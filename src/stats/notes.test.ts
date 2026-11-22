import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { applyMigrations } from "../db/db";
import { derive } from "./derive";
import {
  createNote,
  deleteNote,
  getNote,
  isCalendarDay,
  listNotes,
  noteFields,
  updateNote,
  userNoteCheck,
  validateAuthorName,
  validateNoteFields,
} from "./notes";

function makeDb(): Database {
  const db = new Database(":memory:");
  applyMigrations(db);
  return db;
}

const valid = {
  startDay: "2026-02-10",
  category: "travel" as const,
  label: "  long flight  ",
};

describe("note validation (B-U1/B-U2)", () => {
  test("B-U1 accepts a real calendar date and defaults endDay to startDay", () => {
    const result = validateNoteFields(valid);
    expect(result).toEqual({
      ok: true,
      value: {
        startDay: "2026-02-10",
        endDay: "2026-02-10",
        category: "travel",
        label: "long flight",
      },
    });
  });

  test("B-U1 rejects impossible dates, inverted ranges, bad categories and blank labels", () => {
    expect(validateNoteFields({ ...valid, startDay: "2026-02-30" })).toEqual({
      ok: false,
      error: "startDay must be a calendar date",
    });
    expect(validateNoteFields({ ...valid, startDay: "2026-2-10" }).ok).toBe(false);
    expect(validateNoteFields({ ...valid, endDay: "2026-02-09" })).toEqual({
      ok: false,
      error: "endDay must be on or after startDay",
    });
    expect(validateNoteFields({ ...valid, endDay: "2026-02-30" })).toEqual({
      ok: false,
      error: "endDay must be a calendar date",
    });
    expect(validateNoteFields({ ...valid, category: "work" }).ok).toBe(false);
    expect(validateNoteFields({ ...valid, label: "   " }).ok).toBe(false);
    expect(validateNoteFields({ ...valid, label: "x".repeat(141) }).ok).toBe(false);
    expect(validateNoteFields({ ...valid, label: "x".repeat(140) }).ok).toBe(true);
    expect(validateNoteFields(null).ok).toBe(false);
    expect(validateNoteFields([]).ok).toBe(false);
  });

  test("isCalendarDay round-trips UTC dates", () => {
    expect(isCalendarDay("2024-02-29")).toBe(true);
    expect(isCalendarDay("2025-02-29")).toBe(false);
    expect(isCalendarDay("2026-13-01")).toBe(false);
    expect(isCalendarDay("2026-02-10T00:00:00Z")).toBe(false);
  });

  test("B-U2 merges a partial patch over the existing row before validating", () => {
    const existing = {
      startDay: "2026-02-10",
      endDay: "2026-02-12",
      category: "travel" as const,
      label: "trip",
    };
    expect(validateNoteFields({ label: "trip home" }, existing)).toEqual({
      ok: true,
      value: { ...existing, label: "trip home" },
    });
    expect(validateNoteFields({ startDay: "2026-02-13" }, existing)).toEqual({
      ok: false,
      error: "endDay must be on or after startDay",
    });
    expect(validateNoteFields({ endDay: "2026-02-09" }, existing)).toEqual({
      ok: false,
      error: "endDay must be on or after startDay",
    });
  });
});

describe("note persistence (B-U2–B-U4)", () => {
  test("create, patch, read and delete a note", () => {
    const db = makeDb();
    const created = createNote(db, {
      startDay: "2026-02-10",
      endDay: "2026-02-12",
      category: "travel",
      label: "trip",
    });
    expect(created).toMatchObject({
      startDay: "2026-02-10",
      endDay: "2026-02-12",
      category: "travel",
    });
    expect(created.id).toBeGreaterThan(0);

    const updated = updateNote(db, created.id, {
      ...noteFields(created),
      endDay: "2026-02-14",
      label: "trip home",
    });
    expect(updated).toMatchObject({ endDay: "2026-02-14", label: "trip home" });
    expect(getNote(db, created.id)?.label).toBe("trip home");

    expect(deleteNote(db, created.id)).toBe(true);
    expect(getNote(db, created.id)).toBeNull();
    expect(deleteNote(db, created.id)).toBe(false);
    db.close();
  });

  test("B-U4 lists overlapping notes by start_day DESC, id DESC and filters by range", () => {
    const db = makeDb();
    createNote(db, {
      startDay: "2026-02-01",
      endDay: "2026-02-10",
      category: "illness",
      label: "flu",
    });
    createNote(db, {
      startDay: "2026-02-05",
      endDay: "2026-02-05",
      category: "alcohol",
      label: "party",
    });
    createNote(db, {
      startDay: "2026-03-01",
      endDay: "2026-03-02",
      category: "stress",
      label: "work",
    });

    expect(listNotes(db).map((note) => note.label)).toEqual(["work", "party", "flu"]);
    expect(listNotes(db, "2026-02-04", "2026-02-06").map((note) => note.label)).toEqual([
      "party",
      "flu",
    ]);
    expect(listNotes(db, "2026-02-11", "2026-02-28")).toEqual([]);
    expect(listNotes(db, undefined, "2026-02-05").map((note) => note.label)).toEqual([
      "party",
      "flu",
    ]);
    db.close();
  });

  test("B-U3 derive never clears or modifies notes", () => {
    const db = makeDb();
    const note = createNote(db, {
      startDay: "2026-02-10",
      endDay: "2026-02-12",
      category: "stress",
      label: "busy",
    });
    derive(db);
    expect(getNote(db, note.id)).toEqual(note);
    db.close();
  });

  test("B-A7 provenance defaults to owner and agent writes record their name", () => {
    const db = makeDb();
    const owner = createNote(db, {
      startDay: "2026-02-10",
      endDay: "2026-02-10",
      category: "travel",
      label: "trip",
    });
    expect(owner).toMatchObject({ author: "owner", authorName: null });

    const agent = createNote(
      db,
      { startDay: "2026-02-11", endDay: "2026-02-11", category: "stress", label: "deadline" },
      { author: "agent", authorName: "luna" },
    );
    expect(agent).toMatchObject({ author: "agent", authorName: "luna" });
    expect(listNotes(db).map((note) => note.author)).toEqual(["agent", "owner"]);

    // An owner REST edit keeps the stored provenance when it is omitted.
    const restEdit = updateNote(db, agent.id, { ...noteFields(agent), label: "deadline moved" });
    expect(restEdit).toMatchObject({ author: "agent", authorName: "luna" });

    // An agent write updates it when supplied.
    const agentEdit = updateNote(db, agent.id, noteFields(agent), {
      author: "agent",
      authorName: "pi",
    });
    expect(agentEdit).toMatchObject({ author: "agent", authorName: "pi" });
    db.close();
  });

  test("B-A7 validateAuthorName defaults to agent and bounds the trimmed name", () => {
    expect(validateAuthorName(undefined)).toEqual({ ok: true, value: "agent" });
    expect(validateAuthorName(null)).toEqual({ ok: true, value: "agent" });
    expect(validateAuthorName("  luna ")).toEqual({ ok: true, value: "luna" });
    expect(validateAuthorName("x".repeat(64)).ok).toBe(true);
    expect(validateAuthorName("x".repeat(65)).ok).toBe(false);
    expect(validateAuthorName("   ").ok).toBe(false);
    expect(validateAuthorName(7).ok).toBe(false);
  });
});

describe("B-C7 user-note overlap", () => {
  test("returns clear with no window or no overlap", () => {
    const db = makeDb();
    expect(userNoteCheck(db, null, null)).toEqual({ flagged: false });
    createNote(db, { startDay: "2026-01-01", endDay: "2026-01-02", category: "other", label: "x" });
    expect(userNoteCheck(db, "2026-02-01", "2026-02-07")).toEqual({ flagged: false });
    db.close();
  });

  test("counts notes overlapping the clamped window and clamps the linked day", () => {
    const db = makeDb();
    createNote(db, {
      startDay: "2026-01-20",
      endDay: "2026-02-03",
      category: "travel",
      label: "a",
    });
    createNote(db, {
      startDay: "2026-02-05",
      endDay: "2026-02-09",
      category: "stress",
      label: "b",
    });
    createNote(db, { startDay: "2026-02-10", endDay: "2026-02-10", category: "other", label: "c" });
    expect(userNoteCheck(db, "2026-02-01", "2026-02-07")).toEqual({
      flagged: true,
      day: "2026-02-05",
      count: 2,
    });
    expect(userNoteCheck(db, "2026-02-06", "2026-02-08")).toEqual({
      flagged: true,
      day: "2026-02-06",
      count: 1,
    });
    db.close();
  });
});
