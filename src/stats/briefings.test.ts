import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { applyMigrations } from "../db/db";
import {
  BRIEFING_LIMIT_DEFAULT,
  BRIEFING_LIMIT_MAX,
  createBriefing,
  deleteBriefing,
  getBriefing,
  isValidBriefingLimit,
  latestBriefing,
  listBriefings,
  validateBriefingFields,
} from "./briefings";
import { derive } from "./derive";

function makeDb(): Database {
  const db = new Database(":memory:");
  applyMigrations(db);
  return db;
}

const valid = {
  asOfDay: "2026-02-14",
  title: "  HRV below usual  ",
  summary: "  Citing Feb 8–14: HRV lower than usual, note the watch change. ",
  citedNights: ["2026-02-08", "2026-02-14"],
  citedMetrics: ["hrv_sdnn"],
  authorName: "  luna ",
};

describe("briefing validation (B-B1)", () => {
  test("B-B1 accepts a well-formed briefing and trims the text fields", () => {
    expect(validateBriefingFields(valid)).toEqual({
      ok: true,
      value: {
        asOfDay: "2026-02-14",
        title: "HRV below usual",
        summary: "Citing Feb 8–14: HRV lower than usual, note the watch change.",
        citedNights: ["2026-02-08", "2026-02-14"],
        citedMetrics: ["hrv_sdnn"],
        authorName: "luna",
      },
    });
  });

  test("B-B1 defaults the citation lists to empty arrays", () => {
    const result = validateBriefingFields({
      asOfDay: "2026-02-14",
      title: "Title",
      summary: "Summary",
      authorName: "luna",
    });
    expect(result).toEqual({
      ok: true,
      value: {
        asOfDay: "2026-02-14",
        title: "Title",
        summary: "Summary",
        citedNights: [],
        citedMetrics: [],
        authorName: "luna",
      },
    });
  });

  test("B-B1 rejects impossible dates, blank or oversized text, and bad author names", () => {
    expect(validateBriefingFields({ ...valid, asOfDay: "2026-02-30" })).toEqual({
      ok: false,
      error: "asOfDay must be a calendar date",
    });
    expect(validateBriefingFields({ ...valid, title: "   " })).toEqual({
      ok: false,
      error: "title must be 1–120 characters",
    });
    expect(validateBriefingFields({ ...valid, title: "x".repeat(121) }).ok).toBe(false);
    expect(validateBriefingFields({ ...valid, title: "x".repeat(120) }).ok).toBe(true);
    expect(validateBriefingFields({ ...valid, summary: "  " })).toEqual({
      ok: false,
      error: "summary must be 1–4000 characters",
    });
    expect(validateBriefingFields({ ...valid, summary: "x".repeat(4001) }).ok).toBe(false);
    expect(validateBriefingFields({ ...valid, authorName: undefined })).toEqual({
      ok: false,
      error: "authorName is required",
    });
    expect(validateBriefingFields({ ...valid, authorName: "   " }).ok).toBe(false);
    expect(validateBriefingFields({ ...valid, authorName: "x".repeat(65) }).ok).toBe(false);
    expect(validateBriefingFields(null).ok).toBe(false);
    expect(validateBriefingFields([]).ok).toBe(false);
  });

  test("B-B1 bounds and validates the citation lists", () => {
    expect(validateBriefingFields({ ...valid, citedNights: ["2026-02-30"] })).toEqual({
      ok: false,
      error: "citedNights entries must be calendar dates",
    });
    expect(
      validateBriefingFields({
        ...valid,
        citedNights: Array.from({ length: 31 }, (_, i) =>
          new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10),
        ),
      }),
    ).toEqual({ ok: false, error: "citedNights must contain at most 30 entries" });
    expect(validateBriefingFields({ ...valid, citedMetrics: ["not_a_metric"] })).toEqual({
      ok: false,
      error: "citedMetrics entries must be known metric keys",
    });
    expect(
      validateBriefingFields({
        ...valid,
        citedMetrics: Array.from({ length: 21 }, () => "sleep_h"),
      }),
    ).toEqual({ ok: false, error: "citedMetrics must contain at most 20 entries" });
    expect(validateBriefingFields({ ...valid, citedNights: "2026-02-14" }).ok).toBe(false);
  });

  test("B-A6 limit must be an integer 1..50", () => {
    expect(isValidBriefingLimit(1)).toBe(true);
    expect(isValidBriefingLimit(BRIEFING_LIMIT_MAX)).toBe(true);
    expect(isValidBriefingLimit(BRIEFING_LIMIT_DEFAULT)).toBe(true);
    expect(isValidBriefingLimit(0)).toBe(false);
    expect(isValidBriefingLimit(51)).toBe(false);
    expect(isValidBriefingLimit(2.5)).toBe(false);
    expect(isValidBriefingLimit(Number.NaN)).toBe(false);
    expect(isValidBriefingLimit("10")).toBe(false);
  });
});

describe("briefing persistence (B-B1, B-B2)", () => {
  test("B-B1 creates, reads newest-first, and deletes briefings", () => {
    const db = makeDb();
    const first = validateBriefingFields(valid);
    if (!first.ok) throw new Error(first.error);
    const created = createBriefing(db, first.value);
    expect(created).toMatchObject({
      asOfDay: "2026-02-14",
      title: "HRV below usual",
      citedNights: ["2026-02-08", "2026-02-14"],
      citedMetrics: ["hrv_sdnn"],
      authorName: "luna",
    });
    expect(created.id).toBeGreaterThan(0);
    expect(getBriefing(db, created.id)).toEqual(created);

    const second = createBriefing(db, {
      ...first.value,
      title: "Sleep steady",
      citedNights: [],
      citedMetrics: ["sleep_h"],
    });
    expect(listBriefings(db).map((b) => b.title)).toEqual(["Sleep steady", "HRV below usual"]);
    expect(listBriefings(db, 1).map((b) => b.title)).toEqual(["Sleep steady"]);
    expect(latestBriefing(db)?.id).toBe(second.id);

    expect(deleteBriefing(db, created.id)).toBe(true);
    expect(getBriefing(db, created.id)).toBeNull();
    expect(deleteBriefing(db, created.id)).toBe(false);
    expect(latestBriefing(db)?.id).toBe(second.id);
    db.close();
  });

  test("B-B1 order breaks createdAt ties by descending id", () => {
    const db = makeDb();
    db.run(
      `INSERT INTO briefings (asof_day, title, summary, cited_nights_json, cited_metrics_json, author_name, created_at)
       VALUES ('2026-02-14', 'older', 's', '[]', '[]', 'luna', '2026-02-14T00:00:00Z'),
              ('2026-02-14', 'newer', 's', '[]', '[]', 'luna', '2026-02-14T00:00:00Z')`,
    );
    expect(listBriefings(db).map((b) => b.title)).toEqual(["newer", "older"]);
    expect(latestBriefing(db)?.title).toBe("newer");
    db.close();
  });

  test("B-B2 derive never clears or modifies briefings", () => {
    const db = makeDb();
    const value = validateBriefingFields(valid);
    if (!value.ok) throw new Error(value.error);
    const briefing = createBriefing(db, value.value);
    derive(db);
    expect(listBriefings(db)).toEqual([briefing]);
    db.close();
  });
});
