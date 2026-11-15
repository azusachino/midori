import { apiClient } from "@/api/client";
import type { ImportDTO } from "@/api/types";
import { LoadingState } from "@/components/LoadingState";
import { ReadError } from "@/components/ReadError";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { copy } from "@/copy";
import { useAsyncQuery } from "@/lib/useAsyncQuery";

export function ImportPage() {
  const query = useAsyncQuery<ImportDTO[]>((signal) => apiClient.imports(signal), "imports");

  if (query.status === "loading") {
    return <LoadingState variant="rows" count={3} />;
  }

  if (query.status === "error") {
    return (
      <ReadError title={copy.error.importsTitle} message={query.error} onRetry={query.retry} />
    );
  }

  const rows = query.data;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{copy.pages.import.title}</h1>
        <p className="text-sm text-muted-foreground">{copy.pages.import.subtitle}</p>
        <p className="text-xs text-muted-foreground">{copy.pages.import.placeholderNote}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{copy.pages.import.historyTitle}</CardTitle>
          <CardDescription>
            {rows.length === 0 ? copy.pages.import.noImportsYet : `${rows.length} recorded`}
          </CardDescription>
        </CardHeader>
        {rows.length > 0 ? (
          <CardContent className="divide-y divide-border p-0">
            {rows.map((row) => (
              <div
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
              >
                <div className="min-w-0 space-y-0.5">
                  <p className="truncate font-medium text-foreground">{row.zipName}</p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {row.createdAt.slice(0, 10)}
                    {row.recordsInserted !== null
                      ? ` · ${row.recordsInserted.toLocaleString()} new`
                      : ""}
                    {row.recordsDeduped !== null
                      ? ` · ${row.recordsDeduped.toLocaleString()} known`
                      : ""}
                  </p>
                </div>
                <Badge variant={row.status === "failed" ? "alert" : "secondary"}>
                  {copy.status[row.status]}
                </Badge>
              </div>
            ))}
          </CardContent>
        ) : null}
      </Card>
    </div>
  );
}
