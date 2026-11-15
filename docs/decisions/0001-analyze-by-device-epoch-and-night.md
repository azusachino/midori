# 0001 — Analyze by device epoch and night, re-baselining at seams

Status: proposed 2026-11-15 (owner review via PR)

## Context

v0 kept a separate baseline for each `sourceName`. It used a fixed baseline window from 90 to
29 days before the anchor, and it suppressed every z-score whose 90-day window contained a
coverage boundary. On the real export after the 2026-10-10 watch change, all 14 briefing rows
were suppressed. The new watch cannot produce a z until late November, and suppression lasts
until about January 2027 (`docs/reviews/2026-11-15-v0-product-review.md`, findings 1–3).
The founding question ("readiness feels off — why?") falls exactly in that blanked period.

The same review also found these problems:

- A source is a device *name*. The importer drops the `device` attribute (hardware model) and
  all metadata.
- Coverage uses min/max spans, so one stray sample from a minor app can silence the primary
  watch.
- Overnight metrics are grouped by calendar day rather than by night.

## Decision

1. **Device identity.** Store the parsed hardware model (`device_hw`, e.g. `Watch7,5`) and the
   record metadata (`meta_json`) on every record. A **device epoch** is
   `(source_name, device_hw)`. Its coverage is the set of days it actually recorded, not a
   min/max span.
2. **Night is the unit for overnight metrics.** HRV, respiratory rate, wrist temperature,
   overnight SpO2 and sleep all use one night rule: a sample at or after 15:00 local belongs to
   that date's night, and one before 09:00 belongs to the previous date's night. HRV keeps its
   21:00–09:00 sample filter. Daytime metrics (steps, active energy, VO2 max) stay on calendar
   days.
3. **Completeness.** Every night is either `complete` or `partial`. A night is partial when the
   export was taken before its window closed, or when asleep time is below 50% of that epoch's
   trailing median. "Last night" and baselines use complete nights only.
4. **One primary series per metric.** For each night or day, the primary epoch is the one with
   the most samples. An epoch that recorded on less than 20% of the trailing 28 days is minor:
   it is kept and shown, but it can never be primary and never raises a seam.
5. **Rolling baselines inside an epoch.** The recent window is the last 7 complete units
   (minimum 4). The baseline is the units from 35 to 8 back (minimum 14), drawn **only from
   the current epoch**. Robust z and the 1.4826 × MAD scaling stay as in v0.
6. **Re-baseline instead of going dark.** A change of primary epoch starts a new baseline at
   the seam:
   - Days 1–13: "warming up, n of 14", with no z.
   - From 14 nights: the z is shown with reduced confidence until the full baseline exists.
   - Where both epochs recorded on at least 7 of the same units, the median offset is shown.
     Values are never auto-corrected.
7. **Confidence, not just severity.** Every finding carries `high`, `medium` or `low`
   confidence, derived from n, epoch age and the metric's trust label. Ranking orders by
   |z|, then by confidence.
8. **One compute path.** Nights, daily values, baselines and findings are computed once per
   import, inside the import transaction, and persisted. Request handlers only read. The live
   `computeFindings` call on `/api/deviations` and the query-time evidence-text rewriting are
   removed.
9. **No composite readiness score** (v0 grill Q1 stands). "Readiness contributors" is the
   ranked overnight set.

The window lengths, the 20% minor threshold and the 50% partial threshold are starting values.
The contracts task pins them with unit tests. Changing them later only needs a note in this
record, not a new decision.

## Consequences

- Schema change plus a full re-import from the archived `export.zip`. Derived tables are a
  cache, so nothing is migrated.
- The spike regression fixture (a wrist-temperature device swap) stays. Its expected result
  changes from "z suppressed for 90 days" to "new epoch, warming up, offset shown".
- A device change becomes something you can read about, not a blackout.
- A replacement watch that keeps the old name is still detected, because its hardware model
  differs. Two identical models under one name are not separated. This limitation is accepted.
