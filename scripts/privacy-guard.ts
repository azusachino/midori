/**
 * Tracked-file privacy guard: fails CI if anything resembling personal health data
 * is committed to this (public) repository.
 *
 * Checks every tracked file plus every untracked-but-visible file (gitignored paths
 * are already invisible to `--others --exclude-standard`).
 *
 * Run: bun scripts/privacy-guard.ts
 */

const PATTERNS: ReadonlyArray<{ re: RegExp; why: string }> = [
  { re: /(^|\/)export(_cda)?\.xml$/i, why: "Apple Health export XML" },
  { re: /(^|\/)export\.zip$/i, why: "Apple Health export archive" },
  { re: /apple_health_export\//i, why: "unpacked Apple Health export" },
  { re: /\.(db|sqlite)(-wal|-shm|-journal)?$/i, why: "SQLite database or sidecar" },
  { re: /(^|\/)backups\//i, why: "database backup artifacts" },
  { re: /(^|\/)archive\//i, why: "archived health exports" },
  { re: /(^|\/)electrocardiograms\//i, why: "ECG exports" },
  { re: /\.ecg$/i, why: "ECG export file" },
];

const proc = Bun.spawnSync(["git", "ls-files", "--cached", "--others", "--exclude-standard"], {
  stdout: "pipe",
  stderr: "inherit",
});

if (proc.exitCode !== 0) {
  console.error("privacy-guard: git ls-files failed");
  process.exit(2);
}

const files = new TextDecoder()
  .decode(proc.stdout)
  .split("\n")
  .filter((line) => line.length > 0);

const offenders = files.flatMap((file) => {
  const hit = PATTERNS.find(({ re }) => re.test(file));
  return hit ? [{ file, why: hit.why }] : [];
});

if (offenders.length > 0) {
  console.error("privacy-guard: refusing tracked personal-data files:");
  for (const { file, why } of offenders) {
    console.error(`  ${file}  (${why})`);
  }
  process.exit(1);
}

console.log(`privacy-guard: clean (${files.length} tracked/visible files checked)`);
