# midori v0 — Task List

Source: `tasks/plan.md` rev 2.1 (commit ae99b4b, independently reviewed and approved —
`docs/reviews/2026-11-14-plan-review-pi-kimi.md`). Acceptance criteria below are written
**before any implementation begins**. Check a task only when every acceptance bullet is met and
its verification command/result is recorded here.

Execution model (owner, 2026-11-14): implementation runs alongside pi worker sessions on
haiku/deepseek. Tasks marked **[lead]** (contracts, stats semantics, cross-repo ship) stay with
the lead; the rest are delegable to workers under the assignment-brief format. One writer per
checkout per task; parallel tracks must not touch the same files.

**Gates**: OQ1 (SAX/ZIP runtime deps — owner decision) must be resolved before Task 5. Real-data
checks (T8, Checkpoint 2/3/4 evidence, T25 rollout) are owner-witnessed, never CI.

## Phase 1 — Foundation, contracts & ingest

### Task 1 — Scaffold + CI + privacy guard [delegable]

Bun + TS strict project skeleton with CI that can never see real data.

- AC:
  - [x] `bun run check` = typecheck + biome + tests, all green on empty suite
  - [x] `bun test` runs; README pins dev commands (check/test/import/dev)
  - [x] `.gitignore`: `data/`, `*.db`, `*.db-wal`, `*.db-shm`, zips
  - [x] CI on push: `bun install` → typecheck → `bun test` → tracked-file privacy guard
  - [x] Privacy guard rejects tracked files matching pinned patterns and fails loudly with the
    offending path — verified: staged fake `export.zip` → exit 1 naming the file; clean after
    removal. (biome config migrated to `preset: recommended`.)
- Verify: commit a fake `export.zip` → guard fails locally and in CI; remove it → green.
- Deps: —. Files: package.json, tsconfig.json, biome.json, .gitignore, .github/workflows/ci.yml,
  scripts/privacy-guard.*. Scope: S

### Task 2 — SQLite schema + migrations [lead-adjacent]

All six tables per design; offsets persisted; dedup key behavior defined.

- AC:
  - [x] Tables: imports, sources, records, daily_metrics, findings, device_events
  - [x] records: value + unit + type + source_name + start_at/end_at UTC **and** original local
    offset columns
  - [x] Dedup unique key on (type, source_name, start_at, end_at, value) with NULL-value and
    numeric-equivalence (60 vs 60.0) behavior pinned by migration-level test
  - [x] device_events.kind ∈ {first_seen, last_seen, switch}
  - [x] WAL mode on init; migrations idempotent on re-run
- Verify: `bun test src/db` green incl. dedup-edge test. DONE (9 tests; SQL migrations are the
  source of truth tracked via PRAGMA user_version, drizzle-orm typed mirror guarded by a
  column-set test).
- Deps: T1. Files: src/db/schema.ts, drizzle config, migrations/. Scope: M

### Task 3 — Fixture builders [delegable]

Synthetic corpora that pin every edge the real export taught us.

- AC:
  - [x] Builder emits export.xml (~50 records): multi-source, ±timezone offsets, sleep stages,
    night HR samples, one unknown record type, malformed-edge dates
  - [x] Boundary corpus: records at 14:59/15:00, 08:59/09:00, 21:00, cross-midnight stages
  - [x] Spike-regression fixture: two sources of wrist temp, baseline window on source A,
    recent window on source B
  - [x] Dedup corpus: NULL values, category records, equivalent numerics, exact ties
- Verify: fixtures render to valid XML; snapshot test locks their shape. DONE — built by pi
  worker (claude-haiku-5-5, t7x), lead-reviewed; 8 snapshots lock shape; suite also pins
  determinism, well-formedness checker, synthetic-source labels.
- Deps: T1. Files: tests/fixtures/ (builders + snapshots). Scope: M

### Task 4 — Pin module contracts [lead]

Tracked, unit-tested contracts in `src/domain/` before any consumer exists.

- AC:
  - [x] `Finding` + `EvidenceRef` types exactly per design (kind: deviation|recalibration|
    coverage; severity bands)
  - [x] Stats constants: baseline window anchor−90…anchor−29 **inclusive**; recent
    anchor−13…anchor; gates ≥15 baseline / ≥7 recent days; |z|≥1.5 notable, ≥2.5 alert
  - [x] Zero-MAD policy ported from spike `analyze.py:111-113`, unit-pinned (incl. flat
    baseline, MAD=0 with nonzero diff)
  - [x] Coverage-boundary algorithm signature + semantics (gap vs switch, ported from spike
    source-check logic)
  - [x] JSON API DTOs + upload-job DTOs (202 + id, status enum, error shape)
  - [x] Trust-label map per metric (steps/HR high, HRV moderate, energy low)
  - [x] Every item above has a failing-first unit test (written contract-first in the same
    commit; spike off-by-one −89..−29 fixed to the pinned −90..−29)
- Verify: `bun test src/domain` green; no consumer imports outside src/domain yet.
- Verify: `bun test src/domain` green; no consumer imports outside src/domain yet.
- Deps: T2, T3. Files: src/domain/*.ts + tests. Scope: M (split if >5 files)

### Task 5 — Streaming parser + mapper [delegable]

Zip → streaming XML → typed record rows. **Blocked by OQ1 (dep approval).**

- AC:
  - [x] Parses export.zip without materializing the 909 MB XML
  - [x] Record → row mapping exact; unknown types stored, not aggregated
  - [x] Workout/route/ECG presence logged per import (counts only, not parsed)
  - [x] All T3 fixture corpora parse to expected rows
- Verify: `bun test src/ingest/parser` green on all corpora. DONE — saxes streaming
  parse (records via callback, presence counts per tag, ExportDate + version comment
  captured); yauzl entry selection skips export_cda.xml; mapper pins unknown-type rows
  (null metric key) and malformed dates (counted, never repaired). 89 tests green.
- Deps: T4. Files: src/ingest/parser.ts, mapper.ts. Scope: M

### Task 6 — Transactional ingest store + CLI [lead-adjacent]

Batched, deduped, restartable import with the benchmark that picks the insert path.

- AC:
  - [x] Batched transactions; dedup on conflict (T2 behavior); import-run bookkeeping (counts,
    timings, status)
  - [x] sources table gains first/last-seen + record counts on import
  - [x] `bun run import <export.zip>` CLI end-to-end on fixtures
  - [x] In-task benchmark: scaled fixture ~2M rows; drizzle-vs-raw-`bun:sqlite` decision
    recorded here with numbers
- Verify: fixture import twice → 0 new rows second time; benchmark numbers in this file.
  DONE — benchmark (scripts/bench-insert.ts, bun 1.4.4, 2M synthetic rows, batch 10k,
  2026-11-14): drizzle pass1 15.4s / 129,880 rows/s (all-dup pass2 15.4s);
  raw bun:sqlite prepared stmt pass1 3.9s / 508,705 rows/s (all-dup 3.8s).
  DECISION: raw prepared statements for the insert hot path (~3.9x); drizzle stays
  the typed read layer. Real 2.05M-record export projects to ~4s insert.
- Deps: T2, T5. Files: src/ingest/store.ts, src/cli.ts. Scope: M

### Task 7 — Local backup + retention [delegable]

Own backups from day one, and prove they restore.

- AC:
  - [x] Post-import `VACUUM INTO` snapshot → `data/backups/`; WAL checkpoint before snapshot
  - [x] 30-day retention; imported zips → `data/archive/`
  - [x] `PRAGMA integrity_check` on snapshots
  - [x] Restore smoke: snapshot → readable db; stale `-wal`/`-shm` removed on restore
  - [x] Synthetic-clock retention test: expired deleted at cutoff boundary, newer preserved
- Verify: `bun test src/backup` green incl. clock test. DONE 2026-11-14 (deepseek worker + lead wiring:
  same-second re-backup allocates `-N` snapshot suffix instead of throwing; CLI wires backup →
  prune → archive on successful import, `--keep-zip` skips archival).
- Deps: T6. Files: src/backup/. Scope: S–M

### Task 8 — Real-export verification [lead, owner-witnessed]

The 66 MB proof. No CI. Owner watches.

- AC:
  - [x] Import <5 min (record actual); immediate re-import reports 0 new
  - [x] records total = 2,047,778; sources match spike counts (iWatch/Ultra/iPhone/NRC/あずさWatch)
  - [x] Post-import snapshot + zip archive created; integrity green
- Verify: numbers recorded here, owner-acknowledged. DONE 2026-11-15, owner-witnessed in session:
  first import 19.1s (22.5s wall incl. backup+archive), re-import 14.7s → inserted 0, deduped
  2,047,778; stored records 2,046,801; sources windows match spike (iWatch 2024-02-16→2026-10-10,
  Ultra from 2026-10-08T15:01Z = Oct 9 JST switch, iPhone→2026-11-07, NRC 2025-04-16 only,
  あずさWatch 2023-12-12→2024-02-18); per-source counts differ slightly from spike rg counts
  because spike matched sourceName in Workout elements too — Record totals agree exactly.
  Snapshots data/backups/midori-20261115-000457.db + -000725.db (741MB each, integrity ok);
  zip archived data/archive/export.zip. Two fixes landed during T8: openDb mkdirs parent dir
  (first-run SQLITE_CANTOPEN), import.test.ts archive/backup dirs now run-unique (UUID) to kill
  a cross-run residue flake.
- Deps: T7. Scope: S (session)

**Checkpoint 1** — real import loop proven: timings, idempotence, backup+restore smoke.

## Phase 2 — Stats engine

### Task 9 — Local-day + night assembly [delegable]

- AC:
  - [x] Day = record-local calendar day derived from UTC+offset (JST)
  - [x] Night rule: sleep start ≥15:00 → that date; <09:00 → previous date; else nap excluded
  - [x] Dominant-source stages per night incl. tie behavior
  - [x] Boundary corpus green (14:59/15:00, 08:59/09:00, 21:00, cross-midnight)
- Verify: `bun test src/stats/nights`. DONE 2026-11-14 (haiku worker; dominance = inBed+asleep
  seconds, awake excluded, ties → lexicographically smallest source; durations from UTC instants).
- Deps: T4. Files: src/stats/nights.ts. Scope: S–M

### Task 10 — Daily metrics [delegable]

- AC:
  - [x] Per (metric, source, day): median or sum method per contract; HRV 21:00–09:00 filter
  - [x] Sparse-series behavior pinned (missing days stay missing, no zero-fill)
- Verify: unit tests vs hand-computed fixture values. DONE by lead 2026-11-15:
  src/stats/daily.ts computeDailyMetrics (wholesale recompute per import, 1.0s / 14,420 rows
  on live 2M-record db; 13 metrics; night-only SQL filter; sleep family via assembleNights
  dominant source; JST day boundaries verified). Supporting: dates.ts utcToLocal (round-trip),
  nights.ts Night.sourceRecordCounts. Wired into runImport (storing phase — status CHECK has
  no 'analyzing'; not a user-visible state). 6 new tests in daily.test.ts.
- Deps: T9. Files: src/stats/daily.ts. Scope: M

### Task 11 — Baselines + z + trust [lead]

- AC:
  - [x] median+MAD baseline per T4 window (inclusive edges); robust z = (rec−base)/(1.4826·MAD)
  - [x] Gates, severity bands, zero-MAD, flat baseline — all per contract, tested
  - [x] Per-source anchor = last data day; as-of surfaced in every output
  - [x] Trust labels attached to every metric output
- Verify: `bun test src/stats/baselines`. DONE by lead 2026-11-15: src/stats/baselines.ts
  computeDeviations — one row per (metric, source) with any daily rows; composes T4
  robustZ/severityOf/baselineOffsets; insufficient_data when gates fail (only suppression
  kind here; cross_source/coverage_gap arrive in T12). Real-db readout: 49 rows, 24 computed,
  25 suppressed (Ultra has no baseline window yet), 9ms; top |z| = rhr +1.21 on iWatch tail —
  consistent with spike verdict. Per-source anchor differs from spike's global anchor by
  design (grilled Q9). 6 tests incl. flat-baseline alert + per-source anchor self-containment.
- Deps: T10. Files: src/stats/baselines.ts. Scope: M

### Task 12 — Device events + findings wiring [lead]

- AC:
  - [x] All three event kinds emitted; coverage-boundary detection per contract
  - [x] Cross-source z suppressed + recalibration finding at seams
  - [x] Findings recompute triggered by import completion (integration assertion)
  - [x] Spike regression: two-source wrist-temp swap → switch event + suppressed z, never +4σ
- Verify: spike-regression test green in CI. DONE by lead 2026-11-15: src/stats/events.ts
  (device_events ledger: first_seen/last_seen global from daily spans, switch per metric from
  detectBoundaries; INSERT OR IGNORE dedup, 43 events on live db) + src/stats/findings.ts
  (computeFindings: deviation findings severity≠info; seam suppression precedence switch→cross_source,
  gap→coverage_gap when boundary∈[anchor−90,anchor] involves the row's source; recalibration finding
  per switch boundary, coverage per series_start/gap; recomputeFindings wholesale DELETE+INSERT per
  import, wired into runImport after daily metrics). Live readout: 0 deviations (all |z|<1.5),
  29 recalibration + 8 coverage findings — full 3-year device history incl. WatchUltra takeover
  2026-10-10 on every metric and hrv_rmssd series_start. Tests: 8 in findings.test.ts — spike fixture
  (gap seam: B suppressed coverage_gap, no deviation finding, no |z|≥2.5) + abutting-seam corpus
  (switch event + recalibration finding + B cross_source, A's own z stands).
- Deps: T11, T6. Files: src/stats/events.ts, findings.ts. Scope: M

**Checkpoint 2** — on the real import: spike readout reproduced (wrist temp = recalibration
artifact; RHR/HRV/sleep/SpO2/resp within range). Owner session.

## Phase 3 — API + UI

### Task 13 — API contracts + read routes + integration test [lead-adjacent]

- AC:
  - [x] GET /api/imports, /api/briefing, /api/metrics/:metric/daily, /api/deviations?days=,
    /api/findings, /api/sources — DTOs from src/domain, as-of + trust in payloads
  - [x] Design-required integration test: fixture zip → db → briefing payload assertions,
    running in CI
- Verify: `bun test` incl. integration. DONE by lead 2026-11-15: src/http/routes.ts
  createApp({db}) — Hono read routes over domain DTOs; deviations computed live per request
  (~10ms real db) with days filter [1,365] on per-source asOf, ranking computed-|z|-desc then
  suppressed (deterministic tail); briefing = anchor + asOf-by-metric (freshest source per
  metric) + persisted findings ledger + sources + lastImport + cadence hint (>30d staleness);
  metric daily = per-source series asc with trust/trustNote/asOfDay from registry; unknown
  metric → 404 typed error, known-but-empty → 200 []. hono@4.13.18 (stack-approved).
  Integration test tests/integration/api.test.ts: spike zip → runImport → all 6 routes asserted
  (asOf per metric, coverage finding present, no wrist-temp z≥2.5, trust on every deviation row).
  Live check: re-import of archived zip populated findings ledger (37: 29 recal + 8 coverage)
  via the real pipeline; wrist_temp story: WatchUltra recal 2026-10-10, 3 per-source series.
- Deps: T12. Files: src/http/routes.ts, tests/integration/api.test.ts. Scope: M

### Task 14 — Upload/job route [delegable]

- AC:
  - [x] POST /api/imports → 202 + id; transitions queued→unpacking→parsing→storing→done|failed
  - [x] Single-import lock (409 while running); spool to temp + atomic rename; size/time limits
  - [x] Error payloads typed; retry idempotent (same pipeline as CLI)
  - [x] Synthetic-zip API integration test in CI
- Verify: integration test incl. lock contention + failure injection. DONE by worker t81
  (claude-haiku-5-5 via herdr, 6min) + lead review 2026-11-15: src/http/import.ts
  mountImportRoutes(app, {db, dbPath, archiveDir, spool?/backup?/runImport?/timeoutMs?/maxBytes?})
  — raw-body zip upload (application/zip|octet-stream, else 415), Content-Length check 413 +
  spool byte-count enforcement, temp+atomic rename into data/spool/<uuid>.zip, queued row then
  202 {importId,status} BEFORE work; job = runImport({importId, signal}) with 10min AbortController
  checked at record boundaries; in-process lock claimed synchronously pre-await (409 retryable
  while held); post-success backup+prune+archive (added in lead review; failures logged, never flip
  done→failed); failures before pipeline marked failed with status-guard. runImport gained
  RunImportOptions {importId?, signal?} + ROLLBACK-before-failed fix (worker-verified: without it
  malformed XML left status stuck at parsing; also fixes old wrong-row failed update).
  14 tests tests/integration/upload.test.ts (happy path incl. real pipeline; corrupt zip; malformed
  XML; retry; idempotent re-upload; 409 contention incl. concurrent double-POST; lock release on
  throw; timeout abort; 413 honest+lying length; 415; read routes with upload mounted).
  Worker deviations accepted: zip name via x-zip-name header (sanitized basename, default
  upload.zip); failed import deletes spooled zip (retry = re-upload); cooperative abort only.
  Commit ac98d80.
- Deps: T13. Files: src/http/import.ts, tests/integration/upload.test.ts. Scope: M

### Task 15 — Web foundation [delegable]

- AC: Vite+React builds; dark-first design tokens; centralized copy module; API client with
  job polling; no page logic yet.
- Verify: `bun run dev` serves shell; typecheck green. DONE (worker t82 claude-haiku-5-5, reviewed
  +committed by lead as e1f1c74): web/ shell (tokens.css dark-first, 3-page nav, hand-rolled routing
  w/ skip-link + useId), typed client (ApiError kinds, pollImport w/ ImportFailedError/NotFound/abort),
  src/server.ts (Bun.serve 5174, /api wins, SPA fallback, extension-aware 404, traversal-safe static,
  maxRequestBodySize=MAX_UPLOAD_BYTES), scripts/dev.ts (API+Vite proxy), tests: server 6 + client 7
  (186 total). Review fixes: biome react domain scoped to web/src via overrides (was globally off);
  static id="main" → useId(). Smoke on real db: / 200, /api/briefing 200, SPA route 200, traversal 404.
- Deps: T13. Files: web/. Scope: M

### Task 16 — uPlot wrapper [delegable]

- AC: React wrapper renders baseline bands, multi-series, boundary markers from DTO data;
  visual snapshot test.
- Verify: story/screenshot green. DONE by lead 2026-11-15: uplot 1.6.32 (bundles own types).
  web/src/components/chartData.ts = pure builders (union-day alignment w/ null gaps, banded
  series → hidden low/high + uPlot bands pair, drawBoundaryDays against injected surface,
  day/value formatters); web/src/components/Chart.tsx = thin lifecycle (create/resize/destroy,
  ResizeObserver, axis/legend/cursor, unit suffix on y ticks). DEVIATION from AC: canvas rendering
  is not unit-snapshot-testable under Bun — builders are unit-tested (tests/web/chartData.test.ts,
  8 tests) and pixels land in checkpoint 3 manual browse. Contract change: DeviationDTO +=
  baselineLow/baselineHigh (baseline ± 1.5σ_r = notable edge; null when suppressed) — filled by
  baselines.ts from robustZ dispersion, verified on real db (iWatch wrist_temp band
  [34.91, 35.64]). DeviationRow now extends DeviationDTO.
- Deps: T15. Files: web/src/components/Chart.tsx. Scope: S

### Task 17 — Import page [delegable]

- AC: drop zone → job progress (status transitions visible), run history table,
  new-since-last-run counts.
- Verify: manual pass on fixture zip + synthetic failure.
- Deps: T14, T16. Files: web/src/pages/Import.tsx. Scope: M

### Task 18 — Briefing page [delegable]

- AC: as-of date; last-night summary; ranked deviations **with evidence links**; recalibration
  notices; import status + cadence nudge ("last import N days ago"); trust labels.
- Verify: render from briefing fixture payload; links resolve. DONE by lead 2026-11-15:
  web/src/pages/Briefing.tsx — as-of lead, import line + cadence nudge, 6 last-night cards
  (sleep/deep/rem h, rhr, hrv_sdnn, resp_rate; freshest source per metric, trust chip, as-of day),
  deviations list (severity chip, recent-vs-baseline, σ, suppression reasons as prose, trust chip,
  "Investigate" link → /investigate?metric=&source=), recalibration + coverage findings list with
  links. PageSection gained optional lead prop; copy.ts += copy.metrics (13 EN labels) +
  copy.briefing block; styles in dedicated briefing.css (app.css owned by T17 worker in parallel).
  DEVIATION: no component-level render test (no react testing lib in stack; adding one = new dep
  → ask-first). Verified: tsc + biome clean, build deferred until parallel worker lands; visual
  render + link pass deferred to checkpoint 3 (playwright browse).
- Deps: T13, T16. Files: web/src/pages/Briefing.tsx. Scope: M

### Task 19 — Investigate page [delegable]

- AC: metric picker; baseline-band chart; deviation table with evidence navigation; device
  events; RMSSD/SDNN seam = both series + boundary marker, no blending; as-of + trust labels.
- Verify: manual pass reproducing spike readout visually.
- Deps: T16. Files: web/src/pages/Investigate.tsx. Scope: M

**Checkpoint 3** — integration test green in CI; manual real-data browse: briefing cadence/
status/evidence links, as-of everywhere, investigate reproduces the spike story.

## Phase 4 — MCP

### Task 20 — MCP stdio server [lead-adjacent]

- AC: read-only tools list_imports, list_sources, metric_daily, deviations, findings, briefing;
  contract shared with REST; as-of + trust in every payload.
- Verify: scripted MCP client session asserts tool outputs. DONE by lead 2026-11-15:
  src/http/queries.ts (contract extraction — REST routes now thin Hono wiring over the same
  queries the MCP tools call) + src/mcp/server.ts createMcpServer({db}) with 6 read-only tools
  (briefing described as "start here"; metric_daily validates against METRICS → isError + known
  list; deviations takes days [1,365] default 14; findings takes optional since=YYYY-MM-DD);
  src/cli.ts mcp [--db] subcommand over StdioServerTransport; openDb(path, {readonly: true})
  skips WAL/migrations (read-only handle). @modelcontextprotocol/sdk 1.32.2 + zod (stack-approved).
  Tests src/mcp/server.test.ts: real Client + InMemoryTransport pair over imported spike corpus,
  6 tests asserting as-of/trust travel + no wrist-temp z≥2.5 + since filtering. Live stdio smoke
  on real db: initialize + tools/list + tools/call briefing → anchor 2026-11-07, 37 findings,
  13 as-of entries. Commit 7390f3a.
- Deps: T13. Files: src/mcp/. Scope: M

### Task 21 — Streamable HTTP transport [delegable]

- AC: same tools over streamable HTTP mounted on the Hono app; tailnet-only binding documented.
- Verify: MCP inspector/HTTP client against local server. DONE by lead 2026-11-15:
  src/mcp/http.ts mountMcp(app, {db, path?}) — stateless WebStandardStreamableHTTPServerTransport
  per POST (enableJsonResponse, no session id; exactOptionalPropertyTypes: omit the key, SDK
  types don't accept explicit undefined), fresh McpServer per request, Cache-Control no-store;
  GET/DELETE → 405 typed (no SSE stream, no sessions). Security boundary = deployment binding:
  tailnet-only per design.md Deployment, no auth layer — documented in the module header.
  Tests src/mcp/http.test.ts: real Client + StreamableHTTPClientTransport against Bun.serve on
  ephemeral port over imported spike corpus (handshake + briefing tool round-trip), raw fetch
  initialize asserts no mcp-session-id + serverInfo.name=midori, 405s. Commit 7390f3a..
- Deps: T20. Files: src/mcp/http.ts. Scope: S

**Checkpoint 4** — PASSED 2026-11-15: fresh pi session (claude-haiku-5-5, project MCP config
  .pi/mcp.json → stdio server) answered "what changed recently and why" using only the six
  mcp__midori__ tools: device switch Oct 8–10 with recalibration ledger, suppressed cross_source
  baselines, per-metric stability with real numbers, declined clinical claims. Transcript
  evidence: tasks/checkpoint-4-mcp-session.md.

## Phase 5 — Ship to cluster

### Task 22 — Container + privacy inspection [lead-adjacent]

- AC: multi-stage Bun Dockerfile; .dockerignore (data/, zips, sidecars, backups, archive);
  image-content inspection proves no personal data; container smoke = synthetic import +
  briefing + MCP HTTP in-container.
- Verify: docker build + smoke script green locally.
- Deps: T14, T21. Files: Dockerfile, .dockerignore, scripts/smoke.sh. Scope: M

### Task 23 — harus-charts base chart [lead] (separate repo)

- AC: chart/workload via harus-charts `tk` ticket workflow; RWO PVC; `Recreate` strategy;
  app-level import lock respected; chart build/synth/test gates green; committed in
  harus-charts per its rules.
- Verify: harus-charts gates pass; ticket closed.
- Deps: T22. Files: vendor/harus-charts. Scope: M

### Task 24 — Backup CronJob + restore drill [lead] (harus-charts)

- AC: nightly VACUUM INTO CronJob in chart; retention + integrity; WAL-sidecar lifecycle
  across backup/restore/pod-restart/node replacement; restore drill executed once on cluster.
- Verify: drill log + CronJob run evidence.
- Deps: T23. Scope: S–M

### Task 25 — Deploy per ship-to-cluster playbook [lead, owner-authorized]

- AC: midori service-owned image target; harus-k3s image pin + `check-drift` + validate;
  authorized apply; rollout verification: briefing via tailnet, zip upload through ingress, MCP
  from workstation, CronJob firing, pod-restart cleanliness, re-import idempotence; rollback
  note; separate commits per owning repo.
- Verify: checklist recorded with evidence links.
- Deps: T24. Scope: M

**Checkpoint 5 (v0 done)** — all six design success criteria verified and recorded.

## Parallel tracks (after their deps)

- T3 fixtures ∥ T1 scaffold (after T4: fixture detail work)
- UI track (T15→T16→{T17,T18,T19}) ∥ MCP track (T20→T21) after T13/T14
- Stats (T9→T12) strictly sequential; ingest (T5→T8) strictly sequential

## Decision log (fill as made)

- OQ1 SAX/ZIP deps: **RESOLVED 2026-11-14** — `saxes` + `yauzl` (owner approved; benchmark
  escape-hatch to `sax-wasm` if T6 numbers disappoint). Input surface is **zip only**: no bare
  XML-file import path exists; export.xml is parsed inside the zip (owner, 2026-11-14).
- Code style (owner, 2026-11-14): TypeScript files only — no `.js`/`.mjs` sources, configs as
  `.ts` where the tool allows. CI guard scripts are `.ts` run under Bun.
- T6 insert path: drizzle vs raw bun:sqlite — decide in-task with benchmark numbers here
