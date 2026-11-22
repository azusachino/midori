import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { applyMigrations } from "./migrate";

export { applyMigrations };

export function openDb(path: string, opts: { readonly?: boolean } = {}): Database {
  // SQLite will not create missing parent directories (SQLITE_CANTOPEN on first run).
  if (!opts.readonly) mkdirSync(dirname(path), { recursive: true });
  const db = opts.readonly ? new Database(path, { readonly: true }) : new Database(path);
  if (!opts.readonly) {
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA synchronous = NORMAL");
    // Notes writes can land while the import worker holds the write lock; wait rather
    // than surfacing SQLITE_BUSY as a 500 to the owner.
    db.exec("PRAGMA busy_timeout = 10000");
    applyMigrations(db);
  }
  return db;
}
