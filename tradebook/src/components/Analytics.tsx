import { useState, useMemo, type ReactNode } from "react";
import { BarChart3 } from "lucide-react";
import { cn } from "../lib/utils";
import type { Trade, CatalystType } from "../types/trade";
import { calcPnl } from "../lib/calc";
import { useDashboardFilters, applyFilters } from "./dashboard/filters";
import FilterBar from "./FilterBar";
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

/* -- Shared edge table ------------------------------------------ *
 * Catalyst + Float share one presentation: rows sorted by total P/L,
 * the winner weighted, losers dimmed, plus a computed takeaway line.
 */

interface EdgeRow {
  key: string;
  label: string;
  count: number;
  winRate: number;
  avgPnl: number;
  totalPnl: number;
}

// Below this many trades a row's win rate is noise — flag it, don't trust it.
const SMALL_SAMPLE_MIN = 5;

function fmtSignedDollar(v: number, decimals = 2): string {
  const sign = v < 0 ? "−" : "+"; // unicode minus, matches the takeaway copy
  const abs = Math.abs(v);
  return `${sign}$${abs.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

/** One computed sentence per table: names the edge (highest total P/L) and the
 *  leak (most-negative total), and flags when the leak is also the single
 *  most-traded row — the real insight ("most volume into the worst setup").
 *  Always derived from the rows, never hardcoded. */
function buildTakeaway(sorted: EdgeRow[], volumeClause: string): ReactNode {
  const edge = sorted[0].totalPnl > 0 ? sorted[0] : null;
  const last = sorted[sorted.length - 1];
  const leak = last.totalPnl < 0 ? last : null;

  const mostTraded = [...sorted].sort((a, b) => b.count - a.count)[0];
  const leakIsMostTraded = leak != null && mostTraded.key === leak.key;

  const name = (r: EdgeRow) => (
    <span className="text-primary font-medium">{r.label}</span>
  );
  const up = (s: string) => <span className="font-mono text-profit">{s}</span>;
  const down = (s: string) => <span className="font-mono text-loss">{s}</span>;

  const edgePart = edge && (
    <>
      {name(edge)} ({up(`${edge.winRate.toFixed(0)}% win`)},{" "}
      {up(fmtSignedDollar(edge.totalPnl, 0))})
    </>
  );
  const leakTail = leakIsMostTraded ? (
    <> — and it’s {volumeClause}.</>
  ) : (
    <>.</>
  );
  const leakPart = leak && (
    <>
      {name(leak)} ({down(fmtSignedDollar(leak.totalPnl, 0))}){leakTail}
    </>
  );

  if (edge && leak) {
    return (
      <>
        Your edge is {edgePart}. Your biggest leak is {leakPart}
      </>
    );
  }
  if (edge) {
    return <>Nothing’s leaking this period — your edge is {edgePart}.</>;
  }
  if (leak) {
    return (
      <>Nothing’s net positive this period — your biggest leak is {leakPart}</>
    );
  }
  return <>Not enough P/L spread to call an edge yet.</>;
}

function EdgeTable({
  rows,
  columnLabel,
  volumeClause,
  emptyText,
}: {
  rows: EdgeRow[];
  columnLabel: string;
  volumeClause: string;
  emptyText: string;
}) {
  // Best edge on top, biggest leak on bottom — top-to-bottom tells the story.
  const sorted = useMemo(
    () => [...rows].sort((a, b) => b.totalPnl - a.totalPnl),
    [rows],
  );

  if (sorted.length === 0) {
    return <p className="text-[13px] text-tertiary">{emptyText}</p>;
  }

  const winnerKey = sorted[0].totalPnl > 0 ? sorted[0].key : null;

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-secondary leading-relaxed">
        {buildTakeaway(sorted, volumeClause)}
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-[13px] text-left">
          <thead>
            <tr className="border-b border-border">
              <th className="pb-2.5 pl-3 border-l-2 border-l-transparent text-[13px] font-medium text-secondary">
                {columnLabel}
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
            {sorted.map((s) => {
              const isWinner = s.key === winnerKey;
              const isNegative = s.totalPnl < 0;
              const isSmall = s.count < SMALL_SAMPLE_MIN;
              return (
                <tr
                  key={s.key}
                  className={cn(
                    "border-t border-border",
                    isWinner && "bg-profit/[0.06]",
                    // Losers recede so the eye skips past them.
                    isNegative && "opacity-50",
                  )}
                >
                  <td
                    className={cn(
                      "py-2.5 pl-3 border-l-2",
                      isWinner ? "border-l-profit" : "border-l-transparent",
                    )}
                  >
                    <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-brand-muted text-brand border border-brand/20">
                      {s.label}
                    </span>
                  </td>
                  <td className="py-2.5 text-secondary text-xs whitespace-nowrap">
                    {s.count}
                    {isSmall && (
                      <span
                        className="ml-1.5 text-[10px] text-tertiary"
                        title={`Only ${s.count} trade${
                          s.count === 1 ? "" : "s"
                        } — small sample, read with caution`}
                      >
                        · small sample
                      </span>
                    )}
                  </td>
                  <td
                    className={cn(
                      "py-2.5 text-xs font-medium font-mono",
                      // Don't color a win rate we can't trust.
                      isSmall
                        ? "text-tertiary"
                        : s.winRate >= 50
                          ? "text-profit"
                          : "text-loss",
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
                    {fmtSignedDollar(s.avgPnl)}
                  </td>
                  <td
                    className={cn(
                      "py-2.5 text-right text-xs font-mono",
                      isWinner ? "font-semibold" : "font-medium",
                      s.totalPnl >= 0 ? "text-profit" : "text-loss",
                    )}
                  >
                    {fmtSignedDollar(s.totalPnl)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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

function buildCatalystStats(trades: Trade[]): EdgeRow[] {
  const byType = new Map<string, Trade[]>();
  for (const t of trades) {
    if (!t.catalyst_type) continue;
    const existing = byType.get(t.catalyst_type) || [];
    existing.push(t);
    byType.set(t.catalyst_type, existing);
  }

  const rows: EdgeRow[] = [];
  for (const [type, typeTrades] of byType) {
    const pnls = typeTrades.map(calcPnl);
    const totalPnl = pnls.reduce((a, b) => a + b, 0);
    const wins = pnls.filter((p) => p > 0).length;
    rows.push({
      key: type,
      label: CATALYST_LABELS[type as CatalystType] ?? type,
      count: typeTrades.length,
      winRate: (wins / typeTrades.length) * 100,
      avgPnl: totalPnl / typeTrades.length,
      totalPnl,
    });
  }
  return rows;
}

function CatalystPerformance({ trades }: { trades: Trade[] }) {
  const rows = useMemo(() => buildCatalystStats(trades), [trades]);
  return (
    <EdgeTable
      rows={rows}
      columnLabel="Catalyst"
      volumeClause="your most-traded setup"
      emptyText="No trades with catalyst data yet."
    />
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

function buildFloatStats(trades: Trade[]): EdgeRow[] {
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

  return FLOAT_BUCKETS.map((b, i): EdgeRow => {
    const bt = bucketTrades[i];
    if (bt.length === 0) {
      return {
        key: b.label,
        label: b.label,
        count: 0,
        winRate: 0,
        avgPnl: 0,
        totalPnl: 0,
      };
    }
    const pnls = bt.map(calcPnl);
    const totalPnl = pnls.reduce((a, c) => a + c, 0);
    const wins = pnls.filter((p) => p > 0).length;
    return {
      key: b.label,
      label: b.label,
      count: bt.length,
      winRate: (wins / bt.length) * 100,
      avgPnl: totalPnl / bt.length,
      totalPnl,
    };
  }).filter((s) => s.count > 0);
}

function FloatSizePerformance({ trades }: { trades: Trade[] }) {
  const rows = useMemo(() => buildFloatStats(trades), [trades]);
  return (
    <EdgeTable
      rows={rows}
      columnLabel="Float Size"
      volumeClause="the float band you trade most"
      emptyText="No trades with float data yet."
    />
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
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="page-title">
          Analytics
        </h2>
      </div>

      {/* Filters */}
      <FilterBar
        trades={trades}
        filters={filters}
        onUpdate={updateFilters}
        filtered={filteredTrades.length}
        total={trades.length}
      />

      {/* Tabs */}
      <TabBar active={activeTab} onChange={setActiveTab} />

      {/* Tab content */}
      <div className="space-y-8">
        {activeTab === "timing" && (
          <>
            <div>
              <p className="metric-label mb-4">Time of Day</p>
              <TimeOfDayAnalysis trades={filteredTrades} />
            </div>
            <div className="section-divider" />
            <div>
              <p className="metric-label mb-4">Hold Time</p>
              <HoldTimeAnalysis trades={filteredTrades} />
            </div>
          </>
        )}

        {activeTab === "edge" && (
          <>
            <div>
              <p className="metric-label mb-4">Catalyst Performance</p>
              <CatalystPerformance trades={filteredTrades} />
            </div>
            <div className="section-divider" />
            <div>
              <p className="metric-label mb-4">Float Size</p>
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
