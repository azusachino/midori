import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { applyMigrations } from "../db/db";
import { derive } from "./derive";
import {
  getProfileContext,
  PROFILE_FIELD_MAX_LENGTH,
  saveProfileContext,
  validateProfileFields,
} from "./profile";

function makeDb(): Database {
  const db = new Database(":memory:");
  applyMigrations(db);
  return db;
}

describe("B-P1 profile context", () => {
  test("defaults to empty strings and updatedAt null when the singleton row is absent", () => {
    const db = makeDb();
    expect(getProfileContext(db)).toEqual({
      goals: "",
      routine: "",
      medicalContext: "",
      updatedAt: null,
    });
    db.close();
  });

  test("upserts the singleton row and never creates a second", () => {
    const db = makeDb();
    const first = saveProfileContext(db, {
      goals: "Sleep 7.5 h",
      routine: "Lift on Mon/Wed/Fri",
      medicalContext: "None recorded",
    });
    expect(first).toMatchObject({
      goals: "Sleep 7.5 h",
      routine: "Lift on Mon/Wed/Fri",
      medicalContext: "None recorded",
    });
    expect(first.updatedAt).not.toBeNull();
    saveProfileContext(db, { goals: "Walk daily", routine: "", medicalContext: "" });
    expect(getProfileContext(db)).toMatchObject({
      goals: "Walk daily",
      routine: "",
      medicalContext: "",
    });
    expect(db.query("SELECT COUNT(*) count FROM profile_context").get()).toEqual({ count: 1 });
    db.close();
  });

  test("rejects non-object bodies, missing/non-string fields and oversized values", () => {
    for (const body of [null, [], "text", 42]) {
      expect(validateProfileFields(body)).toEqual({
        ok: false,
        error: "profile body must be an object",
      });
    }
    expect(validateProfileFields({ goals: "", routine: "" })).toEqual({
      ok: false,
      error: "medicalContext must be a string",
    });
    expect(validateProfileFields({ goals: 1, routine: "", medicalContext: "" })).toEqual({
      ok: false,
      error: "goals must be a string",
    });
    const oversized = validateProfileFields({
      goals: "x".repeat(PROFILE_FIELD_MAX_LENGTH + 1),
      routine: "",
      medicalContext: "",
    });
    expect(oversized.ok).toBe(false);
    if (!oversized.ok) expect(oversized.error).toContain("at most");
  });

  test("trims values and allows an empty string to clear a field", () => {
    const validation = validateProfileFields({
      goals: "  Sleep 7.5 h  ",
      routine: "   ",
      medicalContext: "none",
    });
    expect(validation).toEqual({
      ok: true,
      value: { goals: "Sleep 7.5 h", routine: "", medicalContext: "none" },
    });
  });
});

describe("B-P2 derive() never touches owner-authored context", () => {
  test("profile context and notes survive a full derive", () => {
    const db = makeDb();
    saveProfileContext(db, {
      goals: "Sleep 7.5 h",
      routine: "Lift Mon/Wed/Fri",
      medicalContext: "None recorded",
    });
    db.run(
      `INSERT INTO notes (start_day, end_day, category, label, created_at, updated_at)
       VALUES ('2026-03-02', '2026-03-03', 'travel', 'Trip', '2026-03-02T00:00:00Z', '2026-03-02T00:00:00Z')`,
    );
    derive(db);
    expect(getProfileContext(db)).toMatchObject({
      goals: "Sleep 7.5 h",
      routine: "Lift Mon/Wed/Fri",
      medicalContext: "None recorded",
    });
    expect(db.query("SELECT label FROM notes").all()).toEqual([{ label: "Trip" }]);
    db.close();
  });
});
