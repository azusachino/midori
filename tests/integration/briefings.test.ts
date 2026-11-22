import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyMigrations } from "../../src/db/db";
import { createApp } from "../../src/http/routes";
import { derive } from "../../src/stats/derive";

const dirs: string[] = [];
const databases: Database[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeApp(readOnly = false) {
  const db = new Database(":memory:");
  applyMigrations(db);
  databases.push(db);
  const dir = mkdtempSync(join(tmpdir(), "midori-briefings-"));
  dirs.push(dir);
  return createApp({
    db,
    ...(readOnly
      ? {}
      : {
          upload: {
            dbPath: join(dir, "midori.db"),
            archiveDir: join(dir, "archive"),
            spoolDir: join(dir, "spool"),
            backupDir: join(dir, "backups"),
          },
        }),
  });
}

const body = {
  asOfDay: "2026-02-14",
  title: " HRV below usual ",
  summary: "Citing Feb 8–14: HRV lower than usual. A watch change overlaps this window.",
  citedNights: ["2026-02-08", "2026-02-14"],
  citedMetrics: ["hrv_sdnn"],
  authorName: "luna",
};

function jsonRequest(method: string, payload: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  };
}

describe("briefings REST (B-B1–B-B2)", () => {
  test("B-B1 POST validates and creates a briefing, GET returns it newest first", async () => {
    const app = makeApp();
    const res = await app.request("/api/briefings", jsonRequest("POST", body));
    expect(res.status).toBe(201);
    const created = (await res.json()) as Record<string, unknown>;
    expect(created).toMatchObject({
      asOfDay: "2026-02-14",
      title: "HRV below usual",
      summary: "Citing Feb 8–14: HRV lower than usual. A watch change overlaps this window.",
      citedNights: ["2026-02-08", "2026-02-14"],
      citedMetrics: ["hrv_sdnn"],
      authorName: "luna",
    });
    expect(typeof created.createdAt).toBe("string");

    for (const invalid of [
      { ...body, asOfDay: "2026-02-30" },
      { ...body, title: "   " },
      { ...body, summary: "  " },
      { ...body, authorName: "   " },
      { ...body, citedNights: ["2026-02-30"] },
      { ...body, citedMetrics: ["not_a_metric"] },
    ]) {
      const bad = await app.request("/api/briefings", jsonRequest("POST", invalid));
      expect(bad.status).toBe(400);
      const error = (await bad.json()) as { error: string; retryable: boolean };
      expect(typeof error.error).toBe("string");
      expect(error.retryable).toBe(false);
    }

    await app.request(
      "/api/briefings",
      jsonRequest("POST", { ...body, title: "Sleep steady", citedMetrics: ["sleep_h"] }),
    );
    const list = (await (await app.request("/api/briefings")).json()) as {
      briefings: Array<{ title: string }>;
    };
    expect(list.briefings.map((b) => b.title)).toEqual(["Sleep steady", "HRV below usual"]);

    const limited = (await (await app.request("/api/briefings?limit=1")).json()) as {
      briefings: Array<{ title: string }>;
    };
    expect(limited.briefings.map((b) => b.title)).toEqual(["Sleep steady"]);
  });

  test("B-B1 GET rejects an invalid limit", async () => {
    const app = makeApp();
    for (const limit of ["0", "51", "2.5", "abc"]) {
      const res = await app.request(`/api/briefings?limit=${limit}`);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { retryable: boolean }).retryable).toBe(false);
    }
    expect((await app.request("/api/briefings?limit=50")).status).toBe(200);
    expect((await app.request("/api/briefings?limit=")).status).toBe(200);
  });

  test("B-B1 DELETE dismisses a briefing and reports a missing id", async () => {
    const app = makeApp();
    const created = (await (
      await app.request("/api/briefings", jsonRequest("POST", body))
    ).json()) as { id: number };
    const deleted = await app.request(`/api/briefings/${created.id}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ deleted: true });
    const again = await app.request(`/api/briefings/${created.id}`, { method: "DELETE" });
    expect(again.status).toBe(404);
    const missing = await app.request("/api/briefings/999", { method: "DELETE" });
    expect(missing.status).toBe(404);
  });

  test("B-B1 read-only mode answers 405 for mutations and still serves the list", async () => {
    const app = makeApp(true);
    const post = await app.request("/api/briefings", jsonRequest("POST", body));
    expect(post.status).toBe(405);
    expect(await post.json()).toEqual({ error: "briefings are read-only", retryable: false });
    const del = await app.request("/api/briefings/1", { method: "DELETE" });
    expect(del.status).toBe(405);
    expect(await del.json()).toEqual({ error: "briefings are read-only", retryable: false });
    const list = await app.request("/api/briefings");
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual({ briefings: [] });
  });

  test("B-B1 Changes and /api/context carry the newest briefing", async () => {
    const app = makeApp();
    expect(
      ((await (await app.request("/api/changes")).json()) as { latestBriefing: unknown })
        .latestBriefing,
    ).toBeNull();

    await app.request("/api/briefings", jsonRequest("POST", body));
    const changes = (await (await app.request("/api/changes")).json()) as {
      latestBriefing: { title: string; citedMetrics: string[] } | null;
    };
    expect(changes.latestBriefing).toMatchObject({
      title: "HRV below usual",
      citedMetrics: ["hrv_sdnn"],
    });

    const dossier = (await (await app.request("/api/context?days=7")).json()) as {
      latestBriefing: { title: string } | null;
    };
    expect(dossier.latestBriefing).toMatchObject({ title: "HRV below usual" });
  });

  test("B-B2 imports and derive never clear briefings", async () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    databases.push(db);
    db.run(
      `INSERT INTO briefings (asof_day, title, summary, cited_nights_json, cited_metrics_json, author_name, created_at)
       VALUES ('2026-02-14', 'kept', 's', '[]', '[]', 'luna', '2026-02-14T00:00:00Z')`,
    );
    derive(db);
    const app = createApp({ db });
    const list = (await (await app.request("/api/briefings")).json()) as {
      briefings: Array<{ title: string }>;
    };
    expect(list.briefings.map((b) => b.title)).toEqual(["kept"]);
    expect(db.query("SELECT COUNT(*) AS count FROM briefings").get()).toEqual({ count: 1 });
  });
});
