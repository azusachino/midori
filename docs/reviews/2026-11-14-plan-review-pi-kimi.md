<!--
Review preserved from scratch (harus-workstation .tmp/midori/review-pi-kimi/report.md).
Reviewer: herdr peer `midori-review` (terminal t7w), pi on Kimi K3.1 Pro (opencode-go/kimi-k3.1-pro via magpie), medium thinking.
Subject: tasks/plan.md rev 1 (commit d3cc18c) against docs/design.md (commit a072a40).
Reviewed: 2026-11-14. Context: read-only access to the workstation checkout; make context unavailable in its sandbox (mise missing), so verification was via git + file reads.
-->

# Independent review: midori v0 implementation plan

## Verdict

**CHANGES REQUESTED.** `vendor/midori/tasks/plan.md` follows the approved architecture and has a sensible local-first phase sequence, but it does not yet faithfully and completely implement `vendor/midori/docs/design.md`.

The largest gaps are the approved backup contract, testable definitions for the core statistics and import-upload paths, and explicit protection against personal health data entering a container image. Several UI and data-model requirements are also absent, and multiple tasks are too broad for the requested one-session/~5-file bound.

This is a source-only plan review, not a review of implemented behavior. No midori implementation exists in the reviewed checkout.

## Reviewed source and evidence boundary

- Approved design: `vendor/midori/docs/design.md` at commit `a072a409834f11e717150470733e70245fe9ae2c`.
- Plan under review: `vendor/midori/tasks/plan.md` at commit `d3cc18c7fe1572607d1f2273eab4e987ffb12218`.
- The design commit is an ancestor of the plan commit. The midori worktree was clean on `main`, with `HEAD == origin/main` at review time.
- Optional context read: `docs/runbooks/research/2026-11/2026-11-13-midori-apple-health-assistant.md`.
- The referenced spike script and staged export directory were both present at review time. The script is scratch, not a durable specification.
- Deployment context checked: `docs/playbooks/ship-to-cluster.md`, `vendor/harus-charts/AGENTS.md`, `vendor/harus-charts/GEMINI.md`, and relevant `vendor/harus-k3s/CLAUDE.md` rules.

## Per-criterion verdicts

| Criterion | Verdict | Short reason |
|---|---|---|
| 1. Coverage | **Unmet — broad but incomplete** | All major modules and all six MCP tools are named, but local post-import backups, imported-zip archival, non-`Record` presence logging, cadence UI, some device-event kinds, and the required integration test are missing or only implied. |
| 2. Ordering | **Partially met** | `store → ingest → stats → API/UI → MCP → cluster` is correct and checkpoints are well placed. Acceptance detail arrives too late, and import-backup/stat-recompute/upload wiring needs explicit placement. |
| 3. Sizing | **Unmet** | Tasks 4, 6, 9, 10, 11, 12, and 16 are likely to exceed one focused session or ~5 files. Task 10 is explicitly called a small uPlot-wrapper task in the risk table but actually contains the entire web foundation. |
| 4. Verifiability | **Partially met** | Checkpoints 1, 2, and 4 are concrete. Per-task acceptance is deferred until Phase 3, the required fixture-zip-to-briefing integration test is absent, and Checkpoint 3/5 need explicit evidence checklists. |
| 5. Risks | **Partially met** | The risk list identifies the right headline risks. Import mitigation is plausible, but SQLite/hostPath and cross-repo mitigations are incomplete; night-rule tests and dependency/privacy/upload risks need more detail. |
| 6. Gaps | **Unmet — material gaps found** | Zero-MAD/window semantics, large-upload behavior, import concurrency, `.dockerignore`, runtime dependency approval, backup restore/integrity checks, and several contract definitions are not planned. |

## Findings, ordered by severity

### HIGH-1 — The approved backup contract is only partially planned

**Evidence**

- The design requires nightly `VACUUM INTO`, 30-day retention, **archived imported zips**, a cluster CronJob, **and a post-import job during local development** (`vendor/midori/docs/design.md:192-194`, “Backups are owned by midori”).
- Task 4 covers ingest and bookkeeping only (`vendor/midori/tasks/plan.md:46-47`).
- Task 16 covers only the cluster CronJob and retention (`vendor/midori/tasks/plan.md:92-94`). No task archives imported zips or implements local post-import backup.

**Impact**

A local-first v0 can pass every listed checkpoint while violating an explicit approved boundary and leaving the only canonical health-data copy without the promised backup. Checkpoint 5’s generic “all six success criteria” does not recover this omission because backup ownership is also a standalone design boundary.

**Required revision**

Add a Phase 1 task for local imported-zip archival and post-import snapshot/retention behavior. Extend Task 16 to preserve the same archive/snapshot contract on k3s. Add synthetic-clock retention tests, SQLite integrity verification, and a restore smoke test; “CronJob fires” alone does not prove a usable backup.

### HIGH-2 — Core deviation and recalibration behavior is not yet falsifiable

**Evidence**

- The design pins the per-metric/source anchor, every-view “as of” date, baseline days `−90…−29`, recent 14 days, robust-z formula, day-count gates, severity thresholds, per-source comparisons, recalibration suppression, trust labels, and a typed `Finding` contract (`vendor/midori/docs/design.md:119-146`).
- Task 7 names the broad features but omits the exact baseline/recent windows and zero/edge-case behavior (`vendor/midori/tasks/plan.md:57-58`).
- Task 8 names “coverage boundary detection” without defining how a boundary is distinguished from an ordinary gap, and explicitly mentions only `switch` events (`vendor/midori/tasks/plan.md:59-60`).
- The scratch spike uses `range(29, 90)` for its baseline (`.tmp/midori/analyze.py:102`), which excludes day `−90`, despite its `[-90,-29]` comment. It has a zero-MAD fallback at lines 111-113, but neither that fallback nor an alternative is specified in the plan.

**Impact**

Different reasonable implementations can produce different rankings and alerts while all claiming to satisfy Task 7. Zero MAD can otherwise yield an infinite/NaN z-score. Under-specified boundary detection is especially risky because avoiding a device-change false alarm is the origin acceptance story, not an optional refinement.

**Required revision**

Before Task 7, write the exact window inclusivity, missing-day treatment, zero-MAD policy, threshold-boundary behavior, `Finding`/`EvidenceRef` types, and coverage-boundary algorithm into the plan or a tracked module contract. Add synthetic tests for exact window edges, ≥15/≥7 gates, `|z| = 1.5` and `2.5`, zero MAD, sparse series, per-source anchors, source start/end inside each compared window, overlapping sources, ordinary gaps, and the spike regression. Do not rely on gitignored spike code as the only canonical behavioral definition.

### HIGH-3 — The 909 MB HTTP import journey has no implementable contract

**Evidence**

- The design requires `POST /api/imports` zip upload (`vendor/midori/docs/design.md:151`) and success with a real 909 MB export (`:178`). Its deployment note separately says “66 MB is nothing” (`:212-213`), which is not a safe sizing assumption for the stated acceptance input.
- Task 4 builds only the CLI ingest path (`vendor/midori/tasks/plan.md:46-47`).
- Task 9 lists endpoint names but not upload processing, response/job semantics, failure states, concurrency, or limits (`:67-68`).
- Task 17 is the first explicit upload-through-ingress verification (`:95-96`).

**Impact**

The UI and cluster can be built around an upload contract that cannot sustain the real input: request-body limits, ingress timeouts, temporary-disk capacity, request duration, concurrent imports, and failed-import status can all fail late in Phase 5. A synchronous multi-minute request and an asynchronous `202 + import id` flow require different UI and API clients.

**Required revision**

Define the upload contract before Tasks 9-11: reuse of the Task 4 pipeline, synchronous vs asynchronous response, status transitions, error payload, upload spooling/atomicity, maximum size/timeouts, single-import locking, and behavior on retry/re-upload. Resolve the 909 MB vs 66 MB inconsistency explicitly rather than configuring ingress for 66 MB. Add a synthetic zip API integration test in Phase 3 and retain the real upload verification in Task 17.

### HIGH-4 — Personal-data protection does not extend to the container artifact

**Evidence**

- Success criterion 5 requires `data/` to be gitignored and nothing personal to leave the host; the design also forbids committing/publishing health data (`vendor/midori/docs/design.md:184,197-198`).
- Task 1 includes only `.gitignore` (`vendor/midori/tasks/plan.md:40-41`).
- Task 15 adds a multi-stage Dockerfile and smoke test but no `.dockerignore`, build-context check, or image-content verification (`:90-91`).
- The real export is deliberately copied into midori `data/` for Task 5 (`:117`), making an accidental later `COPY . .` particularly consequential.

**Impact**

A database or export can be excluded from Git and still be copied into an image layer. That would violate the privacy boundary and could export health data wherever the image is imported or published.

**Required revision**

Add `.dockerignore` coverage for `data/`, export archives, SQLite sidecars/backups, and scratch inputs before Task 15. Add an automated tracked-file/CI fixture check and an image-content inspection proving no personal data is present. State that real exports are never used in CI or baked into smoke-test images, and identify the private storage boundary for cluster backups.

### MED-1 — Per-task acceptance is scheduled after the work it should constrain, and a required test is absent

**Evidence**

- The plan says per-task acceptance criteria land in `tasks/todo.md` **in Phase 3** (`vendor/midori/tasks/plan.md:5-6`), after Phases 1-2/Tasks 1-8 would already be complete.
- The design explicitly requires unit coverage and a `fixture zip → db → briefing endpoint payload` integration test (`vendor/midori/docs/design.md:167-174`).
- The plan includes fixtures and the spike regression, but no task or checkpoint includes that end-to-end integration test. Checkpoint 3 is manual browsing only (`vendor/midori/tasks/plan.md:76-77`).

**Required revision**

Produce falsifiable acceptance for all tasks before Phase 1. Add the fixture integration test to Task 9/Checkpoint 3 and make Task 1’s CI explicitly run `bun install`, typecheck, and `bun test` on push with synthetic data only. Replace “briefing renders fully” with the exact required panels and payload assertions.

### MED-2 — Several approved UI requirements disappear from the page tasks

**Evidence**

- The Briefing must include evidence links, import status, and a cadence nudge; every view must show its analysis “as of” date (`vendor/midori/docs/design.md:121,159-164`). Success criterion 3 also names cadence (`:182`).
- Task 11 includes Briefing as-of date, last night, ranked deviations, and recalibration notices, but not Briefing evidence links, import status, or cadence (`vendor/midori/tasks/plan.md:71-72`).
- Task 12 does not state the Investigate as-of date (`:73-74`). Trust labels are created in Task 7 but no API/UI/MCP task explicitly carries them to consumers.

**Required revision**

Add these fields and panels to Tasks 9, 11, 12, and 13 contracts as applicable. Checkpoint 3 should explicitly check cadence, import status, evidence navigation, as-of dates, and trust labels rather than only “history” and “fully.”

### MED-3 — Data-model obligations are only implied, and some are absent

**Evidence**

- Workout elements, GPS routes, and ECG CSVs must be logged as present but not parsed (`vendor/midori/docs/design.md:91-94`). No ingest task names this behavior.
- `device_events` includes `first_seen`, `last_seen`, and `switch` (`:100-101`), while Task 8 names only boundary detection and `switch` (`vendor/midori/tasks/plan.md:59-60`).
- Records must retain UTC instants plus the export local offset (`vendor/midori/docs/design.md:108-110`); Task 6 consumes UTC+offset, but Tasks 2/4 do not explicitly require offset persistence.
- The design requires dedup-key unit tests (`:171`). Task 4 names dedup but does not define NULL/missing-value or numeric-normalization behavior for the SQLite unique key.

**Required revision**

Add explicit acceptance for non-`Record` presence logging, all device-event kinds, offset persistence, source metadata/count updates, and dedup edge cases. Test NULL values, category records, equivalent numeric representations, malformed dates, and unknown record types. Keep unknown types stored but out of aggregation as the design requires.

### MED-4 — Multiple tasks exceed the requested session/file bound

| Task | Why it is too broad | Suggested split |
|---|---|---|
| 4 (`plan.md:46-47`) | ZIP handling, SAX parsing, mapping all records, transactional dedup, source/import bookkeeping, CLI, and tests | Streaming parser/mapper + fixtures; transactional store/dedup; CLI/run bookkeeping; local backup/archive |
| 6 (`:55-56`) | Local-day semantics, night assembly, dominant-source selection, all median/sum aggregations, HRV filter, and tests | Night/local-day assembly; per-source daily metric aggregation |
| 9 (`:67-68`) | Seven route operations plus shared JSON contracts and large upload behavior | Domain/API contracts + read routes; import upload/job route; integration tests |
| 10 (`:69-70`) | Vite/React scaffold, tokens, chart wrapper, copy module, and API client | Web foundation/tokens/copy/client; isolated uPlot wrapper |
| 11 (`:71-72`) | Two complete pages with upload, history, briefing, findings, and notices | Import page; Briefing page |
| 12 (`:73-74`) | Picker, custom chart, table, evidence navigation, events, and two HRV series | Chart/metric view; findings/evidence/device panel, if the file count exceeds the bound |
| 16 (`:92-94`) | Cross-repo chart, PVC, workload, ingress, backup CronJob, retention, and owning-repo gates | Base chart/workload; backup/archive resources; cluster pin/apply preparation |

Task 8 and Task 13 are also watch items, but they can fit if earlier tasks leave narrow, well-tested interfaces. The risk table’s claim that Task 10 is a “small” wrapper task (`plan.md:113`) contradicts its actual content and should be corrected.

### MED-5 — SQLite-on-k3s mitigation does not prove integrity or single-writer behavior

**Evidence**

- The only mitigation is a single-writer pod and moving to hostPath if problems appear (`vendor/midori/tasks/plan.md:114`).
- A single replica does not by itself prevent old/new pod overlap during a rolling update, and hostPath does not itself repair fsync semantics or provide recovery.
- Task 17 checks only that the backup CronJob fires (`:95-96`).

**Required revision**

Require an RWO PVC, an explicit update strategy that prevents concurrent writers (for example `Recreate`), and application-level import serialization. Add pod-restart/reimport checks, `integrity_check` on snapshots, and a restore drill. Keep WAL sidecar handling explicit. hostPath may remain a fallback decision, but it is not verification or a backup.

### MED-6 — The harus-charts/harus-k3s work is not yet the prescribed ship-to-cluster sequence

**Evidence**

- The design requires shipping per the playbook (`vendor/midori/docs/design.md:185-186,213-215`). Tasks 15-17 provide a Dockerfile, chart, and generic deploy verification (`vendor/midori/tasks/plan.md:90-96`).
- The playbook requires tier-2 owner scope, service-owned image build/import targets, `harus-k3s` image pins, `validate`, `check-drift`, image/source identity checks, owning apply targets, rollout verification, and separate repo commits (`docs/playbooks/ship-to-cluster.md:24-27,52-84`).
- harus-charts also requires its `tk` task workflow and owning build/synth/test gates (`vendor/harus-charts/AGENTS.md:6`; `vendor/harus-charts/GEMINI.md:61-87,128`).

**Required revision**

Name these steps and evidence explicitly. Add the midori service-owned image target, chart synth/test gate, harus-k3s pin/update and `check-drift`, authorized apply path, rollback note, and separate commit/PR handoffs. Merely reading harus-charts instructions is a useful start, not the whole mitigation.

### MED-7 — “No blocking open questions” overlooks runtime dependency approval

**Evidence**

- The design says to ask before runtime dependencies beyond the approved stack (`vendor/midori/docs/design.md:195-196`).
- Task 4 requires ZIP handling and streaming SAX parsing (`vendor/midori/tasks/plan.md:46-47`), but no SAX/XML or ZIP implementation/dependency is named, and the plan declares no blocking questions (`:119-122`).

**Required revision**

Before Task 4, either name an implementation using already approved/platform capabilities or record the proposed runtime packages and obtain the required owner decision. This need not block Tasks 1-3, but it is a real Phase 1 gate.

## Coverage matrix

### Design elements

| Design element | Verdict | Task mapping and remainder |
|---|---|---|
| Data model / migrations / WAL / dedup | **Partial** | Tasks 2 and 4 cover all six tables, WAL, and the unique key. Offset persistence, non-`Record` presence logs, dedup edge cases, and some metadata behavior need explicit acceptance. |
| Local-day and night rules | **Met with test clarification** | Tasks 3 and 6 directly cover offsets, night assignment, dominant source, naps, and HRV nighttime filtering. Exact boundary/tie tests remain necessary. |
| Stats engine, anchor, gates, severity, trust | **Partial** | Tasks 6-8 name the major features. Exact windows, zero-MAD behavior, typed findings, trust-label propagation, and every-view as-of behavior are incomplete. |
| Device events / recalibration | **Partial** | Task 8 and the spike fixture cover `switch`/suppression; `first_seen` and `last_seen` are not scheduled and boundary detection is undefined. |
| REST endpoints | **Names met; behavior partial** | Task 9 lists every approved route. Upload/job/error/concurrency semantics and integration verification are missing. |
| Briefing / Investigate / Import UI | **Partial** | Tasks 10-12 cover all three pages and the approved visual stack. Cadence, Briefing evidence links/import status, universal as-of dates, and trust display need restoration. |
| MCP tools, stdio and streamable HTTP | **Met** | Tasks 13-14 name all six read-only tools, one shared implementation/contract, and both transports. Checkpoint 4 covers the pi journey. |
| Backups | **Unmet** | Task 16 covers cluster `VACUUM INTO` and retention only. Local post-import backup and imported-zip archival are absent. |
| CI | **Mostly met** | Task 1 schedules minimal CI and synthetic-only verification is explicit. Its acceptance should pin install/typecheck/test-on-push and privacy checks. |
| Deployment | **Partial** | Tasks 15-17 cover image, pod/PVC, tailnet ingress, MCP, upload, and CronJob. The owning ship-to-cluster mechanics, single-writer rollout, archive, and privacy checks are incomplete. |
| Non-goals / invented scope | **Met** | No task adds an LLM, composite score, multi-user support, public exposure, Postgres, real-time ingest, or another deferred roadmap feature. Biome is a reasonable lint implementation of the approved `check` command, not new product scope. |

### Success criteria 1-6

| Success criterion | Verdict | Mapping |
|---|---|---|
| 1. Real import <5 min; immediate re-import 0 new | **Met** | Task 5 and Checkpoint 1 are quantitative and owner-witnessed. |
| 2. Spike readout reproduced safely | **Met at checkpoint level; contract incomplete** | Checkpoint 2, Task 12, and Checkpoint 3 cover it. Stats semantics/test matrix still need correction to make implementation reliably reproduce it. |
| 3. Briefing and import history/cadence | **Partial** | Task 11/Checkpoint 3 cover rendering and history but omit cadence and some required Briefing content. |
| 4. Pi answers using only MCP tools | **Met** | Tasks 13-14 and Checkpoint 4 directly implement and verify it. Preserve a tool transcript as evidence. |
| 5. Tests green, `data/` ignored, no personal data leaves host | **Partial** | Task 1 covers tests/CI/gitignore. No explicit privacy verification covers Docker build context/images and backup artifacts. |
| 6. harus-k3s closing milestone | **Partial** | Tasks 15-17 cover the visible journey, but omit parts of the required ship workflow and full backup/archive contract. |

## Ordering and checkpoint assessment

The main dependency order is correct:

- Schema precedes ingest; the real import is tested before UI investment.
- Aggregation precedes baselines, which precede device recalibration/findings.
- The JSON contract precedes parallel UI/MCP work.
- Container/chart/deploy remain the closing sequence.
- Checkpoints occur at real import, real stats, rendered UI, agent query, and deployed system — all meaningful partial states.

Required ordering corrections:

1. Write all task acceptance criteria before Phase 1, not during Phase 3 (`plan.md:5-6`).
2. Define the typed `Finding` and stats semantics before implementing Tasks 7-8; do not leave domain meaning implicit until the REST DTO task.
3. Put local archive/post-import backup immediately after the ingest transaction can complete successfully, before relying on the real import as the canonical store.
4. In Task 8, explicitly wire deterministic stats/finding recomputation into the import completion path and add an integration assertion. Task 4 cannot have done this before stats existed.
5. Define import upload behavior with Task 9 before the Import page/API client work in Tasks 10-11.
6. Expand Phase 5 into the actual service → chart → cluster pin/validate/apply/rollout sequence.

## Risk-table assessment

| Risk | Assessment |
|---|---|
| 2.05M rows / <5 min | **Plausible mitigation, imperfect timing.** Prepared `bun:sqlite` statements and batched transactions are concrete, and real verification precedes UI. However, “measure first” occurs in Task 5 only after Task 4 builds the whole path. Add a small parser/insert benchmark during Task 4, an explicit fallback decision point, and memory/peak-disk observations. Also time stats recompute so “answerable in minutes” does not stop at XML insertion. |
| Night/day edge cases | **Real but incomplete mitigation.** Porting validated rules and unit tests is sound. Enumerate 14:59/15:00, 08:59/09:00, 21:00 HRV, cross-midnight stages, naps, offsets, dominant-source ties, missing stages, and multiple sources. Preserve the rules in tracked code/tests rather than depending on scratch. |
| SQLite on k3s | **Insufficient as written.** Single-writer and hostPath do not prove integrity, prevent rollout overlap, or establish recoverability. Add RWO/`Recreate`, import locking, integrity checks, restart/reimport verification, and restore testing. |
| harus-charts cross-repo work | **Reasonable start, incomplete mitigation.** A dedicated task and reading owning instructions are good. The actual ticket, synth/test, image-target, pin, drift, authorized apply, and two-repo evidence steps must also appear. |
| Missing risks | Add large-upload/ingress behavior, concurrent imports, unapproved SAX/ZIP dependencies, container-image personal-data leakage, failed/partial import recovery, and backup restore failure. |

## Minimum revision set before approval

1. Restore local post-import backup and imported-zip archival; add cluster retention/integrity/restore checks.
2. Move per-task acceptance ahead of Phase 1 and add the required fixture zip → DB → Briefing integration test.
3. Pin stats windows/edge cases, the typed `Finding` contract, and device-boundary detection with synthetic tests.
4. Specify the large zip upload/job/concurrency contract and resolve the 909 MB vs 66 MB deployment assumption.
5. Add `.dockerignore` and image/privacy verification for health data.
6. Restore cadence, Briefing evidence/import status, every-view as-of dates, and trust-label propagation.
7. Add non-`Record` presence logging, all device-event kinds, offset persistence, and dedup edge tests.
8. Split the oversized tasks identified above.
9. Turn Phase 5 into the owning ship-to-cluster sequence with concrete cross-repo gates.
10. Resolve SAX/ZIP runtime dependency approval before Task 4.

Once those changes are made, the existing phase structure and checkpoints are a strong base; no wholesale replan is needed.

## Review checks and skipped stages

- Read all requested files in the requested order, then applicable review/deployment instructions.
- `git -C vendor/midori diff --check HEAD` exited 0; `git status --porcelain=v1` was empty before this scratch report was written.
- `make context NAMES="midori"` and `make status NAMES="midori"` could not run because `mise` is unavailable (`mise: command not found`). Direct Git inspection and direct reads of the available project instruction files were used for this read-only review; this is **not** a claim that those Make gates passed.
- No tests or runtime acceptance journeys were run: the reviewed revision contains only the design/plan and no implementation to execute.
- No tracked files, remotes, issues, deployments, or shared task systems were modified. No subagents or delegation were used.
