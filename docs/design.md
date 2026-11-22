# midori design — v1

Status: proposed 2026-11-15 (rev 2 after the
[Fable review](reviews/2026-11-15-v1-design-review-fable.md)), replacing v0 (approved
2026-11-13, in Git history at `adb9a75`).
Drivers: [v0 review](reviews/2026-11-15-v0-product-review.md),
[0001 analysis model](decisions/0001-analyze-by-device-epoch-and-night.md),
[0002 UI stack](decisions/0002-ui-on-shadcn-tailwind-echarts.md).
Companions: [journeys and expected behavior](journeys.md) (the behavioral contract and the
only home of numeric thresholds), [UI design](ui-design.md), [plan](../tasks/plan.md).
Evidence base: harus-workstation
`docs/runbooks/research/2026-11/2026-11-13-midori-apple-health-assistant.md`.

## What midori is

A personal **health analyst** for Apple Health exports. It answers one question well:

> Something feels off. What changed, since when, how sure are we, and is it me or the device?

The founding case: the watch's readiness score felt off. Apple keeps its readiness score
inside Apple, but most of the inputs are in the export (sleep, sleeping heart rate via a proxy,
HRV, respiratory rate, wrist temperature, SpO2). midori ranks how each input moved against
your own baseline on the same device, says since when and how confident it is, and lists the
confounders it checked. A change of device is a confounder to show, never a cause to assert.

midori is not a daily-carry tool or a daily glance. It runs on periodic `export.zip` imports
because only the raw export keeps per-device samples. It is single-user (haru), tailnet-only,
and has no LLM inside; agents narrate over its MCP tools.

## Scope

In:

- Raw `export.zip` import into SQLite (the v0 pipeline: idempotent, ~15 s for ~2M records),
  extended to capture device hardware, OS version and metadata.
- Device epochs, a sticky primary per metric, nights in their own timezone, two-level
  usability.
- Rolling per-stint baselines that re-baseline at seams; confidence, onset and confounder checks
  on every finding.
- Readiness contributors: the ranked overnight set (`journeys.md` §2). No composite score.
- Device comparison across a seam: the offset when devices overlap, otherwise the across-seam
  step labelled as inseparable.
- Drill-down from a finding to the nights or days behind it, and a long view by epoch.
- Read-only MCP for pi and luna; owned backups with a retention cap.

Out (for now): push/HAE ingest, naps, workouts and routes, an advice layer
(HowToLiveBetter), clinical records, any LLM in the compute path, multi-user, public exposure.

## User journeys

The five journeys are defined in [journeys.md §3](journeys.md#3-journeys):

- J1, investigate a feeling (primary)
- J2, monthly import
- J3, new watch
- J4, ask an agent
- J5, long view

Expected behavior is defined there too, as `B-` rules.

## Data model

The SQL migrations are the source of truth. Changes from v0:

- `records` + `device_hw TEXT`, `device_sw TEXT` (parsed from `<Record device=...>`
  `hardware:`/`software:`), `meta_json TEXT` (MetadataEntry key/values). The dedup key is
  unchanged. Insert becomes an upsert that fills these columns where they are NULL (B-I12).
- `imports` + `export_date`, `stage`, `progress`; the status CHECK gains `deriving`.
- `epochs(id, source_name, device_hw, kind, first_day, last_day, days_present)`. Kind is
  `watch | phone | app | other`.
- `epoch_events(epoch_id, day, kind, detail)`: OS updates (B-D8).
- `nights(date, zone, tz_change, partial_reason, asleep_s, core_s, deep_s, rem_s, in_bed_s)`.
  Stages come from the `sleep_h` primary epoch.
- `metric_values(metric, epoch_id, unit_day, unit_kind, value, n, usable)`. Unit kind is
  `night | day`. This replaces `daily_metrics`.
- `stints(metric, epoch_id, start_day, end_day)`: the primary history. Seams are stint
  boundaries.
- `findings(metric, state, z, severity, confidence, onset_day, onset_open, recent, baseline,
  k_outside, checks_json, asof_day, stint_id)`, plus `seam_steps(metric, seam_day, kind
  offset|step, value, n_old, n_new)`.
- `notes(id, start_day, end_day, category, label, created_at, updated_at, author, author_name)`:
  annotations (B-U1–B-U4, B-A7) that derive and imports never clear. `category` is one of
  `illness | travel | alcohol | medication | stress | other`; `author` is `owner | agent`
  (CHECK) and `author_name` records which agent appended the row.
- `briefings(id, asof_day, title, summary, cited_nights_json, cited_metrics_json, author_name,
  created_at)`: dated, evidence-cited agent cards for Changes (B-B1–B-B2), indexed by
  `created_at DESC, id DESC`. derive and imports never clear or modify them.
- `finding_snapshots(import_id, metric, state, z, severity, direction, confidence, asof_day)`:
  a compact per-import snapshot written inside derive (B-I13), used only for the
  import-to-import diff (B-F15). Primary key `(import_id, metric)`.
- `profile_context(id CHECK id = 1, goals, routine, medical_context, updated_at)`: the owner's
  singleton agent context (B-P1–B-P2), editable from the UI and never cleared by derive or
  imports.
- `device_events` and `daily_metrics` are dropped.

## Stats engine

Deterministic only. The principles are in
[0001](decisions/0001-analyze-by-device-epoch-and-night.md); the rules and numbers are in
[journeys.md §4](journeys.md#4-expected-behavior) (B-D, B-N, B-F, B-C).

Derive pipeline per import, in one transaction after records are stored: epochs (with
inheritance) → stints (primary) → nights (zones, completeness) → metric values (usability) →
findings, checks and seam steps. The new derived tables are swapped in atomically when the
transaction commits. Request handlers only read.

## Interfaces

REST (Hono, JSON):

- `GET /api/health`: `{ ok, version, revision }` build identity (B-R5).
- Imports:
  - `POST /api/imports` (validated before job creation, B-I1)
  - `GET /api/imports`
  - `GET /api/imports/:id` (stage, progress, summary)
  - `GET /api/imports/:id/diff` (`FindingsDiffDTO` or `null`, B-F15)
  - `POST /api/imports/:id/retry`
- `GET /api/changes`: ranked findings, as-of, freshness, warming-up notice, last usable night,
  `sinceLastImport`, and recent notes.
- `GET /api/metrics`: index, one entry per metric with its state and 1-year weekly series.
- `GET /api/metrics/:metric?range=90d|180d|1y|all`: units with epoch, usability, band, recent
  window, stints, seam steps. `all` returns weekly medians.
- `GET /api/metrics/:metric/units/:day`: evidence for one unit (≤ as-of only, B-I6).
- `GET /api/epochs`: epochs with per-metric role (primary / candidate / minor), baseline state,
  seam steps and OS updates.
- `GET /api/nights?from=&to=` (≤400 days).
- `GET /api/notes?from=&to=`; `POST /api/notes`; `PATCH /api/notes/:id`;
  `DELETE /api/notes/:id` (mutations are absent in read-only deployments and answer 405).
  Notes carry audit provenance (`author`, `authorName`).
- `GET /api/briefings?limit=`; `POST /api/briefings`; `DELETE /api/briefings/:id` (B-B1;
  mutations answer 405 in read-only deployments). `GET /api/changes` and
  `GET /api/context` carry `latestBriefing`.
- `GET /api/profile`; `PUT /api/profile` (owner agent context, B-P1; mutation answers 405 in
  read-only deployments).
- `GET /api/context?days=7..30` (default 14): the B-A5 dossier that MCP `health_context`
  returns — findings with long-term primary-stint medians, aligned recent nights, profile,
  freshness and what changed since the previous import.

MCP (stdio + streamable HTTP), per B-A1–B-A7:

- Always mounted, read-only (8 tools): `changes()`, `health_context(days?)`,
  `metric_series(metric, range)`, `nights(from, to)`, `epochs()`, `list_notes(from?, to?)`,
  `list_briefings(limit?)`, `list_imports()`.
- Mounted when the server is `writable: true` (4 more, 12 total), all auditable and never
  touching `records` or a derived table: `add_note`, `update_note`, `save_briefing`,
  `update_profile`. HTTP `/mcp` is writable; CLI stdio stays read-only unless `--writable`
  is passed (which also opens SQLite writable).

## UI

Pages per [ui-design.md](ui-design.md):

| Page | Route |
| --- | --- |
| Changes | `/` |
| Trends | `/trends` |
| Metrics | `/metrics` |
| Metric detail | `/metrics/:key` |
| Devices | `/devices` |
| Import | `/import` |

Metric detail opens at 90 days when reached from Changes and at 180 days otherwise. Stack per
[0002](decisions/0002-ui-on-shadcn-tailwind-echarts.md): Vite + React, shadcn/ui on Tailwind
v4, ECharts, a small router with view state in the URL. Dark-first; copy lives in one module.

## Tech stack

Bun, TypeScript strict, SQLite (`bun:sqlite` + drizzle for the schema), Hono, `saxes` +
`yauzl`, `@modelcontextprotocol/sdk`, Vite + React, shadcn/ui + Tailwind v4, ECharts, one
router. Ask first before adding any other runtime dependency.

## Testing

- Every `B-` rule has a test or e2e check named by its id.
- Regression fixtures:
  - the v0 spike (wrist-temperature device swap → new stint, warming up, across-seam step,
    never a raw +4σ)
  - a minor app writing one sample → no seam
  - a same-name replacement watch with device-less sleep records → one new epoch for all
    metrics
  - alternating phone/watch step days → no seam
  - a flat respiratory-rate baseline → z bounded by the floor
  - a night spent in another timezone → assigned correctly and `tz_change` flagged
- Integration: fixture zip → db → `/api/changes`; re-import over pre-v1 rows fills `device_hw`.
- Playwright on synthetic data via `make e2e` (1440 and 390 px). Each UI slice also gets a
  real-data screenshot pass that someone actually looks at; findings are recorded without
  values.

## Success criteria (v1)

1. Re-importing the real export over the existing db finishes in under 2 minutes (B-I9). It
   fills `device_hw` on existing rows (B-I12), and an immediate second import adds 0 records.
2. On the real export, the watch that started on 2026-10-10 is its own epoch for **all**
   overnight metrics, including sleep and resting HR. Each overnight metric shows a z with
   confidence, or a warming-up/insufficient state with its reason. Steps have no spurious seams.
3. *Changes* names the top contributors with onset, confidence and checks. Each opens a Metric
   view whose chart, band and contributing nights agree with the finding.
4. A pi session answers "what changed recently, and could the device explain it?" using only
   MCP tools. The answer cites nights and states the confound without asserting a cause.
5. `bun run check` and `make e2e` pass; nothing personal is in Git or images.
6. The cluster deployment (harus-k3s) is updated through the ship-to-cluster playbook, the
   real export is re-imported there, and the backup CronJob still runs.

## Boundaries

- **Always**: deterministic stats; per-stint baselines; usable units only; `data/` out of Git.
- **Ask first**: new runtime dependencies beyond the stack; changing a principle in 0001;
  deleting stored data; exposure beyond the tailnet.
- **Never**: commit health data, the db or screenshots of real data; LLM arithmetic on raw
  series; assert a device or health cause.

## Roadmap (after v2)

HAE push ingest if freshness starts to matter; naps; a visit-prep summary; an advice layer
grounded in HowToLiveBetter; workouts and routes.
