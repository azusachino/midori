import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import type { MetricRange, MetricTab } from "@/api/types";
import { RootLayout } from "@/components/RootLayout";
import { ChangesPage } from "@/pages/Changes";
import { DevicesPage } from "@/pages/Devices";
import { ImportPage } from "@/pages/Import";
import { MetricDetailPage } from "@/pages/MetricDetail";
import { MetricsPage } from "@/pages/Metrics";
import { NotFoundPage } from "@/pages/NotFound";

export interface MetricDetailSearch {
  range: MetricRange;
  tab: MetricTab;
  night?: string | undefined;
}

const VALID_RANGES = new Set<MetricRange>(["90d", "180d", "1y", "all"]);
const VALID_TABS = new Set<MetricTab>(["chart", "long"]);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function validateMetricSearch(raw: Record<string, unknown>): MetricDetailSearch {
  const rawRange = raw.range;
  const range: MetricRange =
    typeof rawRange === "string" && VALID_RANGES.has(rawRange as MetricRange)
      ? (rawRange as MetricRange)
      : "180d";

  const rawTab = raw.tab;
  const tab: MetricTab =
    typeof rawTab === "string" && VALID_TABS.has(rawTab as MetricTab)
      ? (rawTab as MetricTab)
      : "chart";

  const rawNight = raw.night;
  const night = typeof rawNight === "string" && DAY_RE.test(rawNight) ? rawNight : undefined;

  return night === undefined ? { range, tab } : { range, tab, night };
}

const rootRoute = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFoundPage,
});

const changesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: ChangesPage,
});

const metricsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/metrics",
  component: MetricsPage,
});

const metricDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/metrics/$key",
  validateSearch: validateMetricSearch,
  component: MetricDetailPage,
});

const devicesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/devices",
  component: DevicesPage,
});

const importRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/import",
  component: ImportPage,
});

const routeTree = rootRoute.addChildren([
  changesRoute,
  metricsRoute,
  metricDetailRoute,
  devicesRoute,
  importRoute,
]);

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
