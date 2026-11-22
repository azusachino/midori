# Implementation plan: midori v5 — Premium Evergreen Bento Cockpit

Status: draft 2026-11-22, pending independent review by Argon (`gemini-4-argon-high`).
Baseline: `main@8ba8c1c` (v4 complete, 375 tests green, 34 e2e passing, live on `0.0.1-rc4`).
References: [design](../docs/design.md), [journeys](../docs/journeys.md), [UI design](../docs/ui-design.md), `vendor/iroha/apps/iroha-web/src/routes/app.css`.

## 1. Goal & scope

Elevate `midori`'s visual craft from a utilitarian dark admin layout to a **premium, tactile
Evergreen Bento Cockpit** combining the best patterns from `iroha`, Linear, Apple Vitals,
Oura, Eight Sleep, and Stripe/Vercel — without adding runtime dependencies, breaking `B-F9`
neutral copy, or regressing any existing test or `B-` rule.

### Four visual upgrades:

1. **Atmospheric Canvas, Frosted Chrome, & Tactile Tile Material (`web/src/styles/app.css`, `Shell.tsx`)**
   - **Canvas (`body`):** Subtle `4rem × 4rem` architectural hairline grid (`rgb(255 255 255 / 0.022)`)
     layered over dual soft corner radial washes (emerald top-right + subtle teal/rose ambient
     glow bottom-left) on `#0a0c0b`.
   - **Tactile Tile Utility (`.midori-tile` & `.midori-tile-interactive`):** `rounded-2xl`
     (`14px`) elevated surfaces with a top-down specular sheen gradient
     (`linear-gradient(180deg, rgb(255 255 255 / 0.045), rgb(255 255 255 / 0))`), soft ambient
     depth shadow (`0 8px 30px -6px rgb(0 0 0 / 0.55)`), and `1px` specular top rim
     (`inset 0 1px 0 rgb(255 255 255 / 0.07)`). Interactive tiles lift `-1px` with emerald
     border glow on hover (`180ms cubic-bezier(0.22, 1, 0.36, 1)`, disabled under
     `prefers-reduced-motion`).
   - **Out-of-range status halos (`.midori-glow-notable`, `.midori-glow-alert`, `.midori-glow-emerald`):**
     Subtle colored radial edge glow on shifted tiles and spotlight cards.
   - **Frosted-glass floating chrome (`.midori-glass`):** `backdrop-filter: blur(20px) saturate(160%)`
     with top/bottom specular border applied to the sticky top header (`Shell.tsx`) and
     slide-over sheets (`ContextSheet`, `EvidenceSheet`) while keeping data tiles opaque.
   - **Editorial typography utilities (`.midori-kicker`):** Tracked uppercase `11px` kickers
     (`letter-spacing: 0.1em`, `font-semibold`, `text-muted-foreground`) above every card.
   - **Invariant:** Keep all `--color-*` hex values in `@theme` synced with `web/src/lib/theme.ts`
     so `tests/web/theme.test.ts` stays 100% green.

2. **Always-Visible Overnight Vitals Bento Grid on Home (`web/src/components/VitalTile.tsx`, `Changes.tsx`)**
   - Directly beneath the Hero (and Agent Briefing when present), render a sleek responsive
     **Overnight Vitals Bento Grid** (`data-testid="vitals-bento"`, `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5`)
     covering the 6 core Apple Vitals metrics (`sleep_h`, `rhr`, `hrv_sdnn`, `wrist_temp`,
     `resp_rate`, `spo2` — rendered in that fixed order for whichever metrics exist in
     `changes.overnight`).
   - Each `VitalTile` (`data-testid="vital-tile-<metric>"`) is a `.midori-tile-interactive` card
     linking to `/metrics/:key?range=90d&tab=chart` with:
     - Top row: `MetricIcon` inside a tinted rounded-lg icon well + metric name + compact status
       pill (`within` / `higher` / `lower` / `learning`).
     - Center: **Oversized tabular numeral** (`text-2xl sm:text-3xl font-semibold tracking-tight tabular-nums`,
       e.g., `65` with muted `bpm` unit suffix, respecting the `%` fraction guard and showing
       warm-up progress when `warming_up`).
     - Range bar: sleek `RangeGauge` bar + usual range caption (`usual 54–58 bpm`).
     - Footer: smooth **gradient-filled** `Sparkline` + compact `7/7 nights` / flagged-check chip.
   - Out-of-range tiles (`notable` / `alert`) carry `.midori-glow-notable` / `.midori-glow-alert`.
   - **Compatibility:** Existing `overnight-section` (`stands-out-group`, `close-to-edge-group`,
     `overnight-all` with `finding-row-*`) remains intact below `vitals-bento` so all `B-F12`
     semantics and existing `e2e/changes.spec.ts` assertions stay 100% valid.

3. **Editorial Hero & Lush Sleep Card (`Changes.tsx`, `LastNightCard.tsx`, `BriefingCard.tsx`, `Sparkline.tsx`)**
   - **Answer Hero Card:** Upgraded to `.midori-tile` with subtle emerald (all-within) or
     amber/rose (shifted) corner wash, `OVERNIGHT STATUS` kicker, visual **status pill strip**
     (`N in range`, `N shifted`, `N learning`), clean pill buttons (`+ Log note`, `Agent profile`,
     and `View trends →` link to `/trends`).
   - **Last Night Sleep Card (`LastNightCard.tsx`):** Upgraded to `.midori-tile`, `LAST COMPLETE NIGHT`
     kicker, **oversized `7.5 h` hero numeral** (`text-3xl font-semibold tabular-nums`), taller
     rounded `h-3` stage bar with subtle glow, and crisp stage breakdown pills (`Deep 1.5h`,
     `REM 1.5h`, `Core 4.5h`), preserving all existing copy/text assertions in `e2e/changes.spec.ts`.
   - **Gradient Sparklines (`Sparkline.tsx`):** Add a subtle SVG `<linearGradient>` vertical area
     fill under the recent sparkline segments so every mini-chart has Stripe/Oura-style visual depth.
   - **Briefing Spotlight (`BriefingCard.tsx`):** Upgraded to `.midori-tile .midori-glow-emerald`
     with soft emerald top-left ambient wash.

4. **Consistent Premium Polish Across All Other Pages (`/trends`, `/metrics`, `/metrics/:key`, `/devices`, `/import`)**
   - Apply `.midori-tile` and `.midori-kicker` to cards in `Trends.tsx`, `Metrics.tsx`,
     `MetricDetail.tsx`, `Devices.tsx`, and `Import.tsx`.
   - Add soft vertical `LinearGradient` area fills under the 4 line curves in
     `CorrelatedVitalsChart.tsx` (using ECharts `areaStyle` with low opacity `0.18 -> 0.0`).
   - Bump `package.json` `"version"` to `"0.0.1-rc5"`.

## 2. Implementation slice (single cohesive UI-only slice for `pi` DeepSeek via Herdr)

No schema, backend, or MCP changes are required (zero migration risk).

- **Files:**
  - `package.json` (`version: "0.0.1-rc5"`)
  - `web/src/styles/app.css` (canvas grid + glows, `.midori-tile`, `.midori-tile-interactive`,
    `.midori-glass`, `.midori-kicker`, `.midori-glow-*`)
  - `web/src/components/Shell.tsx` (`.midori-glass` sticky header, polished sidebar active state)
  - `web/src/components/Sparkline.tsx` (subtle SVG gradient area fill under recent curve)
  - `web/src/components/VitalTile.tsx` (new — Apple Vitals/Bevel-style bento tile)
  - `web/src/components/LastNightCard.tsx` (editorial `.midori-tile` with oversized sleep numeral)
  - `web/src/components/BriefingCard.tsx` (`.midori-tile .midori-glow-emerald` spotlight)
  - `web/src/components/CorrelatedVitalsChart.tsx` (soft vertical gradient `areaStyle` fills)
  - `web/src/pages/Changes.tsx` (Hero Bento + `vitals-bento` grid + `.midori-tile` polish)
  - `web/src/pages/Trends.tsx`, `web/src/pages/Metrics.tsx`, `web/src/pages/MetricDetail.tsx`,
    `web/src/pages/Devices.tsx`, `web/src/pages/Import.tsx` (`.midori-tile` + `.midori-kicker` consistency)
  - `web/src/copy.ts` (neutral B-F9 kickers/labels for Vitals Bento & hero)
  - `tests/web/vitalTile.test.ts` (new unit tests for core vital selection, value/unit split, `%` guard)
  - `e2e/changes.spec.ts` (assert `vitals-bento` visible with `vital-tile-*` at 1440px & 390px,
    plus zero horizontal overflow)
- **Gates:**
  - `bun run check` exits 0
  - `bun run privacy-guard` exits 0
  - `make e2e` exits 0
  - Lead inspects rendered 1440px & 390px screenshots of `/` (both with alerts and all-within)
    and `/trends` before merging.
