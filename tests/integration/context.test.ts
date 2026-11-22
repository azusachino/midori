import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyMigrations } from "../../src/db/db";
import { createApp } from "../../src/http/routes";

const databases: Database[] = [];
const dirs: string[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeApp(readOnly = false) {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.prepare(
    `INSERT INTO imports (created_at, zip_name, zip_size, status)
     VALUES ('2026-11-15T00:00:00Z', 'synthetic.zip', 1, 'done')`,
  ).run();
  databases.push(db);
  if (readOnly) return createApp({ db });
  const dir = mkdtempSync(join(tmpdir(), "midori-context-"));
  dirs.push(dir);
  return createApp({
    db,
    upload: {
      dbPath: join(dir, "midori.db"),
      archiveDir: join(dir, "archive"),
      spoolDir: join(dir, "spool"),
      backupDir: join(dir, "backups"),
    },
  });
}

const putProfile = (app: ReturnType<typeof makeApp>, body: unknown) =>
  app.request("/api/profile", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("B-R5 GET /api/health", () => {
  test("returns ok plus version and revision", async () => {
    const response = await makeApp().request("/api/health");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; version: string; revision: string };
    expect(body.ok).toBe(true);
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(body.revision.length).toBeGreaterThan(0);
  });
});

describe("B-P1 profile context REST", () => {
  test("GET defaults to empty strings and updatedAt null", async () => {
    const response = await makeApp().request("/api/profile");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      goals: "",
      routine: "",
      medicalContext: "",
      updatedAt: null,
    });
  });

  test("PUT stores trimmed fields and clears them with empty strings", async () => {
    const app = makeApp();
    const saved = await putProfile(app, {
      goals: "  Sleep 7.5 h ",
      routine: "Lift Mon/Wed/Fri",
      medicalContext: "  ",
    });
    expect(saved.status).toBe(200);
    const body = (await saved.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      goals: "Sleep 7.5 h",
      routine: "Lift Mon/Wed/Fri",
      medicalContext: "",
    });
    expect(typeof body.updatedAt).toBe("string");

    await putProfile(app, { goals: "", routine: "", medicalContext: "" });
    expect(await (await app.request("/api/profile")).json()).toMatchObject({
      goals: "",
      routine: "",
      medicalContext: "",
    });
  });

  test("PUT rejects non-object bodies and bad fields with 400 retryable false", async () => {
    const app = makeApp();
    for (const body of ["not json", "null", "[]", "42"]) {
      const response = await putProfile(app, body);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ retryable: false });
    }
    const missing = await putProfile(app, { goals: "", routine: "" });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ retryable: false });
    const oversized = await putProfile(app, {
      goals: "x".repeat(1001),
      routine: "",
      medicalContext: "",
    });
    expect(oversized.status).toBe(400);
  });

  test("PUT answers 405 profile is read-only when upload is not mounted", async () => {
    const response = await putProfile(makeApp(true), {
      goals: "a",
      routine: "b",
      medicalContext: "c",
    });
    expect(response.status).toBe(405);
    expect(await response.json()).toEqual({ error: "profile is read-only", retryable: false });
  });
});

describe("B-A5 GET /api/context", () => {
  test("returns the dossier shape with defaults and a trimmed night window", async () => {
    const app = makeApp();
    const response = await app.request("/api/context");
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      asOfDay: null,
      findings: [],
      recentNights: [],
      sinceLastImport: null,
      guidance: expect.stringContaining("midori does not assert causes"),
      profile: { goals: "", routine: "", medicalContext: "", updatedAt: null },
      summary: { standsOut: 0, closeToEdge: 0, within: 0, other: 0, sharedConfounders: [] },
    });

    const week = await app.request("/api/context?days=7");
    expect(week.status).toBe(200);
  });

  test("rejects days outside 7..30 or non-numeric with 400 retryable false", async () => {
    const app = makeApp();
    for (const days of ["6", "31", "abc", "1.5", "0"]) {
      const response = await app.request(`/api/context?days=${days}`);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "days must be an integer between 7 and 30",
        retryable: false,
      });
    }
  });
});
