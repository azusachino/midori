import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { applyMigrations } from "../../src/db/db";
import { createApp } from "../../src/http/routes";

const databases: Database[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function app() {
  const db = new Database(":memory:");
  applyMigrations(db);
  db.prepare(
    `INSERT INTO imports (created_at, zip_name, zip_size, status)
     VALUES ('2026-11-15T00:00:00Z', 'synthetic.zip', 1, 'done')`,
  ).run();
  databases.push(db);
  return createApp({ db });
}

describe("read API during the derived-schema transition", () => {
  test("v0 derived read endpoints are explicitly unavailable", async () => {
    for (const path of [
      "/api/sources",
      "/api/findings",
      "/api/briefing",
      "/api/deviations",
      "/api/metrics/wrist_temp/daily",
    ]) {
      const response = await app().request(path);
      expect(response.status).toBe(501);
      expect(await response.json()).toMatchObject({ retryable: false });
    }
  });

  test("import history remains readable", async () => {
    const response = await app().request("/api/imports");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject([{ zipName: "synthetic.zip", status: "done" }]);
  });
});
