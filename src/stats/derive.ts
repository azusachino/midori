import type { Database } from "bun:sqlite";
import { rebuildBaselines } from "./baselines";
import { captureFindingSnapshot } from "./diff";
import { type FindingRowDTO, rebuildFindings } from "./findings";
import { rebuildNightPipeline } from "./nights";
import { rebuildSeamSteps } from "./seams";
import { rebuildMetricValues } from "./values";

export type DeriveStage =
  | "epochs_presence_stints_nights_values"
  | "baselines"
  | "seams"
  | "findings";

export interface DeriveOptions {
  /** Import that produced this derived snapshot; when set, its finding snapshot is written. */
  importId?: number;
  /** Test seam for proving rollback when any post-stage work fails. */
  afterStage?: (stage: DeriveStage) => void;
}

export interface DeriveResult {
  asOfDay: string | null;
  findings: FindingRowDTO[];
  nights: number;
  metricValuesChanged: number;
}

/** Rebuild all derived tables as one atomic transaction. */
export function derive(db: Database, options: DeriveOptions = {}): DeriveResult {
  db.exec("BEGIN IMMEDIATE");
  try {
    // Clear referencing rows inside the transaction before epochs are rebuilt.
    db.exec(
      "DELETE FROM findings; DELETE FROM seam_steps; DELETE FROM metric_values; DELETE FROM nights; DELETE FROM stints;",
    );
    const nights = rebuildNightPipeline(db);
    const metricValuesChanged = rebuildMetricValues(db);
    options.afterStage?.("epochs_presence_stints_nights_values");
    const baselines = rebuildBaselines(db);
    options.afterStage?.("baselines");
    rebuildSeamSteps(db, () => true);
    options.afterStage?.("seams");
    const findings = rebuildFindings(db, baselines);
    // B-I13: snapshot this import's findings inside the same transaction. Rollbacks and
    // failed imports therefore leave no snapshot rows behind.
    if (options.importId !== undefined) captureFindingSnapshot(db, options.importId);
    options.afterStage?.("findings");
    db.exec("COMMIT");
    const asOfDay = (
      db
        .query(
          "SELECT MAX(unit_day) AS day FROM metric_values WHERE metric = 'sleep_h' AND usable = 1",
        )
        .get() as { day: string | null }
    ).day;
    return { asOfDay, findings, nights: nights.length, metricValuesChanged };
  } catch (error) {
    if (db.inTransaction) db.exec("ROLLBACK");
    throw error;
  }
}
