import { Link } from "@tanstack/react-router";
import { Upload } from "lucide-react";
import { copy } from "@/copy";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";

/**
 * Centered empty state shown on every page except Import when no data has been
 * imported yet (B-R4).
 */
export function EmptyState() {
  return (
    <div className="mx-auto flex min-h-[55vh] max-w-xl items-center justify-center py-8">
      <Card className="w-full" data-testid="empty-state">
        <CardHeader className="space-y-2 pb-4">
          <CardTitle className="text-xl">{copy.empty.title}</CardTitle>
          <CardDescription>{copy.empty.subtitle}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <ol className="space-y-3">
            {copy.empty.steps.map((item) => (
              <li
                key={item.step}
                className="flex items-start gap-3 rounded-md border border-border bg-background/60 p-3"
              >
                <span
                  aria-hidden="true"
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border-strong bg-muted text-xs font-semibold text-foreground tabular-nums"
                >
                  {item.step}
                </span>
                <div className="min-w-0 space-y-0.5">
                  <p className="text-sm font-medium text-foreground">{item.title}</p>
                  <p className="text-xs text-muted-foreground">{item.body}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className="flex justify-start">
            <Button asChild>
              <Link to="/import">
                <Upload aria-hidden="true" />
                {copy.empty.cta}
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
