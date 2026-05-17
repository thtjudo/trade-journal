import { useState, useMemo } from "react";
import { BarChart3 } from "lucide-react";
import { cn } from "../lib/utils";
import type { Trade, CatalystType } from "../types/trade";
import { calcPnl } from "../lib/calc";
import DashboardFilters, {
  FilterSummary,
  QuickDatePills,
  useDashboardFilters,
  applyFilters,
} from "./dashboard/DashboardFilters";
import TimeOfDayAnalysis from "./analytics/TimeOfDayAnalysis";
import HoldTimeAnalysis from "./analytics/HoldTimeAnalysis";
import TiltDetection from "./analytics/TiltDetection";
import { useAllTrades } from "../hooks/useTrades";

/* -- Date range label ------------------------------------------- */

function describeRange(from: string, to: string): string {
  if (!from && !to) return "all time";
  if (!from || !to) return "this period";
  const fromDate = new Date(from + "T00:00:00");
  const toDate = new Date(to + "T00:00:00");
  const days = Math.round(
    (toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (days <= 8) return "7 days";
  if (days <= 31) return "30 days";
  if (days <= 62) return "60 days";
  if (days <= 92) return "90 days";
  if (days <= 366) return "year";
  return "this period";
}

/* -- Tab Navigation --------------------------------------------- */

const TABS = [
  { key: "timing", label: "Timing" },
  { key: "edge", label: "Edge" },
  { key: "behavior", label: "Behavior" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function TabBar({
  active,
  onChange,
}: {
  active: TabKey;
  onChange: (tab: TabKey) => void;
}) {
  return (
    <div className="flex gap-1 p-0.5 rounded-lg bg-white/[0.03] border border-white/[0.04] w-fit">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={cn(
            "px-4 py-1.5 rounded-md text-[13px] font-medium transition-all duration-150",
            active === tab.key
              ? "bg-white/[0.08] text-white shadow-sm"
              : "text-zinc-500 hover:text-zinc-300"
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/* -- Catalyst Performance --------------------------------------- */

const CATALYST_LABELS: Record<CatalystType, string> = {
  earnings: "Earnings",
  news_pr: "News / PR",
  fda: "FDA",
  sec_filing: "SEC Filing",
  short_squeeze: "Short Squeeze",
  sympathy: "Sympathy",
  technical: "Technical",
  other: "Other",
};

interface CatalystStats {
  type: string;
  count: number;
  winRate: number;
  avgPnl: number;
  totalPnl: number;
}

function buildCatalystStats(trades: Trade[]): CatalystStats[] {
  const byType = new Map<string, Trade[]>();
  for (const t of trades) {
    if (!t.catalyst_type) continue;
    const existing = byType.get(t.catalyst_type) || [];
    existing.push(t);
    byType.set(t.catalyst_type, existing);
  }

  const stats: CatalystStats[] = [];
  for (const [type, typeTrades] of byType) {
    const pnls = typeTrades.map(calcPnl);
    const totalPnl = pnls.reduce((a, b) => a + b, 0);
    const wins = pnls.filter((p) => p > 0).length;
    stats.push({
      type,
      count: typeTrades.length,
      winRate: (wins / typeTrades.length) * 100,
      avgPnl: totalPnl / typeTrades.length,
      totalPnl,
    });
  }

  stats.sort((a, b) => b.count - a.count);
  return stats;
}

function CatalystPerformance({ trades }: { trades: Trade[] }) {
  const stats = useMemo(() => buildCatalystStats(trades), [trades]);

  if (stats.length === 0) {
    return (
      <p className="text-[13px] text-tertiary">
        No trades with catalyst data yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px] text-left">
        <thead>
          <tr className="border-b border-border">
            <th className="pb-2.5 text-[13px] font-medium text-secondary">
              Catalyst
            </th>
            <th className="pb-2.5 text-[13px] font-medium text-secondary">
              Trades
            </th>
            <th className="pb-2.5 text-[13px] font-medium text-secondary">
              Win Rate
            </th>
            <th className="pb-2.5 text-[13px] font-medium text-secondary text-right">
              Avg Profit / Loss
            </th>
            <th className="pb-2.5 text-[13px] font-medium text-secondary text-right">
              Total Profit / Loss
            </th>
          </tr>
        </thead>
        <tbody>
          {stats.map((s) => (
            <tr key={s.type} className="border-t border-border">
              <td className="py-2.5">
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-brand-muted text-brand border border-brand/20">
                  {CATALYST_LABELS[s.type as CatalystType] ?? s.type}
                </span>
              </td>
              <td className="py-2.5 text-secondary text-xs">{s.count}</td>
              <td
                className={cn(
                  "py-2.5 text-xs font-medium font-mono",
                  s.winRate >= 50 ? "text-profit" : "text-loss",
                )}
              >
                {s.winRate.toFixed(0)}%
              </td>
              <td
                className={cn(
                  "py-2.5 text-right text-xs font-medium font-mono",
                  s.avgPnl >= 0 ? "text-profit" : "text-loss",
                )}
              >
                {s.avgPnl >= 0 ? "+" : ""}${s.avgPnl.toFixed(2)}
              </td>
              <td
                className={cn(
                  "py-2.5 text-right text-xs font-medium font-mono",
                  s.totalPnl >= 0 ? "text-profit" : "text-loss",
                )}
              >
                {s.totalPnl >= 0 ? "+" : ""}${s.totalPnl.toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* -- Float Size Performance ------------------------------------- */

interface FloatBucket {
  label: string;
  min: number;
  max: number;
}

const FLOAT_BUCKETS: FloatBucket[] = [
  { label: "<10M", min: 0, max: 10_000_000 },
  { label: "10-50M", min: 10_000_000, max: 50_000_000 },
  { label: "50-200M", min: 50_000_000, max: 200_000_000 },
  { label: ">200M", min: 200_000_000, max: Infinity },
];

interface FloatStats {
  label: string;
  count: number;
  winRate: number;
  avgPnl: number;
  totalPnl: number;
}

function buildFloatStats(trades: Trade[]): FloatStats[] {
  const bucketTrades: Trade[][] = FLOAT_BUCKETS.map(() => []);

  for (const t of trades) {
    if (t.float_shares == null) continue;
    for (let i = 0; i < FLOAT_BUCKETS.length; i++) {
      const b = FLOAT_BUCKETS[i];
      if (t.float_shares >= b.min && t.float_shares < b.max) {
        bucketTrades[i].push(t);
        break;
      }
    }
  }

  return FLOAT_BUCKETS.map((b, i) => {
    const bt = bucketTrades[i];
    if (bt.length === 0) {
      return { label: b.label, count: 0, winRate: 0, avgPnl: 0, totalPnl: 0 };
    }
    const pnls = bt.map(calcPnl);
    const totalPnl = pnls.reduce((a, c) => a + c, 0);
    const wins = pnls.filter((p) => p > 0).length;
    return {
      label: b.label,
      count: bt.length,
      winRate: (wins / bt.length) * 100,
      avgPnl: totalPnl / bt.length,
      totalPnl,
    };
  }).filter((s) => s.count > 0);
}

function FloatSizePerformance({ trades }: { trades: Trade[] }) {
  const stats = useMemo(() => buildFloatStats(trades), [trades]);

  if (stats.length === 0) {
    return (
      <p className="text-[13px] text-tertiary">
        No trades with float data yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px] text-left">
        <thead>
          <tr className="border-b border-border">
            <th className="pb-2.5 text-[13px] font-medium text-secondary">
              Float Size
            </th>
            <th className="pb-2.5 text-[13px] font-medium text-secondary">
              Trades
            </th>
            <th className="pb-2.5 text-[13px] font-medium text-secondary">
              Win Rate
            </th>
            <th className="pb-2.5 text-[13px] font-medium text-secondary text-right">
              Avg Profit / Loss
            </th>
            <th className="pb-2.5 text-[13px] font-medium text-secondary text-right">
              Total Profit / Loss
            </th>
          </tr>
        </thead>
        <tbody>
          {stats.map((s) => (
            <tr key={s.label} className="border-t border-border">
              <td className="py-2.5">
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-brand-muted text-brand border border-brand/20">
                  {s.label}
                </span>
              </td>
              <td className="py-2.5 text-secondary text-xs">{s.count}</td>
              <td
                className={cn(
                  "py-2.5 text-xs font-medium font-mono",
                  s.winRate >= 50 ? "text-profit" : "text-loss",
                )}
              >
                {s.winRate.toFixed(0)}%
              </td>
              <td
                className={cn(
                  "py-2.5 text-right text-xs font-medium font-mono",
                  s.avgPnl >= 0 ? "text-profit" : "text-loss",
                )}
              >
                {s.avgPnl >= 0 ? "+" : ""}${s.avgPnl.toFixed(2)}
              </td>
              <td
                className={cn(
                  "py-2.5 text-right text-xs font-medium font-mono",
                  s.totalPnl >= 0 ? "text-profit" : "text-loss",
                )}
              >
                {s.totalPnl >= 0 ? "+" : ""}${s.totalPnl.toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* -- Analytics Page --------------------------------------------- */

export default function Analytics() {
  const [filters, updateFilters] = useDashboardFilters();
  const [activeTab, setActiveTab] = useState<TabKey>("timing");

  const { data: trades = [], isLoading, isError, refetch } = useAllTrades(filters.from, filters.to);

  const filteredTrades = useMemo(
    () => applyFilters(trades, filters),
    [trades, filters],
  );

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <p className="text-[13px] text-loss">Failed to load trades</p>
        <button
          onClick={() => refetch()}
          className="text-[12px] text-tertiary hover:text-white transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <div className="h-4 w-4 border-2 border-white/10 border-t-white/50 rounded-full animate-spin" />
        <p className="text-[13px] text-tertiary">Loading analytics...</p>
      </div>
    );
  }

  if (trades.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <div className="w-12 h-12 rounded-[6px] flex items-center justify-center">
          <BarChart3 size={24} strokeWidth={1.5} className="text-zinc-600" />
        </div>
        <h2 className="text-base font-medium text-primary tracking-tight">
          No trades to analyze
        </h2>
        <p className="text-[13px] text-zinc-500 text-center max-w-xs">
          Analytics will appear here once you have trade data in the selected date range.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-medium text-primary tracking-tight">
          Analytics
        </h2>
      </div>

      {/* Quick date range */}
      <QuickDatePills filters={filters} onUpdate={updateFilters} />

      {/* Filters */}
      <DashboardFilters
        trades={trades}
        filters={filters}
        onUpdate={updateFilters}
      />
      <FilterSummary
        total={trades.length}
        filtered={filteredTrades.length}
        from={filters.from}
        to={filters.to}
      />

      {/* Tabs */}
      <TabBar active={activeTab} onChange={setActiveTab} />

      {/* Tab content */}
      <div className="space-y-8">
        {activeTab === "timing" && (
          <>
            <div>
              <h3 className="text-[13px] font-medium text-secondary mb-4">Time of Day</h3>
              <TimeOfDayAnalysis trades={filteredTrades} />
            </div>
            <div className="border-t border-white/[0.04] pt-6">
              <h3 className="text-[13px] font-medium text-secondary mb-4">Hold Time</h3>
              <HoldTimeAnalysis trades={filteredTrades} />
            </div>
          </>
        )}

        {activeTab === "edge" && (
          <>
            <div>
              <h3 className="text-[13px] font-medium text-secondary mb-4">Catalyst Performance</h3>
              <CatalystPerformance trades={filteredTrades} />
            </div>
            <div className="border-t border-white/[0.04] pt-6">
              <h3 className="text-[13px] font-medium text-secondary mb-4">Float Size</h3>
              <FloatSizePerformance trades={filteredTrades} />
            </div>
          </>
        )}

        {activeTab === "behavior" && (
          <TiltDetection
            trades={filteredTrades}
            dateRangeLabel={describeRange(filters.from, filters.to)}
          />
        )}
      </div>
    </div>
  );
}
