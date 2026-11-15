# midori v0 — product and design review (2026-11-15)

Reviewer: Claude Opus 5.5 (Claude Code), at the owner's request ("review the project; it might
need a redesign and rework"). This is a self-run review, not independent verification. No
personal measurements appear here. Real-data observations are described only by their shape.

Evidence: `main` @ `adb9a75`. `bun run check` passed: 197 tests, 2 biome warnings. Server
run locally against the private db; Playwright screenshots of `/`, `/investigate` and
`/import` (kept in gitignored `.tmp/review/`, not committed). Code read: `src/stats/*`,
`src/domain/stats.ts`, `src/domain/metrics.ts`, `src/ingest/mapper.ts`, `src/db/schema.ts`,
`src/http/queries.ts`.

## Verdict

**Keep the pipeline, redesign the analysis model and the briefing.** Ingest, storage, backups,
MCP transport and deployment work well. On the current data, the import of about 2.05M records
takes 15–19 s against a 5-minute budget, and a re-import adds 0 records (measured, import run
history). The product core does not work: **every one of the 14 briefing deviation rows is
suppressed**, so the "how am I doing" screen tells you nothing (measured, screenshot). This
follows from the design itself, not from a bug, so patching it will not fix it.

## Findings

### 1. Analysis goes dark for ~3 months after every device change (design flaw)

The current watch began recording on 2026-10-10. Baselines are strictly per source and need
≥15 days within anchor−90…anchor−29. Seam suppression also blanks any source whose
[anchor−90, anchor] window contains a switch. Together that means:

- the new watch can produce no z until its baseline window fills (late Nov at the earliest), and
- its rows stay `cross_source`-suppressed until the seam leaves the 90-day window (~early Jan 2027).

The old watch's analysis stays frozen at its last day. The acceptance story ("investigate a
change in watch readiness") is about exactly the period the design blanks out. Two rules
conflict: per-source purity gives no continuity, and a device change is the moment you most
want an answer.

### 2. "Source" is a device *name*, not a device

`mapRecord` keeps `sourceName` but drops the `device` attribute (hardware model, software)
and every `<MetadataEntry>`. The design's `meta_json` column never shipped. Consequences:

- Seam detection only works because the devices happen to have different names. A replacement
  watch that keeps the old name would be invisible.
- Spans are `MIN(day)..MAX(day)` per source, so intermittent coverage (e.g. a tablet writing
  active energy sporadically over months) looks continuous. Any minor app writing one sample
  inside the window raises a "switch" and can silence the primary watch. `boundaryInvolves`
  also matches the counterpart.
- Metadata needed later (HR motion context, HRV context, sleep source detail) is gone. The
  design said to store everything so future metrics need no re-import. The archived zip
  softens this, but it does not meet the design.

### 3. Overnight metrics are bucketed by calendar day, not by night

Sleep uses the night rule (≥15:00 → that date, <09:00 → previous date). HRV, respiratory rate
and wrist temperature use a 21:00–09:00 filter but group by the sample's *calendar* day
(`quantityGroups` in `src/stats/daily.ts`). One "day" of HRV therefore mixes the tail of one
night with the start of the next, and it does not line up with that date's sleep night.
(Inferred from code. Not yet confirmed with a test.)

### 4. "Last night" has no completeness check

The headline cards show the latest night even when the export was taken mid-night. On the
current data, the latest night is plainly partial (a fraction of a normal sleep total, with
zero deep/REM), and it is presented as fact (measured, screenshot).

### 5. Suppressed rows still show a "baseline"

`medianOrNull` returns a median from any number of days. The briefing prints "recent X vs
baseline Y" for rows whose baseline has 1–2 days. That is a number with no statistical
standing next to a z that was suppressed for exactly that reason.

### 6. The briefing is a ledger, not a briefing

There are 14 identical "Info · near a source coverage boundary" cards. Below them sit about
40 "source coverage changes" rows going back to 2023, including one-off apps, all weighted
equally. Nothing is ranked, because nothing can be. History belongs in Investigate.

### 7. UI defects (measured, screenshots)

- Investigate: the uPlot legend is drawn over the plot area; ~250 px of empty space sits above
  the chart; the x-axis has no date labels; the full 2017–2026 range is the default, which
  squashes recent data into the right ~25% of the width.
- Import: a ~280 px empty band sits between the header and the content (layout bug).
- Device events table is not sorted by date.

### 8. Two compute paths for the same answer

`/api/findings` reads the persisted `findings` cache. `/api/deviations` recomputes findings
live (`listDeviations` → `computeFindings`). `listFindings` also rewrites legacy evidence text
("took over from") at query time. These are leftovers from wording churn and should go away
once there is one compute path.

### 9. Freshness is limited by the input, not the code

A manual monthly `export.zip` means "last night" is up to ~30 days old by design. With import
taking ~15 s, the real cost is the manual export on the phone. HAE push ingest is listed as v1.
It is the single biggest lever on whether the dashboard gets used.

### 10. Ledger overstates completion

`tasks/checkpoint-3-ui-browse.md` and `tasks/checkpoint-4-mcp-session.md` both say the
checkpoint still needs verification. `tasks/todo.md` nonetheless records Checkpoint 4 as
PASSED and Checkpoint 5 as "all six design success criteria verified". Criteria 2 (investigate
view) and 4 (an agent answering "what changed and why") are contested by the project's own
records.

### Minor

- `data/backups/` holds 195 snapshots (2.1 GB) from one day of local imports and test runs.
  Retention is age-only, with no count or size cap.
- Several `.tmp-*-test/` dirs (baselines, integration, mcp, mcp-http) are not in `.gitignore`.
  They are empty today, so `git status` is clean.

## Proposed redesign (for owner decision)

Keep: zip ingest + store, backups, Hono/REST shell, MCP transport, container + k3s manifests.

1. **Capture device identity and metadata.** Add `device_hw` (parsed from `device`) and
   `meta_json` to `records`. The analysis key becomes a *device epoch* (source + hardware),
   with coverage measured by days present, not min/max spans.
2. **One continuous series per metric.** Pick a primary source per day (a dominant-coverage
   rule, similar to Apple's source priority). Ignore minor sources below a coverage-share
   threshold.
3. **Re-baseline at seams instead of going dark.** At a new epoch, start a fresh baseline from
   the seam with a short warm-up (e.g. 14 nights). Show "re-baselining, day n of 14" and
   per-epoch bands. Where both devices recorded on the same days, estimate and show the offset
   rather than hiding it.
4. **Night as the unit for overnight metrics.** HRV, respiratory rate, wrist temp and overnight
   SpO2 follow the sleep night rule. Each night gets a completeness flag, and "last night"
   means the last *complete* night.
5. **Rolling baseline instead of fixed −90…−29 windows** (e.g. trailing 28–60 complete nights
   per epoch), so findings are available within weeks of a seam.
6. **Briefing rebuilt around a short list:** freshness + "as of", last complete night, at most
   ~5 ranked items, one compact seam notice. History moves to Investigate, with the default
   range set to the last 180 days, epoch shading and a legend outside the plot.
7. **One compute path.** Either persist everything per import and only read at request time,
   or compute live and drop the `findings` table. Not both.
8. **Decide on freshness:** add HAE / Shortcut push ingest in this rework, or keep zip-only
   and accept monthly staleness.

Steps 1–5 change the schema and stats contracts, which the design marks "ask first". Treat
the rework as tier 2: amend `docs/design.md`, record an ADR for the per-source → per-epoch
change, then slice it with the spike regression kept as a fixture.
