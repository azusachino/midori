# 0001 — Analyze by device epoch and night, re-baselining at seams

Status: proposed 2026-11-15, rev 2 after the
[Fable review](../reviews/2026-11-15-v1-design-review-fable.md). Owner review via PR #1.

## Context

v0 kept a baseline per `sourceName`, used a fixed baseline window from 90 to 29 days before the
anchor, and suppressed every z-score whose 90-day window contained a coverage boundary. On the
real export after the 2026-10-10 watch change, all 14 briefing rows were suppressed
(`docs/reviews/2026-11-15-v0-product-review.md`). The founding question ("readiness feels off
— why?") falls exactly in the blanked period.

The v0 review and the Fable design review also measured these properties of the real export:

- The importer drops `device` (hardware model, OS version) and all metadata.
- Apple writes sleep and resting-HR records **without** a `device` attribute, while sensor
  samples carry one.
- Every timestamp is rendered in the export-time zone. Only `HKTimeZone` metadata on sleep
  records shows where a night was actually spent.
- Steps come from phone and watch together on most days.
- Respiratory rate and SpO2 are quantized enough that MAD is often 0.
- The old and new watch share no nights.

## Decision

The numbers behind each rule live only in [journeys.md §4](../journeys.md#4-expected-behavior).
This record fixes the principles:

1. **Device identity.** Capture the hardware model, the OS version and the metadata on every
   record. An **epoch** is `(source name, hardware model)`. Device-less records inherit the
   epoch of the same source's device-bearing records nearest in time (B-D1, B-D2, B-D2b).
2. **Night is the unit for overnight metrics**, assigned in the night's own timezone from
   `HKTimeZone` (B-N1–B-N5). Daytime metrics use calendar days.
3. **Usability has two levels.** The night must be complete (no export cut), and the metric's
   sample minimum must be met. Short nights are real data, not missing data (B-N6, B-N7).
4. **One sticky primary per metric.** Minor epochs are excluded per (metric, epoch). Kind
   priority goes watch > phone > app. The primary changes only after a sustained run, so
   day-to-day source mixing never creates a seam. A unit without primary data has no value
   (B-D3–B-D5).
5. **Rolling, ordinal baselines inside the current stint.** Recent and baseline windows are
   ranks over usable units, with a recency gate and a per-metric dispersion floor (B-F1–B-F4).
6. **Re-baseline instead of going dark.** A new stint warms up, then produces an early
   low-confidence z, then reaches full confidence (B-F3, B-F6). The user sees a countdown, not
   a blank.
7. **Show the confound, don't resolve it.** With shared nights, midori shows the offset; without
   them, it shows the across-seam step labelled "device or you, can't be separated." Device
   change, OS update, partial data, travel and missing nights are explicit checks on every
   finding (B-D6–B-D8, B-C1–B-C6).
8. **Findings say since when.** Onset comes from the current run outside the band (B-F11).
9. **One compute path.** Everything is derived once per import and swapped in atomically.
   Request handlers only read (B-I5, B-I6).
10. **No composite readiness score** (v0 grill Q1 stands). "Readiness contributors" is the
    ranked overnight set. VO2max is trend-only.

Thresholds marked † in journeys.md may be tuned after the slice 6 real-data readout with a note
there. Changing a principle above needs a new decision.

## Consequences

- Schema additions (`device_hw`, `device_sw`, `meta_json`, `export_date`, progress) plus an
  upsert re-import that fills them on existing rows. No data is deleted (B-I12).
- The spike regression fixture (a wrist-temperature device swap) stays. Its expected result
  changes from "z suppressed for 90 days" to "new stint, warming up, across-seam step shown".
- A device change becomes a readable state with a countdown, not a blackout.
- A same-name replacement watch is detected by its hardware model, including its device-less
  sleep records through inheritance. Two identical models under one name are not separated.
  This limitation is accepted.
- When old and new devices never overlap, midori reports a device-change confound and cannot
  say whether the device or the person changed.
- Steps use the primary epoch only and can read lower than Apple's merged total.
