# midori v1 — workflow, user journeys and expected behavior

Status: proposed 2026-11-15, rev 2 after the
[Fable review](reviews/2026-11-15-v1-design-review-fable.md). Companion to
[design.md](design.md) (what and why) and [ui-design.md](ui-design.md) (how it looks).

**This file is the behavioral contract and the only home of numeric thresholds.** Other
documents reference `B-` ids instead of restating numbers. Each `B-` rule becomes at least
one test or e2e check named by its id ([tasks/plan.md](../tasks/plan.md)). Thresholds marked † are starting values: slice 6's real-data readout may tune them with a note here. Quoted
wording is indicative copy.

## 1. The end-to-end workflow

```text
iPhone Health ──Export All Health Data──▶ export.zip (~66 MB)
   │  Save to Files → open midori in Safari (tailnet) → choose file
   │  or AirDrop to the Mac → drop on the Import page
   ▼
Import ──upload (XHR progress)──▶ validate ──▶ job: queued → unpacking → parsing → storing → deriving → done
                                                          │
                     derive (one transaction, atomic swap of derived tables):
                     epochs → nights → metric values → primary series → findings + checks
                                                          │
             ┌──────────────────────────┬─────────────────┴──────────┬───────────────────┐
             ▼                          ▼                            ▼                   ▼
          Changes                 Metric detail                  Devices          MCP (pi / luna)
   "what moved, how sure"   "show me the nights"        "which watch, when"   same reads, as JSON
```

Cadence: roughly monthly, or whenever something feels off. Imports are idempotent. Derived
state always reflects **all** stored records, not just the latest zip.

## 2. Vocabulary

| Term | Meaning | UI wording |
| --- | --- | --- |
| Epoch | One device: `(source name, hardware model)`, B-D1/B-D2 | "device", or "watch" for watch epochs |
| Minor | An epoch too sparse to represent a metric (B-D3) | "occasional source" |
| Primary | The epoch that represents a metric over a stretch of time (B-D4) | "measured by …" |
| Stint | A continuous period with the same primary epoch for a metric; seams separate stints | "since your new watch" |
| Unit | A night (overnight metrics) or a calendar day (daytime metrics) | "night" / "day" |
| Usable unit | Night-level complete **and** metric-level sample minimum met (B-N7) | partial units are shown hollow |
| Rank | Usable units in the current stint, numbered newest = 1 | — |
| Recent | Ranks 1–7 (B-F1) | "last 7 nights" |
| Baseline | Ranks 8–35 (B-F1) | "your usual range" |
| As of | Newest usable night of the primary watch epoch for `sleep_h` | "Data through Nov 7" |

Metric set:

- **Overnight** (unit = night): `sleep_h, deep_h, rem_h, sleep_hr, hrv_sdnn, hrv_rmssd, rhr,
  resp_rate, wrist_temp, spo2`.
  - `sleep_hr` is the median heart rate during that night's asleep intervals, the closest
    export proxy to Apple Vitals' sleeping heart rate.
  - `rhr` is Apple's daily value, assigned to the night that ends that morning.†
- **Daytime** (unit = day): `steps, active_kj, heart_rate`.
- **Trend-only** (charted, never a finding): `vo2max`.

## 3. Journeys

### J1 — Investigate a feeling (primary)

> "My readiness has felt off for a week. Is anything actually different?"

1. Open midori → **Changes**. The top bar says "Data through Nov 7 · imported 8 days ago".
2. The *Overnight* list shows every overnight metric in ranked order (B-F7). Each row shows:
   - the direction in neutral words ("lower than usual")
   - frequency ("5 of the last 7 nights")
   - onset ("since Oct 31", or "at least since Oct 10", B-F11)
   - a confidence chip
   - the number of flagged checks
   - a 35-unit sparkline
3. Clicking a row opens **Metric detail** at 90 days: band, recent window, seams, partial units.
4. The *Checks* panel lists confounders (B-C1–B-C6), each "clear" or "flagged" with a link.
5. Clicking a night opens its evidence: sample times and values, sleep stages, device,
   timezone.
6. Outcome: what moved, since when, how consistently and how confidently, and whether a device
   change, an OS update, partial data or travel could explain it. midori states no cause.
   When old and new watch never overlapped, midori says so ("device or you, can't be
   separated", B-D7).

### J2 — Monthly import

1. On the iPhone: Health → profile → Export All Health Data → Save to Files. Then open midori in
   Safari on the tailnet, go to Import → choose file. Alternatively, AirDrop to the Mac and drop
   it there.
2. Upload progress shows bytes. On the phone, the page says "Keep this tab open until the upload
   finishes" (B-I11). After upload the stage stepper runs, and the tab can close (B-I7).
3. **Summary card**: new records, new usable nights, "data through" date, new devices or OS
   updates, and the current top changes.
4. "See what changed" opens **Changes**.

### J3 — New watch

1. After an import containing a new hardware model, the summary says "New watch detected: Apple
   Watch Ultra (Watch7,5), first night Oct 10".
2. **Changes** shows one compact notice while any overnight metric is warming up (B-F3):
   "Learning your new watch — wrist temp: 9 of 14 usable nights. First reading around Nov 12." The dates are estimates from the observed nightly cadence; n is the minimum
   over overnight metrics.
3. **Devices** shows:
   - the epoch timeline
   - the primary per metric
   - for each seam, either the overlap offset (B-D6) or the across-seam step with its "can't
     be separated" label (B-D7)
4. Old-watch history stays visible in its own color. Values are never blended or rescaled.

### J4 — Ask an agent

1. pi or luna call `changes()`. They get the same rows and order as the Changes page, with
   as-of, confidence, state, onset, checks and `caveats[]`.
2. Follow-ups use `metric_series` and `nights` (per-unit values with epoch and usability).
3. Tool descriptions tell the agent to cite nights and to treat device changes, OS updates,
   partial data and travel as confounders, never as causes.

### J5 — Long view

1. **Metrics** index: one card per metric with a 1-year mini chart and its current state.
2. Metric detail → *Long view* tab: a calendar heatmap per year, split by epoch, with seams
   marked.

## 4. Expected behavior

### Import (B-I)

| ID | Given / when | Then |
| --- | --- | --- |
| B-I1 | Upload finishes, but the file is not a zip or lacks `apple_health_export/export.xml` | The server checks the zip's central directory **before** creating a job → 400, "This isn't a Health export (export.xml not found)." No job row, nothing stored |
| B-I2 | An upload while another import is running | 409; the page shows the running job |
| B-I3 | The identical zip again | Job done; "Nothing new: 0 new records". Derived state unchanged; history records the run |
| B-I4 | `ExportDate` older than the newest stored data | Accepted (dedup). Warning: "This export is older than data you already have; nothing is removed." |
| B-I5 | Failure at any stage | Stored records stay. Inserts are idempotent, so they are harmless. **Derived state is untouched**, and reads keep serving the previous derive. The job is `failed` with stage and reason. The spool is kept 24 h for `POST /api/imports/:id/retry` |
| B-I6 | Reads during an import | Derived tables swap atomically at `done`. Evidence reads only records of units ≤ the current as-of, so newly stored records never leak in early |
| B-I7 | Tab closed after the upload completed | The job continues; reopening Import shows it live |
| B-I8 | Job record | `imports` stores stage, `progress` (bytes parsed / total), `export_date`, record counts, new usable nights and new epochs. Status `deriving` is allowed by the schema |
| B-I9 | Real export | End to end (upload excluded) under 2 min locally |
| B-I10 | Server starts with non-terminal import rows | Marked `failed`, reason "interrupted by restart"; retry offered while the spool exists |
| B-I11 | Upload from a phone | XHR upload with byte progress; "Keep this tab open until the upload finishes." A network drop shows "Upload interrupted — choose the file again" (not resumable) |
| B-I12 | Each import / backup run | Re-import fills `device_hw`, `device_sw` and `meta_json` on existing rows where they are NULL (upsert); dedup key unchanged; no data deleted. Backups keep at most 30 days **and** 10 snapshots |

### Devices and epochs (B-D)

| ID | Given / when | Then |
| --- | --- | --- |
| B-D1 | Records with one source name but different `hardware:` | Two epochs. Kind from hardware: `Watch*` → watch, `iPhone*` → phone, otherwise other |
| B-D2 | A record without `device`, from a source that carries `device` on other records | Inherits the epoch of that source's device-bearing records nearest in time (same or adjacent local day; else nearest within 30 days). This covers Apple's device-less sleep and resting-HR records |
| B-D2b | A source that never carries `device` (apps, manual entry) | Epoch `(source, "")`, kind `app` |
| B-D3 | Minor, per (metric, epoch), evaluated over all history at each derive | Minor if the epoch never records the metric on ≥6 of any 28 consecutive calendar units†. Minor epochs are drawn faintly and are never candidates for primary |
| B-D4 | Primary per metric (sticky) | Candidates are non-minor epochs; kind priority watch > phone > app/other. The first primary is the highest-priority candidate at series start (tie: most sleep seconds for sleep metrics, else most samples). The primary changes only when: (a) a higher-priority candidate records 7 consecutive units†; (b) a same-kind candidate records 7 consecutive units† on which the incumbent records none; or (c) the incumbent records nothing for 14 consecutive units† and another candidate does. The new stint starts at the first unit of the qualifying run |
| B-D4b | A unit on which the primary recorded nothing | No value for that metric on that unit, even if other epochs recorded. No per-unit fallback |
| B-D5 | A change of primary | A seam at the new stint's first unit |
| B-D6 | A seam with ≥7 shared usable units† between old and new primary | Median offset (new − old) with n. Values are never adjusted |
| B-D7 | A seam with <7 shared units | Across-seam step instead: median of the old stint's last ≤28 usable units vs the new stint's first ≤28 (≥7 each). Label: "difference across the watch change — device or you, can't be separated" |
| B-D8 | `software:` version changes within a primary epoch | An OS-update event on that epoch (no seam) |

### Nights and units (B-N)

| ID | Given / when | Then |
| --- | --- | --- |
| B-N1 | The night's zone | `HKTimeZone` from that night's sleep records when present; otherwise the export's offset. All local times for the night use this zone |
| B-N2 | Sleep record starting ≥15:00 local | That date's night |
| B-N3 | Sleep record starting <09:00 local | Previous date's night |
| B-N4 | Asleep record starting 09:00–12:00 | Previous night if it starts ≤60 min† after that night's last asleep end; otherwise a nap, excluded |
| B-N5 | Overnight sensor samples (HRV also requires 21:00–09:00 local) | Assigned by B-N2/B-N3 in the B-N1 zone. `sleep_hr` uses HR samples inside the night's asleep intervals only |
| B-N6 | Night-level completeness | `partial`, reason `export_cut`, when the night's window (until 12:00 the next day) ends after `ExportDate`. Copy: "export taken before noon". Short nights are **not** partial |
| B-N7 | Metric-level completeness and usability | The registry minimum per night is met (wrist temp 1, HRV 3, resp 3, SpO2 3, `sleep_hr` 10†; sleep metrics: asleep > 0). A unit is usable only when night-level complete and the metric minimum is met |
| B-N8 | `tz_change` | A night whose B-N1 zone differs from the previous night's |
| B-N9 | Daytime unit | Local calendar day in the export offset; usable unless it is the export day |

### Baselines and findings (B-F)

| ID | Given / when | Then |
| --- | --- | --- |
| B-F1 | Windows | Ordinal over usable units of the **current stint**: recent = ranks 1–7, baseline = ranks 8–35 |
| B-F2 | Recent gate | ≥4 recent units, and rank 1 within 14 calendar days† of as-of; else `insufficient` ("3 of 4 recent nights", or `stale` "no recent nights") |
| B-F3 | Baseline gate | <7 baseline units: `warming_up`, progress = stint usable units out of 14. 7–13: an early baseline, z computed, confidence low. ≥14: full |
| B-F4 | z | σ = max(1.4826·MAD, registry floor†). Floors: resp 0.5 /min, SpO2 1 pt, wrist temp 0.05 °C, HRV 2 ms, RHR / sleep HR / HR 1 bpm, sleep 0.25 h, deep / REM 0.1 h, steps 250, active energy 100 kJ. z = (median recent − median baseline) / σ, with displayed and ranked \|z\| capped at 10 ("≥10σ") |
| B-F5 | Severity | \|z\| ≥1.5 notable, ≥2.5 alert, else within |
| B-F6 | Confidence (first match wins) | 1. `low` if trust is low or baseline <14. 2. `medium` if baseline <24 or recent <6. 3. otherwise `high` |
| B-F7 | Ranking (Changes and `changes()`) | Computed rows by capped \|z\| desc, then confidence high→low; then `warming_up`; then `insufficient`. Ties use registry order. Daytime rows appear on Changes only when notable or alert |
| B-F8 | Frequency | k = recent units outside the band (baseline median ± 1.5σ) |
| B-F9 | Wording | "higher/lower than usual / within usual". Never "better/worse", "caused by", "your watch is wrong" |
| B-F10 | Trend-only metrics (`vo2max`) | Charted with epochs and seams; no finding, no Changes row |
| B-F11 | Onset (notable/alert rows) | Walk back from rank 1 over usable units outside the band on the same side, tolerating one inside unit. Onset = the first unit of that run: "since Oct 31". If the run reaches rank 35 or the stint start: "at least since …" |

### Checks (confounders, B-C)

Computed per finding row and shown as clear or flagged:

| ID | Check | Flagged when |
| --- | --- | --- |
| B-C1 | Device change | A seam on this metric within the last 35 calendar units of as-of |
| B-C2 | OS update | A B-D8 event on the primary epoch within the last 35 calendar units |
| B-C3 | Partial nights | ≥1 partial unit was skipped while collecting the recent window |
| B-C4 | Timezone change | A `tz_change` night among the recent units |
| B-C5 | Missing nights | The recent window spans >10 calendar units |
| B-C6 | Low trust | Metric trust is `low` |

### Freshness (B-R)

| ID | Given / when | Then |
| --- | --- | --- |
| B-R1 | Any page | Top bar: "Data through <as-of> · imported <n> days ago" |
| B-R2 | >30 days since the last import | Banner on Changes: "Your last import was 34 days ago. Findings describe <oldest recent unit>–<as-of>." with an Import link |
| B-R3 | Last-night card | Newest usable night within 14 days. If the newest night is partial: "Nov 7 skipped: export taken before noon." If there is none: "No complete night in the last 14 days." |
| B-R4 | No imports yet | Every page except Import shows the empty state with export steps |

### Agents (B-A)

| ID | Given / when | Then |
| --- | --- | --- |
| B-A1 | `changes()` | Same rows/order as `/api/changes`; each row has `asOf, epoch, state, confidence, onset, checks, trust, caveats[]` |
| B-A2 | Any tool | Read-only; unknown metric → `isError` with the known list |
| B-A3 | Tool descriptions | Cite nights; device changes, OS updates, partial data and travel are confounders; midori asserts no causes |
| B-A4 | Range limits | `nights` >400 days is rejected with a hint. `metric_series(range=all)` returns weekly medians |

## 5. Non-behaviors (v1)

- No composite readiness score.
- No push or HAE intake, no notes, no naps, no workouts.
- No cross-device value correction.
- No notifications.
- No "what changed since the previous import" diff.
- Primary-only sums: steps can be lower than Apple's merged total. The trust note says so.
- Without shared nights, midori reports a device-change confound; it cannot resolve it.
