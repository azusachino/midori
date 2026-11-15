# midori v1 — workflow, user journeys and expected behavior

Status: proposed 2026-11-15. Companion to [design.md](design.md) (what and why) and
[ui-design.md](ui-design.md) (how it looks). This file is the behavioral contract: each `B-`
rule becomes at least one test or e2e check in [tasks/plan.md](../tasks/plan.md). Wording in
quotes is indicative copy, not final.

## 1. The end-to-end workflow

```text
iPhone Health ──Export All Health Data──▶ export.zip (~66 MB)
   │  (share sheet → Safari on tailnet, or AirDrop → Mac)
   ▼
Import page ──upload──▶ job: queued → unpacking → parsing → storing → deriving → done
                                                         │
                       derive (one transaction, atomic swap of derived tables):
                       epochs → nights → metric values → primary series → findings
                                                         │
             ┌──────────────────────────┬────────────────┴───────────┬───────────────────┐
             ▼                          ▼                            ▼                   ▼
          Changes                 Metric detail                  Devices          MCP (pi / luna)
   "what moved, how sure"   "show me the nights"        "which watch, when"   same reads, as JSON
```

Cadence: roughly monthly, or whenever something feels off. Each import is independent and
idempotent. The derived state always reflects **all** records stored so far, never just the
latest zip.

## 2. Vocabulary (shown to the user in plain words)

| Term | Meaning | UI wording |
| --- | --- | --- |
| Epoch | One device as identified by `(source name, hardware model)` | "device", or "watch" for watch epochs |
| Primary | The epoch whose values represent a metric for a given night or day | "measured by …" |
| Minor | An epoch recording on <20% of the trailing 28 days; never primary | "occasional source" |
| Unit | A night (overnight metrics) or a calendar day (daytime metrics) | "night" / "day" |
| Complete / partial | Whether a night is usable for baselines | "partial night" |
| Baseline | Units 35…8 back, current epoch, complete only (≥14) | "your usual range" |
| Recent | The last 7 complete units (≥4) | "last 7 nights" |
| Warming up | New primary epoch with fewer than 14 baseline units | "learning this watch, 9 of 14 nights" |
| As of | The last complete unit of the primary watch epoch | "Data through Nov 7" |

Overnight metrics: `sleep_h, deep_h, rem_h, hrv_sdnn, hrv_rmssd, rhr, resp_rate, wrist_temp,
spo2`. Daytime metrics: `steps, active_kj, vo2max, heart_rate`. Resting HR is a once-per-day
Apple value, but it is reported for the night that precedes it, so it lines up with the other
overnight metrics.

## 3. Journeys

### J1 — Investigate a feeling (primary)

> "My readiness has felt off for a week. Is anything actually different?"

1. Open midori → **Changes**. The header reads "Data through Nov 7 · imported 8 days ago".
2. The *Overnight* list shows **every** overnight metric, ranked by |z|. Rows outside the usual
   range are tinted. Each row says the direction in neutral words ("lower than usual") and how
   often it happened ("5 of the last 7 nights"), with a confidence chip and a 35-night
   sparkline.
3. Clicking the top row opens **Metric detail** for that metric with the range set to 90 days.
   The chart shows the band, the recent window and any seam.
4. The *Checks* panel lists confounders: device change in window, partial nights in recent,
   timezone changes, missing nights. Each is either "clear" or "flagged" with a link.
5. Clicking a night opens its evidence (sample times and values, sleep stages, source).
6. Outcome: you can state what moved, since when, how consistently and how confidently, and
   whether a device change or partial data could explain it. midori never states a cause.

### J2 — Monthly import

1. On the iPhone: Health → profile → Export All Health Data → share → Safari opens the midori
   Import page on the tailnet (or AirDrop to the Mac and drop it there).
2. Drop or choose the file. The stage stepper and a byte-progress bar run. The tab can be
   closed; the job keeps going.
3. **Summary card**: new records, new complete nights, "data through" date, new devices,
   findings that appeared or resolved since the previous import.
4. A "See what changed" button opens **Changes**.

### J3 — New watch

1. After an import containing a new hardware model, the summary says "New watch detected:
   Apple Watch Ultra (Watch7,5), first night Oct 10".
2. **Changes** shows one compact notice: "Learning your new watch — baselines from Oct 24, full
   from Nov 14". The affected rows show "learning, n of 14" instead of a z.
3. **Devices** shows the epoch timeline, which epoch is primary for each metric, and for each
   seam either the median offset on shared nights or "no shared nights, offset unknown".
4. Old-watch history stays visible on charts in its own color. It is never blended or rescaled.

### J4 — Ask an agent

1. pi or luna call `changes()` and get the same ranking as the Changes page, with as-of,
   confidence, baseline state, trust and a `caveats[]` list.
2. For follow-ups they call `metric_series` or `nights` and get per-unit values with epoch and
   completeness.
3. The tool descriptions instruct the agent to cite nights and to treat device changes and
   partial nights as confounders, never as causes.

### J5 — Long view

1. **Metrics** index: a small chart per metric over 1 year, with its current state.
2. Metric detail → *Long view* tab: a calendar heatmap per year and monthly medians across all
   years, split by epoch, with seams marked.

## 4. Expected behavior

### Import (B-I)

| ID | Given / when | Then |
| --- | --- | --- |
| B-I1 | A file that is not a zip, or a zip without `apple_health_export/export.xml` | Rejected before the job starts: "This isn't a Health export (export.xml not found)." Nothing is written |
| B-I2 | An upload while another import is running | 409; the page shows the running job instead of starting a second |
| B-I3 | The identical zip is uploaded again | Job done; "Nothing new: 0 new records". Derived state and findings are unchanged; history records the run |
| B-I4 | An export whose `ExportDate` is older than the newest data already stored | Accepted (dedup). Warning: "This export is older than data you already have; nothing is removed." |
| B-I5 | Failure at any stage | Record and derive transactions roll back; reads keep serving the previous state. The job shows `failed` with the stage and a one-line reason. The spooled zip is kept 24 h for retry |
| B-I6 | Reads during an import | Served from the previous derived state until an atomic swap at `done`. No half-derived reads |
| B-I7 | The browser tab closes mid-import | The job continues; reopening Import shows its live state |
| B-I8 | Import finishes | `imports` stores `export_date`, record counts, new complete nights, new epochs, and findings added/resolved compared with the previous derive |
| B-I9 | Any import | The real-export import finishes in under 2 min locally (v0 measured ~15–19 s for parse+store) |

### Devices and epochs (B-D)

| ID | Given / when | Then |
| --- | --- | --- |
| B-D1 | Records with the same source name but different `hardware:` values | Two epochs |
| B-D2 | A record without a `device` attribute (apps, manual entry) | Epoch `(source, "")`, kind `app` |
| B-D3 | An epoch recording on <20% of the trailing 28 days for a metric | Minor for that metric: drawn as faint dots, never primary, never a seam |
| B-D4 | Two non-minor epochs recording the same unit | The primary is the one with more samples; ties go to the newer epoch |
| B-D5 | The primary epoch for a metric changes | A seam on that metric at the first unit of the new epoch |
| B-D6 | A seam with ≥7 shared complete units | Median offset (new − old) shown with n. Values are never adjusted |
| B-D7 | A seam with <7 shared units | "Offset unknown (n shared nights)" |

### Nights and units (B-N)

| ID | Given / when | Then |
| --- | --- | --- |
| B-N1 | A sleep sample starts at or after 15:00 local | Belongs to that date's night |
| B-N2 | A sleep sample starts before 09:00 local | Belongs to the previous date's night |
| B-N3 | A sample between 09:00 and 15:00 (nap) | Excluded from nights in v1 |
| B-N4 | HRV, respiratory rate, wrist temperature or SpO2 samples | Assigned to nights by B-N1/B-N2; HRV also requires 21:00–09:00 |
| B-N5 | Sleep from multiple non-minor epochs in one night | Stages from the primary epoch only; no cross-source sum |
| B-N6 | A night whose window (until 12:00 the next day) ends after the export's `ExportDate` | `partial`, reason `export_cut` |
| B-N7 | A night with asleep time <50% of the epoch's trailing 28-night median | `partial`, reason `short` |
| B-N8 | A night without sleep records but with HRV etc. | Overnight metrics kept; complete when the metric's registry minimum is met (wrist temp 1, HRV/resp/SpO2 3), otherwise `partial`, reason `sparse` |
| B-N9 | Records whose UTC offset differs from the previous night | The night is tagged `tz_change` (used in Checks); local-time rules still apply |
| B-N10 | A daytime metric | Unit = local calendar day. A day is complete unless it is the export day |

### Baselines and findings (B-F)

| ID | Given / when | Then |
| --- | --- | --- |
| B-F1 | Any metric | Recent = last 7 complete units (≥4 required); baseline = complete units 35…8 back in the **current primary epoch** (≥14 required) |
| B-F2 | Both gates met | Robust z = (median recent − median baseline) / (1.4826·MAD); zero-MAD policy as in v0 |
| B-F3 | Baseline n <14 and the epoch is <35 units old | State `warming_up`, progress n/14, no z |
| B-F4 | Recent n <4 or baseline n <14 for other reasons | State `insufficient` with the reason ("3 of 4 recent nights") |
| B-F5 | |z| ≥1.5 / ≥2.5 | Severity `notable` / `alert`; below that, `within` |
| B-F6 | Confidence | `high`: baseline ≥24, recent ≥6, trust ≠ low. `medium`: gates met, baseline ≥14. `low`: trust low, or epoch <35 units old. The lowest applicable value wins |
| B-F7 | Ranking on Changes and in `changes()` | Computed rows by |z| desc, then confidence; then `warming_up`; then `insufficient`. Ties are broken by metric order in the registry |
| B-F8 | Per finding | "k of last 7": the count of recent units outside the band (baseline median ± 1.5σ) |
| B-F9 | Wording | Direction is "higher/lower than usual". Never "better/worse", "caused by", or "your watch is wrong" |
| B-F10 | Findings across imports | Each derive diffs against the previous one; new and resolved findings are listed in the import summary |

### Checks (confounders, B-C)

Computed for every finding over the baseline and recent windows:

| ID | Check | Flagged when |
| --- | --- | --- |
| B-C1 | Device change | A seam on this metric within the baseline or recent window |
| B-C2 | Partial nights | ≥1 partial night was dropped from the recent window |
| B-C3 | Timezone change | A `tz_change` night in the recent window |
| B-C4 | Missing nights | Recent window spans >10 calendar units to collect 7 complete ones |
| B-C5 | Low-trust metric | Metric trust is `low` |

### Freshness (B-R)

| ID | Given / when | Then |
| --- | --- | --- |
| B-R1 | Any page | Top bar: "Data through <as-of> · imported <n> days ago" |
| B-R2 | >30 days since the last import | Banner on Changes: "Your last import was 34 days ago. Findings describe Oct 10–Nov 7." with a link to Import |
| B-R3 | The last night is partial | The Last-night card shows the latest complete night and says why the newer one was skipped |
| B-R4 | No imports yet | Every page except Import shows the empty state with export instructions |

### Agents (B-A)

| ID | Given / when | Then |
| --- | --- | --- |
| B-A1 | `changes()` | Same rows and order as `/api/changes`; each row carries `asOf, epoch, state, confidence, trust, checks, caveats[]` |
| B-A2 | Any tool | Read-only; unknown metric → `isError` with the known list |
| B-A3 | Tool descriptions | Say: cite nights; device changes and partial data are confounders; midori asserts no causes |
| B-A4 | `nights(from,to)` range >400 days | Rejected with a hint to narrow the range |

## 5. Non-behaviors (explicitly not in v1)

- No composite readiness score.
- No push or HAE intake, no notes or annotations, no naps, no workouts.
- No value correction across devices; offsets are displayed only.
- No notifications; midori is opened, it does not ping.
