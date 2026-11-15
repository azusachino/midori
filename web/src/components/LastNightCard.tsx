import { Moon } from "lucide-react";
import type { LastNightDTO } from "@/api/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { copy } from "@/copy";
import { formatDayWithWeekday, formatShortDay } from "@/lib/finding-format";

export interface LastNightCardProps {
  lastNight: LastNightDTO | null;
}

export function LastNightCard({ lastNight }: LastNightCardProps) {
  if (!lastNight) {
    return (
      <Card data-testid="last-night-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Moon aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
            <span>{copy.pages.changes.lastNight.emptyTitle}</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{copy.pages.changes.lastNight.noneRecent}</p>
        </CardContent>
      </Card>
    );
  }

  const asleep = lastNight.asleepH.toFixed(1);
  const deep = lastNight.deepH.toFixed(1);
  const rem = lastNight.remH.toFixed(1);
  const core = lastNight.coreH.toFixed(1);

  const stageTotal = Math.max(0.01, lastNight.deepH + lastNight.remH + lastNight.coreH);
  const deepPct = (lastNight.deepH / stageTotal) * 100;
  const remPct = (lastNight.remH / stageTotal) * 100;
  const corePct = (lastNight.coreH / stageTotal) * 100;

  return (
    <Card data-testid="last-night-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Moon aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
          <span className="tabular-nums">
            {copy.pages.changes.lastNight.title(formatDayWithWeekday(lastNight.date))}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-foreground tabular-nums">
            {copy.pages.changes.lastNight.breakdown(asleep, deep, rem, core)}
          </p>

          <div
            role="img"
            aria-label={copy.pages.changes.lastNight.stageBarAria(deep, rem, core)}
            data-testid="sleep-stage-bar"
            className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted sm:w-48"
          >
            {deepPct > 0 ? (
              <div style={{ width: `${deepPct.toFixed(1)}%` }} className="h-full bg-epoch-2" />
            ) : null}
            {remPct > 0 ? (
              <div style={{ width: `${remPct.toFixed(1)}%` }} className="h-full bg-learning" />
            ) : null}
            {corePct > 0 ? (
              <div
                style={{ width: `${corePct.toFixed(1)}%` }}
                className="h-full bg-muted-foreground/45"
              />
            ) : null}
          </div>
        </div>

        {lastNight.skippedPartialDay && lastNight.skippedPartialReason === "export_cut" ? (
          <p
            data-testid="last-night-skipped"
            className="text-xs text-muted-foreground tabular-nums"
          >
            {copy.pages.changes.lastNight.skippedExportCut(
              formatShortDay(lastNight.skippedPartialDay),
            )}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
