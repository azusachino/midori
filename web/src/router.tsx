import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
} from "@tanstack/react-router";
import type { MetricRange, MetricTab } from "@/api/types";
import { RootLayout } from "@/components/RootLayout";
import { RouteFallback } from "@/components/RouteFallback";
import { ChangesPage } from "@/pages/Changes";
import { NotFoundPage } from "@/pages/NotFound";

export interface MetricDetailSearch {
  range: MetricRange;
  tab: MetricTab;
  night?: string | undefined;
  zoomStart?: string | undefined;
  zoomEnd?: string | undefined;
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

  const rawZoomStart = raw.zoomStart;
  const zoomStart =
    typeof rawZoomStart === "string" && DAY_RE.test(rawZoomStart) ? rawZoomStart : undefined;

  const rawZoomEnd = raw.zoomEnd;
  const zoomEnd =
    typeof rawZoomEnd === "string" && DAY_RE.test(rawZoomEnd) ? rawZoomEnd : undefined;

  const result: MetricDetailSearch = { range, tab };
  if (night !== undefined) result.night = night;
  if (zoomStart !== undefined && zoomEnd !== undefined) {
    result.zoomStart = zoomStart;
    result.zoomEnd = zoomEnd;
  }
  return result;
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
  component: lazyRouteComponent(() => import("@/pages/Metrics"), "MetricsPage"),
  pendingComponent: RouteFallback,
});

const metricDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/metrics/$key",
  validateSearch: validateMetricSearch,
  component: lazyRouteComponent(() => import("@/pages/MetricDetail"), "MetricDetailPage"),
  pendingComponent: RouteFallback,
});

const devicesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/devices",
  component: lazyRouteComponent(() => import("@/pages/Devices"), "DevicesPage"),
  pendingComponent: RouteFallback,
});

const importRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/import",
  component: lazyRouteComponent(() => import("@/pages/Import"), "ImportPage"),
  pendingComponent: RouteFallback,
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
