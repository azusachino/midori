import type { FindingsDiffDTO, FindingsDiffItemDTO } from "../api/types";
import { copy } from "../copy";

/** Neutral, one-line rendering of a diff item (B-F9). */
export function formatDiffItem(item: FindingsDiffItemDTO): string {
  return copy.diff.item(
    copy.metrics[item.metric] ?? item.metric,
    copy.diff.classifications[item.classification] ?? item.classification,
  );
}

export function formatDiffItems(diff: FindingsDiffDTO): string[] {
  return diff.items.map(formatDiffItem);
}

export function formatDiffFooter(diff: FindingsDiffDTO): string | null {
  return diff.unchangedCount > 0 ? copy.diff.unchanged(diff.unchangedCount) : null;
}
