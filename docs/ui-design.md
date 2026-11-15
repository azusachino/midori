# midori v1 — UI design

Status: proposed 2026-11-15. Behavior lives in [journeys.md](journeys.md) (`B-` ids are
referenced here); the stack is in [0002](decisions/0002-ui-on-shadcn-tailwind-echarts.md).
Wireframes are ASCII. Values in them are invented placeholders, not real data.

## 1. Principles

1. **The answer first, evidence one click away.** Every screen opens with a sentence-level
   answer; charts and tables support it. This follows the progressive order: Changes → Metric →
   night evidence.
2. **Always show the full overnight set.** Ranking, not filtering. "Nothing stands out" is a
   result too, and the rows stay visible (B-F7).
3. **Uncertainty is visible, never alarming.** Confidence, trust, warming-up and partial states
   each get a fixed visual treatment. Severity uses amber and rose tints, never full-red
   blocks.
4. **Devices have colors, metrics don't.** Epoch colors are stable app-wide, so a seam reads the
   same on every chart. Metrics are told apart by label and position.
5. **Neutral language** (B-F9): "higher/lower than usual", "5 of the last 7 nights".

## 2. Information architecture

| Route | Page | Purpose | Journeys |
| --- | --- | --- | --- |
| `/` | Changes | What moved, how sure | J1, J3 |
| `/metrics` | Metrics | One small chart per metric, 1 year | J5 |
| `/metrics/:key?range=90d\|180d\|1y\|all&night=YYYY-MM-DD&tab=chart\|long` | Metric detail | Chart, checks, contributing nights, evidence | J1, J5 |
| `/devices` | Devices | Epochs, primaries, seams, offsets | J3 |
| `/import` | Import | Upload, job, summary, history | J2 |

All view state lives in the URL, so links can be shared between your own devices and pasted to
agents.

## 3. Shell

```text
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ● midori                       Data through Nov 7 · imported 8 days ago   [⌘K]  │  top bar (B-R1)
├────────────┬─────────────────────────────────────────────────────────────────────┤
│ Changes    │                                                                     │
│ Metrics    │   page content, max-width 1200, 24px gutters                        │
│ Devices    │                                                                     │
│ Import     │                                                                     │
│            │                                                                     │
│ ── watch ──│                                                                     │
│ ● Ultra    │   current primary watch + "learning 9/14" when warming up           │
└────────────┴─────────────────────────────────────────────────────────────────────┘
```

- ⌘K opens a command palette (shadcn `Command`) to jump to a metric or page.
- Below 768 px the sidebar becomes a top tab bar and the freshness text drops to its own line.
  The phone layout covers upload and reading Changes (J2 starts on the phone).

## 4. Changes (`/`)

```text
Changes                                                        as of Nov 7 (Fri)
┌ banner, only when >30 days since import (B-R2) ───────────────────────────────┐
│ ⚠ Your last import was 34 days ago. Findings describe Oct 10–Nov 7. [Import]  │
└───────────────────────────────────────────────────────────────────────────────┘
┌ notice, only when an epoch is warming up ─────────────────────────────────────┐
│ ◐ Learning your new watch (Ultra, Watch7,5) — baselines from Oct 24,          │
│   full from Nov 14.                                                [Devices]  │
└───────────────────────────────────────────────────────────────────────────────┘

Overnight                                         ranked by distance from usual
┌───────────────────────────────────────────────────────────────────────────────┐
│▌HRV (SDNN)    lower than usual   42 ms vs 55   5 of 7 nights  ◆ medium  ~~~▁▁ │ ← notable tint
│▌Resting HR    higher than usual  61 vs 57 bpm  4 of 7 nights  ◆ high    ~~~▔▔ │
│ Sleep         within usual       6.9 vs 7.1 h  1 of 7 nights  ◆ high    ~~~~~ │
│ Resp. rate    within usual       …                                            │
│ Wrist temp    learning · 9 of 14 nights  ▓▓▓▓▓▓░░░                            │ ← warming_up
│ SpO₂          not enough nights · 3 of 4 recent                               │ ← insufficient
└───────────────────────────────────────────────────────────────────────────────┘
Daytime — only rows that are notable or alert
│ Steps         higher than usual  9.1k vs 6.0k  6 of 7 days   ◆ high    ~~~▔▔  │

┌ Last complete night — Thu Nov 6 ──────────────────────────────────────────────┐
│ asleep 7.2 h · deep 0.9 · REM 1.5 · core 4.8      [stage bar ▇▇▅▅▇▅▅▇]        │
│ Nov 7 skipped: partial night (export taken 06:12).                  (B-R3)    │
└───────────────────────────────────────────────────────────────────────────────┘
```

Row anatomy (one `FindingRow` component, reused in the Metric header and the Metrics index):

| Slot | Content | Rule |
| --- | --- | --- |
| Left bar | 3 px tint: none / amber (`notable`) / rose (`alert`) | Color is never the only signal; the direction words carry it too |
| Name | Metric label + trust icon (tooltip = trust note) | `low` trust gets a visible "low trust" badge |
| Direction | "higher / lower / within usual" | B-F9 |
| Values | recent median vs baseline median, unit | Tabular numerals, unit once |
| Frequency | "k of last 7" | B-F8 |
| Confidence | ◆ high / ◇ medium / ○ low | B-F6 |
| Sparkline | 35 units, band shaded, recent 7 emphasized | ECharts mini, no axes |

Clicking a row goes to `/metrics/:key?range=90d`. Hover shows the checks summary (e.g. "1
check flagged: partial nights").

States:

| State | Shows |
| --- | --- |
| No imports (B-R4) | Centered empty state: three export steps with a phone illustration, button to Import |
| Importing | Normal page plus a top-bar pill "Import running · parsing 62%" linking to Import (B-I6) |
| All within | Rows stay; header line "Nothing stands out across 9 overnight metrics." |
| Loading | Row skeletons (shadcn `Skeleton`), never spinners over a blank page |

## 5. Metric detail (`/metrics/:key`)

```text
← Changes   HRV (SDNN) · ms · moderate trust ⓘ                   [Chart | Long view]
┌ FindingRow (same component as Changes) ───────────────────────────────────────┐
│▌lower than usual   42 vs 55 ms   5 of 7 nights   ◆ medium                     │
└───────────────────────────────────────────────────────────────────────────────┘
 [90d] 180d  1y  All                                           measured by ● Ultra
┌───────────────────────────────────────────────────────────────────────────────┐
│ 70 ┤          ░░░░░░░░░░░░░░░░░ band (baseline ±1.5σ, current epoch)          │
│ 55 ┤ ●─●─●─●  ┊ ●─●─●─●─●─●─●─●─●─●─●─●  ▒▒▒▒▒▒▒ recent 7                    │
│ 40 ┤       ●  ┊                          ○ ●─●─●─●─●                           │
│    ┤  iWatch  ┊ New watch                ○ = partial night                     │
│    └──────────┴────────────────────────────────────────────── Aug   Sep   Oct  │
│    [=================== dataZoom slider ===============================]       │
└───────────────────────────────────────────────────────────────────────────────┘
┌ Checks ───────────────────────────┐  ┌ Recent nights ─────────────────────────┐
│ ✓ No device change in window      │  │ Date     Value  vs usual  Device  Note │
│ ⚑ 1 partial night skipped (Nov 7) │  │ Nov 6    41     −1.2σ     Ultra        │
│ ✓ No timezone change              │  │ Nov 5    39     −1.4σ     Ultra        │
│ ✓ No missing nights               │  │ Nov 4    47     −0.6σ     Ultra   tz   │
│ ✓ Trust: moderate                 │  │ …        (7 rows, then "baseline:      │
└───────────────────────────────────┘  │  28 nights, median 55, Sep 26–Oct 30") │
                                       └────────────────────────────────────────┘
```

Clicking a point or a table row selects a night (`?night=`) and opens the **evidence sheet**
(shadcn `Sheet`, right side):

```text
┌ Night of Wed Nov 5 · HRV (SDNN) ──────────────────────── ✕ ┐
│ Value 39 ms (median of 6 samples, 21:00–09:00)            │
│ Device Ultra (Watch7,5) · complete                        │
│ Samples  23:14 44 · 00:52 37 · 02:10 39 · 03:41 35 · …    │
│ Sleep    23:02–06:48 · asleep 7.1 h  [stage bar]          │
│ Also recorded: iPhone (minor, 0 samples this night)       │
│ [Copy link]                                               │
└───────────────────────────────────────────────────────────┘
```

Chart spec (ECharts):

| Element | Encoding |
| --- | --- |
| Series | One line per non-minor epoch in the epoch color, 1.5 px, `connectNulls: false` |
| Minor epochs | Scatter, 40% opacity, no line |
| Partial units | Hollow symbol, excluded from the band math |
| Band | Stacked area (low, high−low) over the baseline window, current epoch only, 15% fill |
| Recent window | `markArea`, subtle highlight, label "last 7" |
| Seams | `markLine` dashed vertical, label "New watch", tooltip with the offset or "offset unknown" |
| Tooltip | Date, value + unit, device, complete/partial, sample count |
| Axis | Time x-axis with month ticks; y-axis without forced zero; unit on the axis name |
| Range | Segmented control sets `dataZoom` start/end; the slider allows fine adjustment; URL updates |
| Legend | Outside the plot, above it, devices only |

A visually hidden table of the plotted points is kept for screen readers.

**Long view tab**: one calendar heatmap per year (ECharts `calendar`). Cells are colored by
deviation from that epoch's yearly median on a diverging scale, partial units are hatched, and
seams are marked on the calendar edge. A monthly-median line chart across all years sits below
it, split by epoch.

## 6. Metrics index (`/metrics`)

A grid of cards, 3 columns on desktop and 1 on phone. Each card holds the metric name, trust,
its current state as a compact `FindingRow` line, and a 1-year mini chart with epoch colors and
seams. Overnight metrics come first, then daytime. Clicking a card opens Metric detail.

## 7. Devices (`/devices`)

```text
Devices
┌ Timeline ─────────────────────────────────────────────────────────────────────┐
│ watch  ▕ Apple Watch (old name) ▏▕──── iWatch ────────────────▏▕ Ultra ▏       │
│ phone  ▕──────────────────────────── iPhone ──────────────────────────────▏    │
│ apps   · · Clock(2017–20)          · Nike Run Club       · iPad (minor)        │
│        2017 … 2023        2024         2025          2026                      │
└───────────────────────────────────────────────────────────────────────────────┘
┌ Ultra · Watch7,5 · since Oct 10 · 28 nights ─────────── primary for 9 metrics ┐
│ Metric      Baseline        Offset vs iWatch                                  │
│ HRV (SDNN)  ready · low conf offset unknown (0 shared nights)                 │
│ Wrist temp  learning 9/14   offset unknown                                    │
│ Steps       ready           +410/day (n=12 shared days)                       │
└───────────────────────────────────────────────────────────────────────────────┘
(one card per epoch, newest first; minor epochs collapsed under "Occasional sources")
```

The timeline is an ECharts `custom` series showing spans built from days present, so a sparse
app appears as dots and not as a bar (B-D3).

## 8. Import (`/import`)

```text
Import
┌ drop zone (idle) ─────────────────────────────────────────────────────────────┐
│            Drop export.zip here, or choose a file                             │
│   On iPhone: Health → profile → Export All Health Data → Share → Safari       │
└───────────────────────────────────────────────────────────────────────────────┘
┌ running job (replaces the drop zone) ─────────────────────────────────────────┐
│ ● Uploaded  ● Unpacked  ◉ Parsing  ○ Storing  ○ Deriving   62% · 0:41         │
│ [██████████████████████░░░░░░░░░░░░]   You can close this tab.                │
└───────────────────────────────────────────────────────────────────────────────┘
┌ summary (after done) ─────────────────────────────────────────────────────────┐
│ 12,345 new records · 1,998,001 already known · 27 new complete nights         │
│ Data through Nov 7 · New watch: Ultra (Watch7,5)                              │
│ New findings: HRV lower than usual. Resolved: Sleep.  [See what changed →]    │
└───────────────────────────────────────────────────────────────────────────────┘
History  (table: When · Export date · New · Known · Nights added · Duration · Status)
         failed rows expand to show the stage and reason, plus [Retry] while the spool exists (B-I5)
```

Error copy follows B-I1/B-I2/B-I4/B-I5, one line each, saying what happened and what to do.

## 9. Visual system

- **Theme**: dark-first on shadcn's zinc neutrals with Tailwind v4 `@theme` variables, no theme
  switcher. Surfaces: background, card, muted; 1 px borders over shadows.
- **Accent**: one green (`midori` = green) for focus, links and the primary button only.
- **Semantic tints**: `notable` amber, `alert` rose, `learning` sky, `partial` neutral hatch.
  All meet ≥3:1 non-text and ≥4.5:1 text contrast on card; checked with the dataviz/colors
  validators during the UI foundation task.
- **Epoch palette**: 6 categorical colors, assigned by epoch start order and stable across
  pages. Distinct from the semantic tints and colorblind-checked.
- **Type**: system UI stack with `Hiragino Sans` / `Noto Sans JP` fallbacks for Japanese source
  names. Tabular numerals for all values. Scale 12/14/16/20/24.
- **Density**: comfortable for tables (40 px rows), 8 px spacing grid, cards with 16 px padding.
- **Motion**: 150 ms fades on sheet/tooltip only; chart animations off; respects
  `prefers-reduced-motion`.

## 10. Components (shadcn mapping)

| Need | Component |
| --- | --- |
| Shell nav, palette | `Sidebar`, `Command` |
| Rows, cards | `Card`, custom `FindingRow` |
| Range, tabs | `ToggleGroup`, `Tabs` |
| Tables | `Table` (+ TanStack Table only if sorting is needed) |
| Evidence | `Sheet` |
| Chips | `Badge`, `Tooltip` |
| Import | custom drop zone, `Progress`, `Alert` |
| Loading | `Skeleton` |
| Charts | one `EChart` wrapper (init/resize/dispose, theme from CSS variables) + `Sparkline`, `MetricChart`, `CalendarHeat`, `EpochTimeline` |

## 11. Accessibility

Keyboard: every row, chart point list, range control and sheet is reachable, and Esc closes the
sheet. Each chart has a text summary ("HRV lower than usual on 5 of the last 7 nights") plus a
hidden data table. Severity and confidence always pair color with words or shapes. Focus rings
use the accent. WCAG 2.2 AA is the bar.

## 12. Verification of the design

- Playwright on the synthetic fixture: every route, every state in §4 (empty, importing, all
  within, warming up, insufficient), at 1440 px and 390 px.
- Real-data screenshot pass per page, inspected by a person or a reviewing agent. Findings are
  written up without health values; screenshots stay in `.tmp/` (never committed).
