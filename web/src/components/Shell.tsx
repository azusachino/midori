import { Link, useRouterState } from "@tanstack/react-router";
import { type ReactNode, useId } from "react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { copy } from "@/copy";
import { formatDayWithWeekday } from "@/lib/finding-format";
import { computeImportProgressPct } from "@/lib/import-helpers";
import { useShell } from "@/lib/shell-context";
import { epochColor } from "@/lib/theme";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { to: "/", label: copy.nav.changes, matchPrefix: false },
  { to: "/metrics", label: copy.nav.metrics, matchPrefix: true },
  { to: "/devices", label: copy.nav.devices, matchPrefix: false },
  { to: "/import", label: copy.nav.import, matchPrefix: false },
] as const;

function isRouteActive(pathname: string, to: string, matchPrefix: boolean): boolean {
  if (to === "/") return pathname === "/";
  if (matchPrefix) return pathname === to || pathname.startsWith(`${to}/`);
  return pathname === to;
}

export function Shell({ children }: { children: ReactNode }) {
  const mainId = useId();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { status, changes, build } = useShell();

  const activeImport = changes?.activeImport ?? null;
  const primaryWatch = changes?.primaryWatch ?? null;
  const freshness = changes?.freshness ?? null;

  let freshnessLabel: string | null = null;
  if (status === "ready" && changes) {
    if (!changes.hasImports || !freshness?.asOfDay || freshness.daysSinceImport === null) {
      freshnessLabel = copy.topbar.noImports;
    } else {
      freshnessLabel = copy.topbar.freshness(
        formatDayWithWeekday(freshness.asOfDay),
        freshness.daysSinceImport,
      );
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <a
        href={`#${mainId}`}
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:text-accent focus:border focus:border-accent"
      >
        {copy.app.skipToContent}
      </a>

      {/* Top bar (B-R1, B-I6): below 768px freshness moves to its own line */}
      <header className="border-b border-border bg-card/60">
        <div className="flex flex-col gap-2 px-4 py-3 md:flex-row md:items-center md:justify-between md:px-6">
          <div className="flex items-center justify-between gap-3">
            <Link
              to="/"
              className="inline-flex items-center gap-2 text-base font-semibold tracking-tight text-foreground no-underline hover:text-accent"
            >
              <span
                aria-hidden="true"
                className="inline-block h-2.5 w-2.5 rounded-full bg-accent"
              />
              <span>{copy.app.name}</span>
            </Link>

            {activeImport ? (
              <Link to="/import" className="no-underline">
                <Badge variant="learning" data-testid="importing-pill">
                  <span
                    aria-hidden="true"
                    className="inline-block h-1.5 w-1.5 rounded-full bg-learning"
                  />
                  {copy.topbar.importingPill(
                    activeImport.stage ?? activeImport.status,
                    computeImportProgressPct(activeImport.progress, activeImport.progressTotal),
                  )}
                </Badge>
              </Link>
            ) : null}
          </div>

          {freshnessLabel ? (
            <p
              className="text-xs text-muted-foreground tabular-nums"
              data-testid="topbar-freshness"
            >
              {freshnessLabel}
            </p>
          ) : null}

          {/* B-R5 mobile build badge; the desktop equivalent lives in the sidebar footer. */}
          {build ? (
            <p
              className="text-xs text-muted-foreground tabular-nums md:hidden"
              data-testid="mobile-version"
            >
              {copy.shell.version(build.version, build.revision)}
            </p>
          ) : null}
        </div>

        {/* Mobile top tab bar (<768px) */}
        <nav
          aria-label={copy.nav.label}
          className="flex items-center gap-1 overflow-x-auto border-t border-border px-4 py-2 md:hidden"
          data-testid="mobile-nav"
        >
          {NAV_ITEMS.map((item) => {
            const active = isRouteActive(pathname, item.to, item.matchPrefix);
            return (
              <Link
                key={item.to}
                to={item.to}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors no-underline",
                  active
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <div className="flex flex-1">
        {/* Desktop sidebar (>=768px) */}
        {/* The column stretches with the page; its content stays pinned at the top. */}
        <aside className="hidden md:block md:w-52 md:shrink-0 md:border-r md:border-border md:bg-card/30">
          <div className="md:sticky md:top-0 md:max-h-dvh md:overflow-y-auto md:p-4">
            <nav aria-label={copy.nav.label} className="space-y-1" data-testid="sidebar-nav">
              {NAV_ITEMS.map((item) => {
                const active = isRouteActive(pathname, item.to, item.matchPrefix);
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors no-underline",
                      active
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                    )}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>

            {primaryWatch ? (
              <div className="pt-6" data-testid="sidebar-watch">
                <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <span>{copy.sidebar.watchHeading}</span>
                  <Separator className="flex-1" />
                </div>
                <div className="rounded-md border border-border bg-card p-3 space-y-1">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <span
                      aria-hidden="true"
                      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: epochColor(primaryWatch.colorIndex) }}
                    />
                    <span className="truncate">{primaryWatch.label}</span>
                  </div>
                  {primaryWatch.warmingUp ? (
                    <p className="text-xs text-learning tabular-nums">
                      {copy.sidebar.learningProgress(
                        primaryWatch.warmingUp.current,
                        primaryWatch.warmingUp.target,
                      )}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}

            {/* B-R5 desktop build badge, below the watch card so nav geometry is untouched. */}
            {build ? (
              <p
                className="pt-6 text-xs text-muted-foreground tabular-nums"
                data-testid="sidebar-version"
              >
                {copy.shell.version(build.version, build.revision)}
              </p>
            ) : null}
          </div>
        </aside>

        {/* Page content: max-width 1200px, 24px gutters */}
        <main id={mainId} tabIndex={-1} className="min-w-0 flex-1 outline-none">
          <div className="mx-auto w-full max-w-[1200px] px-6 py-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
