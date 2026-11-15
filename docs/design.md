# midori design — v0

Status: approved 2026-11-13; eleven decisions from grilling rounds 1–3 folded in 2026-11-14.
Evidence base: the landscape survey and spike in harus-workstation
`docs/runbooks/research/2026-11/2026-11-13-midori-apple-health-assistant.md`
(commit f526308), which this design turns into decisions.

## Objective

A personal Apple Health **admin dashboard** — not a daily-carry tool. Single user (haru).
Periodic `export.zip` imports into a local SQLite store; deterministic, per-source deviation
analysis; a briefing UI; and a read-only MCP server so agents (pi, luna) can query the store.
No LLM runs inside midori in v0.

The acceptance story is to investigate a change in watch readiness using ranked,
per-metric evidence and source provenance. Apple’s proprietary readiness score and the
cause of a change cannot necessarily be established from an export; source changes are
potential confounders, not proof of a device artifact.

User stories:

- **Import**: I drop a new export.zip roughly monthly; ingestion is idempotent and tells me
  what is new since the last run.
- **Investigate**: pick a window, see each metric's deviation from my own baseline, ranked,
  with the contributing days linked as evidence.
- **Brief**: the opening screen answers "how am I doing" in one glance — last night, top
  deviations, recalibration notices, import cadence.
- **Agent query**: pi/luna answer questions about my health data through scoped read-only
  MCP tools backed by the same store.

## Non-goals (v0)

Real-time ingest (Health Auto Export / HealthKit sync), an iOS app, any LLM inside midori,
clinical FHIR records, the advisory layer (HowToLiveBetter), multi-user, public exposure,
Postgres/Timescale. All deferred deliberately — see roadmap.

## Capability map

| module      | responsibility                                                              | depends on |
| ----------- | --------------------------------------------------------------------------- | ---------- |
| `store`     | SQLite schema, migrations, record/source/import queries                      | —          |
| `ingest`    | unzip + stream-parse export.xml → typed rows, dedup, import-run bookkeeping  | `store`    |
| `stats`     | per-source daily aggregates, baselines, robust deviations, device events, typed findings | `store` |
| `http`      | Bun HTTP API (JSON) for the UI                                              | `stats`    |
| `briefing-ui` | web UI: briefing, investigate, import pages                                | `http`     |
| `mcp`       | read-only MCP server (stdio) exposing the same queries                       | `store`, `stats` |

Build order: `store` → `ingest` → `stats` → `http` + `briefing-ui` → `mcp` (mcp can start in
parallel with the UI once `stats` exists). Module specs split out only if a module outgrows
this document.

## Tech stack

- **Bun** — runtime, test runner, and SQLite driver in one toolchain.
- **TypeScript** strict throughout.
- **SQLite** (owner decision 2026-11-13: no Postgres for the MVP) — single file
  `data/midori.db`, WAL mode. Postgres is a later migration decision, not a v0 concern.
- **drizzle-orm + bun:sqlite** for typed schema and migrations (settled 2026-11-13: drizzle).
- **Hono** for HTTP (small, Bun-native).
- **Vite + React** for `web/` (settled 2026-11-13: React) with **uPlot** for charts, wrapped in a
  small React component (grill Q3) — multi-year daily series with baseline bands is its exact case.
- **@modelcontextprotocol/sdk**: stdio transport for local dev; **streamable HTTP transport,
  tailnet-only**, so agents on other machines (pi, luna) reach the cluster deployment (grill
  Q8/Q11). Tool set identical, all read-only.

## Commands

Scaffold-time exact commands will be pinned in the repo README when implementation starts;
shape: `bun install`, `bun run dev` (server + Vite), `bun run import <export.zip>`,
`bun run mcp`, `bun test`, `bun run check` (typecheck + lint).

## Project structure

```
src/store/     schema, migrations, query functions
src/ingest/    zip handling, SAX stream parser, record mapper, dedup
src/stats/     daily aggregates, night assembly, baselines, deviations, findings, trust labels
src/http/      Hono routes
src/mcp/       MCP tool definitions
web/           Vite + React app
docs/          this design; later ADRs and module specs
data/          gitignored: SQLite db, uploaded zips
```

## Data model (sketch)

- `imports(id, started_at, finished_at, export_date, zip_name, status, n_new, n_dup)`
- `sources(name PK, kind, first_seen, last_seen, n_records)` — kind: watch | iphone | app
- `records(id, type, source_name, start_at, end_at, value, unit, meta_json)` with a dedup
  unique key on `(type, source_name, start_at, end_at, value)`; re-imports collapse.
  **All recognized `<Record>` types are stored** (grill Q2) — the full ~2.05M rows of the real
  export, raw samples included: any future metric works without re-finding a deleted zip.
  Types outside the analysis whitelist are stored, not aggregated. Workout elements, GPS routes,
  and ECG CSVs are logged as present but not parsed in v0.
- `daily_metrics(metric, source_name, day, value, method, n)` PK `(metric, source_name, day)`
  — method: `median` (HRV, RHR, wrist temp, resp rate, SpO2) or `sum` (exercise min,
  effort, active energy); sleep assembled per night (rule below).
- `findings(id, kind, metric, source_name, window_days, baseline, recent, z, severity,
  evidence_json, created_day)`
- `device_events(source_name, kind, detected_day, note)` — kinds: `first_seen`, `last_seen`,
  `switch` (coverage boundary splitting a metric's timeline inside the baseline window).

**Night assembly rule** (validated in the spike): a sleep-stage record starting ≥15:00 local
belongs to that date's night; one starting <09:00 belongs to the previous date's night;
daytime records (naps) are excluded in v0. Per night, use the dominant source's stages only
(no cross-source double counting).

**Day semantics** (grill Q5): records store the UTC instant plus the export's local offset; a
"day" is the record's own local calendar day (JST for this user), derived at aggregation time.
Nights and "today" must match lived days, not UTC.

## Stats engine

Deterministic only — the two-layer rule from the survey: an LLM (in an agent, via MCP) may
narrate findings but never compute over raw series.

- Daily aggregates per `(metric, source_name, day)`. HRV restricted to nighttime samples
  (21:00–09:00), as in the spike.
- **Analysis anchor = each metric+source's last data day** (grill Q9), not calendar today —
  imports land roughly monthly, and anchoring to today would leave the recent window mostly
  empty air. Every view surfaces "as of <date>". Baselines: median and MAD over days −90…−29
  relative to that anchor; recent window: the 14 days before it. Robust
  z = (recent_median − baseline_median) / (1.4826 · MAD). Findings recompute per import — under
  this anchor they cannot change between imports, so the `findings` table is a pure cache.
  Require ≥15 baseline days and ≥7 recent days, else no finding.
- Severity: |z| ≥ 1.5 notable, ≥ 2.5 alert.
- **Per-source baselines are mandatory.** Deviations compare a source against itself. When a
  source coverage boundary falls inside the compared windows, emit a `device_events` row
  (`switch`), mark affected metrics *recalibrating*, and suppress cross-source z — the exact
  failure mode the spike caught (wrist temp "z = +4" that was a watch swap).
- Trust labels carried as first-class metadata per metric from the accuracy literature:
  steps/HR high trust; HRV moderate and context-sensitive; energy expenditure low, all brands.

Finding contract (TS):

```ts
type Finding = {
  kind: "deviation" | "recalibration" | "coverage";
  metric: string;            // "hrv_sdnn" | "rhr" | "sleep_h" | "wrist_temp" | ...
  source: string;            // device the comparison ran within
  windowDays: number;
  baseline: number; recent: number; unit: string;
  z: number | null;          // null when suppressed (recalibration)
  severity: "info" | "notable" | "alert";
  evidence: EvidenceRef[];   // { day, value, source } contributing days
};
```

## Interfaces

REST (Hono, JSON): `POST /api/imports` (zip upload), `GET /api/imports`,
`GET /api/briefing`, `GET /api/metrics/:metric/daily`, `GET /api/deviations?days=14`,
`GET /api/findings`, `GET /api/sources`.

MCP tools (read-only; stdio locally, streamable HTTP from the cluster): `list_imports`,
`list_sources`,
`metric_daily(metric, days)`, `deviations(days)`, `findings(since)`, `briefing()`.

UI pages: **Briefing** (last night, top ranked deviations with evidence links, recalibration
notices, import status + cadence nudge), **Investigate** (metric picker, baseline band chart,
deviation table, device events), **Import** (drop zone, run history, new-since-last-run counts).
No composite readiness/recovery score in v0 (grill Q1) — the ranking *is* the story, and a
composite is exactly the artifact that goes unexplained across device seams. Dark-first on
design tokens from day one (grill Q10), no theme switcher in v0; the deviation table and uPlot
bands get the polish. English-first copy in one centralized module (grill Q6).

## Testing strategy

`bun test` throughout; minimal GitHub Actions CI on push — `bun install`, typecheck, tests
(grill Q4; the repo is public). Unit: night assignment, baseline/z math on synthetic series,
dedup key behavior. Parser: a small synthetic `export.xml` fixture (~50 records). **Regression
fixture: the spike scenario** — a two-source wrist-temp series where the device swaps
mid-window must produce a `switch` event and suppressed z, never a raw +4σ deviation.
Integration: fixture zip → db → briefing endpoint payload. Browser e2e deferred.

## Success criteria (v0)

1. The real 909 MB export imports in < 5 min locally; an immediate re-import reports
   0 new records.
2. The investigate view shows per-source measurements and baseline limitations for the
   private export, without asserting that source changes explain observed differences.
3. Briefing renders fully from imported data; import page shows run history and cadence.
4. A pi session answers "what changed recently and why" using only MCP tools.
5. `bun test` green; `data/` gitignored; nothing personal leaves the host.
6. Closing milestone (grill Q11): running on harus-k3s per the ship-to-cluster playbook —
   tailnet-reachable, MCP over streamable HTTP, nightly backup CronJob firing.

## Boundaries

- **Always**: deterministic stats (no LLM in any compute path); per-source baselines;
  run tests before commits; keep `data/` out of git.
- **Backups are owned by midori** (grill Q7): nightly `VACUUM INTO` snapshot, 30-day retention,
  imported zips archived — as a k8s CronJob on the cluster (grill Q8), as a post-import job
  during local development. Health data does not rely on "the machine backup will catch it".
- **Ask first**: new runtime dependencies beyond the stack list; schema changes after this
  spec is approved; exposing the server beyond the tailnet.
- **Never**: commit health data or the db; LLM arithmetic on raw series; publish any
  exported data.

## Open questions

1. ~~drizzle-orm vs raw `bun:sqlite`~~ — settled 2026-11-13: drizzle.
2. ~~React vs Svelte~~ — settled 2026-11-13: React.
3. RMSSD vs SDNN across the device switch: v0 shows both series with a boundary marker and
   no blending; revisit if briefings feel broken at the seam.
4. ~~Hosting~~ — settled by grilling Q8/Q11: harus-k3s at the end of v0 (see Deployment).

## Deployment (end of v0, grill Q8 + Q11)

Develop the whole loop locally first (the real 909 MB export is on this machine); the cluster
is the final milestone, not a blocker. Container image on a Bun base; single pod; SQLite on a
PVC (single-writer — fine on k3s local-path); ingress via tailnet only; zip uploads through
ingress (66 MB is nothing). The chart is authored in harus-charts per its own workflow at
deployment time, via the ship-to-cluster playbook — cross-repo work that lives outside midori's
repo.

## Roadmap (post-v0)

- **v1**: HAE push ingest; advisory layer grounded in HowToLiveBetter (sync + citations);
  manual clinical entries (labs, meds, symptoms); longitudinal trends and 12-month heatmaps;
  workout routes.
- **v2**: Postgres migration if retention/multi-machine ever demands it; own iOS
  anchored-sync app (FreeReps pattern); a composite readiness score only if the briefing ever
  feels incomplete without one (grill Q1).
