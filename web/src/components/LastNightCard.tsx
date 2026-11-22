import { Moon } from "lucide-react";
import type { LastNightDTO } from "@/api/types";
import { SleepStageBar } from "@/components/SleepStageBar";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { copy } from "@/copy";
import { formatDayWithWeekday, formatShortDay } from "@/lib/finding-format";

export interface LastNightCardProps {
  lastNight: LastNightDTO | null;
}

export function LastNightCard({ lastNight }: LastNightCardProps) {
  if (!lastNight) {
    return (
      <Card data-testid="last-night-card" className="flex h-full flex-col">
        <CardHeader className="pb-2">
          <h3 className="midori-kicker flex items-center gap-2">
            <Moon aria-hidden="true" className="h-3.5 w-3.5" />
            <span>{copy.pages.changes.lastNight.emptyTitle}</span>
          </h3>
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
    <Card data-testid="last-night-card" className="flex h-full flex-col">
      <CardHeader className="pb-2">
        {/* The kicker is uppercased by CSS; the DOM text keeps the e2e copy (H1). */}
        <h3 className="midori-kicker flex items-center gap-2">
          <Moon aria-hidden="true" className="h-3.5 w-3.5" />
          <span className="tabular-nums">
            {copy.pages.changes.lastNight.title(formatDayWithWeekday(lastNight.date))}
          </span>
        </h3>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3.5">
        <p className="flex flex-wrap items-baseline gap-x-1.5">
          <span className="text-3xl leading-none font-semibold tracking-tight text-foreground tabular-nums">
            {asleep}
          </span>
          <span className="text-sm font-medium text-muted-foreground">h</span>
        </p>

        <p className="text-xs text-foreground/85 tabular-nums">
          {copy.pages.changes.lastNight.breakdown(asleep, deep, rem, core)}
        </p>

        <SleepStageBar
          deepH={lastNight.deepH}
          remH={lastNight.remH}
          coreH={lastNight.coreH}
          className="mt-auto"
        />

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
