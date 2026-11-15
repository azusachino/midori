# Implementation plan: midori v1

Status: proposed 2026-11-15. v0 plan, ledger and checkpoints are archived in `tasks/v0/`.
Inputs: [design](../docs/design.md), [journeys and behavior](../docs/journeys.md),
[UI design](../docs/ui-design.md), decisions [0001](../docs/decisions/0001-analyze-by-device-epoch-and-night.md)
and [0002](../docs/decisions/0002-ui-on-shadcn-tailwind-echarts.md),
[v0 review](../docs/reviews/2026-11-15-v0-product-review.md).

## Workflow rules

- **No code before Gate 0.** The design set (the five documents above) gets an agent review
  (Fable) and owner approval first.
- **Per-slice AC before the slice starts.** Each slice below names its `B-` rules; the slice
  brief copies them as acceptance criteria and adds its verification command.
- **One slice = one PR** on `task/v1-<slice>`, ≤ ~5 source files plus tests, `bun run check`
  green; UI slices also need `make e2e` green. Merge order follows the slice numbers.
- **Behavior first.** Every `B-` rule gets a unit/integration test or an e2e check that names
  its id (`test("B-N6 export-cut night is partial", …)`).
- **Real data stays out of Git.** Real-export checks are recorded as pass/fail with shapes and
  counts only (no measurements); screenshots stay in `.tmp/`.
- **Who does what.** Lead (this session's model): slices 1–6 (stats semantics) and 13.
  Delegable to worker models with a brief: slices 7–12. UI slices get an inspected real-data
  screenshot pass before merge.
- **Reviews.** Gate 0: Fable on the design set. Gate A: independent review of the engine
  against `B-D/B-N/B-F/B-C`. Gate C: independent walkthrough of J1–J5 on real data.

## What is kept, rewritten, deleted

| Area | Fate |
| --- | --- |
| `src/ingest/` (zip, SAX parser, store, import job), `src/backup/`, `src/db/` | Keep; extend the parser/mapper/schema for `device_hw`, `meta_json`, `export_date` |
| `src/http/import.ts` job route, Hono app, `src/mcp/` transports | Keep; add the `deriving` stage; swap read handlers |
| `src/stats/*`, `src/domain/stats.ts` boundaries, `findings`/`device_events` | Rewrite per 0001; the zero-MAD/robust-z helpers and the spike fixture are kept |
| `src/http/queries.ts` | Rewrite as read-only queries over persisted derived tables |
| `web/` pages, CSS, uPlot wrapper | Delete; rebuild per ui-design.md |
| Dockerfile, smoke, harus-k3s manifests | Keep; bump tag at ship time |

## Phases and slices

### Gate 0 — design approved

Fable review of the design set → revisions → owner approval of PR #1.

### Phase 1 — engine (lead)

1. **Schema + capture.** Migration: `records.device_hw`, `records.meta_json`,
   `imports.export_date`, plus the new derived tables (`epochs, nights, metric_values,
   primary_series`, the reshaped `findings`). Parser/mapper fill them. Fixtures: same-name
   replacement watch, app without device, metadata entries. Rules: B-D1, B-D2, B-I8 (fields).
2. **Epochs + primary/minor.** Days-present coverage, minor rule, primary per unit, seams,
   offsets. Rules: B-D3–B-D7. Fixture: a minor app writing one sample in window → no seam.
3. **Nights + completeness.** Night rule for sleep and overnight metrics, HRV filter, primary
   stages, partial reasons, tz tagging, daytime units. Rules: B-N1–B-N10.
4. **Metric values + baselines + confidence.** Recent/baseline windows, z, severity,
   warming-up/insufficient states, confidence, k-of-7. Rules: B-F1–B-F8. The spike fixture now
   expects new epoch → warming up → offset shown.
5. **Findings, checks, diff, atomic derive.** Ranking, checks, wording keys, new/resolved diff,
   derive in one transaction with swap at `done`, previous state served during import. Rules:
   B-F7, B-F9, B-F10, B-C1–B-C5, B-I5, B-I6, B-I8.
6. **CLI readout + real-export check.** `bun src/cli.ts changes [--json]` prints the ranking.
   Owner-witnessed run on the real export: import time (B-I9), Ultra is its own epoch, no
   metric blank because of the seam (design success criterion 2). Result recorded without
   values.

**Gate A**: independent review of slices 1–6 against B-D/B-N/B-F/B-C; `bun run check` green.

### Phase 2 — read API + MCP (lead-adjacent)

7. **REST v1.** `/api/changes`, `/api/metrics/:metric?range=`, `/api/metrics/:metric/units/:day`,
   `/api/epochs`, `/api/nights`, `GET /api/imports/:id` with the summary. v0 read routes are
   removed. Integration test: fixture zip → `/api/changes`. Rules: B-R1–B-R4 (payload side),
   B-I3, B-I4.
8. **MCP v1.** Tools `changes, metric_series, nights, epochs, list_imports`; descriptions per
   B-A3; parity test with REST (B-A1); B-A2, B-A4. **Checkpoint B**: a pi session answers "what
   changed recently, and could the device explain it?" using MCP only. Transcript reviewed for
   cause assertions, stored without values.

### Phase 3 — UI (delegable, with briefs)

9. **Foundation.** Tailwind v4, shadcn init, router, shell (sidebar, top-bar freshness,
   ⌘K), `EChart` wrapper with CSS-variable theme, epoch palette + semantic tints checked for
   contrast/colorblindness, typed API client, empty/loading primitives. Delete v0 web code.
10. **Import page.** Drop zone, stepper/progress, summary, history, retry, error copy (B-I1–B-I7
    UI side). e2e: upload fixture, duplicate upload, bad file.
11. **Changes page.** `FindingRow`, overnight/daytime lists, warming-up notice, stale banner,
    last complete night, all states from ui-design §4. e2e at 1440/390 px.
12. **Metric detail + Metrics index.** `MetricChart` (band, recent, seams, partial, minor),
    range/zoom in URL, Checks, recent-nights table, evidence `Sheet`, Long view (calendar +
    monthly medians), Metrics grid.
13. **Devices page (lead).** Epoch timeline from days present, per-epoch cards, offsets.

**Gate C**: independent J1–J5 walkthrough on real data (screenshots inspected; findings written
up without values) plus `make e2e` green.

### Phase 4 — ship

14. Image + smoke (synthetic), harus-k3s tag bump PR with its gates, owner-authorized apply,
    re-import of the real export on the cluster, MCP check from the workstation, backup
    CronJob still firing. Rollback = previous tag; derived tables rebuild on the next import.

## Parallelism

Slices 1→2→3→4→5 run strictly in sequence. Slice 9 can start after Gate 0 (it uses no engine
data). Slices 10–13 start after slice 7, and 10, 11 and 13 can run in parallel (different
files). Slice 8 can run in parallel with slices 9–13.

## Risks

| Risk | Mitigation |
| --- | --- |
| Starting thresholds (7/28 windows, 20% minor, 50% partial) feel wrong on real data | Slice 6 real-data readout before any UI; adjust via a note in 0001 (allowed without a new decision) |
| Night rule misassigns shift or travel nights | B-N9 tagging + the tz check; naps out of scope |
| `meta_json` grows the db (already 751 MB) | Measure in slice 1; store only known keys if growth exceeds 30% |
| Workers produce unverified UI again | Real-data screenshot inspection is a merge condition, not a checkpoint afterthought |
| ECharts bundle size | Per-module imports; budget 300 KB gzipped for the whole app, checked in slice 9 |
| Derive time grows with nights/epochs | Measured in slice 5; budget is part of B-I9 (<2 min end to end) |

## Open questions

1. Router: TanStack Router vs React Router. Decided in slice 9; either is acceptable per 0002.
2. Should resting HR belong to the preceding night (as proposed) or to its calendar day?
   Confirm in the slice 3 readout.
