import {
  Activity,
  Droplets,
  Flame,
  Footprints,
  Gauge,
  HeartPulse,
  type LucideIcon,
  Moon,
  MoonStar,
  Sparkles,
  Thermometer,
  TrendingUp,
  Waves,
  Wind,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Per-metric glyph for Changes rows, metric cards and metric detail headers. Named
 * imports keep the icon module tree-shaken (§10). Icons are decorative: the metric
 * label always sits beside them.
 */
const METRIC_ICONS: Record<string, LucideIcon> = {
  sleep_h: Moon,
  deep_h: MoonStar,
  rem_h: Sparkles,
  sleep_hr: HeartPulse,
  hrv_sdnn: Waves,
  hrv_rmssd: Waves,
  rhr: Gauge,
  resp_rate: Wind,
  wrist_temp: Thermometer,
  spo2: Droplets,
  steps: Footprints,
  active_kj: Flame,
  heart_rate: Activity,
  vo2max: TrendingUp,
};

export function MetricIcon({
  metric,
  size = 14,
  className,
}: {
  metric: string;
  size?: number;
  className?: string;
}) {
  const Icon = METRIC_ICONS[metric] ?? Activity;
  return (
    <Icon
      aria-hidden="true"
      focusable="false"
      size={size}
      strokeWidth={1.75}
      data-testid={`metric-icon-${metric}`}
      className={cn("shrink-0", className)}
    />
  );
}
