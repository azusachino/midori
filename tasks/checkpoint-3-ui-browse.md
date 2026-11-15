# Checkpoint 3 — UI browse on real data (2026-11-15)

Verification for tasks/plan.md Checkpoint 3: integration tests green in CI; a real browser
pass on the real database showing briefing cadence/status/evidence links, as-of everywhere,
and investigate reproducing the spike story.

## How

- Playwright-verify skill: `make e2e` (hermetic: spike-corpus fixture db + built web shell +
  real server, 6 checks, all green in ~0.9s) and the probe (`--project=probe`) against the
  live `data/midori.db` server for the real-data browse. Model on this terminal cannot read
  pixels, so the evidence is the probe's ARIA snapshots (roles + accessible names) plus
  screenshots saved under `/tmp/midori-*.png`.

## Real-data findings (ARIA snapshots)

Briefing (`/`):

- `paragraph: as of 2026-11-07` — anchor day surfaced. Import line `export.zip — Done`.
- Last night cards with as-of + trust chips: Sleep 1.21 h (Moderate), Deep 0 h, REM 0 h
  (export-day partial night — consistent with the spike readout), RHR 68 bpm (High),
  HRV SDNN 61 ms (Moderate), Respiratory rate 15.5 /min (Moderate).
- Deviations: every ハルのWatchUltra row suppressed `across a device switch — baselines not
  comparable`; HRV RMSSD `not enough baseline days yet`; VO₂ max `gap in coverage`. No z≥2.5
  anywhere — the +4σ wrist-temp artifact never appears, exactly the regression the fixture
  pins. Each row links `Investigate → /investigate?metric=&source=<encoded>`.
- Device changes: e.g. `Nike Run Club started recording active energy on 2025-04-16`.

Investigate wrist_temp: chart `img` with 3 series (あずさチノのApple Watch, ハルのWatchUltra,
ハルのiWatch), band note, baseline table (Ultra suppressed, recent 36.32), device events
(`2024-02-18 coverage boundary after ハルのiWatch` …).

Investigate hrv_sdnn: SDNN ×3 sources **and** `ハルのWatchUltra · HRV (RMSSD)` as its own
labeled series — both shown, never blended.

Import: dropzone + run history with the three real runs (2026-11-15: 2,046,801 new; two
re-imports 0 new / 2,047,778 deduped, 14.7–15.3s).

## Fixes that came out of the pass

- `valueFmt` applied to all displayed numbers (was: `Sleep 1.2113888888888888 h`).
- `bun test` scoped to `src tests scripts`; e2e specs run only through playwright.

## Limits

- Screenshots exist (`/tmp/midori-{briefing,wrist,hrv,import}.png`) but were not machine-read
  (model without vision on this route); the ARIA snapshots carry the claims. A human glance at
  the live UI is the remaining sanity check, one `bun src/server.ts` away.
- e2e is local-gated (`make e2e`), not wired into CI: CI stays fast; Chromium-in-CI can be
  added when the UI churn slows.
