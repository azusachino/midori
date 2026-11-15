# Implementation Plan: midori v0 (rev 2)

Spec: `docs/design.md` (approved 2026-11-13, grill decisions folded 2026-11-14, commit a072a40).
Rev 2 incorporates the independent pi/Kimi K3.1 Pro plan review
(`docs/reviews/2026-11-14-plan-review-pi-kimi.md`, verdict CHANGES REQUESTED): splits oversized
tasks, adds the local-backup task, pins contracts before implementation, defines the upload job,
extends privacy to container images, and expands Phase 5 into the prescribed ship-to-cluster
sequence. Per-task acceptance criteria land in `tasks/todo.md` at the Phase 3 gate — **before any
implementation begins**.

## Overview

Build the v0 loop end to end: scaffold → contracts pinned → real export importable into SQLite
with local backup → deterministic per-source deviation analysis with the spike regression as a
permanent fixture → briefing/investigate/import UI → read-only MCP (stdio + streamable HTTP) →
ship to harus-k3s as the closing milestone, following the ship-to-cluster playbook. Local-first
development; the cluster never blocks the analysis loop.

## Architecture Decisions

- **Slicing**: foundation is unavoidably horizontal (schema, parser), but every task after the
  schema is a verifiable vertical step ending in something runnable.
- **Contracts before consumers**: typed `Finding`/`EvidenceRef`, stats window semantics,
  coverage-boundary algorithm, and the JSON API/upload-job shapes are pinned (Task 4) before
  stats, API, UI, or MCP tasks consume them (review HIGH-2, MED-1).
- **Import upload is an async job** (review HIGH-3): the uploaded body is the ~66 MB
  `export.zip`; the server then unpacks and parses the ~909 MB `export.xml`, which takes minutes.
  `POST /api/imports` returns `202 + import id`; status transitions
  `queued → unpacking → parsing → storing → done | failed`; single-import lock (one running
  import per db); spool to a temp file with atomic rename; configurable size/time limits; retry
  re-uses the same idempotent pipeline as CLI import. The "66 MB is nothing" note in the design
  refers to ingress body size only — parse duration, not upload, is the constraint.
- **Bulk-insert path**: drizzle owns schema/migrations and cold queries; the ingest hot path
  uses raw `bun:sqlite` prepared statements inside batched transactions if the in-task benchmark
  shows drizzle overhead (decision point inside Task 6, measured during the task, not after).
- **Fixture strategy**: small synthetic `export.xml` (~50 records, multi-source, offset and
  boundary edge cases) for parser/stats unit tests, plus the **spike regression fixture**
  (two-source wrist-temp device swap → `switch` event + suppressed z, never raw +4σ), plus the
  design-required integration test (fixture zip → db → briefing endpoint payload). Real-export
  verification is owner-witnessed — never CI, never committed.
- **Night/day rules port from the spike** (harus-workstation `.tmp/midori/analyze.py`,
  gitignored scratch — port into tracked code + tests, scratch is not the spec): sleep start
  ≥15:00 local → that date's night; <09:00 → previous date; naps excluded; dominant-source
  stages per night; HRV restricted to 21:00–09:00 samples.
- **MCP dual transport**: one tool implementation; stdio for local dev + streamable HTTP
  mounted on the Hono app (tailnet-only) for the cluster. Tool payloads carry as-of dates and
  trust labels like every other consumer.
- **Privacy extends to artifacts** (review HIGH-4): `data/`, zips, db sidecars, and backups are
  excluded from Git *and* from the Docker build context (`.dockerignore`); image-content
  inspection verifies no personal data; CI and smoke tests use synthetic data only.

## Task List

### Phase 1: Foundation, contracts & ingest (store → ingest)

- [ ] Task 1: Scaffold Bun + TS strict project (biome, `bun test`, `bun run check`, README
      commands pinned, .gitignore for `data/`). CI on push runs `bun install`, typecheck,
      `bun test` — synthetic data only — plus a **tracked-file privacy guard** rejecting health
      exports, SQLite dbs/`-wal`/`-shm` sidecars, and backup artifacts (pinned pattern list),
      so personal data cannot enter the public repo.
- [ ] Task 2: SQLite schema + drizzle migrations — all six tables, WAL, dedup unique key on
      (type, source_name, start_at, end_at, value) with NULL/numeric-normalization behavior
      defined; records persist UTC instant **and** original local offset; `device_events`
      supports all three kinds (`first_seen`, `last_seen`, `switch`).
- [ ] Task 3: Fixture builders — synthetic export.xml (~50 records: multi-source, ±offset
      formats, sleep stages, night samples, unknown record type, malformed-edge dates) + spike
      regression fixture (two-source wrist-temp swap) + dedup-edge fixtures (NULL values,
      category records, equivalent numerics).
- [ ] Task 4: Pin module contracts in tracked code (`src/domain/`): typed `Finding`/
      `EvidenceRef`; exact stats semantics — baseline window anchor−90…anchor−29 inclusive,
      recent window anchor−13…anchor (14 days), ≥15 baseline / ≥7 recent day gates, severity
      thresholds at |z|≥1.5 / ≥2.5, zero-MAD policy ported from the spike and pinned by unit
      test, missing-day treatment, per-source anchor = last data day; coverage-boundary
      algorithm (gap vs device switch, ported from the spike's source-check logic) ; JSON API +
      upload-job DTOs; trust labels per metric. Unit tests pin every edge.
- [ ] Task 5: Streaming XML parser + record mapper (fixtures green; unknown types stored not
      aggregated; Workout/route/ECG presence logged, not parsed).
- [ ] Task 6: Transactional ingest store — batched inserts with dedup, import-run bookkeeping,
      source first/last-seen + counts, `bun run import <export.zip>` CLI; in-task benchmark on
      the fixture scaled to ~2M rows decides drizzle vs raw `bun:sqlite` hot path.
- [ ] Task 7: Local backup — post-import `VACUUM INTO` snapshot to `data/backups/`, 30-day
      retention, imported zips archived under `data/archive/`; `PRAGMA integrity_check` on
      snapshots; restore smoke test (snapshot → readable db); WAL-sidecar lifecycle handled
      (checkpoint before snapshot; restore replaces db **and** removes stale sidecars);
      synthetic-clock retention test proving the 30-day cutoff deletes expired snapshots while
      preserving newer ones.
- [ ] Task 8: Real-export verification (owner-witnessed): import in <5 min;
      immediate re-import reports 0 new; source counts agree with the import;
      post-import snapshot + archive created.

**Checkpoint 1**: import loop proven on real data; idempotence shown; timing met; backup +
restore smoke green.

### Phase 2: Stats engine (stats)

- [ ] Task 9: Local-day derivation + night assembly — record-local calendar days (JST),
      14:59/15:00 and 08:59/09:00 boundary tests, cross-midnight stages, naps excluded,
      dominant-source selection incl. ties.
- [ ] Task 10: Per-source daily metrics — median vs sum methods, HRV 21:00–09:00 filter,
      sparse-series behavior.
- [ ] Task 11: Baselines + robust z + severity + trust labels + per-source anchor, exactly per
      the Task 4 contract (window edges, gates, thresholds, zero-MAD, flat-baseline case).
- [ ] Task 12: Device events + recalibration — all three event kinds, coverage-boundary
      detection per contract, suppressed cross-source z, findings recompute wired into import
      completion with an integration assertion. Spike regression test green.

**Checkpoint 2**: verify per-source statistics against the private import. A change in
source is a potential confounder; it does not establish the cause of a measured change.

### Phase 3: API + UI (http + briefing-ui)

- [ ] Task 13: Domain/API JSON contracts + read routes (imports list, briefing, metric daily,
      deviations, findings, sources) + the design-required integration test: fixture zip →
      db → briefing endpoint payload assertions.
- [ ] Task 14: Import upload/job route per the Task 4 contract — `202 + id`, status
      transitions, single-import lock, spooling + atomic rename, size/time limits, error
      payloads, retry semantics; synthetic-zip API integration test.
- [ ] Task 15: Web foundation — Vite+React scaffold, design tokens (dark-first), centralized
      copy module, API client with job polling.
- [ ] Task 16: uPlot React wrapper — baseline bands, multi-series, boundary markers (genuinely
      small, isolated).
- [ ] Task 17: Import page — drop zone with job progress, run history, new-since-last-run.
- [ ] Task 18: Briefing page — as-of date, last night, ranked deviations **with evidence
      links**, recalibration notices, **import status + cadence nudge**, trust labels.
- [ ] Task 19: Investigate page — metric picker, baseline band chart, deviation table with
      evidence navigation, device events, RMSSD/SDNN seam handling (both series + boundary
      marker, no blending), as-of date, trust labels.

**Checkpoint 3** (explicit): integration test green in CI; manual browse on real data —
briefing shows cadence + import status + evidence links; every view carries its as-of date and
trust labels; investigate reproduces the spike readout visually.

### Phase 4: MCP server (mcp)

- [ ] Task 20: MCP server, stdio transport — read-only tools (list_imports, list_sources,
      metric_daily, deviations, findings, briefing), payloads carrying as-of + trust labels;
      contract shared with REST layer.
- [ ] Task 21: Streamable HTTP transport mounted on the Hono app (tailnet-only), same tools.

**Checkpoint 4**: a pi session answers "what changed recently and why" using only MCP tools;
tool-call transcript preserved as evidence.

### Phase 5: Ship to cluster (closing milestone, per ship-to-cluster playbook)

- [ ] Task 22: Dockerfile (Bun base, multi-stage) + `.dockerignore` (data/, zips, db sidecars,
      backups, archive) + image-content inspection proving no personal data + container
      smoke test (synthetic import + briefing + MCP HTTP inside the container).
- [ ] Task 23: harus-charts base chart/workload via its `tk` ticket workflow — RWO PVC,
      `Recreate` update strategy (no overlapping writers), app-level import lock respected;
      chart build/synth/test gates green.
- [ ] Task 24: Backup CronJob in the chart — nightly `VACUUM INTO`, 30-day retention,
      integrity check; restore drill executed once on the cluster; WAL-sidecar handling across
      backup, restore, pod restart, and node replacement (sidecars never restored across
      restarts).
- [ ] Task 25: Deploy per playbook: midori service-owned image target; harus-k3s image pin +
      `check-drift` + validate; authorized apply; rollout verification from other machines —
      briefing via tailnet, zip upload through ingress, MCP query from workstation, CronJob
      firing; rollback note recorded. Rollout verification also covers pod-restart behavior
      (SQLite reopens cleanly; no stale sidecars) and a re-import idempotence check through the
      cluster endpoint. Separate commits per owning repo (midori, harus-charts,
      harus-k3s).

**Checkpoint 5 (v0 done)**: all six success criteria in `docs/design.md` verified and recorded
with evidence.

## Parallelization

- After Task 4 (contracts), fixture work (Task 3) and scaffold (Task 1) are independent.
- After Task 13/14 (API contracts + upload job), Phase 3 UI work and Phase 4 MCP work are
  independent — safe to run as parallel sessions.
- Schema, ingest hot path, and stats semantics are strictly sequential (Tasks 2→5→6→9→11).

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| 2.05M-row import misses <5 min | High | Raw `bun:sqlite` prepared statements in the hot path; batched transactions; benchmark inside Task 6 (scaled fixture), fallback decided before stats exist |
| Stats semantics ambiguous at implementation time | High | Task 4 pins windows, gates, thresholds, zero-MAD, boundary algorithm as tracked, unit-tested contracts before any consumer exists |
| Large-upload/parse failure modes (async job, lock, spool) | Med | Async 202 + status contract (Task 4), implemented + integration-tested in Task 14 before UI depends on it |
| Personal data leaks into container image | High | `.dockerignore` + image-content inspection + synthetic-only CI (Task 22) |
| export.xml shape drift / unknown attributes | Med | Parser ignores unknown attributes; fixtures pin Export Version 17 shape; unknown record types stored |
| Night/day rule edge cases | Med | Boundary-time unit tests (14:59/15:00, 08:59/09:00, 21:00, cross-midnight, ties); rules ported from spike into tracked tests |
| SQLite on k3s (rollout overlap, integrity, recovery) | Med | RWO PVC + `Recreate` strategy + app-level lock; integrity checks on snapshots; restore drill (Tasks 24–25) |
| Cross-repo chart/deploy workflow | Med | Phase 5 follows the ship-to-cluster playbook and harus-charts' own tk workflow, gates named per task |
| SAX/ZIP runtime dependencies unapproved | Med | Open question 1 resolved before Task 5 |
| Backup exists but doesn't restore | Med | Restore smoke test local (Task 7) and drill on cluster (Task 24) |

## Open Questions

1. **Runtime dependencies for XML SAX parsing and zip handling** (e.g. `saxes`/`sax-wasm`,
   `yauzl`/`adm-zip`, or shelling out to `unzip`): the design's ask-first boundary applies —
   owner decision needed before Task 5. Bun/platform-native options preferred if adequate.
2. RMSSD vs SDNN across the device switch — decided for v0 (Task 19); revisit only if
   briefings feel broken at the seam.
