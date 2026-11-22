# Implementation plan: midori v4 — Evergreen Identity, Multi-Metric Graphs, & Auditable Agent Write Layer

Status: rev 2 (2026-11-22), revised after independent review by Argon (`gemini-4-argon-high`,
[2026-11-22-v4-plan-review-argon.md](../docs/reviews/2026-11-22-v4-plan-review-argon.md)) —
all findings H1, H2, M1–M3, L1–L2 incorporated.
Baseline: `main@dfc5bca` (v3 complete, 338 tests green, 30 e2e passing).
References: [design](../docs/design.md), [journeys](../docs/journeys.md), [UI design](../docs/ui-design.md), [v3 plan](v3-plan.md).

## 1. Goal & scope

Turn `midori` into a distinctive, intuitive personal health workspace with three major upgrades:

1. **Identity & Evergreen Design Language (`web/`)**
   - Custom geometric **evergreen leaf SVG brand mark** (`BrandMark.tsx`, `web/public/favicon.svg`)
     replacing the 10px CSS dot, wired into `web/index.html` and `Shell.tsx` (`aria-hidden="true"`,
     no `<title>` so `e2e/shell.spec.ts` link name stays `"midori"`).
   - Refined dark-botanical surface tokens in both `web/src/styles/app.css` and
     `web/src/lib/theme.ts` (`#0a0c0b` bg, `#121614` card, `#1a201d` muted, `#232b27` border,
     subtle emerald top ambient glow) — with a `tests/web/theme.test.ts` sync assertion verifying
     `app.css` `--color-*` hex values match `THEME_DEFAULTS` and `EPOCH_PALETTE`.
   - Per-metric iconography (`MetricIcon.tsx` with named `lucide-react` imports) on `FindingRow`,
     `Metrics` cards, and `MetricDetail` headers.
2. **Multi-Metric Graphs — `/trends` (`B-T1`)**
   - Register `BarChart` (`echarts/charts`) and `AxisPointerComponent` (`echarts/components`) in
     `web/src/components/EChart.tsx` (`echarts.use([...])`).
   - New lazy-loaded **Trends** route (`/trends`, nav item between `Changes` and `Metrics`)
     powered by `GET /api/context?days=14|30`, reversing `context.recentNights` from `DESC` to
     chronological ascending (`ASC`) order before constructing x-axes and calling
     `clampNotesToAxis(context.recentNotes, days)`:
     - **Sleep Architecture Chart** (`SleepArchitectureChart.tsx`): ECharts stacked bar chart
       (Deep / REM / Core) over 14d or 30d with usual sleep median line, partial-night indicator,
       and note bands.
     - **Correlated Vitals Stack** (`CorrelatedVitalsChart.tsx`): ECharts 4-panel synchronized
       multi-grid chart (`Sleep`, `HRV (SDNN)`, `Resting HR`, `Wrist temp`) sharing one x-axis
       and linked crosshair (`axisPointer: { link: [{ xAxisIndex: "all" }] }`) + shaded note ranges.
3. **Auditable Agent Write Layer (`B-A6`, `B-A7`, `B-B1`–`B-B2`)**
   - Raw Apple Health `records` and deterministic derived stats remain **100% immutable** to agents.
   - Add auditable provenance (`author: 'owner' | 'agent'`, `author_name`) to `notes`.
   - Add `briefings` table (`migrations/0009_agent_writes_and_briefings.sql`) where agents
     (`luna`, `pi`) can publish dated, evidence-cited analysis & advice cards that render right
     on `midori`'s Home (`/`) page and can be dismissed/deleted by the owner.
   - Extend MCP (`createMcpServer({ db, writable = false })`) with read-only `list_briefings`
     (always mounted) and 4 auditable write tools (`add_note`, `update_note`, `save_briefing`,
     `update_profile`) mounted when `writable: true` (enabled on HTTP `/mcp` via `startServer`,
     opt-in `--writable` on CLI stdio with `openDb(dbPath, { readonly: !writable })`, disabled
     when `writable: false`).

Out of scope: LLM calls inside midori, mutating raw Apple Health records via MCP, composite
readiness score, HAE push ingest, new runtime dependencies.

## 2. Behavioral rules (additions to `docs/journeys.md`)

| ID | Given / when | Then |
| --- | --- | --- |
| B-B1 | `GET /api/briefings?limit=`, `POST /api/briefings`, `DELETE /api/briefings/:id` | `GET` returns newest-first briefings (`limit` integer 1..50, default 10; `400` on invalid). `POST` validates real calendar `asOfDay`, trimmed `title` (1–120), trimmed `summary` (1–4000), `authorName` (1–64), optional `citedNights` (valid calendar dates, max 30) and `citedMetrics` (known metric keys, max 20), returning `201 BriefingDTO` (`400 { error, retryable: false }` on invalid). `DELETE` returns `200 { deleted: true }` or `404`. Mutations return `405 { error: "briefings are read-only", retryable: false }` when `upload` is omitted. |
| B-B2 | Re-import or `derive()` runs | `briefings` is never cleared or modified by `derive()` or imports. |
| B-A6 | MCP `list_briefings({ limit? })` | Read-only (always mounted). Returns `{ briefings: BriefingDTO[] }`, validating `limit` 1..50 (`{ isError: true }` on invalid). |
| B-A7 | MCP write tools (`add_note`, `update_note`, `save_briefing`, `update_profile`) when `writable: true` | Mounted only when `writable: true` (enabled on HTTP `/mcp` when server is writable; off in read-only mode and stdio default unless `--writable`). `add_note`/`update_note` tag rows `author = "agent"` with validated `authorName` (default `"agent"`, 1–64 chars). `update_profile` accepts optional partial fields and merges with `getProfileContext(db)` before validating. All write tools enforce REST validators and return `{ isError: true }` on invalid input. Never mutate `records` or derived tables. |
| B-T1 | Trends page (`/trends`) | Displays Sleep Architecture (14d / 30d stacked Deep/REM/Core) and Correlated Vitals Stack (Sleep, HRV SDNN, Resting HR, Wrist temp on one synced ascending axis) from `GET /api/context?days=`. Empty state when no imports exist (B-R4). |

Also update `B-A2` and `B-U4` in `docs/journeys.md` and `McpServer` `instructions` to reflect
that raw `records` and derived tables are strictly immutable, stdio MCP is read-only by default
(`--writable` opt-in), and writable HTTP `/mcp` mounts the 4 auditable context write tools.

## 3. Data model (`migrations/0009_agent_writes_and_briefings.sql` + `src/db/schema.ts`)

```sql
-- Auditable provenance on owner/agent notes (B-A7) and agent briefings (B-B1–B-B2).
-- Neither table is cleared or modified by derive() or imports.

ALTER TABLE notes ADD COLUMN author TEXT NOT NULL DEFAULT 'owner' CHECK (author IN ('owner', 'agent'));
ALTER TABLE notes ADD COLUMN author_name TEXT;

CREATE TABLE briefings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asof_day TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  cited_nights_json TEXT NOT NULL DEFAULT '[]',
  cited_metrics_json TEXT NOT NULL DEFAULT '[]',
  author_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_briefings_created ON briefings (created_at DESC, id DESC);
```

- `src/db/schema.ts` updates `notes` (`author`, `authorName`) and adds `briefings`.
- `src/db/db.test.ts` updates all 4 migration lists with `"0009_agent_writes_and_briefings.sql"`,
  adds `briefings: schema.briefings` to `tables`, and adds a `notes.author` CHECK test.

## 4. Interfaces & DTOs (`src/domain/api.ts`)

- `NoteAuthor = "owner" | "agent"`
- `NoteDTO` gains `author: NoteAuthor` and `authorName: string | null`.
- `BriefingDTO`:
  ```ts
  export interface BriefingDTO {
    id: number;
    asOfDay: string;
    title: string;
    summary: string;
    citedNights: string[];
    citedMetrics: string[];
    authorName: string;
    createdAt: string;
  }
  ```
- `ChangesDTO` gains `latestBriefing: BriefingDTO | null`.
- `HealthContextDTO` gains `latestBriefing: BriefingDTO | null`.

### REST (`src/http/routes.ts`)
- `GET /api/briefings?limit=10` -> `{ briefings: BriefingDTO[] }` (always mounted)
- `POST /api/briefings` -> `201 BriefingDTO` (when `upload` present; else `405`)
- `DELETE /api/briefings/:id` -> `200 { deleted: true }` (when `upload` present; else `405`)

### MCP (`src/mcp/server.ts`, `src/mcp/http.ts`, `src/server.ts`, `src/cli.ts`)
- `createMcpServer({ db, writable = false })`:
  - Read-only tools (always mounted, 8 total): `changes`, `health_context`, `metric_series`,
    `nights`, `epochs`, `list_notes`, `list_briefings`, `list_imports`.
  - Auditable write tools (mounted when `writable: true`, 4 tools -> 12 total): `add_note`,
    `update_note`, `save_briefing`, `update_profile`.
  - Every tool description appends `${AGENT_GUIDANCE}` (`B-A3`).
- `mountMcp(app, { db, writable })` passes `writable` through; `startServer` mounts with
  `writable: true`. CLI `mcp` stays read-only by default and accepts `--writable` (opening SQLite
  with `openDb(dbPath, { readonly: !writable })`).
- `src/stats/notes.ts`: `createNote` accepts optional `provenance?: { author?: NoteAuthor; authorName?: string | null }` (defaults to `owner`/`null`); `updateNote` preserves existing provenance when omitted and updates it when supplied.
- `scripts/smoke-container.ts` asserts `/api/health`, `list_briefings`, and MCP write tools on
  the writable container.

## 5. UI (`web/src/`)

- **Brand & visual language**:
  - `web/public/favicon.svg` + `web/index.html` favicon & title (landed together in Slice 2 so
    `/favicon.svg` never 404s).
  - `web/src/components/BrandMark.tsx` (`aria-hidden="true"`, no `<title>`) used in `Shell.tsx`.
  - `web/src/components/MetricIcon.tsx` (named `lucide-react` imports) used in `FindingRow`,
    `Metrics`, and `MetricDetail`.
  - `web/src/styles/app.css` + `web/src/lib/theme.ts`: refined dark-botanical surface tokens
    (`#0a0c0b` bg, `#121614` card, `#1a201d` muted, `#232b27` border, subtle emerald top glow);
    `tests/web/theme.test.ts` verifies `app.css` matches `THEME_DEFAULTS` & `EPOCH_PALETTE`.
- **Latest Agent Briefing on Home (`Changes.tsx`, `BriefingCard.tsx`)**:
  - Renders cleanly below the Hero when `changes.latestBriefing !== null`, showing title,
    author badge (`by luna · as of Nov 12`), summary text, clickable cited-metric pills,
    cited-night chips, and a dismiss/delete button (`DELETE /api/briefings/:id`).
  - Notes in `NotesPanel.tsx` and Home chips show a subtle `agent` provenance badge when
    `note.author === "agent"`.
- **Trends page (`web/src/pages/Trends.tsx`, `router.tsx`, `Shell.tsx`, `EChart.tsx`)**:
  - Register `BarChart` and `AxisPointerComponent` in `EChart.tsx`.
  - New nav tab `Trends` (`/trends`, lazy-loaded via `lazyRouteComponent` in `router.tsx`).
  - `14d | 30d` toggle fetching `GET /api/context?days=14|30`, reversing `recentNights` to
    chronological ascending order before plotting and calling `clampNotesToAxis`.
  - `SleepArchitectureChart.tsx`: ECharts stacked bar chart (Deep / REM / Core) + usual median
    reference line + note bands + accessible summary.
  - `CorrelatedVitalsChart.tsx`: ECharts 4-grid synchronized chart (`Sleep`, `HRV (SDNN)`,
    `Resting HR`, `Wrist temp`) with linked `axisPointer`, shared date axis, and note bands.

## 6. Implementation slices (for `pi` DeepSeek via Herdr)

1. **Slice 1 — Migration 0009, Briefings CRUD, Note Provenance, & Auditable MCP Write Layer**
   - Backend: `migrations/0009_agent_writes_and_briefings.sql`, `src/db/schema.ts`,
     `src/db/db.test.ts`, `src/domain/api.ts`, `src/stats/notes.ts`, `src/stats/briefings.ts`,
     `src/stats/context.ts`, `src/http/queries.ts`, `src/http/routes.ts`, `src/mcp/server.ts`,
     `src/mcp/http.ts`, `src/server.ts`, `src/cli.ts`, `scripts/smoke-container.ts`,
     `docs/journeys.md`, `docs/design.md`.
   - Minimal web sync (so `bun run check` exits 0 on Slice 1): `web/src/api/fixtures.ts`
     (`latestBriefing: null`, `author: "owner"`, `authorName: null`) and `tests/web/notesDiff.test.ts`
     (`author: "owner"`, `authorName: null`).
   - Tests: `src/stats/briefings.test.ts`, `tests/integration/briefings.test.ts`,
     `src/mcp/server.test.ts` (update `list_notes` shape, 8 read-only tools + 12 writable tools
     with `${AGENT_GUIDANCE}` + write round-trips), `tests/integration/server.test.ts` (12 tools
     on writable `/mcp`), `src/stats/notes.test.ts`.
   - Gate: `bun run check` exits 0.
2. **Slice 2 — Evergreen Brand & Design Language, `BriefingCard`, and `/trends` Multi-Metric Graphs**
   - Frontend: `web/public/favicon.svg`, `web/index.html`, `web/src/styles/app.css`,
     `web/src/lib/theme.ts`, `web/src/components/EChart.tsx` (`BarChart`, `AxisPointerComponent`),
     `web/src/components/BrandMark.tsx`, `web/src/components/MetricIcon.tsx`,
     `web/src/components/BriefingCard.tsx`, `web/src/components/SleepArchitectureChart.tsx`,
     `web/src/components/CorrelatedVitalsChart.tsx`, `web/src/pages/Trends.tsx`,
     `web/src/router.tsx`, `web/src/components/Shell.tsx`, `web/src/components/FindingRow.tsx`,
     `web/src/components/NotesPanel.tsx`, `web/src/pages/Changes.tsx`, `web/src/pages/Metrics.tsx`,
     `web/src/pages/MetricDetail.tsx`, `web/src/api/client.ts`, `web/src/api/types.ts`,
     `web/src/copy.ts`.
   - Tests: `tests/web/theme.test.ts` (CSS/TS sync + contrast/CVD checks),
     `tests/web/trendsAndBriefings.test.ts` (ascending order + note clamping + briefing client),
     `e2e/trends-and-briefings.spec.ts`, `e2e/shell.spec.ts`.
   - Gate: `bun run check` exits 0, `bun run privacy-guard` exits 0, `make e2e` exits 0.
   - Lead visual verification: capture & inspect 1440px and 390px screenshots of `/` (with a
     briefing card) and `/trends` (Sleep Architecture + Correlated Vitals Stack) before merge.
