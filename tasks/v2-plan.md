# Implementation plan: midori v2 — Own Notes as Confounders & Import-to-Import Diff

Status: rev 2 (2026-11-22), revised after independent review by Argon (`gemini-4-argon-high`,
[2026-11-22-v2-plan-review-argon.md](../docs/reviews/2026-11-22-v2-plan-review-argon.md)) —
all findings H1, H2, M1–M5, L1–L2 incorporated.
Baseline: `main@50b30b8` (v1 complete, 263 tests green).
References: [design](../docs/design.md), [journeys](../docs/journeys.md), [UI design](../docs/ui-design.md), [0001](../docs/decisions/0001-analyze-by-device-epoch-and-night.md).

## 1. Goal & scope

Deliver the two highest-leverage items from the post-v1 roadmap without changing `midori`'s
core invariants (deterministic stats only, neutral B-F9 wording, `export.zip`-first, read-only
MCP, no new runtime dependencies, `data/` out of Git):

1. **Feature A — Own notes & annotations as confounders (`B-C7`, `B-U1`–`B-U4`)**
   Let the owner annotate a date or date range (e.g., illness, travel, alcohol, medication,
   stress, other). Notes survive re-imports and `derive()`, surface as a seventh confounder
   check (`user_note`), render on Metric detail charts and the Evidence sheet, and are
   exposed read-only to agents over MCP.
2. **Feature B — Import-to-import findings diff (`B-I13`, `B-F15`)**
   Persist a compact snapshot of computed findings per completed import so each new export
   answers *"what newly shifted or returned to usual since my previous export?"* on both the
   Changes page, Import summary, and MCP `changes()`.

Out of scope for v2: naps, workouts/routes, HAE push ingest, advice layer, composite readiness
score, MCP write tools.

## 2. Behavioral rules (additions to `docs/journeys.md`)

### User notes (`B-U` and `B-C7`)

| ID | Given / when | Then |
| --- | --- | --- |
| B-U1 | Create note (`POST /api/notes`) | Requires valid real calendar date `startDay` (`YYYY-MM-DD`, UTC round-trip validated so impossible dates like `2026-02-30` fail), optional `endDay` (defaults to `startDay`, must be valid calendar date and `endDay >= startDay`), `category` in `illness \| travel \| alcohol \| medication \| stress \| other`, and trimmed `label` (1–140 chars). Invalid input returns `400 { error, retryable: false }`. |
| B-U2 | Edit / delete note (`PATCH /api/notes/:id`, `DELETE /api/notes/:id`) | `PATCH` loads existing row (`404` if missing), merges partial fields, validates merged `endDay >= startDay`, real calendar dates, `category`, and trimmed `label` (1–140 chars), returning `400 { error, retryable: false }` on violation. `DELETE` returns `200 { deleted: true }` or `404`. Mutations return `405 { error: "notes are read-only", retryable: false }` when the app runs in read-only mode (`upload` omitted). |
| B-U3 | Re-import or `derive()` runs | `notes` table is never cleared or modified by `derive()` or imports. |
| B-U4 | Read notes (`GET /api/notes?from=&to=`, MCP `list_notes`) | Validates `from`/`to` as real calendar dates when provided (400 / `isError` on invalid). Returns notes overlapping `[from, to]` (or all notes if omitted), ordered by `start_day DESC, id DESC`. MCP tool is strictly read-only (B-A2). |
| B-C7 | Confounder check `user_note` | Flagged on a finding when >=1 note overlaps `[oldestRecentDay, newestRecentDay]` (clamped to `<= asOfDay`), i.e. `start_day <= newestRecentDay AND end_day >= oldestRecentDay`. Carries `count` (overlapping notes) and `day` = `MAX(note.start_day, oldestRecentDay)` for the latest overlapping note (so `ChecksPanel` always links to a day inside the recent window). Evaluated live in `deriveChecks()` so adding/deleting a note updates checks immediately without a full re-derive. Never asserts a cause (B-F9). |

### Import-to-import findings diff (`B-I13`, `B-F15`)

| ID | Given / when | Then |
| --- | --- | --- |
| B-I13 | Import finishes `done` | Inside `derive(db, { importId })` (same `BEGIN IMMEDIATE` transaction), `DELETE FROM finding_snapshots WHERE import_id = ?` then insert one row per non-trend finding into `finding_snapshots(import_id, metric, state, z, severity, direction, confidence, asof_day)` before `COMMIT`. Failed imports / rollbacks write no snapshot. Migration `0007` backfills `finding_snapshots` from `findings` for the latest existing `done` import so upgraded v1 DBs diff immediately on their first v2 import. |
| B-F15 | Computing diff for `Changes` / `changes()` / `GET /api/imports/:id/diff` | Compare target snapshot against the most recent prior `done` import snapshot with strictly earlier `asof_day` (`prev.asof_day < curr.asof_day`). For `GET /api/imports/:id/diff`, return `null` if any earlier `done` import (`id < :id`) already had `asof_day >= target.asof_day` (e.g. duplicate B-I3 or older B-I4 import). For `ChangesDTO.sinceLastImport`, compare the latest `done` snapshot against the most recent prior `done` snapshot with `asof_day < current.asof_day` (null if none). Classify each metric neutrally in this exact priority order: (1) `direction_reversed`: both `state === "computed"`, both `severity` in `("notable","alert")`, and `prev.direction !== curr.direction`; (2) `newly_notable`: `curr.state === "computed"` and `curr.severity` in `("notable","alert")` while `!(prev.state === "computed" && prev.severity in ("notable","alert"))`; (3) `returned_to_usual`: `prev.state === "computed"` and `prev.severity` in `("notable","alert")` and `curr.state === "computed"` and `curr.severity === "within"`; (4) `shifted_further`: both `state === "computed"`, both `severity` in `("notable","alert")`, `prev.direction === curr.direction`, and either `(prev.severity === "notable" && curr.severity === "alert")` or `Math.abs(curr.z) - Math.abs(prev.z) >= 0.5`; (5) `baseline_ready`: `prev.state` in `("warming_up","insufficient")` and `curr.state === "computed"` and `curr.severity === "within"`. All other pairs (including moderating notable/alert metrics and transitions to non-computed states) are omitted from `items` and counted in `unchangedCount`. |

## 3. Data model (`migrations/0007_notes_and_snapshots.sql` + `src/db/schema.ts`)

```sql
CREATE TABLE notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  start_day TEXT NOT NULL,
  end_day TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('illness', 'travel', 'alcohol', 'medication', 'stress', 'other')),
  label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (end_day >= start_day)
);
CREATE INDEX idx_notes_range ON notes (start_day, end_day);

CREATE TABLE finding_snapshots (
  import_id INTEGER NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  metric TEXT NOT NULL,
  state TEXT NOT NULL,
  z REAL,
  severity TEXT,
  direction TEXT,
  confidence TEXT,
  asof_day TEXT NOT NULL,
  PRIMARY KEY (import_id, metric)
);
CREATE INDEX idx_finding_snapshots_asof ON finding_snapshots (asof_day, import_id);

-- Backfill snapshot for latest done import on upgraded v1 databases (M1)
INSERT OR IGNORE INTO finding_snapshots (import_id, metric, state, z, severity, direction, confidence, asof_day)
SELECT
  (SELECT MAX(id) FROM imports WHERE status = 'done'),
  metric,
  state,
  z,
  severity,
  CASE
    WHEN state != 'computed' OR z IS NULL THEN NULL
    WHEN severity = 'within' THEN 'within'
    WHEN z > 0 THEN 'higher'
    ELSE 'lower'
  END,
  confidence,
  asof_day
FROM findings
WHERE (SELECT MAX(id) FROM imports WHERE status = 'done') IS NOT NULL;
```

- `src/db/schema.ts` mirrors both tables (`notes`, `findingSnapshots`), and `src/db/db.test.ts`
  is updated (migration list + table map) so schema parity stays enforced.
- `derive(db, { importId })` keeps its atomic `BEGIN IMMEDIATE` transaction and writes
  `finding_snapshots` for `importId` (after `DELETE FROM finding_snapshots WHERE import_id = ?`)
  right after `rebuildFindings()` before `COMMIT`.
- `derive()` still clears only derived tables (`findings`, `seam_steps`, `metric_values`,
  `nights`, `stints`) — never `notes` or `finding_snapshots`.

## 4. Interfaces & DTOs (`src/domain/api.ts`)

```ts
export type NoteCategory = "illness" | "travel" | "alcohol" | "medication" | "stress" | "other";

export interface NoteDTO {
  id: number;
  startDay: string;
  endDay: string;
  category: NoteCategory;
  label: string;
  createdAt: string;
  updatedAt: string;
}

export type FindingsDiffClassification =
  | "direction_reversed"
  | "newly_notable"
  | "returned_to_usual"
  | "shifted_further"
  | "baseline_ready";

export interface FindingSnapshotSummaryDTO {
  state: FindingState;
  severity: FindingSeverity;
  direction: FindingDirection | null;
  z: number | null;
  confidence: "high" | "medium" | "low" | null;
}

export interface FindingsDiffItemDTO {
  metric: string;
  kind: "overnight" | "daytime";
  classification: FindingsDiffClassification;
  previous: FindingSnapshotSummaryDTO;
  current: FindingSnapshotSummaryDTO;
}

export interface FindingsDiffDTO {
  fromImportId: number;
  toImportId: number;
  fromAsOfDay: string;
  toAsOfDay: string;
  unchangedCount: number;
  items: FindingsDiffItemDTO[];
}
```

### REST (`src/http/routes.ts`, `src/http/queries.ts`)

- `GET /api/notes?from=&to=` -> `{ notes: NoteDTO[] }` (always mounted)
- `POST /api/notes` -> `201 NoteDTO` (when `upload` present; else `405 { error: "notes are read-only", retryable: false }`)
- `PATCH /api/notes/:id` -> `200 NoteDTO` (when `upload` present; else `405`)
- `DELETE /api/notes/:id` -> `200 { deleted: true }` (when `upload` present; else `405`)
- `GET /api/imports/:id/diff` -> `{ diff: FindingsDiffDTO | null }` (always mounted; `404` if import id missing)
- `GET /api/changes` -> `ChangesDTO` gains `sinceLastImport: FindingsDiffDTO | null` and
  `recentNotes: NoteDTO[]` (notes with `end_day >= addDays(asOfDay, -34)`, no upper cap on
  `start_day` so notes logged after `asOfDay` remain visible; all notes when `asOfDay === null`).
- `GET /api/metrics/:metric` -> `MetricSeriesDTO` gains `notes: NoteDTO[]` overlapping the
  returned range.
- `GET /api/metrics/:metric/units/:day` -> `UnitEvidenceDTO` gains `notes: NoteDTO[]` covering
  `day`.

### MCP (`src/mcp/server.ts`)

- New read-only tool `list_notes({ from?, to? })` returning `{ notes: NoteDTO[] }` (validates
  calendar dates when supplied, returning `isError` on invalid dates).
- `CHECK_CAVEATS` gains `user_note: "A personal note overlaps the recent window."`.
- `changes()` returns `{ asOf, rows, sinceLastImport, recentNotes }` where each row includes
  `user_note` in `checks` and `caveats`.
- `AGENT_GUIDANCE` updated to list personal notes alongside device changes, OS updates,
  partial data, and travel as confounders (never causes).

## 5. UI (`web/src/`)

- **Copy (`web/src/copy.ts`)**: add neutral strings for `user_note` check (`copy.checks.user_note`,
  `copy.pages.changes.checkNouns.user_note = "a personal note"`, clear/flagged labels), note
  categories, note form labels, and diff classifications (`newly_notable`, `returned_to_usual`,
  `direction_reversed`, `shifted_further`, `baseline_ready`). Must pass `tests/web/theme.test.ts`
  B-F9 neutral wording check.
- **ChecksPanel (`web/src/components/ChecksPanel.tsx` & `web/src/lib/evidence.ts`)**: include
  `user_note` in canonical check order (`B-C1`–`B-C7`).
- **EvidenceSheet (`web/src/components/EvidenceSheet.tsx`)**: display notes covering the
  selected night/day with inline add/edit/delete controls; accepts `onNotesChanged?: () => void`
  callback from `MetricDetailPage` that triggers `query.retry()` and `shell.refresh()`.
- **MetricChart (`web/src/components/MetricChart.tsx`)**: display note markers/bands on the
  time axis (distinct from seams and OS updates), clamping each overlapping note's
  `[startDay, endDay]` to `[days[0], days.at(-1)]` (and snapping through `axisDay` for
  `range === "all"`).
- **Changes page (`web/src/pages/Changes.tsx`)**:
  - Render compact "Since previous export" card when `sinceLastImport` has non-empty `items`.
  - Render compact "Notes" panel to add/list/delete notes directly from Changes, refreshing
    Changes data on mutation.
- **Import page (`web/src/pages/Import.tsx`)**: fetch `GET /api/imports/:id/diff` for the
  completed job when `recordsInserted > 0 && !olderThanStored` and show the diff summary card
  when non-null.

## 6. Implementation slices (for `pi` DeepSeek via Herdr)

Each slice keeps `bun run check` (`tsc --noEmit && tsc -p web/tsconfig.json --noEmit && biome check . && bun test`) green (H2).

1. **Slice 1 — Migration, Notes CRUD, `B-C7` confounder check, and minimal web type/copy sync**
   - Backend: `migrations/0007_notes_and_snapshots.sql`, `src/db/schema.ts`, `src/db/db.test.ts`,
     `src/domain/api.ts`, `src/stats/notes.ts`, `src/stats/checks.ts`, `src/http/routes.ts`,
     `src/http/queries.ts`.
   - Minimal web type/copy sync (so `tsc -p web/tsconfig.json` stays green): `web/src/copy.ts`
     (`user_note` strings), `web/src/lib/evidence.ts` (`CHECK_ORDER` + switch cases),
     `web/src/api/fixtures.ts` (`notes: []`, `recentNotes: []`, `sinceLastImport: null`).
   - Docs: `docs/journeys.md` (`B-U1`–`B-U4`, `B-C7`), `docs/design.md`.
   - Tests: `src/stats/notes.test.ts`, `src/stats/checks.test.ts`, `tests/integration/notes.test.ts`
     covering `B-U1`–`B-U4`, `B-C7`, read-only 405, calendar date validation, partial PATCH validation.
   - Gate: `bun run check` exits 0.

2. **Slice 2 — Finding snapshots, Import-to-import diff, and MCP updates**
   - Backend: `src/stats/diff.ts`, `src/stats/derive.ts`, `src/ingest/import.ts`,
     `src/ingest/import-worker.ts`, `src/http/queries.ts`, `src/http/routes.ts`,
     `src/mcp/server.ts`.
   - Docs: `docs/journeys.md` (`B-I13`, `B-F15`).
   - Tests: `src/stats/diff.test.ts`, `src/stats/derive.test.ts`, `tests/integration/diff.test.ts`,
     `src/mcp/server.test.ts` covering `B-I13`, `B-F15` (all 5 classifications + moderating/non-computed
     exclusions + duplicate/older import handling + v1 backfill), MCP `list_notes` & `changes` parity.
   - Gate: `bun run check` exits 0.

3. **Slice 3 — Web UI + E2E**
   - Frontend: `web/src/copy.ts` (full notes + diff copy), `web/src/api/client.ts`,
     `web/src/components/ChecksPanel.tsx`, `web/src/components/EvidenceSheet.tsx`,
     `web/src/components/MetricChart.tsx`, `web/src/pages/MetricDetail.tsx`,
     `web/src/pages/Changes.tsx`, `web/src/pages/Import.tsx`.
   - Tests: `tests/web/*` updates + new unit tests for note clamping & diff formatting;
     `e2e/` specs for creating/deleting a note, verifying `user_note` check, and viewing diff.
   - Gate: `bun run check` exits 0, `make e2e` exits 0, `bun run privacy-guard` exits 0.
