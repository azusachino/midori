import { copy } from "@/copy";
import { cn } from "@/lib/utils";

export interface SleepStageBarProps {
  deepH: number;
  remH: number;
  coreH: number;
  className?: string;
}

/** Proportional horizontal sleep stage bar (deep/REM/core) with visible legend (ui-design §11). */
export function SleepStageBar({ deepH, remH, coreH, className }: SleepStageBarProps) {
  const deep = deepH.toFixed(1);
  const rem = remH.toFixed(1);
  const core = coreH.toFixed(1);

  const stageTotal = Math.max(0.01, deepH + remH + coreH);
  const deepPct = (deepH / stageTotal) * 100;
  const remPct = (remH / stageTotal) * 100;
  const corePct = (coreH / stageTotal) * 100;

  return (
    <div className={cn("flex w-full flex-col gap-1.5", className)}>
      <div
        role="img"
        aria-label={copy.pages.changes.lastNight.stageBarAria(deep, rem, core)}
        data-testid="sleep-stage-bar"
        className="flex h-3 w-full overflow-hidden rounded-full bg-muted shadow-[0_0_18px_-6px_var(--color-accent)]"
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
      <div
        data-testid="sleep-stage-legend"
        className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground"
      >
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-epoch-2" />
          <span>{copy.pages.changes.lastNight.stageLegend.deep}</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-learning" />
          <span>{copy.pages.changes.lastNight.stageLegend.rem}</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-muted-foreground/45" />
          <span>{copy.pages.changes.lastNight.stageLegend.core}</span>
        </span>
      </div>
    </div>
  );
}
