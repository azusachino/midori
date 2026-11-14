# Implementation Plan: midori v0

Spec: `docs/design.md` (approved 2026-11-13, grill decisions folded 2026-11-14, commit a072a40).
This plan turns the capability map (`store → ingest → stats → http + briefing-ui → mcp`, ship
step last) into ordered, verifiable tasks. Task detail (acceptance criteria per task) lands in
`tasks/todo.md` in Phase 3 after this plan is approved.

## Overview

Build the v0 loop end to end: scaffold → real export importable into SQLite → deterministic
per-source deviation analysis with the spike regression as a permanent fixture → briefing/
investigate/import UI → read-only MCP (stdio + streamable HTTP) → ship to harus-k3s as the
closing milestone. Local-first development; the cluster never blocks the analysis loop.

## Architecture Decisions

- **Slicing**: foundation is unavoidably horizontal (schema, parser), but every task after the
  schema is a verifiable vertical step ending in something runnable: "import runs", "z-scores
  compute", "briefing renders", "pi answers a question", "cluster serves it".
- **Bulk-insert path**: 2.05M rows must import in <5 min. drizzle owns schema/migrations and
  cold queries; the ingest hot path uses raw `bun:sqlite` prepared statements inside batched
  transactions if drizzle overhead is too slow. Measure first with the real export (Task 5).
- **Fixture strategy**: a tiny synthetic `export.xml` (~50 records, multi-source, offset edge
  cases) for parser/stats unit tests, plus a dedicated **spike regression fixture** (two-source
  wrist-temp device swap → must yield `switch` event + suppressed z, never raw +4σ). Real-export
  verification is a separate, owner-witnessed step — never a CI test, never committed.
- **Night/day rules port directly from the spike** (`.tmp/midori/analyze.py` in
  harus-workstation, gitignored): sleep start ≥15:00 local → that date's night; <09:00 → previous
  date; naps excluded; dominant-source stages per night; HRV restricted to 21:00–09:00 samples.
- **MCP dual transport**: one tool implementation; stdio server for local dev + streamable HTTP
  mounted on the Hono app (tailnet-only) for the cluster deployment.
- **UI**: Vite+React, dark-first tokens, uPlot behind a small React wrapper, copy in one
  centralized module. API contract (JSON shapes) is defined before UI tasks so MCP/UI can
  proceed in parallel against the contract.

## Task List

### Phase 1: Foundation & ingest (store → ingest)

- [ ] Task 1: Scaffold Bun + TS strict project (biome, `bun test`, `bun run check`, README
      commands pinned, .gitignore for `data/`, minimal CI workflow).
- [ ] Task 2: SQLite schema + drizzle migrations for all tables
      (imports/sources/records/daily_metrics/findings/device_events), WAL mode, dedup unique key.
- [ ] Task 3: Synthetic export.xml fixture builder (~50 records: multi-source, ±offset formats,
      sleep stages, night samples) + spike regression fixture generator.
- [ ] Task 4: Ingest pipeline — unzip, streaming SAX parse, record mapper, batched transactional
      inserts with dedup, import-run bookkeeping; `bun run import <export.zip>`.
- [ ] Task 5: Real-export verification (owner-witnessed): 909 MB export imports <5 min;
      re-import reports 0 new; sources table matches spike counts (2,047,778 records).

**Checkpoint 1**: import loop proven on real data; idempotence shown; timing met.

### Phase 2: Stats engine (stats)

- [ ] Task 6: Daily aggregates per (metric, source, day) — night assembly rule, dominant-source
      stages, median vs sum methods, HRV nighttime filter, local-day derivation from UTC+offset.
- [ ] Task 7: Baselines + robust z + severity + trust labels + anchor = last data day per
      metric+source; ≥15 baseline / ≥7 recent day gates.
- [ ] Task 8: Device events + recalibration — coverage boundary detection, `switch` events,
      suppressed cross-source z, `findings` recompute per import. Spike regression test green.

**Checkpoint 2**: on the real import, stats reproduce the spike readout (wrist temp =
recalibration artifact; RHR/HRV/sleep/SpO2/resp in range).

### Phase 3: API + UI (http + briefing-ui)

- [ ] Task 9: Hono API — all endpoints (`/api/imports` POST/GET, briefing, metric daily,
      deviations, findings, sources) with JSON contract types shared with MCP + web.
- [ ] Task 10: Web scaffold — Vite+React app, design tokens (dark-first), uPlot React wrapper,
      centralized copy module, API client.
- [ ] Task 11: Import page (drop zone, run history, new-since-last-run) + Briefing page
      (as-of date, last night, ranked deviations, recalibration notices).
- [ ] Task 12: Investigate page — metric picker, baseline band chart, deviation table with
      evidence links, device events, RMSSD/SDNN seam handling (both series + boundary marker).

**Checkpoint 3**: manual browse on real data — briefing renders fully; investigate reproduces
the spike readout visually; import page shows history.

### Phase 4: MCP server (mcp)

- [ ] Task 13: MCP server with read-only tools (list_imports, list_sources, metric_daily,
      deviations, findings, briefing) — stdio transport; contract shared with REST layer.
- [ ] Task 14: Streamable HTTP transport mounted on the Hono app (tailnet-only), same tools.

**Checkpoint 4**: a pi session answers "what changed recently and why" using only MCP tools
(success criterion 4).

### Phase 5: Ship to cluster (closing milestone)

- [ ] Task 15: Dockerfile (Bun base, multi-stage) + deploy notes; container smoke-tested
      locally (import + briefing + MCP HTTP inside the container).
- [ ] Task 16: Chart in harus-charts per its own workflow (cross-repo, follows harus-charts
      agent rules) — PVC, single pod, tailnet-only ingress, backup CronJob (nightly
      VACUUM INTO, 30-day retention).
- [ ] Task 17: Deploy to harus-k3s, verify end to end from other machines: briefing via
      tailnet, zip upload through ingress, MCP query from workstation, CronJob fires.

**Checkpoint 5 (v0 done)**: all six success criteria in `docs/design.md` verified and recorded.

## Parallelization

- After Task 9 (JSON contract types), Phase 3 UI work and Phase 4 MCP work are independent —
  safe to run as parallel sessions if wanted.
- Task 3 (fixtures) can parallelize Tasks 1–2.
- Everything touching the schema or ingest hot path is strictly sequential (Tasks 2→4→5→6).

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| 2.05M-row import misses <5 min target under drizzle | High | Raw `bun:sqlite` prepared statements in the ingest hot path; batched transactions; measure in Task 5, not after UI exists |
| export.xml shape drift / unknown attributes | Med | Parser ignores unknown attributes; fixture pins Export Version 17 shape; unknown record types still stored |
| uPlot + React integration friction | Med | Wrapper is its own small task (Task 10) before any page depends on it |
| SQLite on k3s local-path (WAL/fsync semantics) | Med | Single-writer pod; if integrity or durability issues appear, move PVC to local SSD hostPath |
| Cross-repo chart workflow unknowns (harus-charts CLI tickets) | Med | Task 16 starts by reading harus-charts' own agent instructions; budgeted as its own task, not a sub-step |
| Night/day rule edge cases (naps, multi-source nights) | Med | Rules already validated against real data in the spike; port + unit-test as-is; deviation from spike behavior is a finding, not a refactor |
| Real-data verification needs the export.zip | Low | Already staged at harus-workstation `.tmp/midori/apple_export/`; copy into midori `data/` (gitignored) at Task 5 |

## Open Questions

- None blocking. (Design open questions 1, 2, 4 are settled; #3 RMSSD/SDNN seam handling is
  decided for v0 and encoded in Task 12.)
