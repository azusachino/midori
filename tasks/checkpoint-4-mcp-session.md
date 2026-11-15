# Checkpoint 4 — MCP-only session evidence

**Date:** 2026-11-15 · **Plan gate:** "a pi session answers 'what changed recently and why' using only MCP tools; tool-call transcript preserved as evidence."

**Setup:** fresh pi session (claude-haiku-5-5 via magpie), cwd `vendor/midori`, project MCP server `.pi/mcp.json` → `bun src/cli.ts mcp --db data/midori.db` (stdio, read-only, 6 tools). The session was instructed to use only `mcp__midori__*` tools, print its tool calls, and ground every number in tool output. Raw terminal capture: herdr `t83`, saved locally at `.tmp/midori/ckpt4-raw.txt` (workstation scratch, not committed).

## Tool calls made

| Tool | Arguments | Purpose |
| --- | --- | --- |
| briefing | none | Anchor, as-of, finding ledger, staleness |
| deviations | days = 14 | Ranked deviations + suppressed rows |
| findings | none | Recalibration/coverage ledger |
| list_sources | none | Device history |
| list_imports | none | Import status |
| metric_daily | rhr, hrv_sdnn, hrv_rmssd, sleep_h, wrist_temp, resp_rate, heart_rate | Per-source series |

## Session's answer (condensed, numbers from tool output)

- **Device switch:** `list_sources` shows ハルのWatchUltra first seen 2026-10-08 and ハルのiWatch last seen 2026-10-10; `findings` carries 2026-10-09/10 recalibration entries for almost every metric ("took over from ハルのiWatch; cross-device offsets reset").
- **Baselines suppressed:** in `deviations` (14d), WatchUltra rows show `baseline: null, z: null` suppressed `cross_source` (hrv_rmssd `insufficient_data`, vo2max `coverage_gap`); no deviation is reported for any readiness input.
- **Recent Ultra values:** RHR 70.5 bpm (daily 68–80, last 68); HRV SDNN 57.65 ms (dipped to 36 on 11-04, recovered to 61 by 11-07); HRV RMSSD 46.4 ms (same dip/recovery); sleep 6.6 h avg (11-07 = 1.2 h partial night); resp rate ~15/min flat; wrist temp 36.3 °C trend-only; steps 7,227/day.
- **Data freshness:** latest import (id 3, 2026-11-15) inserted 0 records, deduped all 2,047,778 → last data day is 2026-11-07.
- **Conclusion (session's words):** "Most likely the device switch and offset reset, not a health change… Recheck once the Ultra has a baseline (about 90 days from 2026-10-08)." It explicitly declined to claim clinical normality: "I cannot judge 'normal' against population or clinical norms from these tools."

## Verdict

**Pass.** The session reproduced the spike verdict (device-change artifact, metrics stable) using only the six MCP tools, respected suppression semantics, surfaced trust limits unprompted, and never invented a number. The read-only MCP surface (T20/T21) is sufficient for an agent to answer the product's founding question.
