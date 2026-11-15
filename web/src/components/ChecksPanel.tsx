import { Link } from "@tanstack/react-router";
import { Check, Flag } from "lucide-react";
import { type MouseEvent, useCallback, useMemo } from "react";
import type { MetricSeriesDTO } from "@/api/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { copy } from "@/copy";
import { resolveChecks } from "@/lib/evidence";
import { formatShortDay } from "@/lib/finding-format";

export interface ChecksPanelProps {
  series: MetricSeriesDTO;
  onSelectDay?: (day: string, trigger?: HTMLElement) => void;
}

/** Confounder checks panel (B-C1–B-C6) rendered beside Recent nights on MetricDetail. */
export function ChecksPanel({ series, onSelectDay }: ChecksPanelProps) {
  const checks = useMemo(() => resolveChecks(series), [series]);

  const handleDayClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      if (!onSelectDay) return;
      const day = event.currentTarget.dataset.day;
      if (day) onSelectDay(day, event.currentTarget);
    },
    [onSelectDay],
  );

  return (
    <Card data-testid="checks-panel" className="min-w-0 overflow-hidden">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">{copy.pages.metricDetail.checksTitle}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <ul className="divide-y divide-border text-sm">
          {checks.map((item) => (
            <li
              key={item.key}
              data-testid={`check-row-${item.key}`}
              data-status={item.flagged ? "flagged" : "clear"}
              className="flex items-start justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
            >
              <div className="flex min-w-0 items-start gap-2">
                {item.flagged ? (
                  <Flag aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-notable" />
                ) : (
                  <Check
                    aria-hidden="true"
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground"
                  />
                )}
                <span className="sr-only">
                  {item.flagged
                    ? copy.pages.metricDetail.checkStatusFlagged
                    : copy.pages.metricDetail.checkStatusClear}
                  {": "}
                </span>
                <span className={item.flagged ? "text-foreground" : "text-muted-foreground"}>
                  {item.label}
                </span>
              </div>

              {item.day && onSelectDay ? (
                <button
                  type="button"
                  data-day={item.day}
                  data-testid={`check-day-link-${item.key}`}
                  onClick={handleDayClick}
                  className="shrink-0 text-xs text-primary underline-offset-4 hover:underline cursor-pointer"
                >
                  {copy.pages.metricDetail.checksInspectUnit(formatShortDay(item.day))}
                </button>
              ) : item.linkToDevices ? (
                <Link
                  to="/devices"
                  data-testid={`check-devices-link-${item.key}`}
                  className="shrink-0 text-xs text-primary underline-offset-4 hover:underline"
                >
                  {copy.pages.metricDetail.checksDevicesLink}
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
