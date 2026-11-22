# Independent Plan Review: midori v2 — Own Notes as Confounders & Import-to-Import Diff

- **Reviewer**: Argon (`gemini-4-argon-high`)
- **Date**: 2026-11-22
- **Plan reviewed**: `vendor/midori/tasks/v2-plan.md` against `vendor/midori` (`main@50b30b8`)
- **Verdict**: **APPROVE WITH CHANGES**

The plan preserves `midori`'s core invariants (deterministic stats, atomic `derive()` transaction, neutral `B-F9` copy, read-only MCP, no new runtime dependencies). However, checking the plan against the live codebase exposed two **HIGH** issues (a state/severity trap in `B-F15` diff classification and a cross-target typecheck break in Slice 1/2's `bun run check` gate) plus several **MEDIUM** and **LOW** edge cases that should be tightened before implementation starts.

---

## Findings

### HIGH

#### H1. `B-F15` `returned_to_usual` and `shifted_further` will misclassify non-computed states and moderating metrics
- **Evidence**: In `src/stats/baselines.ts:141`, `deriveOne()` sets `severity: severityOf(z)` for every row, and `severityOf(null)` returns `"within"`. As a result, rows in `findings` with `state` in `"warming_up" | "insufficient" | "stale"` are stored with `severity = "within"` (`src/stats/baselines.ts:196`).
- **Impact**:
  1. If `B-F15` checks `prev.severity in ('notable', 'alert') -> curr.severity === 'within'` without requiring `curr.state === 'computed'`, any notable metric whose baseline resets for a new watch (`warming_up`) or becomes `insufficient`/`stale` will be falsely classified as `returned_to_usual`.
  2. For `shifted_further` (`stayed notable/alert and escalated severity or |delta z| >= 0.5`), if `|delta z| >= 0.5` is evaluated as `Math.abs(curr.z - prev.z) >= 0.5`, a metric that **moderated** toward baseline on the same side (e.g. `z = +3.0` alert -> `z = +2.2` notable, `|Δz| = 0.8`) would be misclassified as `shifted_further`.
- **Action**:
  - Require `prev.state === "computed" && curr.state === "computed"` for `returned_to_usual`, `direction_reversed`, and `shifted_further`.
  - Evaluate `direction_reversed` (`prev.direction !== curr.direction` while both are computed `notable`/`alert`) **before** `shifted_further`.
  - For `shifted_further`, require `prev.direction === curr.direction` and either severity escalation (`prev.severity === "notable" && curr.severity === "alert"`) or `Math.abs(curr.z) - Math.abs(prev.z) >= 0.5` (moved further from 0, not closer). If both stay `notable`/`alert` on the same side without escalating or increasing `|z|` by `>= 0.5`, count in `unchangedCount`.

#### H2. Slice 1 and Slice 2 `bun run check` gates will fail `tsc -p web/tsconfig.json` unless web type consumers are updated in tandem
- **Evidence**: `package.json:6-7` defines `"check": "bun run typecheck && bun run lint && bun run test"` where `"typecheck"` runs both `tsc --noEmit` and `tsc -p web/tsconfig.json --noEmit`. `web/src/api/types.ts` re-exports `CheckDTO`, `ChangesDTO`, `MetricSeriesDTO`, and `UnitEvidenceDTO` directly from `@midori/domain/api` (`src/domain/api.ts`).
- **Impact**:
  1. Adding `"user_note"` to `CheckDTO["key"]` in `src/domain/api.ts` in Slice 1 immediately breaks `tsc -p web/tsconfig.json` in `web/src/lib/evidence.ts:22-61` (`formatClearLabel` and `formatFlaggedLabel` use exhaustive `switch (key)` over `CheckKey` with no `default` branch) and in `web/src/components/FindingRow.tsx:209` (`copy.checks[check.key]` fails to index `copy.checks` until `user_note` exists in `web/src/copy.ts`).
  2. Adding required fields (`recentNotes`, `sinceLastImport`, `notes`) to `ChangesDTO`, `MetricSeriesDTO`, and `UnitEvidenceDTO` in Slice 1/2 breaks `web/src/api/fixtures.ts` (`emptyChangesStub`, `changesStub`, `metricSeriesStub`, `unitEvidenceStub`) and `tests/web/*.test.ts`.
- **Action**: Pull the minimal `web/src/copy.ts` check strings (`copy.checks.user_note`, `copy.pages.changes.checkNouns.user_note`, `checksClearLabels.user_note`, `checksFlaggedLabels.user_note`), `web/src/lib/evidence.ts` `CHECK_ORDER`/switch cases, and `web/src/api/fixtures.ts` default fields into Slice 1 and Slice 2 (leaving UI component work in Slice 3) so `bun run check` actually exits 0 at the end of every slice.

---

### MEDIUM

#### M1. Migration `0007` should backfill `finding_snapshots` for existing v1 databases, and `src/db/db.test.ts` needs 4 updates
- **Evidence**: On an upgraded v1 instance (where at least one `done` import and current `findings` rows already exist), `0007_notes_and_snapshots.sql` creates `finding_snapshots` empty. The first v2 import would have no prior snapshot to diff against (`sinceLastImport = null`), requiring two new exports before Feature B produces a diff. Also, `src/db/db.test.ts` hardcodes the migration list at lines 25, 65, and 97 and the table map at line 216.
- **Action**:
  - In `migrations/0007_notes_and_snapshots.sql`, backfill `finding_snapshots` from `findings` for `import_id = (SELECT MAX(id) FROM imports WHERE status = 'done')` when such an import exists, computing `direction` with `CASE WHEN state != 'computed' OR z IS NULL THEN NULL WHEN severity = 'within' THEN 'within' WHEN z > 0 THEN 'higher' ELSE 'lower' END` (matching `src/stats/findings.ts:74-81` and `0006_import_as_of_day.sql`).
  - Inside `derive(db, { importId })`, run `DELETE FROM finding_snapshots WHERE import_id = ?` before inserting snapshot rows so retries or repeated `derive()` calls for the same `importId` are idempotent, and ensure failed imports after derive (or rollbacks) leave no snapshot rows (`B-I13`).
  - Add `src/db/db.test.ts` to Slice 1's file list (update lines 25, 65, 97, and add `notes` + `finding_snapshots` to `tables` at line 216).

#### M2. Duplicate (`B-I3`) and older (`B-I4`) imports on `Import.tsx` summary vs `Changes.tsx`
- **Evidence**: `B-F15` compares against the most recent prior `done` import snapshot with a strictly earlier `asof_day`. On `Changes.tsx` (`sinceLastImport`), this works as intended: re-importing the same zip (`B-I3`) keeps the diff between the current `asOfDay` and the previous distinct `asOfDay`. However, on `Import.tsx:550` (`completedJob` summary card) and `GET /api/imports/:id/diff`, if import `:id` inserted 0 records (`B-I3`: `"Nothing new: 0 new records."`) or was an older export (`B-I4`: `olderThanStored === true`), an earlier `done` import (`id < :id`) already had `asof_day >= target.asof_day`. Displaying a diff from an even older `asof_day` on that import's summary card would contradict `"Nothing new: 0 new records."`
- **Action**:
  - For `GET /api/imports/:id/diff` (and the `Import.tsx` summary card), return `null` when any prior `done` import (`id < :id`) already has `asof_day >= target.asof_day` (or when `completedJob.recordsInserted === 0 || completedJob.olderThanStored`).
  - Keep `ChangesDTO.sinceLastImport` comparing the latest `done` snapshot against the most recent prior `done` snapshot with `asof_day < current.asof_day`.

#### M3. `B-F13` shared confounders noun for `user_note` and `ChangesDTO.recentNotes` upper date bound
- **Evidence**:
  1. Because user notes are global by date and computed overnight metrics share the same 7-night window, any note overlapping the recent window will flag `user_note` on all computed overnight rows (`>= 50%`), triggering `sharedFlaggedChecks()` (`web/src/lib/finding-format.ts:154`) on `Changes.tsx:56`. If `copy.pages.changes.checkNouns.user_note` is not defined in `web/src/copy.ts:179`, `Changes.tsx:57` will render the raw key `"user_note"`.
  2. Plan §4 line 90 defines `ChangesDTO.recentNotes` as "notes overlapping the last 35 days up to `asOfDay`". If a user opens `Changes` when `asOfDay` is several days old (e.g. Nov 7) and logs a note for today (Nov 15) before importing, filtering `recentNotes` by `start_day <= asOfDay` would cause the newly created note to vanish from the Changes notes panel on refresh.
- **Action**:
  - Add `user_note: "a personal note"` to `copy.pages.changes.checkNouns`.
  - In `getChanges(db)`, query `recentNotes` with `end_day >= addDays(asOfDay, -34)` without upper-capping `start_day <= asOfDay` (and return all notes when `asOfDay === null`), while keeping `B-C7` in `deriveChecks()` strictly clamped to `[oldestRecentDay, newestRecentDay]` (`<= asOfDay`).

#### M4. `PATCH /api/notes/:id` partial-update validation, calendar date validation, and read-only route mounting
- **Evidence**:
  1. `notes` has `CHECK (end_day >= start_day)`. If `PATCH /api/notes/:id` receives only `startDay` or only `endDay`, validating only the request body in isolation will miss `nextStartDay > nextEndDay` and let SQLite throw a 500 constraint error instead of `400`.
  2. `web/src/api/client.ts:127` (`isErrorBody`) requires every error JSON response to include both `error: string` and `retryable: boolean`.
  3. Read-only mode omits `upload` in `createApp({ db })` (`src/http/routes.ts:14-22`).
- **Action**:
  - Validate calendar dates using real UTC round-trip checks (matching `getNights` in `src/http/queries.ts:884-891`, rejecting impossible dates like `2026-02-30`) across `POST/PATCH/GET /api/notes` and MCP `list_notes`.
  - On `PATCH /api/notes/:id`, load the existing row first (`404` if missing), merge `{ startDay, endDay, category, label }`, validate `endDay >= startDay` and trimmed `label` length `1..140`, and return `400 { error, retryable: false }` on any violation.
  - Mount `GET /api/notes` and `GET /api/imports/:id/diff` unconditionally in `createApp()`, and return `405 { error: "notes are read-only", retryable: false }` (or omit/404) for `POST/PATCH/DELETE /api/notes` when `upload` is omitted.

#### M5. Multi-day note clamping in `MetricChart.tsx` and parent query invalidation in `EvidenceSheet.tsx`
- **Evidence**:
  1. `MetricChart.tsx:66` builds `dayIndex` from `buildCalendarDays(series)` (`web/src/lib/metric-chart.ts:145`), which only contains days within the active range (`90d`/`180d`/`1y`, or Monday week starts when `range === "all"`). A multi-day note overlapping the chart window can have `startDay < days[0]` or `endDay > days.at(-1)`. Looking up `dayIndex.get(note.startDay)` without clamping to `[days[0], days.at(-1)]` (and snapping to `toWeekStartMonday` when `range === "all"`) will return `undefined` and drop boundary-spanning notes.
  2. `EvidenceSheet.tsx:119` runs its own `useAsyncQuery` inside `MetricDetailPage` (`web/src/pages/MetricDetail.tsx:47`). Adding/editing/deleting a note inside `EvidenceSheet` will leave `MetricDetailPage`'s `ChecksPanel` (`B-C7`) and `MetricChart` stale unless `EvidenceSheet` notifies `MetricDetailPage` and `useShell()`.
- **Action**:
  - Clamp each overlapping note's `[startDay, endDay]` to `[days[0], days.at(-1)]` (mapped through `axisDay` for `range === "all"`) before rendering `MetricChart` markers/bands and tooltip lines.
  - Pass an `onNotesChanged?: () => void` callback from `MetricDetailPage` to `EvidenceSheet` that calls `query.retry()` and `shell.refresh()` after note mutations.

---

### LOW

#### L1. MCP `changes()` manual payload construction and `CHECK_CAVEATS` (`src/mcp/server.ts`)
- **Evidence**: `src/mcp/server.ts:48-58` does not serialize `getChanges(db)` directly; it returns `JSON.stringify({ asOf: changes.asOfDay, rows })` and maps `row.checks` through `CHECK_CAVEATS` (`src/mcp/server.ts:11-18`).
- **Action**: Add `user_note: "A personal note overlaps the recent window."` to `CHECK_CAVEATS`, and include `sinceLastImport: changes.sinceLastImport` and `recentNotes: changes.recentNotes` in the object serialized by MCP `changes()`.

#### L2. Clamp `B-C7` `check.day` into `[oldestRecentDay, newestRecentDay]` and pin `FindingsDiffDTO` + docs in slice lists
- **Evidence**:
  1. In `ChecksPanel.tsx:62-71`, a flagged check with `item.day` renders an `"Open <day>"` button that opens `EvidenceSheet` for `item.day`. If a multi-day note started before `oldestRecentDay`, raw `note.start_day` would open a day outside the finding's 7-night recent window.
  2. `FindingsDiffDTO` is referenced in §4 without its field list, and `docs/journeys.md` / `docs/design.md` are not listed in §6 slice files.
- **Action**:
  - In `B-C7`, set `day` to `MAX(note.start_day, oldestRecentDay)` for the latest overlapping note so `ChecksPanel` always links to a unit inside `[oldestRecentDay, newestRecentDay]` that is covered by the note.
  - Specify `FindingsDiffDTO` in `src/domain/api.ts` (`fromImportId`, `toImportId`, `fromAsOfDay`, `toAsOfDay`, `unchangedCount`, `items: Array<{ metric, kind, classification, previous, current }>`) and include `docs/journeys.md` and `docs/design.md` in Slice 1/2 file lists.
