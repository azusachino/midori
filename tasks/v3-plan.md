# Implementation plan: midori v3 — Polished Vitals UI, Version Info, & Agent Health Context MCP

Status: rev 2 (2026-11-22), revised after independent review by Argon (`gemini-4-argon-high`,
[2026-11-22-v3-plan-review-argon.md](../docs/reviews/2026-11-22-v3-plan-review-argon.md)) —
all findings H1, H2, M1–M3, L1–L2 incorporated.
Baseline: `main@e0b1007` (v2 complete, 300 tests green, live on `0.0.1-rc3`).
References: [design](../docs/design.md), [journeys](../docs/journeys.md), [UI design](../docs/ui-design.md), [v2 plan](v2-plan.md).

## 1. Goal & scope

Elevate `midori` from an engineer's diagnostic table into a cohesive personal health dataset
with two first-class surfaces:

1. **Build & version visibility (`B-R5`)**
   Surface app version tag and short 7-char source revision in `GET /api/health` and in the UI
   sidebar footer / mobile header so the owner always knows what build is running.
2. **Dataset & rich Agent Context (`B-P1`–`B-P2`, `B-A5`)**
   - Add a durable singleton `profile_context` table (`goals`, `routine`, `medical_context`)
     editable from the UI and never wiped by `derive()` or re-imports.
   - Add `health_context` MCP tool (and `GET /api/context?days=14`) returning a single-call
     structured dossier: current findings + primary-stint 90d/1y long-term baseline medians,
     14-night aligned cross-metric matrix (sleep stages + primary-stint usable overnight vitals
     + timezone + overlapping notes per night), `sinceLastImport`, `recentNotes`, and `profile`.
3. **Polished, intuitive Vitals UI (`web/src/`)**
   - Replace the raw inline Notes form on Changes (`/`) with a clean slide-over **Notes &
     Agent Profile** drawer (`ContextSheet`) triggered from the hero, leaving only compact
     note chips on the home view when notes overlap the window.
   - Promote **Last night's sleep** into a 2-column **Overview hero** alongside the answer
     summary card (always rendered, including the `lastNight === null` B-R3 state).
   - Add an **Apple Vitals-style horizontal range gauge** (`RangeGauge`) to overnight rows
     leading with human units (e.g. `56 bpm`, `7.2 h`, `48 ms`) against a fixed-proportion
     usual band, tucking secondary statistical details into clean chips/hover.
   - Inspect real rendered 1440px and 390px screenshots before merge.

Out of scope: composite numeric readiness score, LLM calls inside midori, HAE push ingest,
workouts/routes, new runtime dependencies.

## 2. Behavioral rules (additions to `docs/journeys.md`)

| ID | Given / when | Then |
| --- | --- | --- |
| B-R5 | `GET /api/health` and UI shell | `/api/health` returns `{ ok: true, version, revision }` where `version` comes from trimmed `MIDORI_VERSION` (fallback `package.json` `"version"`, then `"dev"`) and `revision` from trimmed `MIDORI_REVISION` shortened from 40-char hex to 7 chars preserving any `-dirty` suffix (fallback `"dev"`). The UI displays the version/revision in the desktop sidebar footer (`data-testid="sidebar-version"`, placed below `sidebar-watch`) and mobile header (`data-testid="mobile-version"`). |
| B-P1 | `GET /api/profile` and `PUT /api/profile` | Returns `{ goals, routine, medicalContext, updatedAt }` (defaults to empty strings and `updatedAt: null` when row `id = 1` is absent). `PUT` rejects non-object JSON with `400 { error, retryable: false }`, requires `goals`, `routine`, `medicalContext` to be strings (trimmed length `0..1000`, allowing `""` to clear), and upserts `id = 1`. Mutations return `405 { error: "profile is read-only", retryable: false }` when `upload` is omitted. |
| B-P2 | Re-import or `derive()` runs | `profile_context` is never cleared or modified by `derive()` or imports. |
| B-A5 | MCP `health_context({ days? })` and `GET /api/context?days=` | Read-only dossier (B-A2). `days` defaults to `14` and must be an integer `7..30` (HTTP `400` on REST; `{ isError: true }` on MCP). Returns `{ asOfDay, freshness, primaryWatch, profile, summary, findings, sinceLastImport, recentNights, recentNotes, guidance }`. Each finding uses `apiFindings(db)` + human-readable `caveatsFor(row)` and includes `longTerm: { median90d, median1y, n90d, n1y }` computed strictly from primary-stint `usable = 1` `metric_values` (`epoch_id = currentStint.epochId`, `unit_day >= currentStint.startDay`, `unit_day <= asOfDay`) over `[addDays(asOfDay, -89), asOfDay]` and `[addDays(asOfDay, -364), asOfDay]` (all nulls/0s when `asOfDay` or `stint` is null). `recentNights` returns `[]` when `asOfDay === null`, else up to `days` nights in `[addDays(asOfDay, -(days - 1)), asOfDay]` ordered newest first, aligning sleep stages, primary-stint `usable = 1` overnight metrics (missing/unusable mapped to `null`), `tzChange`, `partialReason`, and overlapping `notes`. |

## 3. Data model (`migrations/0008_profile_context.sql` + `src/db/schema.ts`)

```sql
-- Persistent owner profile/context for agent advice (B-P1–B-P2).
-- Singleton row (id = 1); never cleared or modified by derive() or imports.
CREATE TABLE profile_context (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  goals TEXT NOT NULL DEFAULT '',
  routine TEXT NOT NULL DEFAULT '',
  medical_context TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
```

- `src/db/schema.ts` mirrors `profileContext`.
- `src/db/db.test.ts` updates all 4 migration list assertions (with `"0008_profile_context.sql"`)
  and adds `profile_context: schema.profileContext` to the `tables` parity map.
- `derive()` never touches `notes` or `profile_context`.

## 4. Build metadata, REST & MCP interfaces

### Build metadata
- `package.json`: add `"version": "0.0.1-rc4"`.
- `Makefile`: `image-app` and `image-local` pass `--build-arg MIDORI_VERSION=$(TAG) --build-arg SOURCE_REVISION=$(SOURCE_REVISION)`.
- `Dockerfile`: adds `ARG MIDORI_VERSION=dev`, `ENV MIDORI_VERSION=$MIDORI_VERSION`, `ENV MIDORI_REVISION=$SOURCE_REVISION`.
- `src/domain/build.ts` (server-only, never imported by `web/src/`): exports `getBuildInfo()`
  returning `{ version, revision }` with 40-char hex revision shortened to 7 chars preserving
  `-dirty`.
- `GET /api/health` returns `{ ok: true, version, revision }`.
- `scripts/smoke-container.ts`: asserts `/api/health` has `{ ok: true, version, revision }` and
  MCP `tools/list` includes `"health_context"`.

### DTOs (`src/domain/api.ts`)
- `HealthDTO`: `{ ok: true; version: string; revision: string }`
- `ProfileContextDTO`: `{ goals: string; routine: string; medicalContext: string; updatedAt: string | null }`
- `LongTermBaselineDTO`: `{ median90d: number | null; median1y: number | null; n90d: number; n1y: number }`
- `AlignedNightDTO`: `{ date: string; zone: string; tzChange: boolean; partialReason: string | null; sleep: { asleepH: number; deepH: number; remH: number; coreH: number } | null; metrics: Record<string, number | null>; notes: Array<{ id: number; category: NoteCategory; label: string }> }`
- `HealthContextDTO`: `{ asOfDay: string | null; freshness: FreshnessSummaryDTO; primaryWatch: ChangesDTO["primaryWatch"]; profile: ProfileContextDTO; summary: { standsOut: number; closeToEdge: number; within: number; other: number; sharedConfounders: string[] }; findings: Array<FindingRowDTO & { longTerm: LongTermBaselineDTO }>; sinceLastImport: FindingsDiffDTO | null; recentNights: AlignedNightDTO[]; recentNotes: NoteDTO[]; guidance: string }`

### REST (`src/http/routes.ts`)
- `GET /api/health` -> `HealthDTO`
- `GET /api/profile` -> `ProfileContextDTO` (always mounted)
- `PUT /api/profile` -> `200 ProfileContextDTO` (when `upload` present; else `405 { error: "profile is read-only", retryable: false }`)
- `GET /api/context?days=14` -> `HealthContextDTO` (always mounted; `400 { error, retryable: false }` if `days` invalid)

### MCP (`src/mcp/server.ts`)
- New read-only tool `health_context({ days?: number })` with `days: z.number().optional()` and
  in-handler validation (`Number.isInteger(days) && days >= 7 && days <= 30`, else `{ isError: true }`).
- Tool description appends `${AGENT_GUIDANCE}` so `src/mcp/server.test.ts` B-A3 check passes.
- Update `McpServer` `instructions` to recommend `health_context` for holistic advice and
  `changes` for quick ranked findings.

## 5. UI redesign (`web/src/`)

- **Version badge (`Shell.tsx`, `ShellProvider.tsx`, `client.ts`)**:
  - Keep `loadShellChanges(client: Pick<ApiClient, "changes">, signal?)` signature unchanged in
    `web/src/lib/shell-context.ts` (L2).
  - `ShellProvider` fetches `apiClient.health(signal)` separately on mount (non-blocking,
    catches errors -> `build: null`) and exposes `build: { version, revision } | null` on context.
  - Desktop sidebar renders `data-testid="sidebar-version"` **below** `sidebar-watch` inside
    the sticky container (preserving `e2e/shell.spec.ts` `sidebar-nav` -> `sidebar-watch` <64px
    spacing). Mobile header renders `data-testid="mobile-version"`.
- **Visual range gauge (`web/src/components/RangeGauge.tsx`)**:
  - Returns `null` when `row.state !== "computed"` or any of `recentMedian`, `baselineMedian`,
    `baselineLow`, `baselineHigh` is `null` or suppressed by the pre-9c fraction `%` guard.
  - Maps `[baselineLow, baselineHigh]` to a fixed middle band (`30%..70%` of width,
    `baselineMedian` at `50%`, guarding `halfBand = Math.max(1e-6, (baselineHigh - baselineLow) / 2)`),
    and clamps the `recentMedian` dot into `[padX, width - padX]` so extreme `|z| >= 10` never
    squashes the band or produces `NaN`.
  - Uses `pointer-events-none` so it never blocks `FindingRow`'s stretched link.
- **Upgraded `FindingRow.tsx`**:
  - Keeps `formatRecentVsBaseline` exported in `web/src/lib/finding-format.ts`.
  - Leads with metric name + prominent recent value in human units (with the `%` guard),
    followed by `RangeGauge` + neutral direction label, keeping frequency/onset/checks/sparkline
    clean and scannable.
- **Home Overview (`Changes.tsx`)**:
  - **Hero grid** (`grid-cols-1 lg:grid-cols-12 gap-4`):
    - Left (7 cols): Answer & vitals status card (headline, status summary pills, shared
      confounders note, and clean **`+ Log note`** / **`Agent profile`** buttons opening
      `ContextSheet`).
    - Right (5 cols): `LastNightCard` **always rendered** (including when `lastNight === null`
      for `B-R3` and `e2e/changes.spec.ts`).
  - **Compact notes strip**: when `changes.recentNotes.length > 0`, show sleek category/date/label
    chips + a `"Manage"` button opening `ContextSheet` on the Notes tab; when empty, omit the
    strip (no raw form on `/`).
  - **Since previous export** card (when non-empty) + **Overnight** / **Daytime** groups.
- **Notes & Agent Profile drawer (`web/src/components/ContextSheet.tsx`)**:
  - Radix `Sheet` with two tabs (`Notes` and `Agent profile`):
    - `Notes` tab embeds `NotesPanel` (`onChanged={refresh}`).
    - `Agent profile` tab loads/saves `GET/PUT /api/profile` (`goals`, `routine`, `medicalContext`)
      with neutral B-F9 copy and clear saved feedback.

## 6. Implementation slices (for `pi` DeepSeek via Herdr)

1. **Slice 1 — Build info (`B-R5`), Profile Context (`B-P1`–`B-P2`), and Health Context (`B-A5`)**
   - Files: `package.json`, `Dockerfile`, `Makefile`, `src/domain/build.ts`,
     `migrations/0008_profile_context.sql`, `src/db/schema.ts`, `src/db/db.test.ts`,
     `src/domain/api.ts`, `src/stats/profile.ts`, `src/stats/context.ts`, `src/http/routes.ts`,
     `src/mcp/server.ts`, `src/mcp/server.test.ts`, `tests/integration/server.test.ts`,
     `scripts/smoke-container.ts`, `docs/journeys.md`, `docs/design.md`, plus new unit/integration
     tests (`src/stats/profile.test.ts`, `src/stats/context.test.ts`, `tests/integration/context.test.ts`).
   - Gate: `bun run check` exits 0.
2. **Slice 2 — Polished Vitals UI, Version Badge, `RangeGauge`, and `ContextSheet`**
   - Files: `web/src/api/client.ts`, `web/src/api/types.ts`, `web/src/api/fixtures.ts`,
     `web/src/copy.ts`, `web/src/lib/shell-context.ts`, `web/src/components/ShellProvider.tsx`,
     `web/src/components/Shell.tsx`, `web/src/components/RangeGauge.tsx`,
     `web/src/components/FindingRow.tsx`, `web/src/components/ContextSheet.tsx`,
     `web/src/pages/Changes.tsx`, `tests/web/*`, `e2e/notes-and-diff.spec.ts`, `e2e/shell.spec.ts`.
   - Gate: `bun run check` exits 0, `bun run privacy-guard` exits 0, `make e2e` exits 0.
   - Lead visual verification: capture & inspect desktop (1440px) and mobile (390px) screenshots
     of `/` and the open `ContextSheet` before merge.
