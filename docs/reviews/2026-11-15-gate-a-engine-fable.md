<!--
Gate A independent verification of midori v1 engine slices 1–8.
Reviewer: Claude Fable 5.2 (native subagent, fresh context, did not write the code).
Revision: main @ ad46acb. Synthetic repros in workstation .tmp/midori-v1/gate-a/ (scratch).
Real-data probes: counts and states only, on a deleted scratch copy.
Resolution: slice 8b (task/v1-8b-gate-a-fixes); see tasks/todo.md.
-->

# Gate A — midori v1 engine (slices 1–8)

## Verdict

**PASS WITH FINDINGS.** `bun run check` exits 0 (198 pass). The derive is atomic, migration 0004
is safe on real data, and the real-data shape is healthy. Three rules are not implemented as
written on the production path (B-D6, B-C3, B-I4's "nothing removed" for derived state), and
one stint bug can blank a metric.

| # | Criterion | Result |
| --- | --- | --- |
| 1 | Every rule implemented as written, with a test named by its id | unmet (H1, M2, M6; 12 ids without a named test) |
| 2 | Correctness beyond the tests | unmet (10 deviations reproduced synthetically) |
| 3 | Atomicity and failure | met, except H2 |
| 4 | Gates | met: `bun run check` exit 0, 198 tests |
| 5 | Real-data shape | met; H1 is live on 1 seam, the rest are latent |

## Findings

### HIGH

- **H1 — the B-D6 overlap offset is unreachable.**
  - `metric_values` stores only the primary epoch per unit (`nights.ts:712`), so
    `rebuildSeamSteps` never sees shared units. Every seam is a `step` (real data: 27 steps,
    0 offsets), although one daytime seam has ≥7 shared days.
  - The `B-D6` test feeds an input production never produces.
  - Fix: keep non-primary presence units for seam statistics (also needed for the faint
    minor-epoch points in the UI); test through `derive()`.
- **H2 — importing an older export regresses derived state (B-I4, B-N6).**
  - The export date used for completeness comes from the latest import row by id, not the
    newest export date over `done` imports. Every night after the older date becomes
    `export_cut`, and as-of moves back.
  - Fix: use the max parsed `export_date` over done imports plus the running one; assert as-of
    and partial counts in the B-I4/B-I3 tests.

### MED

- **M1:** in `primaryAtStart`'s fallback branch, a minor epoch can become the initial primary;
  the metric then gets no stints, values or finding. Fix: filter non-minor.
- **M2:** B-C3 never flags. It counts night-level partials inside the recent window, but an
  export-cut night is always after as-of, and metric-level unusable units are ignored. Fix: count
  unusable `metric_values` for the metric/epoch between the oldest recent unit and as-of.
- **M3:** B-C1 keys on `seam_steps` rows, not on stint boundaries, so seams without a step row
  are missed. Fix: use the `stints.start_day` of non-first stints.
- **M4:** B-F11 onset is NULL when rank 1 is inside the band; the side comes from rank 1, not
  from the sign of z. Fix: take the side from the sign of z, tolerate rank 1 inside, and
  compute onset for notable/alert rows only.
- **M5:** B-D2 inheritance is resolved per (source, local day), not per record. A swap night
  is split, and sleep seams land one day after sensor seams. The tests exercise a second,
  non-production implementation. Fix: resolve per record by nearest time, and test the
  production path.
- **M6:** B-I8 lacks new usable nights, new epochs, and a progress total (the uncompressed entry
  size). Fix: store them, or move them explicitly to slice 9.
- **M7:** B-N8 compares zone strings, so a missing-`HKTimeZone` fallback produces false
  `tz_change` nights. Fix: compare UTC offsets.

### LOW

- **L1:** `rhr` is assigned through the 15:00–09:00 window and drops or misassigns daytime
  records. Fix: assign by local date − 1.
- **L2:** B-C5 boundary is off by one (span > 10 uses the day difference). Decide inclusive or
  exclusive and test it.
- **L3:** export-day units are dropped instead of stored as unusable (B-N9).
- **L4:** B-D4: `app` outranks `other`; with several qualifiers, the last iterated wins; the
  first stint can start at a non-primary first day.
- **L5:** expired spools and orphaned `.part` files are never deleted.
- **L6:** the job-level catch and the restart reconcile overwrite `stage` with `failed`, losing
  the failing stage (B-I5).
- **L7:** the trend-only `vo2max` row is persisted in `findings`; readers must filter it.
- **L8:** epoch ids change on every derive; don't expose them in URLs.
- **L9:** test-only and dead code carries rule-named tests (`deriveEpochs`, `rebuildStints`,
  `rebuildNights`, `primaryUnits`, `assembleNights`, …).
- **L10:** the band is centred on the baseline median, so "at least since" is nearly
  unreachable. Note it in journeys.md.

## Rule coverage

No test is named for: B-D2b, B-D5, B-D7, B-N2, B-N3, B-N8, B-N9, B-F5, B-F9, B-F10. B-C2–B-C6
share one combined test. Named tests that exercise a non-production helper: B-D4b, B-D6, B-N4,
B-N5, B-D1/B-D2 (partly).

## Real-data shape (counts only)

- 11 epochs, 106 OS events, 42 stints, 1,407 nights (1 `export_cut`), 13,179 metric values,
  14 findings, 27 seam steps.
- At most 1 epoch per (metric, unit).
- Findings: 13 computed (12 medium, 1 low), 1 warming_up.
- Flagged checks: device_change 12, os_update 13, low_trust 1, partial_nights 0.

## Not verified

- B-I9 timing; a real HTTP upload or restart.
- Cross-connection isolation (B-I6).
- DST and half-hour zones.
- B-R, B-A, the UI and the image (out of scope).
