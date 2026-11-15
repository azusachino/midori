<!--
Gate C independent verification of midori v1 (journeys J1–J5 on the real export).
Reviewer: Claude Fable 5.2 (native subagent, fresh context, did not write the code).
Revision: main @ 54ff2df. Evidence (private screenshots and logs) stays in workstation
scratch .tmp/midori-v1/gate-c/run/; this record has counts, timings and states only.
Resolution: tasks/todo.md (Gate C fixes).
-->

# Gate C — midori v1 journeys on real data

## Verdict

**PASS WITH FINDINGS.** All five journeys complete on the real export and the gates exit 0
(after the reviewer reinstalled stale `node_modules` on `main`). Two HIGH defects in J2/J5 are
invisible to the mocked e2e suite.

## Gates

| Command | Exit | Result |
| --- | --- | --- |
| `bun run check` (as found) | 2 | `main`'s `node_modules` was stale vs `bun.lock` |
| `bun install --frozen-lockfile`, then `bun run check` | 0 | 248 tests pass |
| `make e2e` | 0 | 26 passed |
| `bun run build` / `bun run privacy-guard` | 0 | ECharts in a lazy chunk; privacy clean |

## Journeys (fresh empty db, real export through the UI file input, 1440 and 390 px)

| Journey | Result |
| --- | --- |
| J2 import | Works: 56.4 s first import, then "Nothing new" (54.9 s). The bad-file copy, busy lock and history all work. Has H1, M1, M2, M3 |
| J1 investigate | Pass: 10 overnight rows ranked by \|z\|, detail chart, checks, a recent table consistent with k, and a keyboard-operable evidence sheet |
| J3 new watch | Pass at 1440: the current watch is primary for 14 metrics, and step/offset labels are present. M4 at 390 |
| J4 agent | Suite parity (MCP `changes` = REST) plus CLI/REST order on real data. No live session rerun |
| J5 long view | Calendar passes. The Metrics index has H2 |

No horizontal overflow in 85 screenshots and no console errors (apart from the expected 400).
No B-F9 violations.

## Success criteria

- 1: met (56.4 s; re-import 0 new)
- 2: met
- 3: met (onset not exercised by this data)
- 4: unverifiable here (Checkpoint B predates 9b–9d)
- 5: met after the install (image not built)

## Findings

### HIGH

- **H1:** import progress shows 100% for the whole job. The UI clamps the byte count as if it
  were a percent, and the e2e mocks and unit test encode the same wrong contract. Fix: use
  `progress / progressTotal`.
- **H2:** the Metrics index mini-charts span about 3 years, blend primary and non-primary
  epochs, and mark mixed weeks with a null epoch, so Steps is almost blank. Fix: primary-stint
  values only, 52 weeks before as-of, plus a two-epoch fixture test.

### MED

- **M1:** the server stops answering for about 30 s during store and derive (synchronous on
  the event loop). The storing and deriving stages are never displayed. Risk: a liveness probe
  restarting the pod mid-import. Fix: run the import in a Worker, or yield between batches.
- **M2:** the "Import running" pill is a load-time snapshot. Fix: poll while an import is
  active.
- **M3:** the import summary's "Data through" shows the export date; the top bar shows as-of.
  Fix: use as-of.
- **M4:** the Devices timeline at 390 px opens at the oldest years with every bar off-screen.
- **M5:** the baseline band and its date span include the recent window. Fix: emit or flag
  baseline-rank points only.

### LOW

- **L1:** Metric detail with no imports shows "No nights in this range" instead of the B-R4
  empty state.
- **L2:** focus goes to `BODY` after closing the evidence sheet.
- **L3:** Metrics card links include the hidden table (about 4,600 characters), and the
  table's Device column reads "Epoch 16".
- **L4:** at 390 px the legend collides with the y-axis name, and seam and "last 7" labels are
  clipped.
- **L5:** the tooltip lacks usable/partial status and the zone.
- **L6:** copy: ISO dates vs "Nov 6 (Fri)"; pluralization ("1 primary epochs"); a −1.5σ
  rounding display next to "within usual"; the first-import summary lists every source as a
  "New device".
- **L7:** Devices: OS diamonds for an occasional source; at 390 px the "Across change" header
  disappears; former primaries are labelled "(candidate)".
- **L8:** no test is named B-A1, B-A2, B-A3 or B-I9.
- **L9:** `main`'s `node_modules` was not reinstalled after PR #16; the final gate ran on the
  worktree.

## Not verified

- A live MCP-only session after 9b–9d.
- The image.
- The pre-v1 `device_hw` fill (test-backed).
- Notable/alert, onset, warming-up, stale, partial-skip, failed/retry, older-export and
  interrupted-upload states on real data.
- Drag-and-drop, Safari on iPhone, screen readers, contrast.
