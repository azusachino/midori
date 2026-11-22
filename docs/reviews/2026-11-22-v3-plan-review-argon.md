# Independent Plan Review: midori v3 — Polished Vitals UI, Version Info, & Agent Health Context MCP

- **Reviewer**: Argon (`gemini-4-argon-high`)
- **Date**: 2026-11-22
- **Plan reviewed**: `vendor/midori/tasks/v3-plan.md` against `vendor/midori` (`main@e0b1007`)
- **Verdict**: **APPROVE WITH CHANGES**

The v3 plan is well-scoped and preserves `midori`'s core invariants (deterministic per-stint statistics, atomic `derive()` transaction that never touches owner-authored tables, read-only MCP, neutral `B-F9` copy, and zero new runtime dependencies). Checking the plan against the live codebase surfaced **2 HIGH**, **3 MEDIUM**, and **2 LOW** findings that should be addressed in the plan/slices so `bun run check`, `make e2e`, and `make smoke-container` stay green on the first pass.

---

## Findings

### HIGH

#### H1. Slice 1 `bun run check` will fail in `tests/integration/server.test.ts`, `src/mcp/server.test.ts`, and `src/db/db.test.ts` unless existing exact-match assertions and `AGENT_GUIDANCE` are updated in Slice 1
- **Evidence**:
  1. `tests/integration/server.test.ts:70` asserts `expect(await response.json()).toEqual({ ok: true })` (strict deep equality) on `GET /api/health`. Returning `{ ok: true, version, revision }` in Slice 1 will fail this test unless updated.
  2. `src/mcp/server.test.ts:47-54` and `tests/integration/server.test.ts:227-234` both assert the exact MCP tool list `.toEqual(["changes", "metric_series", "nights", "epochs", "list_notes", "list_imports"])`.
  3. `src/mcp/server.test.ts:55-61` iterates over **every** tool returned by `client.listTools()` and asserts that `tool.description` contains `"Cite the specific nights"`, `"Device changes, OS updates, partial data, travel, and personal notes are confounders"`, and `"midori does not assert causes"` (`AGENT_GUIDANCE`).
  4. `src/db/db.test.ts` hardcodes the applied migration list in **four** places (lines 25, 66, 105, and 159) in addition to the Drizzle `tables` parity map at line 279.
- **Action**:
  - In Slice 1, append `${AGENT_GUIDANCE}` to `health_context`'s MCP tool description in `src/mcp/server.ts`.
  - Include `tests/integration/server.test.ts` and `src/mcp/server.test.ts` in Slice 1's file list (update the `/api/health` expectation and add `"health_context"` to both `tools/list` assertions).
  - In `src/db/db.test.ts`, update all 4 migration list assertions (lines 25, 66, 105, 159) with `"0008_profile_context.sql"` and add `profile_context: schema.profileContext` to `tables` at line 279.

#### H2. UI redesign breaks `e2e/notes-and-diff.spec.ts` and risks breaking `B-R3` (`e2e/changes.spec.ts`) and Playwright strict mode (`data-testid="app-version"`)
- **Evidence**:
  1. **Notes on Changes (`e2e/notes-and-diff.spec.ts`)**: Lines 58–65 expect inline `note-row-*`, `note-delete-btn-*`, and `notes-empty` directly inside `data-testid="changes-notes"` on `/`. Line 138 (`B-F15` diff test, where `recentNotes: []`) asserts `await expect(page.getByTestId("changes-notes")).toBeVisible()`. In v3, the raw inline form on `/` is replaced by `ContextSheet`, and the compact notes strip is only rendered when `changes.recentNotes.length > 0`.
  2. **`LastNightCard` when `lastNight === null` (`e2e/changes.spec.ts:208-210`, `B-R3`)**: Plan §5 states: *"Right (5 cols): `LastNightCard` promoted into the hero (when `lastNight` exists)"*. However, when `lastNight === null` (as in `staleChangesStub()`), `B-R3` and `e2e/changes.spec.ts:208-210` require `data-testid="last-night-card"` to still render on `/` with `copy.pages.changes.lastNight.noneRecent` (`"No complete night in the last 14 days."`).
  3. **Duplicate `data-testid="app-version"` and sidebar geometry (`e2e/shell.spec.ts:69-77`)**: Plan §5 specifies rendering `data-testid="app-version"` in both the desktop sidebar footer and mobile header. Because `Shell.tsx` renders both the mobile header (`md:hidden`) and desktop sidebar (`hidden md:block`) in the DOM simultaneously, `page.getByTestId("app-version")` will fail Playwright strict mode (`resolved to 2 elements`). Additionally, `e2e/shell.spec.ts:69-77` asserts that `sidebar-watch` sits within `64px` below `sidebar-nav` and stays on-screen when scrolled at `1440x480`.
- **Action**:
  - Update `e2e/notes-and-diff.spec.ts` in Slice 2: in test 1, verify the compact note chip on `/`, open `ContextSheet` (via the strip's `"Manage"` button or hero trigger), delete the note inside `ContextSheet`, and verify `notes-empty`; in test 2 (`recentNotes: []`), assert the hero trigger button (`+ Log note` / `Agent profile`) is visible and the compact notes strip is absent.
  - Always render `LastNightCard` in the right hero column even when `changes.lastNight === null` so `B-R3` and `e2e/changes.spec.ts:208` remain green.
  - Use distinct test IDs for desktop vs. mobile version badges (e.g. `data-testid="sidebar-version"` and `data-testid="mobile-version"`, or `.first()` / a single shared header element), and place the desktop sidebar version footer **below** `sidebar-watch` inside the sticky container so `sidebar-nav` -> `sidebar-watch` spacing (`< 64px`) in `e2e/shell.spec.ts:71` is untouched.

---

### MEDIUM

#### M1. `B-R5` build/version plumbing: `package.json` lacks a `"version"` field, and `Makefile` passes a 40-char `SOURCE_REVISION` while `B-R5` requires a 7-char `revision`
- **Evidence**:
  1. `package.json:1-5` has `"name": "midori"`, `"private": true`, `"type": "module"`, and **no `"version"` field**. A fallback to `package.json` version will return `undefined` unless `"version"` is added to `package.json` (and/or `getBuildInfo()` falls back to `"dev"`).
  2. `Makefile:13` defines `SOURCE_REVISION ?= $(shell git rev-parse HEAD)$(if $(shell git status --porcelain),-dirty)` (full 40-char SHA, plus optional `-dirty`). `Dockerfile` sets `ENV MIDORI_REVISION=$SOURCE_REVISION`. Without truncation in `getBuildInfo()`, `/api/health` and the UI badge will output a 40+ char SHA instead of the 7-char revision specified in `B-R5`.
- **Action**:
  - Add `"version": "0.0.1-rc4"` (or `"0.1.0"`) to `package.json`.
  - In `src/domain/build.ts`, trim `MIDORI_VERSION` and `MIDORI_REVISION`, fall back empty strings to `package.json` version / `"dev"`, and shorten 40-char hex revisions to 7 chars (preserving any `-dirty` suffix, e.g. `/^([0-9a-f]{7})[0-9a-f]{33}(-dirty)?$/i` -> `$1$2`).
  - Keep `src/domain/build.ts` server-only (do not import it from `web/src/`, as `web/tsconfig.json` uses `"types": ["vite/client"]` without Bun/Node types).
  - Update `scripts/smoke-container.ts` to assert `GET /api/health` returns `{ ok: true, version, revision }` and that MCP `tools/list` includes `"health_context"`.

#### M2. `B-A5` `health_context` primary-stint query discipline, `longTerm` window math, and REST/MCP `findings` parity
- **Evidence**:
  1. **`longTerm` stint boundary**: Per ADR 0001, pooling `metric_values` across device epochs/stints corrupts baselines across hardware seams.
  2. **`recentNights` multi-epoch & partial-unit risk**: `metric_values` has primary key `(metric, epoch_id, unit_day)` and stores both `usable = 1` and `usable = 0` rows. A naive `SELECT metric, value FROM metric_values WHERE unit_day = ?` can pick a secondary/minor device epoch or surface an unusable (`usable = 0`, export-cut) partial value as a valid night reading.
  3. **`findings` enrichment**: `readFindings(db)` in `src/stats/findings.ts:120,137` sets `epochLabel` to `deviceHw` (`"Watch7,5"`) and `caveats` to raw check keys (`["tz_change"]`), whereas `apiFindings(db)` in `src/http/queries.ts:137-151` maps `epochLabel` to `source_name` (`"Synthetic Watch B"`) and `caveatsFor(row)` in `src/mcp/server.ts:22-30` produces human-readable caveat sentences.
  4. **MCP `days` validation**: `B-A5` requires invalid `days` (`< 7`, `> 30`, non-integer) to return HTTP `400` on REST and `isError: true` on MCP.
- **Action**:
  - Compute each finding's `longTerm: { median90d, median1y, n90d, n1y }` strictly from `metric_values` with `usable = 1`, `epoch_id = currentStint.epochId`, `unit_day >= currentStint.startDay`, and `unit_day <= asOfDay`, within `[addDays(asOfDay, -89), asOfDay]` (`90d`) and `[addDays(asOfDay, -364), asOfDay]` (`1y`) (matching `getSeries` in `src/http/queries.ts:438-444`). Return `{ median90d: null, median1y: null, n90d: 0, n1y: 0 }` when `asOfDay` or `stint` is null or no usable units exist.
  - For `recentNights`, return `[]` when `asOfDay === null`; otherwise query `nights WHERE date BETWEEN addDays(asOfDay, -(days - 1)) AND asOfDay ORDER BY date DESC`. Populate each night's `metrics` for all overnight metric keys (`Object.values(METRICS).filter(m => m.kind === "overnight")`) by joining `stints` (`s.metric = v.metric AND s.epoch_id = v.epoch_id AND s.start_day <= v.unit_day AND (s.end_day IS NULL OR s.end_day >= v.unit_day)`) with `v.usable = 1` (mapping missing or `usable = 0` values to `null`).
  - Use `apiFindings(db)` + human-readable `caveatsFor(row)` for `HealthContextDTO.findings`, and compute `HealthContextDTO.summary` using the exact `Changes.tsx:50-60` definitions (`standsOut`, `closeToEdge`, `within`, `other`, `sharedConfounders`).
  - In `src/mcp/server.ts`, accept `days: z.number().optional()` in `inputSchema` and validate `Number.isInteger(days) && days >= 7 && days <= 30` inside the tool handler so invalid values consistently return `{ isError: true, content: [...] }`.

#### M3. `RangeGauge` and `FindingRow` edge cases: zero/degenerate band, extreme `z` clamping, pre-9c fraction `%` guard, and stretched-link clickability
- **Evidence**:
  1. `web/src/lib/finding-format.ts:88-90` (`formatRecentVsBaseline`) suppresses pre-9c fraction-scale `%` values (`row.unit === "%" && (row.recentMedian < 1.5 || row.baselineMedian < 1.5)`), and `tests/web/findingFormat.test.ts:87-96` + `web/src/pages/Metrics.tsx:69` depend on `formatRecentVsBaseline`.
  2. In `staleChangesStub()` (`web/src/api/fixtures.ts:426`) and the E2E corpus (`steps`), `|z| >= 10` (`z = 12.4`). If `RangeGauge` auto-scales its domain to `recentMedian`, extreme outliers squash the usual band `[baselineLow, baselineHigh]` into an unreadable sliver; if it divides by `baselineHigh - baselineLow` without a floor, a zero-width synthetic stub produces `NaN` SVG coordinates (failing Playwright console error tracking).
  3. `FindingRow.tsx:80` uses `after:absolute after:inset-0 after:z-0` on the metric `<Link>` so the entire row is clickable.
- **Action**:
  - Keep `formatRecentVsBaseline` exported in `web/src/lib/finding-format.ts`, and apply the same fraction-scale `%` suppression guard to `FindingRow`'s prominent value readout and `RangeGauge`.
  - In `RangeGauge`, return `null` when `row.state !== "computed"` or any of `recentMedian`, `baselineMedian`, `baselineLow`, `baselineHigh` is `null` (or suppressed by the `%` guard).
  - Map `[baselineLow, baselineHigh]` to a fixed middle band of the horizontal track (e.g. `30%..70%` of width, with `baselineMedian` at `50%`, guarding `halfBand = Math.max(1e-6, (baselineHigh - baselineLow) / 2)`) and clamp the `recentMedian` dot position into `[padX, width - padX]`.
  - Render `RangeGauge` with `pointer-events-none` so it never blocks `FindingRow`'s stretched link.

---

### LOW

#### L1. `B-P1` `profile_context` empty-table default, `PUT /api/profile` validation contract, and read-only `405` handling
- **Evidence**: On a fresh database before any `PUT /api/profile`, `profile_context` has 0 rows. Also, `web/src/api/client.ts:136` (`isErrorBody`) requires every HTTP error response to include `{ error: string, retryable: boolean }`.
- **Action**:
  - Pin that `GET /api/profile` (and `HealthContextDTO.profile`) returns `{ goals: "", routine: "", medicalContext: "", updatedAt: null }` when row `id = 1` does not exist.
  - On `PUT /api/profile`, reject non-object JSON bodies with `400 { error, retryable: false }`, require `goals`, `routine`, and `medicalContext` to be strings (trimmed length `0..1000` chars, allowing `""` so the owner can clear a field), and upsert row `id = 1`.
  - When `upload` is omitted in `createApp({ db })`, mount `PUT /api/profile` returning `405 { error: "profile is read-only", retryable: false }`.

#### L2. `ShellProvider` `/api/health` fetch isolation and `B-F9` neutral copy guard
- **Evidence**:
  1. `tests/web/client.test.ts:73` calls `loadShellChanges(c)` directly with a client stub that only mocks `/api/changes`.
  2. `tests/web/theme.test.ts:130-137` serializes `copy` via `JSON.stringify(copy)` and asserts it never contains `"caused"`, `"better"`, `"worse"`, or `"your watch is wrong"`.
- **Action**:
  - Keep `loadShellChanges(client: Pick<ApiClient, "changes">, signal?)` signature and behavior unchanged in `web/src/lib/shell-context.ts`, and fetch `apiClient.health(signal)` separately in `ShellProvider` (catching errors and falling back to `build: null`).
  - Ensure all new strings in `web/src/copy.ts` (`ContextSheet`, `RangeGauge`, version badge, and profile fields) comply with `B-F9` neutral wording.
