import { Link } from "@tanstack/react-router";
import { apiClient } from "@/api/client";
import type { MetricKind, MetricsIndexDTO } from "@/api/types";
import { EmptyState } from "@/components/EmptyState";
import { LoadingState } from "@/components/LoadingState";
import { ReadError } from "@/components/ReadError";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { copy } from "@/copy";
import { useAsyncQuery } from "@/lib/useAsyncQuery";

const KIND_GROUPS: readonly MetricKind[] = ["overnight", "daytime", "trendOnly"];

export function MetricsPage() {
  const query = useAsyncQuery<MetricsIndexDTO>(
    (signal) => apiClient.metricsIndex(signal),
    "metrics",
  );

  if (query.status === "loading") {
    return <LoadingState variant="cards" count={6} />;
  }

  if (query.status === "error") {
    return (
      <ReadError title={copy.error.metricsTitle} message={query.error} onRetry={query.retry} />
    );
  }

  if (!query.data.hasImports) {
    return <EmptyState />;
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{copy.pages.metrics.title}</h1>
        <p className="text-sm text-muted-foreground">{copy.pages.metrics.subtitle}</p>
        <p className="text-xs text-muted-foreground">{copy.pages.metrics.placeholderNote}</p>
      </div>

      {KIND_GROUPS.map((kind) => {
        const items = query.data.metrics.filter((m) => m.kind === kind);
        if (items.length === 0) return null;
        return (
          <section key={kind} className="space-y-3">
            <h2 className="text-sm font-medium text-muted-foreground">
              {copy.pages.metrics.groups[kind]}
            </h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {items.map((item) => (
                <Link
                  key={item.metric}
                  to="/metrics/$key"
                  params={{ key: item.metric }}
                  search={{ range: "180d", tab: "chart" }}
                  className="block no-underline"
                >
                  <Card className="h-full transition-colors hover:border-border-strong">
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between gap-2">
                        <CardTitle className="text-sm">
                          {copy.metrics[item.metric] ?? item.metric}
                        </CardTitle>
                        <Badge variant="secondary">{copy.trust[item.trust]}</Badge>
                      </div>
                      <CardDescription className="text-xs">
                        {item.unit ? item.unit : "unit"}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {item.hasData ? `${item.weeklySeries.length} weekly points` : "No data yet"}
                      </p>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
