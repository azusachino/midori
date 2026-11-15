# midori v1 — task ledger

Source: [tasks/plan.md](plan.md) (merged in PR #1, `6b82101`). The contract is
[docs/journeys.md](../docs/journeys.md): `B-` ids, with thresholds that live only there. The
UI is defined in [docs/ui-design.md](../docs/ui-design.md).

**Check a task only when every AC bullet is met and its verification result is recorded
here** (command, exit code, commit). Real-data results are recorded as counts and pass/fail,
never measurements.

## Execution model (owner, 2026-11-15)

- **Lead** (Claude Code session):
  - writes and maintains this ledger
  - dispatches briefs
  - reviews every diff
  - runs gates
  - pushes and opens/merges PRs
  - runs the owner-witnessed real-data readouts
  - persists results here
- **Engine writer**: Herdr peer `midori-engine`, pi on `magpie/codex/gpt-6-luna`. Takes slices
  1–10, in order.
- **UI writer**: Herdr peer `midori-ui`, agy on `gemini-4-hydrogen-high`. Takes slices 11–17.
- **One writer per worktree.** Each slice runs in `vendor/midori/.worktrees/<slice>` on branch
  `task/v1-<n>-<name>`, cut from current `main`. Writers commit locally and never push; the
  lead pushes.
- **Gates.** Gate A (after slice 8) and Gate C (after slice 17) go to a fresh verifier that
  did not write the code.
- **Every slice:**
  - `bun run check` exits 0
  - tests named `B-xx …` for each listed rule
  - no tracked file outside the slice's Files list without a note in the hand-back
  - no real data in Git
- **UI slices also:** `make e2e` exits 0, and the lead inspects real-data screenshots before
  merge.

## Phase 1 — engine

### Slice 1 — Capture `[midori-engine]`

Goal: store device hardware/software and metadata on every record. Re-import fills them on
existing rows.

- Rules: B-I12 (upsert part), B-I8 (`export_date`), B-D2 groundwork (device-less rows stored
  as NULL `device_hw`).
- Files:
  - `migrations/0002_capture.sql`
  - `src/db/schema.ts`
  - `src/ingest/parser.ts`
  - `src/ingest/mapper.ts`
  - `src/ingest/store.ts`
  - `src/domain/types.ts`
  - `tests/fixtures/model.ts` (+ snapshot), and the matching tests
- AC:
  - [x] Columns `records.device_hw`, `records.device_sw`, `records.meta_json` (JSON object of
    MetadataEntry key→value, NULL when there is none), and `imports.export_date`.
  - [x] The parser extracts `hardware:` and `software:` from the `device` attribute string
    (`<<HKDevice: …>, name:…, hardware:Watch7,5, software:26.1, …>`). An absent attribute
    gives NULLs.
  - [x] `export_date` is persisted from `<ExportDate value=…>`.
  - [x] The store upserts on the existing dedup key and fills `device_hw`, `device_sw` and
    `meta_json` only where the stored value is NULL. Insert/dedup counts keep their v0
    meaning.
  - [x] Test `B-I12 re-import fills device columns on pre-v1 rows`: import a fixture with the
    columns stripped (simulating v0 rows), re-import the full fixture, and assert the columns
    are filled with 0 new records.
  - [x] The fixture model gains a device attribute on sensor records, device-less sleep and
    resting-HR records from a watch source, and `HKTimeZone` metadata on sleep records.
  - [x] The insert benchmark (`scripts/bench-insert.ts`) is re-run; throughput loss vs v0 is
    reported in the hand-back.
- Verify: `bun run check`; `bun test src/ingest`.
- Hand-back extra: the expected db-size growth from `meta_json`, estimated by fixture scaling.
  The lead measures the real number.
- **Done 2026-11-15** — `midori-engine` (pi, magpie/codex/gpt-6-luna high), commit `70a9824`.
  - Lead re-ran `bun run check`: exit 0, 199 tests.
  - Real-data re-import over a copy of the db (lead, counts only): exit 0 in 22 s; 0 inserted,
    2,047,778 deduped.
  - After the re-import, `device_hw` is NULL on 355 of 449,143 HR/HRV/resp rows, and 6
    distinct hardware values exist. Most remaining NULLs are device-less sleep/RHR records,
    which B-D2 inherits in slice 2.
  - `meta_json` is set on 853,835 rows; the db grew 787 → 898 MB (+14%, under the 30% risk
    threshold).
  - Follow-up: `scripts/bench-insert.ts` builds its own table and now fails ("no column
    device_hw"); the writer's scratch benchmark measured 474k rows/s, about −7% vs v0's figure.
    Fixing the script is assigned to slice 8.

### Slice 2 — Derived schema + epochs `[midori-engine]`

Goal: the v1 derived tables exist; epochs are derived with inheritance and OS-update events.

- Rules: B-D1, B-D2, B-D2b, B-D8.
- Files:
  - `migrations/0003_derived.sql` (creates `epochs, epoch_events, stints, nights,
    metric_values, findings` (v1 shape) and `seam_steps`; drops `daily_metrics`,
    `device_events`, v0 `findings`)
  - `src/db/schema.ts`
  - `src/stats/epochs.ts` (+ test)
  - `tests/fixtures/` additions
- AC:
  - [x] Epoch = `(source_name, device_hw)`; kind from the hardware prefix (`Watch*`, `iPhone*`,
    other), `app` for `device_hw` NULL with no inheritance.
  - [x] B-D2 inheritance exactly as specified (same/adjacent local day, else nearest ≤30
    days). Tested with device-less sleep/RHR records.
  - [x] Fixture + test `B-D1 same-name replacement watch yields two epochs`, with the
    device-less sleep records following the right epoch on each side of the change.
  - [x] `epoch_events` OS-update rows on `software` change within an epoch (B-D8).
  - [x] `days_present` counts distinct local days with any record.
  - [x] v0 stats modules that read the dropped tables are removed or stubbed so that `bun run
    check` stays green. The v0 read routes may return 501 until slice 9; list them in the
    hand-back.
- Verify: `bun run check`.
- **Done 2026-11-15** — `midori-engine` (pi, magpie/codex/gpt-6-luna high), commits `13c78f0` and
  `b498d9c`.
  - `bun run check` (lead): exit 0, 173 tests.
  - Real-data derive over the db copy (lead, counts only):
    - epochs by kind: watch 4, phone 3, other 1, app 3
    - no watch source keeps an app epoch, so device-less sleep/RHR records were all inherited
  - B-D8 was amended after the real data showed version flapping. Per-day detection gave 342
    events, with one watch at 6 events for 4 versions in 18 days. A newer-version-first-seen
    rule now gives exactly one event per distinct version (current watch: 2).
  - Main is temporarily degraded until slice 9: the v0 read routes return 501 and the v0 web
    pages are empty. Import still works. The deployed cluster image (v0.1.0) is unaffected.

### Slice 3 — Minor + sticky primary + seams `[midori-engine]`

- Rules: B-D3, B-D4, B-D4b, B-D5, B-D6, B-D7.
- Files:
  - `src/domain/metrics.ts` (add `kind: overnight|daytime|trendOnly`, `floor`, `minSamples`,
    `sleep_hr`; SpO2 becomes overnight; `vo2max` becomes trendOnly; steps trust note mentions
    primary-only sums)
  - `src/stats/stints.ts` (+ test)
  - `src/stats/seams.ts` (+ test)
- AC:
  - [x] Minor per (metric, epoch) over all history, using the 6-of-28 rule.
  - [x] Sticky primary with kind priority and the (a)/(b)/(c) switch conditions. Stints are
    persisted.
  - [x] Fixture `B-D3 minor app single sample → no seam`.
  - [x] Fixture `B-D4 alternating phone/watch step days → no seam`.
  - [x] Fixture `B-D4 watch replaced by same-kind watch → one seam at the first unit of the
    7-run`.
  - [x] B-D4b: no fallback value on units the primary did not record.
  - [x] `seam_steps`: an offset when there are ≥7 shared usable units, else a step (≥7 per side,
    up to 28). Values are never adjusted.
  - [x] Depends on usability from slice 4. Until then, stint and seam logic take a
    `usable(unit)` predicate, and the tests pass explicit predicates.
- Verify: `bun run check`.
- **Done 2026-11-15** — `midori-engine` (pi, magpie/codex/gpt-6-luna high), commit `dd77267`.
  - `bun run check` (lead): exit 0, 180 tests.
  - Real-data probe (lead, counts only; per-day presence from records, all units treated as
    usable):
    - steps: 4 stints following the device history (phone → watch → watch → watch), 1 seam
      in the last 180 days. Fable's measurement under sample-count primary was 6.
    - hrv_sdnn and resp_rate: 3 stints each
    - active_kj: 4 stints, with 2 minor epochs excluded

### Slice 4 — Nights `[midori-engine]`

- Rules: B-N1–B-N9.
- Files:
  - `src/stats/nights.ts` (rewrite) + test
  - `src/domain/dates.ts` (zone helpers)
  - fixtures
- AC:
  - [x] Night zone from `HKTimeZone` (IANA name) on that night's sleep records, else the
    export offset. Local times are computed in that zone.
  - [x] Boundary tests: 14:59/15:00, 08:59/09:00, the 09:00–12:00 continuation (≤60 min after
    the last asleep end vs a nap), and HRV at 21:00.
  - [x] Sleep stages from the `sleep_h` primary epoch only.
  - [x] `sleep_hr` = median HR inside asleep intervals.
  - [x] Export-cut partial (window to 12:00 the next day vs `export_date`). A short night is
    **not** partial.
  - [x] `tz_change` when the zone differs from the previous night's.
  - [x] Fixture `B-N1 night abroad assigned in its own zone`.
  - [x] Daytime unit = local day in the export offset; the export day is not usable.
- Verify: `bun run check`.
- **Done 2026-11-15** — `midori-engine` (pi, magpie/codex/gpt-6-luna high), commits `ba55829`,
  `3c28acc` and `39e97e8`.
  - `bun run check` (lead): exit 0, 186 tests.
  - Real-data readout (lead, counts only) on a db copy:
    - 1,407 nights; 1 partial (`export_cut`); 9 `tz_change` nights over 2 zones
    - `metric_values` for all 14 metrics; 3 stints per watch metric, 4 for steps and active
      energy
  - Two rework rounds came from the lead's real-data runs:
    - The first version left `metric_values` empty on a fresh db (a stints↔nights cycle). Now
      presence → stints → nights.
    - The full pipeline took 383 s and 4.5 GB. Slice 2's per-record epoch derivation alone
      took 348 s; it now aggregates in SQL.
    - After both fixes: `rebuildNightPipeline` on real data takes **3.5 s, 150 MB peak RSS**
      (pod limit 2 GiB).
  - Lesson: time every derive stage on the real db, not only synthetic benchmarks. Slice 2's
    cost was missed at its review.

### Slice 5 — Values + baselines `[midori-engine]`

- Rules: B-N7, B-F1–B-F6, B-F8, B-F11.
- Files: `src/stats/values.ts` (+ test), `src/stats/baselines.ts` (rewrite) + test,
  `src/domain/stats.ts` (remove 1e-9 branch, add floor/cap).
- AC:
  - [x] `metric_values` rows with `usable` from the two-level rule.
  - [x] Ordinal windows over usable units of the current stint. Recent gate includes the
    14-day recency check. Baseline gate gives warming_up <7, early 7–13, full ≥14.
  - [x] σ = max(1.4826·MAD, floor); |z| capped at 10 for display and ranking.
  - [x] Fixture `B-F4 flat resp baseline → bounded z`.
  - [x] Confidence is an ordered decision list (B-F6), one test per branch.
  - [x] k-outside and onset ("since" vs "at least since"), with tests for the one-unit
    tolerance and the open-ended run.
  - [x] The v0 spike fixture is updated: it now expects new stint → warming_up → (after 14
    usable units) a low-confidence z, plus a seam step. Never a raw ≥4σ alert across the seam.
- Verify: `bun run check`.
- **Done 2026-11-15** — `midori-engine-s5` (pi, gpt-6-luna high), commits `e00e4c2` and `32dcc22`
  (rebased onto `dd98e81` by the lead).
  - `bun run check` (lead): exit 0, 193 tests.
  - Real-data readout (lead; states only, no values):
    - pipeline + values + baselines took 3.5 s + 5 ms + 29 ms, 136 MB peak RSS
    - all 13 non-trend metrics are `computed` on the current watch stint (medium confidence;
      low for active energy's low trust)
    - **no metric is blank because of the device change** (success criterion 2)
    - `vo2max` reports `warming_up`; slice 6 excludes trend-only metrics from findings
  - Follow-up for slice 6: severity is named `info`, but B-F5 and the UI types use `within`.
    Rename it.

### Slice 6 — Findings + checks `[midori-engine]`

- Rules: B-F7, B-F9, B-F10, B-C1–B-C6.
- Files:
  - `src/stats/findings.ts` (rewrite) + test
  - `src/stats/checks.ts` (+ test)
  - `src/domain/api.ts` (finding/check types only)
- AC:
  - [ ] Ranking exactly per B-F7, including daytime only when notable/alert and trend-only
    excluded.
  - [ ] Each check has a test for clear and for flagged.
  - [ ] Wording is emitted as keys plus params (e.g. `{dir: "lower"}`), not English sentences.
    The UI copy module renders them. A test asserts that no finding text contains "caused",
    "better" or "worse".
- Verify: `bun run check`.

### Slice 7 — Atomic derive + CLI + readout `[midori-engine, lead readout]`

- Rules: B-I6, B-I9 (measurement).
- Files:
  - `src/stats/derive.ts` (+ test)
  - `src/ingest/import.ts` (call derive)
  - `src/cli.ts` (`changes [--json]`)
- AC:
  - [ ] Derive runs epochs → stints → nights → values → findings/checks/seam steps in one
    transaction.
  - [ ] Test: a derive that throws midway leaves the previous derived rows intact.
  - [ ] Evidence queries are bounded to units ≤ as-of.
  - [ ] `bun src/cli.ts changes --json` prints the ranked rows.
- Readout (lead + owner, real data, recorded here without values):
  - [ ] re-import over the existing db fills `device_hw` (count of NULL sensor rows → 0)
  - [ ] end-to-end time
  - [ ] the new watch is one epoch for all overnight metrics, including sleep and RHR
  - [ ] seam count per metric (steps ≤ 2)
  - [ ] no metric blank because of the seam
  - [ ] † thresholds sane, or tuned with a note in journeys.md
- Verify: `bun run check`; CLI on the fixture db.

### Slice 8 — Import job hardening `[midori-engine]`

- Rules: B-I1–B-I5, B-I7, B-I8, B-I10, B-I12 (backup cap).
- Files:
  - `src/http/import.ts`
  - `src/ingest/zip.ts` (central-directory check)
  - `migrations/0004_imports.sql` (stage, progress, status CHECK + `deriving`)
  - `src/server.ts` (restart reconcile)
  - `src/backup/backup.ts`
  - `tests/integration/upload.test.ts`
- AC:
  - [x] The non-export zip is rejected with 400 before any job row exists.
  - [x] 409 while an import is running.
  - [x] `POST /api/imports/:id/retry` works while the spool exists (24 h), and 410 after.
  - [x] `progress` is updated while parsing.
  - [x] Orphaned non-terminal rows are marked failed on boot.
  - [x] Backups keep ≤30 days and ≤10 snapshots.
  - [x] Each rule has an integration test through HTTP.
- Verify: `bun run check`.
- **Done 2026-11-15** — `midori-engine-s8` (second pi session, gpt-6-luna high), commits `311e311`
  (rebased by the lead) and `13d2678`.
  - `bun run check` (lead): exit 0, 191 tests.
  - The lead's real-data import first failed at migration 0004 (`FOREIGN KEY constraint
    failed`): the table rebuild left deferred FK violations from referencing records, and the
    rebuild also dropped `export_date`. Fixed with a runner marker for the 12-step rebuild
    (`foreign_keys` OFF, `foreign_key_check`), plus a test on a db with referencing rows.
  - After the fix (counts only): import exit 0 in 25 s, 100 MB peak RSS; 0 inserted; 7 import
    rows kept with their export dates; 0 FK violations; stage/progress persisted; 1 snapshot.
  - `scripts/bench-insert.ts` fixed (slice 1 follow-up).

**Gate A**: fresh verifier on slices 1–8 against B-D/B-N/B-F/B-C/B-I. Report persisted in
`docs/reviews/`.

## Phase 2 — read API + MCP

### Slice 9 — REST v1 `[midori-engine]`

- Rules: B-R1–B-R4 (payload side), B-I3, B-I4, B-A4 (`nights`).
- Files:
  - `src/http/queries.ts` (rewrite)
  - `src/http/routes.ts`
  - `src/domain/api.ts` (DTOs)
  - `tests/integration/api.test.ts`
  - `scripts/smoke-container.ts`
  - `scripts/e2e/run.ts`
- AC:
  - [ ] The routes listed in design.md "Interfaces" are implemented, read-only over the
    derived tables.
  - [ ] Integration test: fixture zip → `/api/changes` (rank order, states, as-of, freshness,
    notice, last usable night).
  - [ ] `range=all` returns weekly medians.
  - [ ] v0 read routes remain until slice 11.
  - [ ] Smoke and e2e harness use `/api/changes`.
- Verify: `bun run check`; `make e2e` (the v0 UI may show empty data, but the harness passes).

### Slice 10 — MCP v1 `[midori-engine, lead checkpoint]`

- Rules: B-A1–B-A4.
- Files: `src/mcp/server.ts`, `src/mcp/server.test.ts`, `src/mcp/http.test.ts`.
- AC:
  - [ ] Tools `changes, metric_series, nights, epochs, list_imports`.
  - [ ] A parity test shows `changes()` == `/api/changes` rows.
  - [ ] Descriptions carry the B-A3 sentences.
  - [ ] Unknown metric → `isError` with the known list.
- Checkpoint B (lead): a fresh pi session answers "what changed recently, and could the device
  explain it?" via MCP only. The transcript is reviewed for cause assertions and recorded here
  without values.

## Phase 3 — UI

### Slice 11 — Foundation + v0 removal `[midori-ui]`

May start right away in its own worktree. It merges after slice 9.

- Files:
  - `web/**` (rebuild)
  - `package.json` (`tailwindcss`, `@tailwindcss/vite`, `echarts`, shadcn deps, the chosen
    router; remove `uplot`)
  - `components.json`
  - `tests/web/*` (delete or replace)
  - `e2e/*.spec.ts`
  - at merge: v0 read routes removed from `src/http/routes.ts`
- AC:
  - [ ] Tailwind v4 + shadcn initialized, dark-first. Tokens come from ui-design §9, and the
    contrast/colorblind check for the tints and the 6-color epoch palette is recorded in the
    hand-back.
  - [ ] Router chosen (TanStack Router or React Router), with the reason in the hand-back.
    Routes `/`, `/metrics`, `/metrics/:key`, `/devices`, `/import` exist, with placeholder
    bodies where needed.
  - [ ] Shell: sidebar (top tabs under 768 px), top-bar freshness (B-R1), importing pill.
  - [ ] `EChart` wrapper (init, resize, dispose, theme from CSS variables, per-module imports)
    with a smoke render.
  - [ ] Typed API client against the slice 9 DTOs. Until slice 9 merges, it is built against
    `src/domain/api.ts` from the slice 9 branch, or stubbed with fixtures.
  - [ ] Empty (B-R4), loading and read-error primitives.
  - [ ] Bundle ≤300 KB gzipped, measured and reported.
  - [ ] e2e: shell plus empty state at 1440 and 390 px.
- Verify: `bun run check`; `make e2e`; screenshots in `.tmp/v1-ui/` (lead inspects).

### Slice 12 — Import page `[midori-ui]`

- Rules: B-I1–B-I5, B-I7, B-I10, B-I11 (UI side); ui-design §8.
- AC:
  - [ ] Every §8 state is implemented with its copy.
  - [ ] XHR upload with byte progress and the "keep this tab open" line.
  - [ ] Stepper driven by stage/progress.
  - [ ] Summary card; history; Retry.
- Tests (e2e):
  - [ ] fixture upload → summary
  - [ ] duplicate → "Nothing new"
  - [ ] bad file → B-I1 copy
  - [ ] 390 px upload through the file input
- Verify: `bun run check`; `make e2e`; real-data screenshot inspection by the lead.

### Slice 13 — Changes page `[midori-ui]`

- Rules: B-F7–B-F11 (display), B-R1–B-R4; ui-design §4.
- AC:
  - [ ] `FindingRow` with every slot.
  - [ ] Overnight list (all metrics); daytime list (notable/alert only).
  - [ ] Warming-up notice; stale banner; last usable night card.
  - [ ] Every §4 state.
  - [ ] Copy rendered from finding keys through `web/src/copy.ts`.
  - [ ] Each state has an e2e check at 1440 and 390 px.
- Verify: as slice 12.

### Slice 14 — Metric chart + detail shell `[midori-ui]`

- ui-design §5 chart spec and states.
- AC:
  - [ ] `MetricChart`: polygon band via a `custom` series, recent `markArea`, seam `markLine`
    with offset/step label, OS-update marks, hollow partial points, faint minor points,
    `connectNulls:false`, legend outside.
  - [ ] Range control and `dataZoom` synced to the URL.
  - [ ] FindingRow header; recent-units table.
  - [ ] Trend-only and not-found states; text summary plus hidden table.
- Verify: as slice 12.

### Slice 15 — Checks + evidence sheet `[midori-ui]`

- AC:
  - [ ] Checks panel (B-C1–B-C6).
  - [ ] `?night=` opens the `Sheet` (full-screen under 768 px) with evidence from
    `/units/:day`.
  - [ ] Keyboard and Esc work.
  - [ ] "No samples stored" state.
- Verify: as slice 12.

### Slice 16 — Long view + Metrics index `[midori-ui]`

- AC:
  - [ ] Calendar per year (`calendar` + `custom` series), with hatched partial cells and seam
    marks.
  - [ ] `/metrics` grid from `/api/metrics`, ordered overnight → daytime → trend-only.
  - [ ] Every §6 state.
- Verify: as slice 12.

### Slice 17 — Devices page `[midori-ui]`

- AC:
  - [ ] Epoch timeline from days present (`custom` series; a sparse app shows as dots).
  - [ ] Per-epoch cards with role, baseline state, offset/step labels and OS updates.
  - [ ] Single-epoch and occasional-sources states.
- Verify: as slice 12.

**Gate C**: fresh verifier walks J1–J5 on real data and checks `make e2e`. Report persisted
in `docs/reviews/`.

## Phase 4 — ship

### Slice 18 — Ship `[lead]`

- Steps:
  - README rewrite
  - image + synthetic smoke
  - harus-k3s tag bump PR (its gates)
  - **owner-authorized** apply
  - pre-deploy snapshot
  - real export re-imported on the cluster through the upsert
  - MCP check from the workstation
  - backup CronJob fires
- Rollback = previous tag + snapshot restore, which needs owner approval.

## Dispatch log

| Slice | Writer (peer, model) | Worktree / branch | Base | Status |
| --- | --- | --- | --- | --- |
| 1 | — | — | — | not started |
| 11 | — | — | — | not started |
