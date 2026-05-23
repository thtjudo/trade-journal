import { cn } from "../../lib/utils";
import type { LucideIcon } from "lucide-react";

interface TrendBadge {
  direction: "up" | "down" | "flat";
  label: string;
}

export function StatCard({
  label,
  value,
  color,
  sub,
  trend,
  large,
}: {
  label: string;
  value: string;
  color?: string;
  sub?: string;
  trend?: TrendBadge;
  icon?: LucideIcon;
  large?: boolean;
}) {
  return (
    <div className={cn("metric-card", large && "min-h-[120px]")}>
      <p className="metric-label mb-3">
        {label}
      </p>
      <div className="flex items-baseline gap-2">
        <p
          className={cn(
            "numeric font-semibold leading-tight",
            large ? "text-[32px] sm:text-[40px]" : "text-[24px]",
            color || "text-primary"
          )}
        >
          {value}
        </p>
        {trend && (
          <span
            className={cn(
              "text-[10px] font-medium px-1.5 py-0.5 rounded-[4px] leading-none",
              trend.direction === "up" && "text-profit bg-profit-muted",
              trend.direction === "down" && "text-loss bg-loss-muted",
              trend.direction === "flat" && "text-tertiary bg-surface-2"
            )}
          >
            {trend.direction === "up" && "\u2191 "}
            {trend.direction === "down" && "\u2193 "}
            {trend.label}
          </span>
        )}
      </div>
      {sub && <p className="numeric text-[11px] text-tertiary mt-2 leading-tight">{sub}</p>}
    </div>
  );
}

export function SectionHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div>
      <p className="metric-label mb-1">{title}</p>
      {description && (
        <p className="text-[12px] text-zinc-500">{description}</p>
      )}
    </div>
  );
}
