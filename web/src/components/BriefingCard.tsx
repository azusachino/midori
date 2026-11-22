import { Link } from "@tanstack/react-router";
import { Bot, X } from "lucide-react";
import { useCallback, useState } from "react";
import { apiClient } from "@/api/client";
import type { BriefingDTO } from "@/api/types";
import { MetricIcon } from "@/components/MetricIcon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { copy } from "@/copy";
import { formatShortDay } from "@/lib/finding-format";
import { cn } from "@/lib/utils";

export interface BriefingCardProps {
  briefing: BriefingDTO;
  /** Called after a successful dismiss so the shell can refresh its changes read. */
  onDismissed?: () => void;
  className?: string;
}

/**
 * B-B1: the newest agent briefing on Changes. The card carries its author, its as-of
 * day, the nights and metrics it cites, and a dismiss control; wording stays neutral
 * (B-F9) because the agent's own summary is shown as written.
 */
export function BriefingCard({ briefing, onDismissed, className }: BriefingCardProps) {
  const [dismissing, setDismissing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dismiss = useCallback(async () => {
    if (dismissing) return;
    setDismissing(true);
    setError(null);
    try {
      await apiClient.deleteBriefing(briefing.id);
      onDismissed?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.briefing.dismissError);
      setDismissing(false);
    }
  }, [briefing.id, dismissing, onDismissed]);

  return (
    <section
      data-testid="briefing-card"
      aria-label={copy.briefing.cardAria(briefing.title, briefing.authorName)}
      className={cn(
        "midori-tile midori-glow-emerald px-5 py-4",
        "before:pointer-events-none before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:rounded-l-[14px] before:bg-accent/70 before:content-['']",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <Bot aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-accent" />
            <span className="midori-kicker">{copy.briefing.heading}</span>
            <span aria-hidden="true" className="hidden sm:inline">
              ·
            </span>
            <span className="tabular-nums">
              {copy.briefing.byAuthor(briefing.authorName, formatShortDay(briefing.asOfDay))}
            </span>
          </p>
          <h2 data-testid="briefing-title" className="text-base font-medium text-foreground">
            {briefing.title}
          </h2>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 px-2 text-xs text-muted-foreground hover:text-foreground"
          data-testid="briefing-dismiss-btn"
          aria-label={copy.briefing.dismissAria}
          disabled={dismissing}
          onClick={() => void dismiss()}
        >
          <X aria-hidden="true" className="h-3.5 w-3.5" />
          <span className="ml-1">
            {dismissing ? copy.briefing.dismissing : copy.briefing.dismiss}
          </span>
        </Button>
      </div>

      <p
        data-testid="briefing-summary"
        className="mt-2 whitespace-pre-line text-sm text-foreground/90"
      >
        {briefing.summary}
      </p>

      {briefing.citedMetrics.length > 0 ? (
        <ul
          data-testid="briefing-cited-metrics"
          aria-label={copy.briefing.citedMetricsLabel}
          className="mt-3 flex flex-wrap gap-1.5"
        >
          {briefing.citedMetrics.map((metric) => {
            const label = copy.metrics[metric] ?? metric;
            return (
              <li key={metric}>
                <Link
                  to="/metrics/$key"
                  params={{ key: metric }}
                  search={{ range: "90d", tab: "chart" }}
                  aria-label={copy.briefing.metricLinkAria(label)}
                  data-testid={`briefing-metric-${metric}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background/60 px-2.5 py-1 text-xs text-foreground no-underline hover:border-border-strong focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <MetricIcon metric={metric} size={12} className="text-muted-foreground" />
                  <span>{label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}

      {briefing.citedNights.length > 0 ? (
        <ul
          data-testid="briefing-cited-nights"
          aria-label={copy.briefing.citedNightsLabel}
          className="mt-2 flex flex-wrap gap-1.5"
        >
          {briefing.citedNights.map((day) => (
            <li key={day}>
              <Badge variant="secondary" className="tabular-nums">
                {formatShortDay(day)}
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}

      {error ? (
        <p data-testid="briefing-error" className="mt-2 text-xs text-alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
