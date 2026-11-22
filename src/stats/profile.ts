import type { Database } from "bun:sqlite";
import type { ProfileContextDTO } from "../domain/api";

/**
 * Owner profile/agent context (B-P1–B-P2). `profile_context` is a singleton row
 * (`id = 1`) the owner edits from the UI; derive() and imports never clear or
 * modify it, and the text is context for an agent — never a diagnosis.
 */

/** Longest accepted field value after trimming. */
export const PROFILE_FIELD_MAX_LENGTH = 1000;

export interface ProfileFields {
  goals: string;
  routine: string;
  medicalContext: string;
}

export type ProfileValidation = { ok: true; value: ProfileFields } | { ok: false; error: string };

const FIELD_KEYS = ["goals", "routine", "medicalContext"] as const;

type ProfileRow = {
  goals: string;
  routine: string;
  medical_context: string;
  updated_at: string;
};

function toDto(row: ProfileRow): ProfileContextDTO {
  return {
    goals: row.goals,
    routine: row.routine,
    medicalContext: row.medical_context,
    updatedAt: row.updated_at,
  };
}

/** B-P1: the singleton row, or empty strings and `updatedAt: null` when it is absent. */
export function getProfileContext(db: Database): ProfileContextDTO {
  const row = db
    .query("SELECT goals, routine, medical_context, updated_at FROM profile_context WHERE id = 1")
    .get() as ProfileRow | null;
  return row ? toDto(row) : { goals: "", routine: "", medicalContext: "", updatedAt: null };
}

/**
 * B-P1: accepts an object with `goals`, `routine`, `medicalContext` as strings whose
 * trimmed length is 0..1000 (`""` clears a field). Values are stored trimmed.
 */
export function validateProfileFields(input: unknown): ProfileValidation {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, error: "profile body must be an object" };
  }
  const body = input as Record<string, unknown>;
  const value = {} as ProfileFields;
  for (const key of FIELD_KEYS) {
    const raw = body[key];
    if (typeof raw !== "string") return { ok: false, error: `${key} must be a string` };
    const trimmed = raw.trim();
    if (trimmed.length > PROFILE_FIELD_MAX_LENGTH) {
      return {
        ok: false,
        error: `${key} must be at most ${PROFILE_FIELD_MAX_LENGTH} characters`,
      };
    }
    value[key] = trimmed;
  }
  return { ok: true, value };
}

/** B-P1: upserts the singleton row and returns the stored context. */
export function saveProfileContext(db: Database, value: ProfileFields): ProfileContextDTO {
  db.run(
    `INSERT INTO profile_context (id, goals, routine, medical_context, updated_at)
     VALUES (1, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       goals = excluded.goals,
       routine = excluded.routine,
       medical_context = excluded.medical_context,
       updated_at = excluded.updated_at`,
    [value.goals, value.routine, value.medicalContext, new Date().toISOString()],
  );
  return getProfileContext(db);
}
