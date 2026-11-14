import type { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(import.meta.dir, "..", "..", "migrations");

function migrationFiles(dir: string): Array<{ version: number; name: string; sql: string }> {
  const files = readdirSync(dir)
    .filter((f) => /^\d{4}.*\.sql$/.test(f))
    .sort();
  return files.map((name, i) => {
    const version = Number.parseInt(name.slice(0, 4), 10);
    if (Number.isNaN(version) || version !== i + 1) {
      throw new Error(`migration ${name}: expected sequence number ${i + 1}`);
    }
    return { version, name, sql: readFileSync(join(dir, name), "utf8") };
  });
}

/**
 * Apply pending migrations in order. Each file runs in its own transaction and
 * bumps PRAGMA user_version to the file's sequence number; already-applied files
 * are skipped, so re-running is a no-op. Returns the names applied this call.
 */
export function applyMigrations(db: Database, dir = MIGRATIONS_DIR): string[] {
  const current = Number(
    (db.query("PRAGMA user_version").get() as { user_version: number }).user_version,
  );
  const applied: string[] = [];
  for (const m of migrationFiles(dir)) {
    if (m.version <= current) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.exec(`PRAGMA user_version = ${m.version}`);
    })();
    applied.push(m.name);
  }
  return applied;
}
