import { Database } from "bun:sqlite";
import { applyMigrations } from "./migrate";

export { applyMigrations };

export function openDb(path: string): Database {
  const db = new Database(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA synchronous = NORMAL");
  applyMigrations(db);
  return db;
}
