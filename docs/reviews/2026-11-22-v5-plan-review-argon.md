# Independent Plan Review: midori v5 (Premium Evergreen Bento Cockpit)

- **Reviewer:** Argon (`gemini-4-argon-high`)
- **Date:** 2026-11-22
- **Target plan:** `vendor/midori/tasks/v5-plan.md` against `vendor/midori` (`main@8ba8c1c`)
- **Verdict:** **APPROVE WITH GUARDRAILS** — The single-slice UI architecture is sound, zero-dependency, and well-scoped. Before or during implementation, enforce the two **HIGH** guardrails (`LastNightCard` exact DOM text substring and `Sparkline` `useId()` hook ordering) and the four **MED** guardrails below so all 375 unit tests and 34 Playwright e2e tests pass on the first run.

---

## HIGH Findings

### H1. `LastNightCard.tsx` must preserve exact case-sensitive DOM substrings asserted by `e2e/changes.spec.ts`
- **Where:** `web/src/components/LastNightCard.tsx`, `e2e/changes.spec.ts:78-86, 208-210`
- **Why:** `e2e/changes.spec.ts` asserts:
  ```ts
  await expect(lastNight).toContainText("Last complete night — Nov 14 (Sat)");
  await expect(lastNight).toContainText("asleep 7.5 h · deep 1.5 · REM 1.5 · core 4.5");
  await expect(lastNight.getByTestId("sleep-stage-bar")).toBeVisible();
  await expect(lastNight.getByTestId("sleep-stage-legend")).toContainText("Deep" | "REM" | "Core");
  ```
  Playwright's `toContainText(string)` is **case-sensitive** against DOM `textContent`. If the plan replaces `"Last complete night — Nov 14 (Sat)"` with an uppercase literal `"LAST COMPLETE NIGHT"` or replaces `copy.pages.changes.lastNight.breakdown(asleep, deep, rem, core)` with separate `7.5 h` and `Deep 1.5h / REM 1.5h / Core 4.5h` pills, `e2e/changes.spec.ts:79-80` will fail.
- **Fix:**
  1. Keep `{copy.pages.changes.lastNight.title(formatDayWithWeekday(lastNight.date))}` as the DOM text and apply `.midori-kicker` (`text-transform: uppercase`) via CSS so visual rendering is uppercase while DOM `textContent` remains `"Last complete night — Nov 14 (Sat)"` (and `"Last complete night"` when empty).
  2. Keep `{copy.pages.changes.lastNight.breakdown(asleep, deep, rem, core)}` rendered inside `data-testid="last-night-card"` (either visibly as the tabular summary caption beneath the oversized `7.5 h` numeral, or in an `sr-only` span if stage pills replace it visually), and keep `SleepStageBar` (`sleep-stage-bar` + `sleep-stage-legend`).

### H2. `Sparkline.tsx` SVG `<linearGradient>` ID collision across multiple instances on `/` and `/metrics`
- **Where:** `web/src/components/Sparkline.tsx`, `web/src/lib/finding-format.ts`
- **Why:** With `VitalTile` added to `/`, up to 6 bento sparklines + 8 overnight `FindingRow` sparklines + daytime `FindingRow` sparklines render simultaneously in one document. A static `<linearGradient id="sparkline-fill">` or even a metric-keyed ID (`id={`spark-${metric}`}`) will collide between `VitalTile` and `FindingRow` for the same metric (and when one instance lives inside a collapsed `<details data-testid="overnight-all">`, duplicate SVG IDs can cause `fill="url(#...)"` to reference the wrong severity color or fail to paint).
- **Fix:**
  1. Call `const gradientId = useId();` **at the very top of `Sparkline` before `if (points.length === 0) return null;`** (so Rules of Hooks are never violated).
  2. Use `<linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">` with `<stop offset="0%" stopColor="currentColor" stopOpacity={0.24} />` and `<stop offset="100%" stopColor="currentColor" stopOpacity={0} />`.
  3. Build closed area path(s) for `geo.recentSegments` (closing each contiguous recent segment down to `y = geo.height - 3` at its start/end `x` coordinates so `null` gaps do not create twisted polygons) and apply `className={accentClass}` + `fill={`url(#${gradientId})`}`.

---

## MED Findings

### M1. `Shell.tsx` sticky `.midori-glass` header vs desktop sidebar sticky geometry (`e2e/shell.spec.ts:103-117, 149-154`)
- **Where:** `web/src/components/Shell.tsx:58, 136`, `e2e/shell.spec.ts:103-117`
- **Why:**
  1. Currently `<header>` is in normal flow while the desktop sidebar inner wrapper has `md:sticky md:top-0 md:max-h-dvh`. If `<header>` becomes `sticky top-0 z-30` while the sidebar stays `md:top-0`, scrolling down the page will slide the top of `sidebar-nav` ("Changes") **underneath** the frosted header.
  2. `e2e/shell.spec.ts:104-117` enforces strict vertical geometry:
     - `watchTop - (navBox.y + navBox.height) < 64`
     - `versionBox.y >= watchBox.y + watchBox.height` and `< watchBox.y + watchBox.height + 64`
     - At `1440×480` scrolled to bottom, `sidebar-watch` must stay on screen (`0 <= scrolled.y < 480`).
  3. At `390×844` (`e2e/shell.spec.ts:149-154`), `topbar-freshness` must sit below the brand link (`freshnessBox.y >= brandBox.y + brandBox.height - 2`).
- **Fix:** Offset the desktop sidebar sticky container below the sticky header (`md:top-13` / `md:max-h-[calc(100dvh-3.25rem)]`), preserve the existing `pt-6` spacing between `sidebar-nav`, `sidebar-watch`, and `sidebar-version` (at `1440×480` `sidebar-watch` lands at `y ≈ 273 < 480`), and keep the mobile `<header>` inner row `flex-col md:flex-row`.

### M2. `VitalTile` selector, testid, and interactive element isolation from `FindingRow` (`e2e/changes.spec.ts`)
- **Where:** `web/src/components/VitalTile.tsx`, `web/src/pages/Changes.tsx`, `e2e/changes.spec.ts:54-68, 91-98`
- **Why:** `e2e/changes.spec.ts` queries several testids at the `page` level without scoping to `overnight-section`:
  - `page.getByTestId("finding-row-spo2")` (line 66 — asserted `.toBeHidden()` while inside collapsed `overnight-all`)
  - `page.getByTestId("trust-trigger-hrv_sdnn").click()` (line 91)
  - `page.getByTestId("checks-trigger-hrv_sdnn").click()` (line 96)
  - `page.getByTestId("finding-row-hrv_sdnn")` (lines 109, 199)
- **Fix:**
  1. Render `data-testid="vitals-bento"` **outside** `data-testid="overnight-section"`.
  2. Use `data-testid={`vital-tile-${row.metric}`}` on the tile root and **never** render `finding-row-*`, `trust-trigger-*`, `checks-trigger-*`, `recent-value-*`, or `low-trust-*` inside `VitalTile`.
  3. Because `VitalTile` is a `<Link>` (`<a>`), keep its flagged-check indicator and `RangeGauge` purely non-interactive (`pointer-events-none`, no nested `<button>` or popover trigger inside `<a>`).

### M3. `tests/web/theme.test.ts` full-file CSS regex & `B-F9` neutral copy serialization checks
- **Where:** `web/src/styles/app.css`, `web/src/copy.ts`, `tests/web/theme.test.ts:132-205`
- **Why:**
  1. `readAppCssTokens()` matches `/--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g` across the **entire** `app.css` file and compares against `THEME_DEFAULTS` and `EPOCH_PALETTE`, while also enforcing `g > r`, `g > b`, `g < 64` on surface hexes and `>= 4.5:1` contrast.
  2. `tests/web/theme.test.ts:133-139` checks `JSON.stringify(copy).toLowerCase()` for `"caused"`, `"better"`, `"worse"`, and `"your watch is wrong"`.
- **Fix:** Keep all `--color-*` declarations in `@theme` as untouched 6-digit hex literals (`#rrggbb;`), do not re-declare `--color-*` custom properties inside `.midori-tile` / `.midori-glass` / `.midori-glow-*`, and keep all new `copy.ts` strings strictly descriptive (`"Overnight vitals"`, `"Overnight status"`, `"View trends →"`).

### M4. ECharts `areaStyle` gradient in `CorrelatedVitalsChart.tsx` with `yAxis.scale: true`
- **Where:** `web/src/components/CorrelatedVitalsChart.tsx:152-178`
- **Why:** While `echarts/core` in `echarts@6.1.0` does export `echarts.graphic.LinearGradient`, `panel.color(theme)` returns `#rrggbb` hex strings (`#747ef8`, `#2dd4bf`, `#fb7185`, `#fbbf24`), and each panel uses `yAxis: { type: "value", scale: true }`. Without `origin: "start"`, an ECharts `areaStyle` fills toward `y = 0` (which for scaled axes like wrist temp `36.4 °C` or RHR `54 bpm` can behave unexpectedly if negative/positive bounds shift).
- **Fix:** Use ECharts' declarative linear gradient object directly in `areaStyle` with `origin: "start"` (no extra `echarts/core` import or hex-to-rgba parser needed):
  ```ts
  areaStyle: {
    origin: "start" as const,
    opacity: 0.18,
    color: {
      type: "linear" as const,
      x: 0,
      y: 0,
      x2: 0,
      y2: 1,
      colorStops: [
        { offset: 0, color: panel.color(theme) },
        { offset: 1, color: "rgba(18, 22, 20, 0)" },
      ],
    },
  },
  ```

---

## LOW Findings (Visual & Accessibility Polish)

### L1. Guard `.midori-tile-interactive:hover` transform under `prefers-reduced-motion`
- **Where:** `web/src/styles/app.css`
- **Why:** `app.css:96-104` zeroes `transition-duration` under `@media (prefers-reduced-motion: reduce)`, which still allows `transform: translateY(-1px)` to snap instantaneously on hover unless the transform itself is gated or reset.
- **Fix:** Wrap the hover lift (`transform: translateY(-1px)`) in `@media (prefers-reduced-motion: no-preference)` (or set `transform: none !important` inside the reduced-motion block).

### L2. `.midori-glass` background opacity & `VitalTile` `RangeGauge` width on narrow viewports
- **Where:** `web/src/styles/app.css`, `web/src/components/VitalTile.tsx`
- **Why:**
  1. Applying `.midori-glass` to `SheetContent` (`ContextSheet`, `EvidenceSheet`) and `<header>` over bright chart canvases can reduce text contrast below 4.5:1 if background alpha is too low.
  2. `RangeGauge` defaults to `w-28 sm:w-32` plus an inline `usual 54–58 bpm` label (`RangeGauge.tsx:50, 81`), which can be tight inside a 3-column bento grid at `1024px` (`lg:grid-cols-3`).
- **Fix:** Keep `.midori-glass` background alpha at `>= 0.82` (`rgb(18 22 20 / 0.85)`), and in `VitalTile` either pass a flexible track width (`className="w-24 sm:w-28"`) or render the usual range caption cleanly below the gauge track so `assertNoHorizontalOverflow` passes across `390px`, `768px`, and `1440px`.
