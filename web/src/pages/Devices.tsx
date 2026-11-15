import { apiClient } from "@/api/client";
import type { EpochsDTO } from "@/api/types";
import { EmptyState } from "@/components/EmptyState";
import { LoadingState } from "@/components/LoadingState";
import { ReadError } from "@/components/ReadError";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { copy } from "@/copy";
import { epochColor } from "@/lib/theme";
import { useAsyncQuery } from "@/lib/useAsyncQuery";

export function DevicesPage() {
  const query = useAsyncQuery<EpochsDTO>((signal) => apiClient.epochs(signal), "devices");

  if (query.status === "loading") {
    return <LoadingState variant="cards" count={3} />;
  }

  if (query.status === "error") {
    return (
      <ReadError title={copy.error.devicesTitle} message={query.error} onRetry={query.retry} />
    );
  }

  if (!query.data.hasImports) {
    return <EmptyState />;
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{copy.pages.devices.title}</h1>
        <p className="text-sm text-muted-foreground">{copy.pages.devices.subtitle}</p>
        <p className="text-xs text-muted-foreground">{copy.pages.devices.placeholderNote}</p>
      </div>

      <div className="space-y-3">
        {query.data.epochs.map((epoch, idx) => (
          <Card key={epoch.id}>
            <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
              <div className="flex items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{
                    backgroundColor: epoch.minor ? undefined : epochColor(epoch.colorIndex ?? idx),
                  }}
                />
                <div>
                  <CardTitle className="text-base">{epoch.label}</CardTitle>
                  <CardDescription className="tabular-nums">
                    {epoch.deviceHw || epoch.kind} · {epoch.firstDay} – {epoch.lastDay} ·{" "}
                    {epoch.daysPresentCount} days
                  </CardDescription>
                </div>
              </div>
              {epoch.primaryMetricCount > 0 ? (
                <Badge variant="accent">
                  {copy.pages.devices.primaryFor(epoch.primaryMetricCount)}
                </Badge>
              ) : null}
            </CardHeader>
            {epoch.metrics.length > 0 ? (
              <CardContent className="text-xs text-muted-foreground">
                {epoch.metrics.map((m) => copy.metrics[m.metric] ?? m.metric).join(", ")}
              </CardContent>
            ) : null}
          </Card>
        ))}
      </div>
    </div>
  );
}
