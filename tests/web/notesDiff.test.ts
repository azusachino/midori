import { describe, expect, test } from "bun:test";
import { createApiClient } from "../../web/src/api/client";
import type { FindingsDiffDTO, NoteDTO } from "../../web/src/api/types";
import { formatDiffFooter, formatDiffItem, formatDiffItems } from "../../web/src/lib/diff";
import { clampNotesToAxis } from "../../web/src/lib/metric-chart";

const note = (overrides: Partial<NoteDTO>): NoteDTO => ({
  id: 1,
  startDay: "2026-02-10",
  endDay: "2026-02-10",
  category: "travel",
  label: "trip",
  createdAt: "2026-02-10T00:00:00Z",
  updatedAt: "2026-02-10T00:00:00Z",
  author: "owner",
  authorName: null,
  ...overrides,
});

const days = ["2026-02-01", "2026-02-02", "2026-02-03", "2026-02-04", "2026-02-05"];

describe("clampNotesToAxis", () => {
  test("clamps notes that span before or after the visible axis", () => {
    const bands = clampNotesToAxis(
      [
        note({ id: 1, startDay: "2026-01-20", endDay: "2026-02-03", label: "before" }),
        note({ id: 2, startDay: "2026-02-04", endDay: "2026-03-01", label: "after" }),
        note({ id: 3, startDay: "2026-02-02", endDay: "2026-02-02", label: "inside" }),
      ],
      days,
    );
    expect(bands).toEqual([
      expect.objectContaining({ id: 1, startIndex: 0, endIndex: 2, startDay: "2026-02-01" }),
      expect.objectContaining({ id: 3, startIndex: 1, endIndex: 1 }),
      expect.objectContaining({ id: 2, startIndex: 3, endIndex: 4, endDay: "2026-02-05" }),
    ]);
  });

  test("drops notes entirely outside the axis and handles an empty axis", () => {
    expect(
      clampNotesToAxis([note({ startDay: "2026-03-01", endDay: "2026-03-02" })], days),
    ).toEqual([]);
    expect(clampNotesToAxis([note({})], [])).toEqual([]);
  });

  test("snaps weekly axes through axisDay", () => {
    const weeks = ["2026-02-02", "2026-02-09", "2026-02-16"];
    const bands = clampNotesToAxis(
      [note({ startDay: "2026-02-05", endDay: "2026-02-11" })],
      weeks,
      (day) => {
        const ms = Date.parse(`${day}T00:00:00Z`);
        const offset = (new Date(ms).getUTCDay() + 6) % 7;
        return new Date(ms - offset * 86_400_000).toISOString().slice(0, 10);
      },
    );
    expect(bands).toEqual([expect.objectContaining({ startIndex: 0, endIndex: 1 })]);
  });
});

const diff: FindingsDiffDTO = {
  fromImportId: 1,
  toImportId: 2,
  fromAsOfDay: "2026-02-07",
  toAsOfDay: "2026-02-14",
  unchangedCount: 2,
  items: [
    {
      metric: "hrv_sdnn",
      kind: "overnight",
      classification: "newly_notable",
      previous: {
        state: "computed",
        severity: "within",
        direction: "within",
        z: 0.4,
        confidence: "high",
      },
      current: {
        state: "computed",
        severity: "notable",
        direction: "lower",
        z: 1.8,
        confidence: "high",
      },
    },
    {
      metric: "steps",
      kind: "daytime",
      classification: "returned_to_usual",
      previous: {
        state: "computed",
        severity: "alert",
        direction: "higher",
        z: 2.8,
        confidence: "high",
      },
      current: {
        state: "computed",
        severity: "within",
        direction: "within",
        z: 0.3,
        confidence: "high",
      },
    },
  ],
};

describe("diff copy", () => {
  test("renders neutral classification lines and the unchanged footer", () => {
    expect(formatDiffItem(diff.items[0] as FindingsDiffDTO["items"][number])).toBe(
      "HRV (SDNN): newly notable",
    );
    expect(formatDiffItems(diff)).toEqual([
      "HRV (SDNN): newly notable",
      "Steps: returned to usual",
    ]);
    expect(formatDiffFooter(diff)).toBe("2 metrics unchanged");
    expect(formatDiffFooter({ ...diff, unchangedCount: 0 })).toBeNull();
  });
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("notes and diff API client", () => {
  test("requests notes CRUD, list filters, and the import diff endpoints", async () => {
    const seen: Array<{ url: string; method: string; body: string | null }> = [];
    const client = createApiClient({
      fetch: (async (url: string, init?: RequestInit) => {
        seen.push({
          url,
          method: init?.method ?? "GET",
          body: typeof init?.body === "string" ? init.body : null,
        });
        if (url.startsWith("/api/imports/")) return json({ diff: null });
        if (init?.method === "DELETE") return json({ deleted: true });
        if (url.startsWith("/api/notes") && (init?.method === undefined || init.method === "GET"))
          return json({ notes: [note({})] });
        if (init?.method === "POST" || init?.method === "PATCH") return json(note({ id: 4 }));
        return json({ notes: [] });
      }) as never,
    });

    expect(await client.notes({ from: "2026-02-01", to: "2026-02-28" })).toHaveLength(1);
    await client.createNote({
      startDay: "2026-02-10",
      endDay: "2026-02-12",
      category: "travel",
      label: "trip",
    });
    await client.updateNote(4, { label: "trip home" });
    await client.deleteNote(4);
    expect(await client.importDiff(2)).toBeNull();

    expect(seen).toEqual([
      { url: "/api/notes?from=2026-02-01&to=2026-02-28", method: "GET", body: null },
      {
        url: "/api/notes",
        method: "POST",
        body: JSON.stringify({
          startDay: "2026-02-10",
          endDay: "2026-02-12",
          category: "travel",
          label: "trip",
        }),
      },
      { url: "/api/notes/4", method: "PATCH", body: JSON.stringify({ label: "trip home" }) },
      { url: "/api/notes/4", method: "DELETE", body: null },
      { url: "/api/imports/2/diff", method: "GET", body: null },
    ]);
  });

  test("notes list without bounds omits the query string", async () => {
    let seen = "";
    const client = createApiClient({
      fetch: (async (url: string) => {
        seen = url;
        return json({ notes: [] });
      }) as never,
    });
    expect(await client.notes()).toEqual([]);
    expect(seen).toBe("/api/notes");
  });
});
