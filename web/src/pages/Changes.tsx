import { Link } from "@tanstack/react-router";
import { useId } from "react";
import { EmptyState } from "@/components/EmptyState";
import { LoadingState } from "@/components/LoadingState";
import { ReadError } from "@/components/ReadError";
import { Badge } from "@/components/ui/badge";
import { copy } from "@/copy";
import { useShell } from "@/lib/shell-context";

export function ChangesPage() {
  const headingId = useId();
  const { status, changes, errorMessage, refresh } = useShell();

  if (status === "loading") {
    return <LoadingState variant="rows" count={6} />;
  }

  if (status === "error") {
    return (
      <ReadError
        title={copy.error.changesTitle}
        message={errorMessage ?? copy.api.unknownError}
        onRetry={refresh}
      />
    );
  }

  if (!changes?.hasImports) {
    return <EmptyState />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{copy.pages.changes.title}</h1>
        {changes.asOfDay ? (
          <p className="text-xs text-muted-foreground tabular-nums">
            {copy.pages.changes.asOf(changes.asOfDay)}
          </p>
        ) : null}
      </div>

      <p className="text-sm text-muted-foreground">{copy.pages.changes.placeholderNote}</p>

      <section aria-labelledby={headingId} className="space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 id={headingId} className="text-sm font-medium text-foreground">
            {copy.pages.changes.overnightTitle}
          </h2>
          <span className="text-xs text-muted-foreground">{copy.pages.changes.rankedHint}</span>
        </div>
        <div className="divide-y divide-border rounded-lg border border-border bg-card">
          {changes.overnight.map((row) => (
            <Link
              key={row.metric}
              to="/metrics/$key"
              params={{ key: row.metric }}
              search={{ range: "90d", tab: "chart" }}
              className="flex items-center justify-between gap-4 px-4 py-3 text-sm no-underline hover:bg-muted/40 transition-colors"
            >
              <span className="font-medium text-foreground">
                {copy.metrics[row.metric] ?? row.metric}
              </span>
              <div className="flex items-center gap-2">
                {row.warmup ? (
                  <Badge variant="learning" className="tabular-nums">
                    {copy.sidebar.learningProgress(row.warmup.current, row.warmup.target)}
                  </Badge>
                ) : (
                  <Badge variant="secondary">{row.state}</Badge>
                )}
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
