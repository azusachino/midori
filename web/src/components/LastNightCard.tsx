import { Moon } from "lucide-react";
import type { LastNightDTO } from "@/api/types";
import { SleepStageBar } from "@/components/SleepStageBar";
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

          <SleepStageBar
            deepH={lastNight.deepH}
            remH={lastNight.remH}
            coreH={lastNight.coreH}
            className="sm:w-48"
          />
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
