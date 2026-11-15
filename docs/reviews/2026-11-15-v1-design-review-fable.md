<!--
Reviewer: Claude Fable 5.2 (claude-fable-5-2), fresh-context subagent, owner-named reviewer.
Subject: v1 design set at a1fa2f7 (task/v1-redesign, PR #1). Source-only design review plus
read-only data-shape measurement on the private db and archived zip; counts only.
Lead spot-checks (2026-11-15): H2 (sleep records: 454 with device, 35,266 without), M1
(1 distinct start_offset_min across all records) and H6 (store.ts uses INSERT OR IGNORE)
reproduced. M13 is a reviewer error: plan.md at a1fa2f7 had a Risks section; it was extended
anyway. Resolution of each finding: see "Resolution" at the end.
-->

# Independent design review: midori v1 design set

Reviewer: Fable 5.2, fresh context. Revision `a1fa2f7`. Sources are anonymized as S1..S9;
counts and shapes only.

## Verdict: CHANGES REQUESTED

The direction is right and should stay: epochs, nights, re-baselining, one compute path, no
score. But six rules, as written, would produce wrong or empty output on the real export, and
the warm-up arithmetic contradicts itself across four documents. All fixes are document
revisions; nothing needs re-deciding by the owner. No contradiction of standing owner
decisions was found.

| # | Criterion | Result |
| --- | --- | --- |
| 1 | Coherence | unmet (H1, M6, M7, M8) |
| 2 | B-rules unambiguous and testable | unmet (H2–H5, M1–M5) |
| 3 | Analysis model soundness | unmet: sound in outline, but fails on the real data shape |
| 4 | UI serves the journeys | unmet, but close (M9, M10) |
| 5 | Plan quality | unmet (H6, M11–M13) |
| 6 | Scope | met, with notes |

## HIGH

- **H1. Warm-up arithmetic contradicts itself.**
  - ADR 0001 and design say z appears from night 14.
  - B-F1 (baseline units 35…8 back, ≥14) first yields a z at epoch night 21.
  - "Baselines from Oct 24" (seam + 14) contradicts B-F1/B-F3.
  - "n of 14" counts baseline units in one place and nights on the watch in another.
  - Fix: pick (a) z at night 21, or (b) an early baseline of all epoch units before the recent
    7, minimum 7, giving z at night 14 with low confidence. Then fix all five places.
- **H2. Device-less records split a watch's metrics into an "app" epoch.**
  - Measured: every sleep-analysis and resting-HR record from watch sources has no `device`
    attribute; VO2max is mostly device-less; about 27% of the main watch's records are
    device-less.
  - Under B-D2, four of the nine overnight metrics would land in a separate `app` epoch, and
    the same-name-replacement claim fails for them.
  - Fix: a device-less record inherits the hardware epoch of the same source that carried a
    device on that unit (nearest in time). Fall back to `(source, "")` only when the source
    never carries a device. Add a fixture.
- **H3. "Primary = most samples" without hysteresis makes steps flap.**
  - Measured over 180 days: steps has more than one non-minor source on 169 of 181 days. The
    sample-count rule gives 6 seams with run lengths 126, 1, 24, 5, 10, 1, 13. Other metrics
    have exactly 1 seam.
  - Fix: a sticky primary that changes only after the challenger wins N consecutive units or
    the incumbent stops; optionally, watch beats phone. Add a fixture for alternating
    phone/watch days.
- **H4. The minor rule is ambiguous.**
  - It is scoped per metric in one place and per epoch in another, and it never says when
    "trailing 28" is evaluated.
  - Evaluated per unit, a new watch is minor for its first ~5 nights; measured, that leaves 5
    nights with no eligible primary at the real seam.
  - Evaluated as of today, a retired watch turns minor and loses its historical primaries.
  - Fix: define minor per (metric, epoch) over the epoch's own span. An epoch that is the only
    recorder of a unit is eligible.
- **H5. v0's zero-MAD policy is unsafe for quantized metrics.**
  - The fallback to range/4, else 1e-9, makes any shift an alert.
  - Measured with 28-unit baselines: MAD is exactly 0 in 241 of 931 windows for respiratory
    rate and 78 of 929 for SpO2; never for HRV, wrist temperature or RHR.
  - Ranking by raw |z| would put one-quantum moves on top.
  - Fix: a per-metric dispersion floor (the resolution), `max(1.4826·MAD, floor)`, and a cap on
    displayed |z|. Remove the 1e-9 branch.
- **H6. Re-import cannot fill new columns.**
  - `src/ingest/store.ts` uses `INSERT OR IGNORE` on an unchanged dedup key, so existing rows
    keep `device_hw`/`meta_json` NULL. Every epoch would come out as `(source, "")`. This
    applies to the local and cluster dbs alike.
  - Fix: empty the tables and re-import (data deletion → ask), or upsert to fill NULL
    columns. Add a test.

## MED

- **M1.** All records carry one UTC offset, because the export renders every timestamp in the
  export-time zone. B-N9 can never fire, and travel nights fall into the nap bucket. The real
  signal is the `HKTimeZone` metadata on sleep records (2 distinct values). Use it.
- **M2.** B-N7 marks genuinely short nights partial, so they vanish from `sleep_h` itself. Keep
  short nights complete for sleep metrics; reserve `partial` for export-cut and not-worn
  nights.
- **M3.** There is no recency bound on "last 7 complete units": VO2max spans exceed 10 days in
  240 of 284 windows. It is also unclear whether windows are ordinal or calendar. Fix: make
  them ordinal, add a staleness gate, make VO2max trend-only, and drive the notice from
  overnight metrics only.
- **M4.** Old and new watch share 0 nights for overnight metrics, so the B-D6 offset never
  shows. B-C1 can't fire for a current-epoch-only baseline. Fix:
  - define the check over the last 35 calendar units
  - show the across-seam step with the label "device or you, cannot be separated"
  - capture the `software:` version and add an OS-update check
  - say plainly that midori reports this confound and does not resolve it
- **M5.** Completeness is defined at two levels without saying how they combine. Also:
  - asleep records between 09:00 and 12:00 are dropped (17 of 400 mornings)
  - SpO2 is `nightOnly: false` in the registry
  - sleep primary should stay by seconds, as in v0
  - it is unclear whether a re-primaried epoch may reuse pre-seam values
- **M6.** Atomicity rules don't match the kept code:
  - batches commit every 10k rows
  - the evidence endpoint reads raw records
  - the spool is deleted on failure, and no retry endpoint exists
  - B-I1 needs a server change
  - there is no restart reconciliation
  - there is no progress field
  - the `imports.status` CHECK lacks `deriving`
- **M7.** "Since when" is promised in J1, but no rule computes an onset.
- **M8.** Smaller contradictions:
  - default range is 180 in design but 90 in journeys/ui
  - design lists 4 pages, the UI has 5
  - there is no index endpoint, and no per-epoch metric state for Devices
  - `metric_series(all)` is unbounded
  - the Last-night card has no rule for when no complete night exists
- **M9.** UI states are specified for Changes only. Missing: read-error, not-found, the other
  pages, and upload failure on the phone. The checks summary is hover-only.
- **M10.** "Share → Safari" is not a real iOS path. The real path is Save to Files → Safari →
  choose file; the tab must stay foregrounded during upload; XHR progress is needed.
- **M11.** Slices 1, 5 and 12 exceed the plan's ~5-file rule. Split them.
- **M12.** The keep/rewrite/delete table misses smoke/e2e scripts that call `/api/briefing`,
  plus `src/domain/api.ts`, the web client and copy, tests, the fixture snapshot, the `uplot`
  dependency and the README. Between slices 7 and 11 the UI on `main` is dead.
- **M13.** No risk list.

## LOW

- **L1.** The export-cut rule flags the last night in the normal case; the copy should say
  "export taken before noon".
- **L2.** ECharts notes: hatched calendar cells need a `custom` series; a stacked band breaks on
  negative values; the 6-color palette is smaller than the number of epochs, so color non-minor
  epochs only.
- **L3.** Vitals uses sleeping heart rate, while the overnight set uses RHR as a proxy. Add
  `sleep_hr` or state the limitation.
- **L4.** Primary-only steps undercount against Apple's merged total; state it in the trust
  note.
- **L5.** The confidence rules overlap between 21 and 34 units; write them as an ordered list.
- **L-scope.**
  - Cut or defer: ⌘K, the monthly-median chart, the added/resolved diff, the TanStack Table
    option.
  - `meta_json` for all records is defensible.
  - Add: a backup count/size cap (211 snapshots locally), a software-version check, the
    across-seam step.

## What's good

- The redesign answers the v0 review point by point.
- The B-rule tables are traceable to slices; the only gap is the server side of B-I1.
- Full overnight set, neutral wording, no value correction.
- Real data supports feasibility:
  - hardware is present on all sensor metrics
  - a same-name hardware change is detectable
  - healthy overnight densities: HRV ~6/night, resp ~48, SpO2 ~14, wrist temp exactly 1
  - only 5 of 400 HRV nights have <3 samples

## Not covered

The research note was grep-only. shadcn/Tailwind feasibility was not prototyped. Contrast
claims are unverifiable before tokens exist. No gates were run (docs-only revision).

## Resolution (lead, 2026-11-15)

All findings were accepted except M13: a risk list existed, and it was extended. Chosen
options:

- **H1:** option (b), an early baseline (≥7) giving z at night 14 with low confidence; full
  baseline from night 35.
- **H2:** the inherit rule (B-D2a).
- **H3:** kind priority (watch > phone > app) plus a sticky primary. A unit without primary data
  has no value; there is no per-unit fallback.
- **H4:** minor per (metric, epoch) over its own span.
- **H5:** a dispersion floor in the registry, and |z| capped at 10.
- **H6:** an upsert that fills NULL `device_hw`/`meta_json`/`device_sw`, so no data is deleted.
- **M1:** night rule in the `HKTimeZone` zone.
- **M2:** short nights stay complete for sleep metrics.
- **M3:** ordinal windows, a 14-day staleness gate, VO2max trend-only.
- **M4:** across-seam step, `device_sw` + OS-update check, ADR statement.
- **M5:** two-level completeness; 09:00–12:00 continuation rule; SpO2 overnight; sleep primary
  by seconds; current-stint baseline.
- **M6:** B-I5 relaxed; B-I10 orphan reconcile; retry endpoint; progress field; status CHECK
  migration; server side of B-I1 assigned to a slice.
- **M7:** B-F11 onset.
- **M8:** all fixed.
- **M9:** per-page state tables.
- **M10:** real iOS path, XHR, 390 px file-input e2e.
- **M11:** slices split.
- **M12:** table completed; v0 routes and web deleted together in the UI foundation slice.
- **L1–L5:** applied. L3 adds `sleep_hr`.
- **Scope:** ⌘K, monthly-median chart, added/resolved diff and TanStack Table cut. Backup cap
  added.
