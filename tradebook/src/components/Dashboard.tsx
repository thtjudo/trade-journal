import { useState, useEffect, useMemo } from "react";
import { cn } from "../lib/utils";
import type { Trade } from "../types/trade";
import { calcPnl, calcRR, calcStreak } from "../lib/calc";
import { calcMissedPnl } from "../lib/calc";
import { todayLocal } from "../lib/date";
import CalendarHeatmap from "./CalendarHeatmap";
import { StatCard } from "./dashboard/StatCards";
import EquityCurve from "./dashboard/EquityCurve";
import DailyBreakdown from "./dashboard/DailyBreakdown";
import SetupPerformance from "./dashboard/SetupPerformance";
import EmotionPerformance from "./dashboard/EmotionPerformance";
import RecentTrades from "./dashboard/RecentTrades";
import { buildDailyStats, buildTagStats, buildEmotionStats, calcDrawdownInfo } from "./dashboard/helpers";
import { useSubscription } from "../contexts/SubscriptionContext";
import { useDashboardFilters, applyFilters } from "./dashboard/filters";
import FilterBar from "./FilterBar";
import { useAllTrades, useMissedTrades } from "../hooks/useTrades";
import {
  TrendingUp,
  Hash,
  Target,
  Zap,
  DollarSign,
  TrendingDown,
  Trophy,
  AlertTriangle,
  Shield,
  Crosshair,
  ChevronRight,
} from "lucide-react";

function TodaySummary({ trades }: { trades: Trade[] }) {
  const [dismissed, setDismissed] = useState(false);
  const today = todayLocal();
  const todayTrades = trades.filter((t) => t.trade_date === today);

  // Auto-hide after US market close (4 PM ET)
  useEffect(() => {
    const check = () => {
      const now = new Date();
      const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
      if (et.getHours() >= 16) setDismissed(true);
    };
    check();
    const id = setInterval(check, 60_000);
    return () => clearInterval(id);
  }, []);

  if (todayTrades.length === 0 || dismissed) return null;

  const pnls = todayTrades.map(calcPnl);
  const totalPnl = pnls.reduce((a, b) => a + b, 0);
  const wins = pnls.filter((p) => p > 0).length;
  const losses = pnls.filter((p) => p < 0).length;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => setDismissed(true)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setDismissed(true); }}
      className="relative pl-4 py-3 cursor-pointer animate-slide-down select-none
                 border-l-2 border-brand"
    >
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[13px] font-medium text-primary">
          Today's Session
        </h3>
        <span className="text-[11px] text-tertiary">dismiss</span>
      </div>

      <div className="flex items-center gap-6">
        <div>
          <p className="text-[12px] text-tertiary">Trades</p>
          <p className="text-base font-medium tabular-nums text-primary">{todayTrades.length}</p>
        </div>
        <div>
          <p className="text-[12px] text-tertiary">W / L</p>
          <p className="text-base font-medium tabular-nums">
            <span className="text-profit">{wins}</span>
            <span className="text-tertiary"> / </span>
            <span className="text-loss">{losses}</span>
          </p>
        </div>
        <div>
          <p className="text-[12px] text-tertiary">Profit / Loss</p>
          <p
            className={cn(
              "text-base font-medium tabular-nums",
              totalPnl >= 0 ? "text-profit" : "text-loss"
            )}
          >
            {totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)}
          </p>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard({
  onLogTrade,
}: {
  onLogTrade?: () => void;
}) {
  const { isPro, isTrialing } = useSubscription();
  const proUser = isPro || isTrialing;
  const [filters, updateFilters] = useDashboardFilters();

  const { data: trades = [], isLoading, isError, refetch } = useAllTrades(filters.from, filters.to);
  const { data: missedTrades = [], isError: missedError, refetch: refetchMissed } = useMissedTrades();

  const filteredTrades = useMemo(
    () => proUser ? applyFilters(trades, filters) : trades,
    [trades, filters, proUser]
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
        <p className="text-[13px] text-tertiary">Loading dashboard...</p>
      </div>
    );
  }

  if (trades.length === 0 && missedTrades.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <div className="w-12 h-12 rounded-[6px] flex items-center justify-center">
          <TrendingUp size={24} strokeWidth={1.5} className="text-zinc-600" />
        </div>
        <h2 className="text-base font-medium text-primary tracking-tight">
          No trades logged yet
        </h2>
        <p className="text-[13px] text-zinc-500 text-center max-w-xs">
          Your dashboard will come alive once you start logging trades — win
          rate, profit / loss, streaks, and more.
        </p>
        {onLogTrade && (
          <button
            onClick={onLogTrade}
            className="mt-2 bg-brand hover:bg-brand-hover text-white font-medium text-[13px] px-5 py-2 rounded-[6px] transition-colors"
          >
            Log Your First Trade
          </button>
        )}
      </div>
    );
  }

  const hasTrades = filteredTrades.length > 0;

  const pnls = filteredTrades.map(calcPnl);
  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p < 0);

  const totalPnl = pnls.reduce((a, b) => a + b, 0);
  const winRate = hasTrades ? (wins.length / filteredTrades.length) * 100 : 0;
  const avgWin =
    wins.length > 0 ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
  const avgLoss =
    losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / losses.length : 0;

  // Best / worst trade
  let bestTrade = filteredTrades[0] ?? null;
  let worstTrade = filteredTrades[0] ?? null;
  let bestPnl = pnls[0] ?? 0;
  let worstPnl = pnls[0] ?? 0;
  for (let i = 1; i < filteredTrades.length; i++) {
    if (pnls[i] > bestPnl) {
      bestPnl = pnls[i];
      bestTrade = filteredTrades[i];
    }
    if (pnls[i] < worstPnl) {
      worstPnl = pnls[i];
      worstTrade = filteredTrades[i];
    }
  }

  // Avg R:R (only for trades with stop loss)
  const rrValues = filteredTrades.map(calcRR).filter((r): r is number => r !== null);
  const avgRR =
    rrValues.length > 0
      ? rrValues.reduce((a, b) => a + b, 0) / rrValues.length
      : null;

  // Profit factor
  const grossWins = wins.reduce((a, b) => a + b, 0);
  const grossLosses = Math.abs(losses.reduce((a, b) => a + b, 0));
  const profitFactor = grossLosses > 0 ? grossWins / grossLosses : null;

  // Streak
  const streak = calcStreak(filteredTrades);

  // Daily stats
  const dailyStats = buildDailyStats(filteredTrades);

  // Tag & emotion stats
  const tagStats = buildTagStats(filteredTrades);
  const emotionStats = buildEmotionStats(filteredTrades);

  // Equity curve data (cumulative P&L, chronological)
  const equityDays = [...dailyStats].reverse();
  let runningPnl = 0;
  const equityPoints = [
    { date: "", value: 0 },
    ...equityDays.map((d) => {
      runningPnl += d.pnl;
      return { date: d.date, value: runningPnl };
    }),
  ];

  // Drawdown
  const drawdownInfo = calcDrawdownInfo(equityPoints);

  // Expectancy
  const expectancy = hasTrades
    ? (wins.length / filteredTrades.length) * avgWin +
      (losses.length / filteredTrades.length) * avgLoss
    : 0;

  // Expectancy per R
  const tradesWithStops = filteredTrades.filter((t) => t.stop_loss_price).length;
  const hasEnoughStops = hasTrades && tradesWithStops >= filteredTrades.length * 0.5;
  let expectancyR: number | null = null;
  if (hasEnoughStops) {
    const rrAll = filteredTrades
      .filter((t) => t.stop_loss_price)
      .map((t) => ({ rr: calcRR(t), win: calcPnl(t) > 0 }))
      .filter((x): x is { rr: number; win: boolean } => x.rr !== null);
    if (rrAll.length > 0) {
      const rrWins = rrAll.filter((x) => x.win);
      const rrLosses = rrAll.filter((x) => !x.win);
      const avgWinR =
        rrWins.length > 0
          ? rrWins.reduce((a, x) => a + x.rr, 0) / rrWins.length
          : 0;
      const avgLossR =
        rrLosses.length > 0
          ? Math.abs(rrLosses.reduce((a, x) => a + x.rr, 0) / rrLosses.length)
          : 0;
      const winRateR = rrWins.length / rrAll.length;
      const lossRateR = rrLosses.length / rrAll.length;
      expectancyR = winRateR * avgWinR - lossRateR * avgLossR;
    }
  }

  // Recovery factor
  const recoveryFactor =
    drawdownInfo.maxDrawdown > 0 ? totalPnl / drawdownInfo.maxDrawdown : null;

  // Sharpe-like ratio (annualized)
  const dailyPnls = dailyStats.map((d) => d.pnl);
  let sharpe: number | null = null;
  if (dailyPnls.length > 1) {
    const mean = dailyPnls.reduce((a, b) => a + b, 0) / dailyPnls.length;
    const variance =
      dailyPnls.reduce((sum, p) => sum + (p - mean) ** 2, 0) /
      (dailyPnls.length - 1);
    const std = Math.sqrt(variance);
    if (std > 0) {
      sharpe = (mean / std) * Math.sqrt(252);
    }
  }

  // Recent trades
  const recentTrades = [...filteredTrades]
    .sort((a, b) => {
      if (a.trade_date !== b.trade_date)
        return b.trade_date.localeCompare(a.trade_date);
      return (b.entry_time || "").localeCompare(a.entry_time || "");
    })
    .slice(0, 5);

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div>
        <h2 className="page-title">
          Dashboard
        </h2>
        <p className="numeric text-[13px] text-zinc-500 mt-2 leading-tight">
          {filteredTrades.length} trade{filteredTrades.length !== 1 ? "s" : ""} across {dailyStats.length} session{dailyStats.length !== 1 ? "s" : ""}
        </p>
      </div>

      {/* Filters */}
      <FilterBar
        trades={trades}
        filters={filters}
        onUpdate={updateFilters}
        filtered={filteredTrades.length}
        total={trades.length}
      />

      {/* Today's Summary */}
      {proUser && hasTrades && <TodaySummary trades={filteredTrades} />}

      {hasTrades && (
        <>
          {/* Hero Stats */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              large
              label="Total P&L"
              value={`${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(2)}`}
              color={totalPnl >= 0 ? "text-profit" : "text-loss"}
              icon={DollarSign}
            />
            <StatCard
              label="Win Rate"
              value={`${winRate.toFixed(1)}%`}
              color={winRate >= 50 ? "text-profit" : "text-loss"}
              sub={`${wins.length}W / ${losses.length}L`}
              icon={Target}
            />
            <StatCard
              label="Trades"
              value={String(filteredTrades.length)}
              icon={Hash}
            />
            <StatCard
              label="Streak"
              value={
                streak.type === "none"
                  ? "\u2014"
                  : `${streak.count}${streak.type === "win" ? "W" : "L"}`
              }
              color={
                streak.type === "win"
                  ? "text-profit"
                  : streak.type === "loss"
                    ? "text-loss"
                    : undefined
              }
              icon={Zap}
            />
          </div>

          {/* Equity Curve — full width */}
          {equityPoints.length >= 2 && (
            <>
              <div className="section-divider" />
              <div>
              <div className="flex items-center justify-between mb-4">
                <p className="metric-label">
                  Equity Curve
                </p>
                <span
                  className={cn(
                    "numeric text-[12px] font-medium",
                    totalPnl >= 0 ? "text-profit" : "text-loss"
                  )}
                >
                  {totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)}
                </span>
              </div>
              <EquityCurve
                points={equityPoints}
                drawdownRegion={
                  drawdownInfo.maxDrawdown > 0
                    ? {
                        peakIdx: drawdownInfo.maxDdPeakIdx,
                        troughIdx: drawdownInfo.maxDdTroughIdx,
                      }
                    : undefined
                }
              />
              </div>
            </>
          )}

          {/* Calendar Heatmap */}
          {dailyStats.length > 0 && <CalendarHeatmap dailyStats={dailyStats} />}

          {/* Setup + Emotion Performance */}
          {(tagStats.length > 0 || emotionStats.length > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {tagStats.length > 0 && <SetupPerformance tagStats={tagStats} />}
              {emotionStats.length > 0 && <EmotionPerformance emotionStats={emotionStats} />}
            </div>
          )}

          {/* Daily Breakdown */}
          {proUser && <DailyBreakdown dailyStats={dailyStats} />}

          {/* Recent Trades */}
          <RecentTrades recentTrades={recentTrades} />

          {/* Advanced Metrics (collapsible) */}
          {proUser && (
            <details className="group">
              <summary className="text-[13px] font-medium text-tertiary cursor-pointer select-none [&::-webkit-details-marker]:hidden list-none flex items-center gap-1.5 hover:text-secondary transition-colors">
                <ChevronRight size={14} className="transition-transform group-open:rotate-90" />
                Advanced Metrics
              </summary>
              <div className="mt-4 space-y-4">
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                  <StatCard
                    label="Avg Win"
                    value={`+$${avgWin.toFixed(2)}`}
                    color="text-profit"
                    icon={TrendingUp}
                  />
                  <StatCard
                    label="Avg Loss"
                    value={`-$${Math.abs(avgLoss).toFixed(2)}`}
                    color="text-loss"
                    icon={TrendingDown}
                  />
                  {avgRR !== null && (
                    <StatCard
                      label="Avg R:R"
                      value={`${avgRR.toFixed(2)}R`}
                      color={avgRR >= 1 ? "text-profit" : "text-loss"}
                    />
                  )}
                  {profitFactor !== null && (
                    <StatCard
                      label="Profit Factor"
                      value={profitFactor.toFixed(2)}
                      color={profitFactor >= 1 ? "text-profit" : "text-loss"}
                    />
                  )}
                  <StatCard
                    label="Best Trade"
                    value={bestPnl > 0 ? `+$${bestPnl.toFixed(2)}` : "\u2014"}
                    color={bestPnl > 0 ? "text-profit" : "text-tertiary"}
                    sub={bestPnl > 0 && bestTrade ? bestTrade.ticker : undefined}
                    icon={Trophy}
                  />
                  <StatCard
                    label="Worst Trade"
                    value={worstPnl < 0 ? `-$${Math.abs(worstPnl).toFixed(2)}` : "\u2014"}
                    color={worstPnl < 0 ? "text-loss" : "text-tertiary"}
                    sub={worstPnl < 0 && worstTrade ? worstTrade.ticker : undefined}
                    icon={AlertTriangle}
                  />
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                  <StatCard
                    label="Expectancy"
                    value={`${expectancy >= 0 ? "+" : "-"}$${Math.abs(expectancy).toFixed(2)}`}
                    color={expectancy >= 0 ? "text-profit" : "text-loss"}
                    sub="per trade"
                    icon={Shield}
                  />
                  {expectancyR !== null && (
                    <StatCard
                      label="Expectancy / R"
                      value={`${expectancyR >= 0 ? "+" : ""}${expectancyR.toFixed(2)}R`}
                      color={expectancyR >= 0 ? "text-profit" : "text-loss"}
                    />
                  )}
                  <StatCard
                    label="Max Drawdown"
                    value={
                      drawdownInfo.maxDrawdown > 0
                        ? `-$${drawdownInfo.maxDrawdown.toFixed(2)}`
                        : "\u2014"
                    }
                    color={drawdownInfo.maxDrawdown > 0 ? "text-loss" : "text-tertiary"}
                    sub={
                      drawdownInfo.maxDrawdownPct > 0
                        ? `${drawdownInfo.maxDrawdownPct.toFixed(1)}% of peak`
                        : undefined
                    }
                  />
                  <StatCard
                    label="Current Drawdown"
                    value={
                      drawdownInfo.currentDrawdown > 0
                        ? `-$${drawdownInfo.currentDrawdown.toFixed(2)}`
                        : "$0.00"
                    }
                    color={
                      drawdownInfo.currentDrawdown > 0
                        ? "text-loss"
                        : "text-profit"
                    }
                  />
                  {recoveryFactor !== null && (
                    <StatCard
                      label="Recovery Factor"
                      value={recoveryFactor.toFixed(2)}
                      color={recoveryFactor >= 1 ? "text-profit" : "text-loss"}
                    />
                  )}
                  {sharpe !== null && (
                    <StatCard
                      label="Sharpe Ratio"
                      value={sharpe.toFixed(2)}
                      color={sharpe >= 0 ? "text-profit" : "text-loss"}
                      sub="annualized"
                    />
                  )}
                </div>
              </div>
            </details>
          )}
        </>
      )}

      {/* Missed Opportunities */}
      {missedError && (
        <div className="flex items-center gap-3 text-[13px]">
          <span className="text-loss">Failed to load missed trades</span>
          <button
            onClick={() => refetchMissed()}
            className="text-tertiary hover:text-white transition-colors text-[12px]"
          >
            Retry
          </button>
        </div>
      )}
      {proUser && missedTrades.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            label="Missed Trades"
            value={String(missedTrades.length)}
            color="text-amber"
            icon={Crosshair}
          />
          {(() => {
            const missedPnls = missedTrades
              .map(calcMissedPnl)
              .filter((p): p is number => p !== null);
            const totalMissedPnl =
              missedPnls.length > 0
                ? missedPnls.reduce((a, b) => a + b, 0)
                : null;
            return (
              <StatCard
                label="Missed P&L"
                value={
                  totalMissedPnl !== null
                    ? `${totalMissedPnl >= 0 ? "+" : ""}$${totalMissedPnl.toFixed(2)}`
                    : "\u2014"
                }
                color={
                  totalMissedPnl === null
                    ? "text-tertiary"
                    : totalMissedPnl >= 0
                      ? "text-profit"
                      : "text-loss"
                }
              />
            );
          })()}
          {(() => {
            const setupCounts = new Map<string, number>();
            for (const mt of missedTrades) {
              for (const tag of mt.tags || []) {
                setupCounts.set(tag, (setupCounts.get(tag) || 0) + 1);
              }
            }
            let topSetup: string | null = null;
            let topCount = 0;
            for (const [tag, count] of setupCounts) {
              if (count > topCount) {
                topSetup = tag;
                topCount = count;
              }
            }
            return (
              <StatCard
                label="Top Missed Setup"
                value={topSetup || "\u2014"}
                color={topSetup ? "text-amber" : "text-tertiary"}
                sub={topSetup ? `${topCount}x` : undefined}
              />
            );
          })()}
          {(() => {
            const reasonCounts = new Map<string, number>();
            for (const mt of missedTrades) {
              for (const r of mt.hesitation_reasons || []) {
                reasonCounts.set(r, (reasonCounts.get(r) || 0) + 1);
              }
            }
            let topReason: string | null = null;
            let topCount = 0;
            for (const [reason, count] of reasonCounts) {
              if (count > topCount) {
                topReason = reason;
                topCount = count;
              }
            }
            return (
              <StatCard
                label="Top Hesitation"
                value={topReason || "\u2014"}
                color={topReason ? "text-amber" : "text-tertiary"}
                sub={topReason ? `${topCount}x` : undefined}
              />
            );
          })()}
        </div>
      )}
    </div>
  );
}
