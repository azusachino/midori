import { copy } from "@/copy";
import { Card, CardContent, CardHeader } from "./ui/card";
import { Skeleton } from "./ui/skeleton";

export interface LoadingStateProps {
  variant?: "rows" | "cards" | "chart";
  count?: number;
}

const SKELETON_KEYS = ["s1", "s2", "s3", "s4", "s5", "s6"] as const;

/**
 * Skeleton loading primitive (ui-design §4 & §10). Never renders a full-page spinner.
 */
export function LoadingState({ variant = "rows", count = 5 }: LoadingStateProps) {
  const items = SKELETON_KEYS.slice(0, Math.min(count, SKELETON_KEYS.length));

  if (variant === "cards") {
    return (
      <div
        role="status"
        className="grid grid-cols-1 gap-4 md:grid-cols-3"
        aria-busy="true"
        aria-label={copy.loading.label}
        data-testid="loading-state"
      >
        {items.map((key) => (
          <Card key={key}>
            <CardHeader>
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-40" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-24 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (variant === "chart") {
    return (
      <div
        role="status"
        className="space-y-4"
        aria-busy="true"
        aria-label={copy.loading.label}
        data-testid="loading-state"
      >
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-72 w-full" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div
      role="status"
      className="space-y-2"
      aria-busy="true"
      aria-label={copy.loading.label}
      data-testid="loading-state"
    >
      {items.map((key) => (
        <div
          key={key}
          className="flex h-12 items-center justify-between gap-4 rounded-lg border border-border bg-card px-4"
        >
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="hidden h-4 w-20 md:block" />
          <Skeleton className="h-5 w-16" />
        </div>
      ))}
    </div>
  );
}
