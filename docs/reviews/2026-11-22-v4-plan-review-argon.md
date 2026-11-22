# Independent Plan Review: midori v4 — Evergreen Identity, Multi-Metric Graphs, & Auditable Agent Write Layer

- **Reviewer**: Argon (`gemini-4-argon-high`)
- **Date**: 2026-11-22
- **Plan reviewed**: `vendor/midori/tasks/v4-plan.md` against `vendor/midori` (`main@dfc5bca`)
- **Verdict**: **APPROVE WITH CHANGES**

The v4 plan is cohesive, well-structured, and preserves `midori`'s core architectural boundaries (raw Apple Health `records` and derived tables remain 100% immutable to agents; `derive()` and imports never touch `notes`, `profile_context`, or `briefings`; `/trends` reuses `GET /api/context?days=14|30` without backend query duplication; zero new runtime dependencies).

Checking the plan against the live codebase surfaced **2 HIGH**, **3 MEDIUM**, and **2 LOW** findings that should be incorporated before implementation so Slice 1 and Slice 2 pass `bun run check`, `make e2e`, and `make smoke-container` on the first run.

---

## Findings

### HIGH

#### H1. `web/src/components/EChart.tsx` does not register `BarChart` or `AxisPointerComponent` (and is omitted from Slice 2's file list)
- **Evidence**:
  1. `web/src/components/EChart.tsx:1-32` uses tree-shaken `echarts/core` and currently registers only `LineChart`, `ScatterChart`, `CustomChart`, `CalendarComponent`, `GridComponent`, `TooltipComponent`, `MarkAreaComponent`, `MarkLineComponent`, `MarkPointComponent`, `DataZoomComponent`, `LegendComponent`, and `CanvasRenderer`.
  2. `SleepArchitectureChart.tsx` requires `BarChart` from `"echarts/charts"` (`type: "bar"`, `stack: "sleep"`). Without `BarChart` in `echarts.use([...])`, ECharts fails to render bar series and logs `[ECharts] Series bar is used but not imported`.
  3. `CorrelatedVitalsChart.tsx` uses a 4-grid synchronized crosshair (`axisPointer: { link: [{ xAxisIndex: "all" }] }`), which in modular `echarts/core` builds requires `AxisPointerComponent` from `"echarts/components"` to synchronize cursors across grids without logging `[ECharts] Component axisPointer is used but not imported` (which also fails Playwright's `trackErrors(page)` console-error guard).
  4. `web/src/components/EChart.tsx` is not listed in `v4-plan.md` §5 or §6 Slice 2.
- **Action**:
  - Add `web/src/components/EChart.tsx` to Slice 2's file list.
  - Import `BarChart` from `"echarts/charts"` and `AxisPointerComponent` from `"echarts/components"` in `web/src/components/EChart.tsx` and register both in `echarts.use([...])`.

#### H2. Slice 1 `bun run check` will fail in `tests/web/notesDiff.test.ts`, `src/mcp/server.test.ts`, `tests/integration/server.test.ts`, and `src/cli.ts` (`SQLITE_READONLY`) unless updated in Slice 1
- **Evidence**:
  1. **Typecheck failure in `tests/web/notesDiff.test.ts:7-16`**: Root `tsconfig.json:19` includes `["src", "tests", "scripts", "e2e", "playwright.config.ts"]`, and `web/src/api/types.ts` re-exports `NoteDTO` directly from `@midori/domain/api`. `tests/web/notesDiff.test.ts:7` defines `const note = (overrides: Partial<NoteDTO>): NoteDTO => ({ ... })` without `author` or `authorName`. Adding required `author: NoteAuthor` and `authorName: string | null` to `NoteDTO` in Slice 1 will fail `bun run typecheck` unless `tests/web/notesDiff.test.ts` is updated in Slice 1 (in addition to `web/src/api/fixtures.ts` `emptyChangesStub` and `changesStub` adding `latestBriefing: null`).
  2. **Strict `.toEqual` failure in `src/mcp/server.test.ts:106-118` (`B-U4 list_notes`)**: Line 106 asserts `expect(JSON.parse(textContent(all))).toEqual({ notes: [{ id: 1, startDay: "2026-03-02", endDay: "2026-03-04", category: "travel", label: "trip", createdAt: ..., updatedAt: ... }] })`. Once `toDto` in `src/stats/notes.ts` includes `author: "owner"` and `authorName: null`, this test will fail in Slice 1 unless updated.
  3. **MCP tool list assertions (`src/mcp/server.test.ts:47-55` and `tests/integration/server.test.ts:180,231-239`)**:
     - `src/mcp/server.test.ts:47` tests default read-only `createMcpServer({ db })` and asserts `.toEqual([...])` (must be updated to the 8 read-only tools including `"list_briefings"`).
     - `tests/integration/server.test.ts:231` tests `POST /mcp` `tools/list` on `startServer(...)`. Because `startServer` mounts `mountMcp(app, { db: opts.db, writable: true })`, `tools/list` on `/mcp` will return all **12 tools** (the 8 read-only tools plus `"add_note"`, `"update_note"`, `"save_briefing"`, `"update_profile"`). Additionally, `tests/integration/server.test.ts:180` passes `db: openDb(dbPath, { readonly: true })` into `startServer`; if that test calls any MCP write tool, `openDb(dbPath)` must be opened writable.
  4. **`src/cli.ts:69` opens SQLite with `{ readonly: true }` in `mcp` mode**: If `--writable` is passed to `bun src/cli.ts mcp --writable` while `openDb(dbPath, { readonly: true })` remains hardcoded, every MCP write tool call over stdio will fail with `SQLITE_READONLY: attempt to write a readonly database` (and migrations won't run).
- **Action**:
  - Include `tests/web/notesDiff.test.ts` in Slice 1 (`author: "owner", authorName: null` in `note()`).
  - In `src/mcp/server.test.ts`, update the `B-U4 list_notes` expected object with `author: "owner", authorName: null`, update the read-only tool list to 8 tools (adding `"list_briefings"`), and add a `writable: true` suite asserting all 12 tools carry `${AGENT_GUIDANCE}` (`B-A3`) and testing write round-trips.
  - In `tests/integration/server.test.ts`, update the `/mcp` `tools/list` expectation to all 12 tools (and open `db` without `{ readonly: true }` at line 180 if calling write tools).
  - In `src/cli.ts`, parse `--writable` under `command === "mcp"`, update `usage()`, and call `openDb(dbPath, { readonly: !writable })` and `createMcpServer({ db, writable })`.

---

### MEDIUM

#### M1. `web/src/lib/theme.ts` is omitted from Slice 2, leaving `tests/web/theme.test.ts` testing old zinc tokens instead of `web/src/styles/app.css`
- **Evidence**:
  1. `tests/web/theme.test.ts:3` imports `THEME_DEFAULTS` and `EPOCH_PALETTE` from `web/src/lib/theme.ts`; it does not read `web/src/styles/app.css`.
  2. `v4-plan.md` §5 and §6 Slice 2 list `web/src/styles/app.css` (`#0a0c0b` bg, `#121614` card, `#1a201d` muted, `#232b27` border) and `tests/web/theme.test.ts`, but omit `web/src/lib/theme.ts`.
  3. Verified against `tests/web/theme.test.ts`'s exact luminance/contrast/CVD math: updating `THEME_DEFAULTS` to `background: "#0a0c0b"`, `card: "#121614"`, `muted: "#1a201d"`, `border: "#232b27"`, `primaryForeground: "#0a0c0b"` passes every check with wide margin (`#f4f4f5` 16.60:1 on card, `#a1a1aa` 7.12:1, `#fb7185` 6.78:1, `minor` `#71717a` 3.78:1 >= 3.0, all 6 epoch colors >= 5.29:1 >= 4.5).
- **Action**:
  - Add `web/src/lib/theme.ts` to Slice 2 and update `THEME_DEFAULTS` (plus `--color-primary-foreground`, `--color-accent-foreground`, `--color-destructive-foreground` in `app.css`) to the new evergreen surface tokens.
  - Add a test in `tests/web/theme.test.ts` reading `web/src/styles/app.css` and asserting its `--color-*` hex values match `THEME_DEFAULTS` and `EPOCH_PALETTE` so CSS and TS fallbacks cannot drift.

#### M2. `GET /api/context` returns `recentNights` newest-first (`DESC`), which will invert `/trends` x-axes and break `clampNotesToAxis` unless reversed to `ASC`
- **Evidence**:
  1. `src/stats/context.ts:198` queries `nights` with `ORDER BY date DESC` (newest night at index `0`).
  2. Both `SleepArchitectureChart.tsx` and `CorrelatedVitalsChart.tsx` plot time series that must run chronologically left-to-right (`oldest -> newest`).
  3. `clampNotesToAxis(notes, days)` in `web/src/lib/metric-chart.ts:206-219` requires `days` to be sorted ascending (`const first = days[0]; const last = days[days.length - 1]; if (note.endDay < first || note.startDay > last) continue`). Passing a `DESC` `days` array causes `first > last` and drops overlapping note bands.
- **Action**:
  - In `Trends.tsx` / chart helpers, sort or reverse `context.recentNights` into chronological ascending order (`[...context.recentNights].reverse()`) before constructing the x-axis `days` array, series data, and `clampNotesToAxis(context.recentNotes, days)`.
  - Unit-test this ascending ordering and note-band clamping in `tests/web/trendsAndBriefings.test.ts`.

#### M3. Note provenance & MCP write-tool validation contracts (`createNote`/`updateNote` defaults, partial `update_profile`, and `B-A2`/`B-U4` doc updates)
- **Evidence**:
  1. `src/stats/notes.ts:123,135` (`createNote`, `updateNote`) is called by REST `POST /api/notes` and `PATCH /api/notes/:id` (`src/http/routes.ts:105,116`) and by 10 tests in `src/stats/notes.test.ts` without provenance arguments.
  2. `src/stats/profile.ts:51` (`validateProfileFields`) requires all 3 keys (`goals`, `routine`, `medicalContext`) to be strings on the input object.
  3. `docs/journeys.md:203` (`B-U4`: `"MCP is strictly read-only (B-A2)"`), `docs/journeys.md:251` (`B-A2`: `"Any tool | Read-only"`), and `src/mcp/server.ts:24` (`"Read-only access to an Apple Health warehouse"`) contradict `B-A7` unless updated in Slice 1.
- **Action**:
  - In `src/stats/notes.ts`, add optional `provenance?: { author?: NoteAuthor; authorName?: string | null }` to `createNote` (defaulting to `author = "owner"`, `authorName = null`) and `updateNote` (preserving existing `author`/`author_name` when `provenance` is omitted so REST owner edits keep provenance, while MCP `add_note`/`update_note` pass `{ author: "agent", authorName }`).
  - Validate `authorName` on MCP `add_note`, `update_note`, and `save_briefing`: default omitted `authorName` to `"agent"`, and reject blank or `> 64`-char trimmed strings with `{ isError: true }`.
  - In MCP `update_profile`, accept optional `goals`, `routine`, `medicalContext` and merge `{ ...getProfileContext(db), ...definedArgs }` before calling `validateProfileFields` so agents can update either a single profile field or all three.
  - If MCP `changes` tool output in `src/mcp/server.ts:53-58` is updated to include `latestBriefing: changes.latestBriefing`, update `src/mcp/server.test.ts:68-73` (`.toEqual(...)`) in Slice 1 to match.
  - Update `B-A2` and `B-U4` in `docs/journeys.md`, `docs/design.md`, and `McpServer` `instructions` in `src/mcp/server.ts` to reflect that raw `records` and derived tables are strictly immutable, stdio MCP is read-only by default (`--writable` opt-in), and HTTP `/mcp` mounts the 4 auditable write tools when the server is writable.

---

### LOW

#### L1. `web/public/favicon.svg` serving, `BrandMark` accessible link name in `e2e/shell.spec.ts`, and bundle budget hygiene
- **Evidence**:
  1. `web/vite.config.ts:14` sets `root` to `web/`, so Vite's default `publicDir` (`web/public`) copies `web/public/favicon.svg` to `web/dist/favicon.svg` on `bun run build`, and `src/server.ts:37` (`staticFile`) serves `/favicon.svg` with `200 OK` (`image/svg+xml`). However, if `<link rel="icon" href="/favicon.svg">` is added to `web/index.html` without `web/public/favicon.svg` present at build time, `src/server.ts:78` (`extname(pathname) !== ""`) returns `404`, triggering a browser console error that fails `trackErrors(page)` in `e2e/*.spec.ts`.
  2. `e2e/shell.spec.ts:130` queries `page.getByRole("link", { name: copy.app.name })`. If `BrandMark.tsx` renders an `<svg>` with a `<title>` or `aria-label` inside `<Link to="/">`, it will alter the link's accessible name and break `e2e/shell.spec.ts:130`.
  3. `web/vite.config.ts:31-43` isolates ECharts into a lazy chunk (`manualChunks`).
- **Action**:
  - Land `web/public/favicon.svg` and `web/index.html` together in Slice 2, and set `aria-hidden="true"` (with no `<title>`) on `BrandMark.tsx`'s `<svg>`.
  - Load `/trends` via `lazyRouteComponent(() => import("@/pages/Trends"), "TrendsPage")` in `web/src/router.tsx` so ECharts remains out of the entry `/` bundle, and use named icon imports in `MetricIcon.tsx` (`import { Moon, HeartPulse, ... } from "lucide-react"`) rather than a namespace import (`import * as Icons from "lucide-react"`).

#### L2. Migration `0009` SQLite `ALTER TABLE` + `CHECK` constraint verification and `src/db/db.test.ts` updates
- **Evidence**:
  - Verified directly in `bun:sqlite`: `ALTER TABLE notes ADD COLUMN author TEXT NOT NULL DEFAULT 'owner' CHECK (author IN ('owner', 'agent')); ALTER TABLE notes ADD COLUMN author_name TEXT;` succeeds on existing populated `notes` tables, backfills `author = 'owner'` and `author_name = null`, and enforces the `CHECK` constraint on subsequent writes.
  - `src/db/db.test.ts` asserts the exact list of applied migrations in 4 tests (lines 25, 67, 107, 164) and checks Drizzle schema column parity in `tables` at line 285.
- **Action**:
  - Update all 4 migration list expectations and the `tables` map in `src/db/db.test.ts`, and add a test under `describe("check constraints")` verifying that `notes.author` rejects values outside `('owner', 'agent')`.
