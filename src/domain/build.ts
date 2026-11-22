import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Build identity (B-R5). Server-only: `web/src/` never imports this module, because
 * the web tsconfig has no Bun/Node types. The wire shape is `HealthDTO` in api.ts.
 */

export interface BuildInfo {
  version: string;
  revision: string;
}

/** Shown when neither the environment nor package.json names a version/revision. */
export const BUILD_FALLBACK = "dev";

/** A 40-char lowercase/uppercase hex SHA, optionally followed by `-dirty`. */
const FULL_REVISION = /^([0-9a-f]{7})[0-9a-f]{33}(-dirty)?$/i;

let cached: BuildInfo | null = null;

/** Reads the trimmed `version` from the repo's package.json, or null when unavailable. */
function packageVersion(): string | null {
  try {
    const raw = readFileSync(join(import.meta.dir, "..", "..", "package.json"), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const version = (parsed as { version?: unknown }).version;
    if (typeof version !== "string") return null;
    const trimmed = version.trim();
    return trimmed === "" ? null : trimmed;
  } catch {
    // A missing or unreadable package.json is not fatal; "dev" is the fallback.
    return null;
  }
}

/** B-R5: trimmed MIDORI_VERSION, then package.json `version`, then "dev". */
export function resolveVersion(env: NodeJS.ProcessEnv = process.env): string {
  const raw = (env.MIDORI_VERSION ?? "").trim();
  return raw !== "" ? raw : (packageVersion() ?? BUILD_FALLBACK);
}

/**
 * B-R5: trims MIDORI_REVISION and shortens a full 40-char hex SHA to 7 chars while
 * preserving a `-dirty` suffix. Anything else is passed through; empty becomes "dev".
 */
export function resolveRevision(env: NodeJS.ProcessEnv = process.env): string {
  const trimmed = (env.MIDORI_REVISION ?? "").trim();
  if (trimmed === "") return BUILD_FALLBACK;
  const match = FULL_REVISION.exec(trimmed);
  return match ? `${match[1]}${match[2] ?? ""}` : trimmed;
}

export function getBuildInfo(env: NodeJS.ProcessEnv = process.env): BuildInfo {
  if (env === process.env && cached) return cached;
  const info: BuildInfo = { version: resolveVersion(env), revision: resolveRevision(env) };
  if (env === process.env) cached = info;
  return info;
}
