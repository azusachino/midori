# midori

assistant on ever green

A personal health analyst for Apple Health exports. Drop in a periodic `export.zip`, and
midori answers: *something feels off — what changed, since when, how sure are we, and is it
me or the device?*

It groups records by device epoch (source + hardware model) and assigns overnight metrics to
nights in their own timezone. It keeps rolling per-device baselines that re-baseline at a
device change instead of going dark. Every finding carries confidence, onset and confounder
checks (device change, OS update, partial nights, travel, missing nights). midori never
asserts a cause. Single user, tailnet-only, no LLM inside: agents read it over a read-only
MCP server.

- Design: [`docs/design.md`](docs/design.md)
- Behavior contract: [`docs/journeys.md`](docs/journeys.md) (B- rules; the only home of
  thresholds)
- UI: [`docs/ui-design.md`](docs/ui-design.md)
- Decisions: [`docs/decisions/`](docs/decisions/)
- Plan and ledger: [`tasks/`](tasks/)

## Commands

| Command | What it does |
| --- | --- |
| `bun run check` | typecheck + biome + tests (the CI gate) |
| `make e2e` | Playwright against the real server with a synthetic corpus |
| `bun run privacy-guard` | refuse tracked personal-data files |
| `bun run import <export.zip>` | import an export from the CLI (same job as the web upload) |
| `bun src/cli.ts changes --json [--db <path>]` | print the ranked findings |
| `bun src/cli.ts mcp [--db <path>]` | read-only MCP server over stdio |
| `bun run dev` | API (:5174) + Vite web (:5173, `/api` proxied) |
| `bun run build` / `bun run start` | production web build; serve API + web + MCP (`/mcp`) |
| `make image-app TAG=<tag>` | build the image and import it into local k3s containerd |
| `make smoke-container TAG=<tag>` | in-container smoke (synthetic import, changes, MCP, backup) |

## Rules

- **TypeScript only**: no `.js`/`.mjs` sources.
- **Personal data never enters Git or images.** Health data lives under `data/` (gitignored),
  CI runs the tracked-file privacy guard, and tests use synthetic fixtures only. Real-data
  checks are recorded as counts and pass/fail.
- **Deterministic stats only.** No LLM computes over series; wording stays neutral (B-F9).

## Layout

- `src/ingest/`: streaming zip/XML parser, record mapper, idempotent upsert store
- `src/stats/`: epochs, sticky primary + seams, nights, values, baselines, findings, checks,
  and the atomic `derive`
- `src/http/`: REST v1 read API and the import job (validate, progress, retry, reconcile)
- `src/mcp/`: MCP tools (`changes`, `metric_series`, `nights`, `epochs`, `list_imports`) over
  the same queries
- `src/backup/`: `VACUUM INTO` snapshots (≤30 days, ≤10 snapshots) and zip archive
- `web/`: React + Tailwind v4 + shadcn/ui + ECharts: Changes, Metrics, Metric detail, Devices,
  Import
- `migrations/`: SQL schema, the source of truth
