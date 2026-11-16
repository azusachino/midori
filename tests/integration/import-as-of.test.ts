import { afterAll, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { buildE2eCorpusXml } from "../../scripts/e2e/corpus";
import { openDb } from "../../src/db/db";
import { listImports } from "../../src/http/queries";
import { runImport } from "../../src/ingest/import";
import { buildStoredZip } from "../util/mkzip";

const workdir = join(import.meta.dir, "..", "..", ".tmp-import-as-of-test");
afterAll(() => rmSync(workdir, { recursive: true, force: true }));

test("an import keeps the as-of day it produced after newer data arrives", async () => {
  rmSync(workdir, { recursive: true, force: true });
  const dbPath = join(workdir, "midori.db");
  const zipPath = join(workdir, "export.zip");
  await Bun.write(
    zipPath,
    buildStoredZip([{ name: "apple_health_export/export.xml", data: buildE2eCorpusXml() }]),
  );
  openDb(dbPath).close();
  const summary = await runImport(dbPath, zipPath);
  expect(summary.asOfDay).not.toBeNull();

  const db = openDb(dbPath);
  try {
    expect(listImports(db)[0]?.asOfDay).toBe(summary.asOfDay);
    // A later usable night (as a newer import would add) must not rewrite the old row.
    db.run(
      `INSERT INTO metric_values (metric, epoch_id, unit_day, unit_kind, value, n, usable)
       SELECT metric, epoch_id, '2099-01-01', unit_kind, value, n, 1
       FROM metric_values WHERE metric = 'sleep_h' AND usable = 1 LIMIT 1`,
    );
    expect(listImports(db)[0]?.asOfDay).toBe(summary.asOfDay);
  } finally {
    db.close();
  }
});
