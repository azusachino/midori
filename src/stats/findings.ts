import type { Database } from "bun:sqlite";
import { addDays } from "../domain/dates";
import { METRICS } from "../domain/metrics";
import { detectBoundaries } from "../domain/stats";
import type { CoverageBoundary, EvidenceRef, Finding, SourceSpan } from "../domain/types";
import { computeDeviations, type DeviationRow } from "./baselines";
import { metricAnchor, metricSpans } from "./events";

/**
 * Findings (T12): the persisted anomaly/event ledger, recomputed wholesale on
 * every import (pure cache, same lifecycle as daily_metrics).
 *
 * Three kinds:
 *  - deviation: unsuppressed analysis row with severity notable/alert
 *  - recalibration: a switch seam inside a source's analysis window — the
 *    wrist-temp lesson; cross-device offsets masquerade as physiology
 *  - coverage: series_start (new source inside window) and gaps
 *
 * Seam suppression: a DeviationRow whose window [anchor−90, anchor] contains a
 * boundary that involves its source (either side of the seam) does not get a
 * plain z: switch → suppressed=cross_source, gap → coverage_gap. The boundary
 * itself becomes the finding. Seams take precedence over gate starvation.
 */

export interface FindingsResult {
  findings: Finding[];
  counts: { deviation: number; recalibration: number; coverage: number };
  /** Rows after seam suppression (for API dev: /api/deviations uses this). */
  rows: DeviationRow[];
}

function boundaryInvolves(b: CoverageBoundary, sourceName: string): boolean {
  return b.sourceName === sourceName || b.counterpartSource === sourceName;
}

/** Apply seam suppression to deviation rows using per-metric boundaries. */
function applySeamSuppression(
  rows: DeviationRow[],
  boundariesByMetric: Map<string, CoverageBoundary[]>,
): DeviationRow[] {
  return rows.map((row) => {
    const boundaries = boundariesByMetric.get(row.metric) ?? [];
    const windowStart = addDays(row.asOfDay, -90);
    for (const b of boundaries) {
      if (b.boundaryDay < windowStart || b.boundaryDay > row.asOfDay) continue;
      if (!boundaryInvolves(b, row.sourceName)) continue;
      if (b.kind === "switch") {
        return { ...row, z: null, severity: "info", suppressed: "cross_source" };
      }
      if (b.kind === "gap") {
        return { ...row, z: null, severity: "info", suppressed: "coverage_gap" };
      }
      // series_start for the row's own source means its baseline is young;
      // leave to the insufficient_data gate (already handled by robustZ).
    }
    return row;
  });
}

function boundaryFindings(boundariesByMetric: Map<string, CoverageBoundary[]>): Finding[] {
  const out: Finding[] = [];
  for (const [metric, boundaries] of boundariesByMetric) {
    for (const b of boundaries) {
      if (b.kind === "series_start") {
        out.push({
          kind: "coverage",
          metric,
          sourceName: b.sourceName,
          anchorDay: b.boundaryDay,
          windowDays: 14,
          baseline: null,
          recent: null,
          unit: METRICS[metric]?.unit ?? null,
          z: null,
          severity: "info",
          evidence: [
            {
              kind: "source_span",
              metric,
              sourceName: b.sourceName,
              fromDay: b.boundaryDay,
              detail: "series started inside the analysis window",
            },
          ],
        });
      } else if (b.kind === "switch") {
        out.push({
          kind: "recalibration",
          metric,
          sourceName: b.sourceName,
          anchorDay: b.boundaryDay,
          windowDays: 14,
          baseline: null,
          recent: null,
          unit: METRICS[metric]?.unit ?? null,
          z: null,
          severity: "info",
          evidence: [
            {
              kind: "source_span",
              metric,
              sourceName: b.sourceName,
              fromDay: b.boundaryDay,
              detail: `took over from ${b.counterpartSource ?? "another source"}; cross-device offsets reset`,
            },
          ],
        });
      } else {
        out.push({
          kind: "coverage",
          metric,
          sourceName: b.sourceName,
          anchorDay: b.boundaryDay,
          windowDays: 14,
          baseline: null,
          recent: null,
          unit: METRICS[metric]?.unit ?? null,
          z: null,
          severity: "info",
          evidence: [
            {
              kind: "source_span",
              metric,
              sourceName: b.sourceName,
              fromDay: b.boundaryDay,
              detail: `${b.gapDays ?? "?"}-day gap after ${b.counterpartSource ?? "previous source"}`,
            },
          ],
        });
      }
    }
  }
  return out;
}

export function computeFindings(db: Database): FindingsResult {
  const deviationResult = computeDeviations(db);
  const rows = deviationResult.rows;

  const boundariesByMetric = new Map<string, CoverageBoundary[]>();
  for (const spec of Object.values(METRICS)) {
    const spans: SourceSpan[] = metricSpans(db, spec.key);
    if (spans.length === 0) continue;
    const anchor = metricAnchor(db, spec.key);
    if (!anchor) continue;
    const boundaries = detectBoundaries(spec.key, spans, anchor);
    if (boundaries.length > 0) boundariesByMetric.set(spec.key, boundaries);
  }

  const suppressedRows = applySeamSuppression(rows, boundariesByMetric);

  const deviationFindings: Finding[] = suppressedRows
    .filter((r) => r.suppressed === null && r.severity !== "info")
    .map((r) => ({
      kind: "deviation" as const,
      metric: r.metric,
      sourceName: r.sourceName,
      anchorDay: r.asOfDay,
      windowDays: 14,
      baseline: r.baseline,
      recent: r.recent,
      unit: r.unit,
      z: r.z,
      severity: r.severity,
      evidence: [
        {
          kind: "metric_day" as const,
          metric: r.metric,
          sourceName: r.sourceName,
          fromDay: addDays(r.asOfDay, -90),
          toDay: addDays(r.asOfDay, -29),
          detail: `baseline n=${r.nBaseline}`,
        },
        {
          kind: "metric_day" as const,
          metric: r.metric,
          sourceName: r.sourceName,
          fromDay: addDays(r.asOfDay, -13),
          toDay: r.asOfDay,
          detail: `recent n=${r.nRecent}`,
        },
      ] satisfies EvidenceRef[],
    }));

  const seamFindings = boundaryFindings(boundariesByMetric);
  const findings = [...deviationFindings, ...seamFindings];
  const counts = {
    deviation: deviationFindings.length,
    recalibration: seamFindings.filter((f) => f.kind === "recalibration").length,
    coverage: seamFindings.filter((f) => f.kind === "coverage").length,
  };
  return { findings, counts, rows: suppressedRows };
}

/** Wholesale recompute: findings are a cache, wiped and rebuilt per import. */
export function recomputeFindings(db: Database, importId: number): FindingsResult {
  const result = computeFindings(db);
  const nowIso = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO findings
       (import_id, anchor_day, kind, metric, source_name, window_days,
        baseline, recent, unit, z, severity, evidence, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM findings");
    for (const f of result.findings) {
      insert.run(
        importId,
        f.anchorDay,
        f.kind,
        f.metric,
        f.sourceName,
        f.windowDays,
        f.baseline,
        f.recent,
        f.unit,
        f.z,
        f.severity,
        JSON.stringify(f.evidence),
        nowIso,
      );
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return result;
}
