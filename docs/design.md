# midori design — v1

Status: proposed 2026-11-15, replacing v0 (approved 2026-11-13, in Git history at `adb9a75`).
Drivers: `docs/reviews/2026-11-15-v0-product-review.md`,
[0001 analysis model](decisions/0001-analyze-by-device-epoch-and-night.md),
[0002 UI stack](decisions/0002-ui-on-shadcn-tailwind-echarts.md).
Companions: [journeys and expected behavior](journeys.md), [UI design](ui-design.md),
[plan](../tasks/plan.md).
Evidence base: harus-workstation
`docs/runbooks/research/2026-11/2026-11-13-midori-apple-health-assistant.md`.

## What midori is

A personal **health analyst** for Apple Health exports. It answers one question well:

> Something feels off. What changed, since when, how sure are we, and is it me or the device?

The founding case: the watch's readiness score felt off. Apple keeps its readiness score
inside Apple, but the inputs are in the export (sleep, overnight heart rate, HRV, respiratory
rate, wrist temperature, SpO2). midori ranks how each input moved against your own baseline on
the same device, and says how confident it is. A change of device is a confounder to show,
never a cause to assert.

midori is not a daily-carry tool or a daily glance. It runs on periodic `export.zip` imports
because only the raw export keeps per-device samples, and per-device samples are what the
analysis needs. It is single-user (haru), tailnet-only, with no LLM inside. Agents narrate
over its MCP tools.

## Scope

In:

- Raw `export.zip` import into SQLite (the v0 pipeline: idempotent, ~15 s for ~2M records).
- Device epochs from the hardware model; nights as the unit for overnight metrics; partial-night
  detection.
- Rolling per-epoch baselines that re-baseline at seams, with confidence on every finding.
- Readiness contributors: the ranked overnight set. No composite score.
- Device comparison across a seam (overlap offset).
- Drill-down from a finding to the nights or days behind it.
- Long view: multi-year trends per metric, split by epoch.
- Read-only MCP for pi and luna.
- Owned backups (v0 behavior).

Out (for now): push/HAE ingest, own notes and annotations, workouts and routes, an advice layer
(HowToLiveBetter), clinical records, any LLM in the compute path, multi-user, public exposure.

## User journeys

1. **Investigate a feeling (primary).** Open midori and land on *Changes*: what moved since the
   baseline, ranked by |z| and confidence. Open a metric to see the last 180 units with epoch
   shading, the baseline band and the recent window highlighted. Then list the contributing
   nights and the confounders checked (seam, partial nights, coverage gaps, timezone travel).
   The end point is a sentence you can trust: "*metric* is below your baseline on this watch
   for *k* of the last 7 nights; no seam or partial night explains it."
2. **Monthly import.** Export on the phone and drop the zip on *Import*. Progress runs through
   `queued → unpacking → parsing → storing → deriving → done`. A summary follows: new records,
   new complete nights, data through *date*, and any new device ("re-baselining started").
   You then land on *Changes*.
3. **New watch.** midori detects the new hardware model and opens a new epoch. *Devices* shows
   the timeline of epochs, the overlap offset where both watches recorded, and a countdown
   ("baseline ready in *n* nights"). The old epoch stays readable as history.
4. **Ask an agent.** pi or luna call MCP tools and get per-night figures with coverage, epoch,
   completeness and confidence. The agent narrates and cites nights; it never computes over
   raw series.
5. **Long view (quarterly).** Per-metric trend over years with a calendar heatmap, split by
   epoch, e.g. "is resting heart rate trending down since I started running?"

## Data model

The SQL migrations are the source of truth. Changes from v0:

- `records` + `device_hw TEXT` (parsed from `<Record device=...>` `hardware:`), `meta_json TEXT`
  (MetadataEntry key/values). The dedup key is unchanged.
- `epochs(id, source_name, device_hw, first_day, last_day, days_present, kind)`. Kind is
  `watch | phone | app | other`.
- `nights(date, epoch_id, asleep_s, core_s, deep_s, rem_s, in_bed_s, complete, partial_reason)`.
- `metric_values(metric, epoch_id, unit_day, unit_kind, value, n, complete)`. Unit kind is
  `night | day`. This replaces `daily_metrics`.
- `primary_series(metric, unit_day, epoch_id)`: which epoch is primary for each unit.
- `findings(...)`, computed per import as in v0, plus `confidence`, `epoch_id`,
  `baseline_state` (`ready | warming_up | insufficient`) and `offset_vs_previous`.
- `device_events` is dropped. Epochs and seams are derived per import; history lives in
  `epochs`.

`imports`, `sources` and the backup/archive layout are unchanged. The schema changes require a
re-import from `data/archive/`; derived tables are a cache.

## Stats engine

Deterministic only. The rules are set in [0001](decisions/0001-analyze-by-device-epoch-and-night.md):

- Night rule: a sample at or after 15:00 local belongs to that date's night; one before 09:00
  belongs to the previous date's night. HRV keeps the 21:00–09:00 filter. Naps are excluded.
- Partial night: the export was taken before the night's window closed, or asleep time is below
  50% of the epoch's trailing median.
- Primary epoch per unit: the one with the most samples. Minor epochs (recorded on less than
  20% of the trailing 28 days) are never primary and never raise a seam.
- Recent window: the last 7 complete units (minimum 4). Baseline: units 35 to 8 back
  (minimum 14), current epoch only. Robust z = (recent median − baseline median) /
  (1.4826 · MAD), with v0's zero-MAD policy.
- Severity: |z| ≥ 1.5 notable, ≥ 2.5 alert. Confidence is `high | medium | low`, from n,
  epoch age and trust label.
- Seam: warming up for days 1–13; from 14 nights, z with reduced confidence until the full
  baseline exists. The overlap offset is shown when there are at least 7 shared units. Values
  are never corrected.
- Trust labels per metric (the v0 registry) travel with every payload.

Pipeline per import, in one transaction after storing records: epochs → nights → metric values
→ primary series → findings. Requests only read.

## Interfaces

REST (Hono, JSON):

- `POST /api/imports`, `GET /api/imports`, `GET /api/imports/:id`
- `GET /api/changes`: ranked findings plus the as-of date and import freshness
- `GET /api/metrics/:metric?range=` → units with epoch, completeness and the baseline band
- `GET /api/metrics/:metric/units/:day`: the evidence behind one unit
- `GET /api/epochs`, `GET /api/nights?from=&to=`

MCP (read-only; stdio + streamable HTTP): `changes()` (start here), `metric_series(metric,
range)`, `nights(from, to)`, `epochs()`, `list_imports()`. Every payload carries as-of,
epoch, completeness, confidence and trust.

## UI

Pages:

- **Changes** (home): as-of and freshness, readiness contributors ranked, any epoch warming up
  as one compact notice, last complete night.
- **Metric**: range picker 90 days / 180 days / 1 year / all (default 180 days), ECharts series
  per epoch with seam lines, baseline band and recent window, a contributing-units table, and
  a calendar heatmap for the long view.
- **Devices**: epoch timeline, overlap offsets, baseline countdown.
- **Import**: drop zone, job progress, run summary, history.

Stack per [0002](decisions/0002-ui-on-shadcn-tailwind-echarts.md): Vite + React,
shadcn/ui on Tailwind v4, ECharts, a small router with state in the URL. Dark-first; copy
lives in one module.

## Tech stack

Bun, TypeScript strict, SQLite (`bun:sqlite` + drizzle for the schema), Hono, `saxes` +
`yauzl`, `@modelcontextprotocol/sdk`, Vite + React, shadcn/ui + Tailwind v4, ECharts. Ask
first before adding any other runtime dependency.

## Testing

- `bun test` covers night assignment, partial detection, the primary/minor rule, the seam state
  machine, and the baseline math on synthetic series.
- Regression fixtures:
  - the v0 spike (wrist-temperature device swap → new epoch, warming up, offset shown, never a
    raw +4σ)
  - a minor app writing one sample inside the window → no seam
  - a same-name replacement watch → new epoch by hardware model
- Integration: fixture zip → db → `/api/changes` payload.
- Playwright e2e on synthetic data in CI-free `make e2e`. Each UI slice also gets a real-data
  screenshot pass that someone actually looks at, recorded in the slice's notes without health
  values.

## Success criteria (v1)

1. Re-import of the real export finishes in under 2 minutes, and an immediate re-import adds 0
   records.
2. On the real export, the post-2026-10-10 watch shows as its own epoch. Its metrics show either
   a z with confidence or a "warming up, n of 14" state. No metric is blank because of the seam.
3. *Changes* names the top contributors with confidence. Each one opens a Metric view whose
   chart, band and contributing nights agree with the finding.
4. A pi session answers "what changed recently, and could the device explain it?" using only
   MCP tools. The answer cites nights and does not assert a cause.
5. `bun run check` and `make e2e` pass; nothing personal is in Git or images.
6. The cluster deployment (harus-k3s) is updated through the ship-to-cluster playbook, and the
   backup CronJob still runs.

## Boundaries

- **Always**: deterministic stats; per-epoch baselines; complete nights only for baselines;
  `data/` out of Git.
- **Ask first**: new runtime dependencies beyond the stack above; changing stats rules beyond
  the starting values in 0001; exposure beyond the tailnet.
- **Never**: commit health data, the db or screenshots of real data; LLM arithmetic on raw
  series; assert a device or health cause.

## Roadmap (after v1)

Own notes and annotations as confounders; HAE push ingest if freshness starts to matter; a
visit-prep summary; an advice layer grounded in HowToLiveBetter; workouts and routes.
