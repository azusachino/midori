# Implementation plan: midori v1

Status: proposed 2026-11-15, rev 2 after the
[Fable review](../docs/reviews/2026-11-15-v1-design-review-fable.md). The v0 plan, ledger and
checkpoints are archived in `tasks/v0/`.
Inputs: [design](../docs/design.md), [journeys and behavior](../docs/journeys.md) (the
contract), [UI design](../docs/ui-design.md), decisions
[0001](../docs/decisions/0001-analyze-by-device-epoch-and-night.md) and
[0002](../docs/decisions/0002-ui-on-shadcn-tailwind-echarts.md).

## Workflow rules

- **No code before Gate 0.** The design set gets agent review (Fable: done, rev 2 answers it)
  and owner approval of PR #1.
- **Per-slice acceptance criteria before the slice starts.** Each slice names its `B-` rules.
  The slice brief copies them as acceptance criteria and adds its verification command.
- **One slice = one PR** on `task/v1-<n>-<name>`, at most about 5 source files plus tests.
  Every slice needs `bun run check` green; UI slices also need `make e2e` green. Merge in slice
  order, and `main` stays green and runnable after every merge.
- **Behavior first.** Each `B-` rule gets a test or e2e check whose name starts with its id.
- **Real data stays out of Git.** Real-export checks are recorded as pass/fail plus counts and
  shapes only; screenshots stay in `.tmp/`.
- **Who does what.** The lead does slices 1–8 (engine and contract) and 17 (Devices). Slices
  9–16 can be delegated to worker models with a brief. No UI slice merges until its real-data
  screenshots have actually been looked at.
- **Reviews.** Gate 0: Fable (done). Gate A: independent review of the engine against
  B-D/B-N/B-F/B-C. Gate C: independent J1–J5 walkthrough on real data.
- **Ask first.** Any step that deletes stored data. Cluster apply (slice 18).

## What is kept, rewritten, deleted

| Area | Fate | Slice |
| --- | --- | --- |
| `src/ingest/zip.ts`, `parser.ts` | Keep; parser also yields `device` hardware/software and `MetadataEntry` | 1 |
| `src/ingest/mapper.ts`, `store.ts` | Extend: new columns; `INSERT OR IGNORE` → upsert filling NULLs (B-I12) | 1 |
| `src/db/schema.ts`, `migrations/` | New migrations: capture columns, `imports` fields + status `deriving`, derived tables | 1, 2 |
| `src/ingest/import.ts`, `src/http/import.ts` | Keep the job; add pre-job validation, `deriving` stage, progress, retry, restart reconcile, 24 h spool | 8 |
| `src/backup/` | Keep; add the 10-snapshot cap | 8 |
| `src/stats/*`, `src/domain/stats.ts` | Rewrite per 0001. Keep `median`/MAD helpers; remove the 1e-9 zero-MAD branch | 3–7 |
| `src/domain/metrics.ts` | Extend: `sleep_hr`, kind, floors, minimums, `trendOnly`; SpO2 becomes overnight | 3 |
| `src/domain/api.ts`, `types.ts` | Rewrite the DTOs for v1 payloads | 9 |
| `src/http/queries.ts`, `routes.ts` | Add v1 read routes (slice 9). v0 read routes are deleted in slice 11 with the v0 web | 9, 11 |
| `src/mcp/server.ts` | Rewrite the tools (B-A*); transports kept | 10 |
| `src/cli.ts` | Add a `changes` readout | 7 |
| `tests/fixtures/*` + snapshot | Extend the model (device attrs, metadata, tz, minor app, alternating steps, flat resp); regenerate the snapshot | 1–6 |
| `tests/integration/*` | Update to v1 routes as they land | 9–11 |
| `scripts/smoke-container.ts`, `scripts/e2e/run.ts`, `e2e/*.spec.ts` | Move from `/api/briefing` + `briefing` tool to `/api/changes` + `changes` | 9, 10, 11 |
| `web/` (pages, CSS, uPlot wrapper, client, copy), `tests/web/*`, `uplot` dependency | Delete and rebuild per ui-design.md | 11 |
| `Dockerfile`, harus-k3s manifests | Keep; bump the tag at ship | 18 |
| `README.md` | Rewrite commands, layout and description | 18 |

## Phases and slices

### Gate 0 — design approved

Fable review → rev 2 (this revision) → owner approval of PR #1.

### Phase 1 — engine (lead)

1. **Capture.** Migration: `records.device_hw/device_sw/meta_json`, `imports.export_date`.
   Parser, mapper and store changes, including the upsert. Fixture model gains device
   attributes, device-less sleep/RHR records and metadata. Rules: B-I12, B-I8 (export_date).
   Test: re-importing over pre-v1 rows fills `device_hw`. Measure the db growth from
   `meta_json` against the 30% risk threshold.
2. **Derived schema + epochs.** Migration for `epochs, epoch_events, stints, nights,
   metric_values, findings, seam_steps`; drop `daily_metrics`/`device_events`. Epoch
   derivation with inheritance and OS-update events. Rules: B-D1, B-D2, B-D2b, B-D8.
   Fixture: same-name replacement watch.
3. **Minor + sticky primary.** Registry extension (kind, floors, minimums, `sleep_hr`,
   `trendOnly`, SpO2 overnight); minor rule; stints; seams; seam steps. Rules: B-D3–B-D7.
   Fixtures: a minor app → no seam; alternating phone/watch → no seam.
4. **Nights.** Zones from `HKTimeZone`, night rule, 09:00–12:00 continuation, sleep stages from
   the primary, `sleep_hr`, export-cut completeness, `tz_change`, daytime units. Rules:
   B-N1–B-N9. Fixture: a night in another zone.
5. **Values + baselines.** Usability, ordinal windows, gates, floors and cap, severity,
   confidence, k-outside, onset. Rules: B-F1–B-F6, B-F8, B-F11. The spike fixture now expects
   new stint → warming up → across-seam step. Fixture: flat respiratory-rate baseline.
6. **Findings + checks.** Ranking, trend-only exclusion, checks, wording keys. Rules: B-F7,
   B-F9, B-F10, B-C1–B-C6.
7. **Atomic derive + CLI + real-data readout.** One derive transaction with a swap; evidence
   bounded by as-of; `bun src/cli.ts changes [--json]`. Owner-witnessed run on the real export
   checks B-I9, success criterion 2 (new watch as its own epoch for all overnight metrics, no
   spurious steps seams) and the † thresholds. Tuning notes go into journeys.md. Rules: B-I6.
8. **Import job hardening.** Pre-job zip validation, `deriving` stage, progress, retry endpoint,
   24 h spool, restart reconcile, backup cap. Rules: B-I1–B-I5, B-I7, B-I8, B-I10, B-I12
   (backups). Integration tests through HTTP.

**Gate A**: independent review of slices 1–8 against B-D/B-N/B-F/B-C/B-I; `bun run check`
green.

### Phase 2 — read API + MCP

9. **REST v1** (lead): `/api/changes`, `/api/metrics`, `/api/metrics/:metric`, `/units/:day`,
   `/api/epochs`, `/api/nights`, plus import summary fields. v1 routes are added next to the v0
   ones. The integration test goes fixture zip → `/api/changes`. Smoke and e2e scripts switch
   to `/api/changes`. Rules: B-R1–B-R4 (payload), B-I3, B-I4, B-A4 (`nights`).
10. **MCP v1** (lead): tools `changes, metric_series, nights, epochs, list_imports`; REST
    parity test; descriptions per B-A3. **Checkpoint B**: a pi session answers "what changed
    recently, and could the device explain it?" using MCP only. The transcript is reviewed for
    cause assertions and stored without values. Rules: B-A1–B-A4.

### Phase 3 — UI (delegable, with briefs)

11. **Foundation + v0 removal.** Delete the v0 web, `tests/web`, `uplot` and the v0 read routes.
    Add Tailwind v4, shadcn init, the router, the shell (sidebar/tabs, top-bar freshness,
    importing pill), the `EChart` wrapper with a CSS-variable theme, the epoch palette and
    tints (contrast/colorblind check), the API client, and empty/loading/error primitives. Set a
    bundle budget check (≤300 KB gzipped). e2e: shell + empty states at both widths.
12. **Import page.** Drop zone with a file input, XHR upload, stepper, summary, history, retry,
    all §8 states. e2e: upload fixture, duplicate, bad file, phone file input.
13. **Changes page.** `FindingRow`, overnight/daytime lists, warming-up notice, stale banner,
    last usable night, all §4 states.
14. **Metric chart + detail shell.** `MetricChart` (polygon band, recent, seams, steps, OS
    marks, partial, minor), range/zoom in the URL, FindingRow header, recent-units table,
    trend-only and not-found states.
15. **Checks + evidence sheet.** Checks panel, `?night=` evidence sheet, full-screen on phones.
16. **Long view + Metrics index.** Calendar heatmap with a custom series, Metrics grid from
    `/api/metrics`.
17. **Devices page** (lead). Epoch timeline from days present, per-epoch cards, seam steps, OS
    updates, single-epoch state.

**Gate C**: independent J1–J5 walkthrough on real data (screenshots inspected, findings
recorded without values) plus `make e2e` green.

### Phase 4 — ship

18. README rewrite; image + smoke (synthetic); harus-k3s tag bump PR with its gates;
    owner-authorized apply; real export re-imported on the cluster through the upsert (no
    deletion); MCP check from the workstation; backup CronJob firing. Rollback = previous tag.
    The v1 columns are additive, but the v0 code cannot read the v1 derived tables, so a
    rollback also restores the pre-deploy snapshot. That restore is a data operation and needs
    the owner's approval.

## Parallelism

- Slices 1→2→3→4→5→6→7 run strictly in sequence.
- Slice 8 can run in parallel with slices 5–7 (different files).
- Slice 11 can start after Gate 0, but merges after slice 9.
- Slices 12, 13 and 17 run in parallel after slice 11; slices 14→15→16 run in sequence.
- Slice 10 runs in parallel with Phase 3.

## Risks

| Risk | Mitigation |
| --- | --- |
| Device-less records split epochs (review H2) | Inheritance rule B-D2 + same-name fixture; slice 7 readout checks that every overnight metric sits on the new epoch |
| Source mixing creates spurious seams (H3) | Sticky primary B-D4 + alternating fixture; slice 7 counts seams per metric |
| Quantized metrics inflate z (H5) | Registry floors + cap (B-F4) + flat-baseline fixture |
| Re-import leaves new columns NULL (H6) | Upsert (B-I12) + test; no deletion anywhere in the plan |
| Timezone travel mis-assigns nights (M1) | `HKTimeZone` zones (B-N1) + fixture; tz check B-C4 |
| † thresholds feel wrong on real data | Slice 7 readout before any UI; tune with a note in journeys.md |
| `meta_json` grows the db (751 MB now) | Measured in slice 1; switch to a key allowlist if growth exceeds 30% |
| Workers ship unverified UI again | Inspected real-data screenshots are a merge condition for every UI slice |
| ECharts bundle and custom-series complexity | Per-module imports; budget check in slice 11; band and calendar via documented `custom` series |
| Derive time grows | Measured in slice 7 against B-I9 |
| Cluster rollback needs a data restore | Snapshot before apply; restore only with owner approval (slice 18) |

## Open questions

1. Router: TanStack Router vs React Router. Decided in slice 11; either is acceptable per 0002.
2. `rhr` assigned to the night that ends that morning (journeys §2 †): confirm in the slice 7
   readout.
