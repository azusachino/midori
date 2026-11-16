# midori v1 — UI design

Status: proposed 2026-11-15, rev 2 after the
[Fable review](reviews/2026-11-15-v1-design-review-fable.md). Behavior and all thresholds live
in [journeys.md](journeys.md) (`B-` ids are referenced here); the stack is in
[0002](decisions/0002-ui-on-shadcn-tailwind-echarts.md). Wireframes are ASCII; every value,
date and device label in them is an invented placeholder.

## 1. Principles

1. **The answer first, evidence one click away.** Every screen opens with a sentence-level
   answer, and charts and tables support it. The order is Changes → Metric → night evidence.
2. **Lead with what moved; keep the full set one click away.** "Nothing stands out" is a
   result and gets the headline. Rows that stand out and the ones closest to the edge stay
   visible; the rest of the ranked overnight set sits behind "show all" (B-F7, B-F12).
3. **Uncertainty is visible, never alarming.** Confidence, trust, warming-up, partial and
   "can't be separated" each have a fixed treatment. Severity uses amber and rose tints, never
   full-red blocks.
4. **Devices have colors, metrics don't.** Non-minor epochs get stable colors app-wide, so a
   seam reads the same on every chart.
5. **Neutral language** (B-F9), and every hover-only hint also exists as visible text or a
   focusable control.

## 2. Information architecture

| Route | Page | Purpose | Journeys |
| --- | --- | --- | --- |
| `/` | Changes | What moved, since when, how sure | J1, J3 |
| `/metrics` | Metrics | One card per metric, 1 year | J5 |
| `/metrics/:key?range=90d\|180d\|1y\|all&night=YYYY-MM-DD&tab=chart\|long` | Metric detail | Chart, checks, recent units, evidence, long view | J1, J5 |
| `/devices` | Devices | Epochs, primaries, seams, OS updates | J3 |
| `/import` | Import | Upload, job, summary, history | J2 |

View state lives in the URL. Metric detail defaults to `180d`; links from Changes set `90d`.

## 3. Shell

```text
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ● midori                                 Data through Nov 7 · imported 8 days ago │  top bar (B-R1)
├────────────┬─────────────────────────────────────────────────────────────────────┤
│ Changes    │                                                                     │
│ Metrics    │   page content, max-width 1200, 24 px gutters                       │
│ Devices    │                                                                     │
│ Import     │                                                                     │
│            │                                                                     │
│ ── watch ──│                                                                     │
│ ● Watch B  │   current primary watch; "learning 9/14" while warming up           │
└────────────┴─────────────────────────────────────────────────────────────────────┘
```

Below 768 px the sidebar becomes a top tab bar and the freshness text moves to its own line.
The phone layout is a supported path for Import and Changes (J2 starts on the phone).

## 4. Changes (`/`)

```text
Changes                                                        as of Nov 7 (Fri)
┌ banner, only when >30 days since import (B-R2) ───────────────────────────────┐
│ ⚠ Your last import was 34 days ago. Findings describe Oct 28–Nov 7. [Import]  │
└───────────────────────────────────────────────────────────────────────────────┘
┌ notice, only while an overnight metric is warming up (J3) ────────────────────┐
│ ◐ Learning your new watch — wrist temp: 9 of 14 usable nights. First reading  │
│   around Nov 12. Other overnight metrics are ready.                [Devices]  │
└───────────────────────────────────────────────────────────────────────────────┘

2 overnight metrics stand out in your last 7 nights.            (answer, B-F12)
Inside this window: a watch change and an OS update. Small shifts may come
from these rather than from you.                                (B-F13)

Stands out                                        ranked by distance from usual
┌───────────────────────────────────────────────────────────────────────────────┐
│▌HRV (SDNN)   lower than usual   42 vs 55 ms  5/7 nights  since Oct 31  ◆ med  ⚑1 ~~▁│
│▌Sleeping HR  higher than usual  58 vs 54 bpm 4/7 nights  since Nov 2   ◆ high    ~~▔│
└───────────────────────────────────────────────────────────────────────────────┘
Close to the edge
│ Sleep        slightly lower than usual  6.6 vs 7.1 h 3/7 nights        ◆ high    ~~~│
These become findings only if the shift holds through a full new week of nights.
Import again around Nov 14.                                      (B-F14)
▸ Show all 10 overnight metrics            (within usual, learning, not enough data)
Daytime — only rows that are notable or alert
│ Steps        higher than usual  9.1k vs 6.0k 6/7 days    since Oct 30  ◆ high    ~~▔│

┌ Last complete night — Thu Nov 6 ──────────────────────────────────────────────┐
│ asleep 7.2 h · deep 0.9 · REM 1.5 · core 4.8      [stage bar ▇▇▅▅▇▅▅▇]        │
│ Nov 7 skipped: export taken before noon.                            (B-R3)    │
└───────────────────────────────────────────────────────────────────────────────┘
```

`FindingRow` anatomy (one component, reused in the Metric header and the Metrics cards):

| Slot | Content | Rule |
| --- | --- | --- |
| Left bar | 3 px tint: none / amber (`notable`) / rose (`alert`) | Never the only signal; the direction words carry it too |
| Name | Metric label + trust icon (focusable, popover with the trust note) | `low` trust shows a visible "low trust" badge |
| Direction | "higher / lower / within usual" | B-F9 |
| Values | recent median vs baseline median + unit | Tabular numerals |
| Frequency | "k/7 nights" | B-F8 |
| Onset | "since Oct 31" or "at least since Oct 10" | B-F11; notable/alert only |
| Confidence | ◆ high / ◇ medium / ○ low with the word | B-F6 |
| Checks | ⚑n when n checks are flagged; hidden when 0 | B-C1–B-C6; the count is visible, not hover-only |
| Sparkline | 35 units, band shaded, recent 7 emphasized, ≥10σ clipped with a marker | B-F4 cap |

Clicking a row opens `/metrics/:key?range=90d`. On narrow screens the row wraps to two lines:
name and direction first, then numbers and chips.

States:

| State | Shows |
| --- | --- |
| No imports (B-R4) | Centered empty state with three export steps and a button to Import |
| Importing | Normal page plus a top-bar pill "Import running · parsing 62%" linking to Import (B-I6) |
| All within | Answer card "Nothing stands out in your last 7 nights" with "10 overnight metrics within usual"; up to 3 "close to the edge" rows; the rest behind "show all 10" (B-F12) |
| Stale (B-F2) | Affected rows read "no recent nights"; the banner from B-R2 appears if the import is old |
| Loading | Row skeletons, never a spinner over a blank page |
| Read error | Inline `Alert`: "Couldn't load changes. [Retry]"; the shell and top bar stay usable |

## 5. Metric detail (`/metrics/:key`)

```text
← Changes   HRV (SDNN) · ms · moderate trust ⓘ                   [Chart | Long view]
┌ FindingRow ───────────────────────────────────────────────────────────────────┐
│▌lower than usual   42 vs 55 ms   5/7 nights   since Oct 31   ◆ medium   ⚑1    │
└───────────────────────────────────────────────────────────────────────────────┘
 [90d] 180d  1y  All                                         measured by ● Watch B
┌───────────────────────────────────────────────────────────────────────────────┐
│ 70 ┤               ░░░░░░░░░░░░░░ band (baseline ±1.5σ, current stint)       │
│ 55 ┤ ●─●─●─●  ┊ ●─●─●─●─●─●─●─●─●─●─●─●  ▒▒▒▒▒▒▒ recent 7                    │
│ 40 ┤       ●  ┊                          ○ ●─●─●─●─●                           │
│    ┤ Watch A  ┊ New watch: step −6 ms — device or you, can't be separated     │
│    └──────────┴────────────────────────────────────────────── Aug   Sep   Oct  │
│    [=================== dataZoom slider ===============================]       │
└───────────────────────────────────────────────────────────────────────────────┘
┌ Checks ─────────────────────────────┐  ┌ Recent nights ───────────────────────┐
│ ✓ No device change in last 35 days  │  │ Date    Value  vs usual  Device  Note│
│ ✓ No OS update in last 35 days      │  │ Nov 6   41     −1.2σ     Watch B     │
│ ⚑ 1 partial night skipped (Nov 7)   │  │ Nov 5   39     −1.4σ     Watch B     │
│ ✓ No timezone change                │  │ Nov 4   47     −0.6σ     Watch B  tz │
│ ✓ No missing nights                 │  │ … 7 rows, then "baseline: 21 nights, │
│ ✓ Trust: moderate                   │  │  median 55, Oct 10–Oct 30 (early)"   │
└─────────────────────────────────────┘  └──────────────────────────────────────┘
```

Clicking a point or a table row selects a night (`?night=`) and opens the **evidence sheet**
(shadcn `Sheet`; full-screen on phones):

```text
┌ Night of Wed Nov 5 · HRV (SDNN) ──────────────────────── ✕ ┐
│ Value 39 ms (median of 6 samples, 21:00–09:00 JST)        │
│ Device Watch B (WatchN,n · OS x.y) · usable               │
│ Samples  23:14 44 · 00:52 37 · 02:10 39 · 03:41 35 · …    │
│ Sleep    23:02–06:48 · asleep 7.1 h  [stage bar]          │
│ Also recorded: Phone (minor for this metric)              │
│ [Copy link]                                               │
└───────────────────────────────────────────────────────────┘
```

Chart spec (ECharts):

| Element | Encoding |
| --- | --- |
| Series | One line per non-minor epoch in the epoch color, 1.5 px, `connectNulls: false` |
| Minor epochs | Scatter, 40% opacity, neutral gray (no palette slot) |
| Partial / unusable units | Hollow symbol; excluded from the band math |
| Band | `custom` series drawing a polygon between low and high over the baseline ranks of the current stint (works with negative values, e.g. wrist temp) |
| Recent window | `markArea`, label "last 7" |
| Seams | `markLine`, dashed vertical, label with the offset (B-D6) or the step plus "can't be separated" (B-D7) |
| OS updates | Small `markPoint` on the x-axis, tooltip with the version change |
| Tooltip | Date, value + unit, device, usable/partial + reason, sample count, zone |
| Axis | Time x-axis with month ticks; y-axis not forced to zero; unit in the axis name |
| Range | Segmented control sets `dataZoom` start/end; the slider fine-tunes; the URL updates |
| Legend | Above the plot, outside it, devices only |

Each chart has a one-line text summary and a visually hidden table of the plotted points.

**Long view tab**: a calendar per year (ECharts `calendar` + a `custom` series, so partial
cells can be hatched and seams marked on the calendar edge). Cells use a diverging color scale
for deviation from that stint's median.

States:

| State | Shows |
| --- | --- |
| Unknown metric key | Not-found panel listing the known metrics |
| No data in range | Chart frame with "No nights in this range" and a button to widen the range |
| Warming up / insufficient | The FindingRow shows the state; the chart still renders, with no band |
| Trend-only (`vo2max`) | No FindingRow, no Checks; chart + "Trend only — no baseline comparison" |
| Night without evidence | Sheet says "No samples stored for this night" |
| Loading / read error | Skeleton chart; inline `Alert` with Retry |

## 6. Metrics index (`/metrics`)

A grid of cards: 3 columns on desktop, 1 on phone. Overnight metrics first, then daytime, then
trend-only. Each card shows the name, trust, a compact FindingRow line and a 1-year weekly
mini chart with epoch colors and seams (data from `GET /api/metrics`). Clicking a card opens
Metric detail at 180 days.

States: no imports → the B-R4 empty state; a metric with no data → its card says "No data yet"
and stays in place; loading → card skeletons; error → `Alert` with Retry.

## 7. Devices (`/devices`)

```text
Devices
┌ Timeline (days present) ──────────────────────────────────────────────────────┐
│ watch  ▕ Watch A0 ▏▕──────── Watch A ─────────────────▏▕ Watch B ▏              │
│ phone  ▕──────────────────────────── Phone ──────────────────────────────▏     │
│ apps   · · Clock app                · Run app            · Tablet (minor)       │
│        2017 … 2023        2024         2025          2026                      │
└───────────────────────────────────────────────────────────────────────────────┘
┌ Watch B · WatchN,n · since Oct 10 · 28 nights ────────── primary for 10 metrics ┐
│ Metric      Baseline                Across the change from Watch A            │
│ HRV (SDNN)  full · medium conf.     step −6 ms — device or you, can't separate│
│ Wrist temp  learning 9/14           step +0.3 °C — can't separate             │
│ Steps       full                    offset +410/day (n=12 shared days)        │
│ OS updates  x.1 → x.2 on Oct 28                                               │
└───────────────────────────────────────────────────────────────────────────────┘
(one card per epoch, newest first; minor epochs collapsed under "Occasional sources")
```

The timeline is an ECharts `custom` series built from days present: a sparse app shows as dots,
not a bar (B-D3).

States: a single epoch → the timeline plus one card, with no seam section; no imports → the
B-R4 empty state; loading → skeleton; error → `Alert` with Retry.

## 8. Import (`/import`)

```text
Import
┌ drop zone (idle) ─────────────────────────────────────────────────────────────┐
│            Drop export.zip here, or [Choose file]                             │
│   On iPhone: Health → profile → Export All Health Data → Save to Files,       │
│   then come back here and tap Choose file.                                    │
└───────────────────────────────────────────────────────────────────────────────┘
┌ uploading (XHR progress, B-I11) ──────────────────────────────────────────────┐
│ Uploading export.zip  41 / 66 MB  [██████████░░░░░░]                          │
│ Keep this tab open until the upload finishes.                                 │
└───────────────────────────────────────────────────────────────────────────────┘
┌ running job (after upload) ───────────────────────────────────────────────────┐
│ ● Uploaded  ● Unpacked  ◉ Parsing  ○ Storing  ○ Deriving   62% · 0:41         │
│ [██████████████████████░░░░░░░░░░░░]   You can close this tab now.            │
└───────────────────────────────────────────────────────────────────────────────┘
┌ summary (after done) ─────────────────────────────────────────────────────────┐
│ 12,345 new records · 1,998,001 already known · 27 new usable nights           │
│ Data through Nov 7 · New watch: Watch B (WatchN,n)                            │
│ Top changes now: HRV lower than usual, sleeping HR higher.  [See what changed →]│
└───────────────────────────────────────────────────────────────────────────────┘
History  (When · Export date · New · Known · Nights added · Duration · Status)
```

States and errors (one line each: what happened, what to do):

| State | Copy / behavior |
| --- | --- |
| Not a Health export (B-I1) | "This isn't a Health export (export.xml not found)." Drop zone stays |
| Import already running (B-I2) | Shows the running job; the drop zone is disabled with "One import at a time" |
| Older export (B-I4) | Summary carries the warning line |
| Nothing new (B-I3) | Summary: "Nothing new: 0 new records." |
| Upload interrupted (B-I11) | "Upload interrupted — choose the file again." |
| Job failed (B-I5) | Card shows stage + reason + [Retry] while the spool exists (24 h); after that, "Upload the file again" |
| Interrupted by restart (B-I10) | Same as failed, with reason "interrupted by restart" |
| History empty | "No imports yet" plus the export steps |

## 9. Visual system

- **Theme**: dark-first on shadcn's zinc neutrals via Tailwind v4 `@theme` variables, with no
  theme switcher. Surfaces are background, card and muted; 1 px borders instead of shadows.
- **Accent**: one green (midori = green), for focus, links and the primary button only.
- **Semantic tints**: `notable` amber, `alert` rose, `learning` sky, `partial` neutral hatch.
  Contrast must reach ≥3:1 for non-text and ≥4.5:1 for text on card. This is verified with the
  colors/dataviz validators in the foundation slice.
- **Epoch palette**: 6 categorical colors, assigned to **non-minor** epochs by start order and
  stable across pages. Minor epochs are neutral gray. The palette is distinct from the semantic
  tints and checked for colorblindness. If there are more than 6 non-minor epochs, the oldest
  reuse colors with a dashed stroke.
- **Type**: system UI stack with `Hiragino Sans` / `Noto Sans JP` fallbacks for Japanese
  source names. Tabular numerals for values. Scale: 12/14/16/20/24.
- **Density**: 40 px table rows, an 8 px spacing grid, 16 px card padding.
- **Motion**: 150 ms fades on the sheet and popovers only. Chart animation is off;
  `prefers-reduced-motion` is respected.

## 10. Components (shadcn mapping)

| Need | Component |
| --- | --- |
| Shell nav | `Sidebar` (top `Tabs` under 768 px) |
| Rows, cards | `Card`, custom `FindingRow` |
| Range, tabs | `ToggleGroup`, `Tabs` |
| Tables | `Table` |
| Evidence | `Sheet` |
| Chips, hints | `Badge`, `Popover` (focusable; not hover-only `Tooltip` for content) |
| Import | custom drop zone with a real `<input type=file>`, `Progress`, `Alert` |
| Loading | `Skeleton` |
| Charts | one `EChart` wrapper (init/resize/dispose, theme from CSS variables) + `Sparkline`, `MetricChart`, `CalendarHeat`, `EpochTimeline` |

## 11. Accessibility

- Keyboard reaches every row, range control, chart point list (through the hidden table) and
  sheet; Esc closes the sheet.
- Each chart has a text summary plus the hidden data table.
- Severity, confidence and checks pair color with words or shapes.
- Focus rings use the accent.
- The bar is WCAG 2.2 AA.

## 12. Verification of the design

- Playwright on the synthetic fixture covers every route and every state listed in §4–§8, at
  1440 px and 390 px. The phone import test uses the file input, not drag-and-drop.
- Each page gets a real-data screenshot pass, inspected by a person or a reviewing agent.
  Findings are written up without health values; screenshots stay in `.tmp/` and are never
  committed.
