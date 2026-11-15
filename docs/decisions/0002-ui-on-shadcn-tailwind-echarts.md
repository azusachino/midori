# 0002 — UI on shadcn/ui, Tailwind v4 and ECharts

Status: accepted by owner 2026-11-15 (shadcn/ui + Tailwind; ECharts over uPlot)

## Context

The v0 stack named only Vite, React and uPlot, plus dark-first tokens. No component or styling
choice was ever made. The design's "ask first for new runtime dependencies" rule pushed the UI
toward hand-written CSS, hand-rolled routing and hand-built chart chrome. The v0 review found
the resulting defects on real data: the chart legend drawn over the plot, a blank band on the
Import page, a missing date axis and an unsorted events table.

uPlot's advantage is speed and size. midori's series are small (about 3,000 days times a few
epochs per metric), so that advantage does not matter here. What does matter is everything
uPlot leaves out: legend, tooltip, zoom, bands and markers.

## Decision

- **shadcn/ui on Tailwind v4.** The components (table, select, tabs, tooltip, dialog, card,
  badge) are copied into `web/src/components/ui/` and owned like any other source.
  Tailwind's theme variables replace `tokens.css`, and the UI stays dark-first.
- **ECharts** replaces uPlot, imported per module so tree-shaking works. Epoch shading uses
  `markArea`, seams use `markLine`, baseline bands use stacked area series, and `dataZoom`
  handles the 90-day / 180-day / 1-year / all range picker. The long view uses the calendar
  heatmap. ECharts is also iroha's chart library.
- **Routing:** a small router (TanStack Router or React Router) replaces the hand-rolled one,
  so that URLs carry metric, range and epoch state. The library is chosen in the UI task.

## Consequences

- New runtime dependencies: `tailwindcss`, `@tailwindcss/vite`, `echarts`, Radix primitives
  through shadcn, and one router. Approved here.
- Bundle grows by roughly 150–250 KB gzipped. This is acceptable for a tailnet-only admin tool.
- The UI is rebuilt page by page. The v0 page CSS and the uPlot wrapper are deleted, not
  ported.
- Every UI slice is checked against real data with Playwright screenshots that someone actually
  looks at. The v0 checkpoint skipped that step.
