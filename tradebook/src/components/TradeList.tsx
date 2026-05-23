import { useState, useEffect, Fragment } from "react";
import { supabase } from "../lib/supabase";
import type { Trade } from "../types/trade";
import type { TradeFilters } from "../types/filters";
import { calcPnl, calcRR } from "../lib/calc";
import { exportTradesToCsv } from "../lib/csvExport";
import { sortTrades, type SortKey, type SortDir } from "../lib/tradeSort";
import { useToast } from "./Toast";
import TradeImport from "./TradeImport";
import TradeRowDetail from "./TradeRowDetail";
import TradeDetailContent from "./TradeDetailContent";
import { cn } from "../lib/utils";
import { usePaginatedTrades } from "../hooks/useTrades";
import { useDeleteTrade } from "../hooks/useMutations";

const PAGE_SIZE = 50;

type FilterResult = "all" | "win" | "loss";

const pillBase =
  "px-2 py-1 rounded-[4px] text-[12px] font-medium transition-colors cursor-pointer";
const pillActive =
  "bg-white/[0.06] text-white";
const pillInactive =
  "text-tertiary hover:text-secondary";

const inputClass =
  "h-[30px] rounded-[4px] border border-white/[0.06] bg-transparent px-2 text-[13px] text-primary placeholder-tertiary hover:border-white/[0.1] focus:border-white/[0.15] focus:outline-none transition-colors";

const thClass =
  "text-[11px] font-medium text-tertiary uppercase tracking-[0.04em] py-2";

export default function TradeList({
  onLogTrade,
  onEdit,
}: {
  onLogTrade?: () => void;
  onEdit?: (trade: Trade) => void;
}) {
  const { showToast } = useToast();

  // Server-side pagination & filters
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<TradeFilters>({});
  const [tickerInput, setTickerInput] = useState("");

  // Client-side UI state
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [resultFilter, setResultFilter] = useState<FilterResult>("all");
  const [exporting, setExporting] = useState(false);

  // Debounce ticker search
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((prev) => {
        const next = tickerInput || undefined;
        if (prev.ticker === next) return prev;
        return { ...prev, ticker: next };
      });
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [tickerInput]);

  const { data, isLoading, isFetching, isError, refetch } = usePaginatedTrades(filters, page);
  const trades = data?.trades ?? [];
  const totalCount = data?.totalCount ?? 0;

  const deleteTrade = useDeleteTrade();

  // Delete handler
  async function handleDelete(tradeId: string) {
    if (!confirm("Delete this trade? This can't be undone.")) return;
    const trade = trades.find((t) => t.id === tradeId);
    deleteTrade.mutate(
      { tradeId, screenshotUrl: trade?.screenshot_url },
      {
        onSuccess: () => {
          showToast("Trade deleted", "success");
          setExpandedId(null);
        },
        onError: (err) => {
          showToast(err.message, "error");
        },
      }
    );
  }

  // CSV export — fetches ALL trades (no pagination/filters)
  async function handleExportCsv() {
    setExporting(true);
    const { data, error } = await supabase
      .from("trades")
      .select("*")
      .order("trade_date", { ascending: false })
      .order("entry_time", { ascending: false });
    setExporting(false);
    if (error) {
      showToast("Failed to export trades", "error");
      return;
    }
    exportTradesToCsv((data as Trade[]) || []);
  }

  // Error state
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

  // Initial loading spinner
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <div className="h-4 w-4 border-2 border-white/10 border-t-white/50 rounded-full animate-spin" />
        <p className="text-[13px] text-tertiary">Loading trades...</p>
      </div>
    );
  }

  const hasActiveFilters = !!(
    filters.dateFrom || filters.dateTo || filters.ticker || filters.side || filters.grade
  );

  // Empty state — only when zero trades and no active filters
  if (totalCount === 0 && !hasActiveFilters) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <div className="w-12 h-12 rounded-md flex items-center justify-center text-2xl">
          📋
        </div>
        <h2 className="text-base font-medium text-primary tracking-tight">
          No trades yet
        </h2>
        <p className="text-[13px] text-tertiary text-center max-w-xs">
          Start logging to see your trade history here.
        </p>
        {onLogTrade && (
          <button
            onClick={onLogTrade}
            className="mt-2 bg-brand hover:bg-brand/90 text-white font-medium text-[13px] px-5 py-2 rounded-[6px] transition-colors"
          >
            Log Your First Trade
          </button>
        )}
      </div>
    );
  }

  // Sort helpers
  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <span className="text-zinc-600 ml-0.5">↕</span>;
    return (
      <span className="text-secondary ml-0.5">
        {sortDir === "asc" ? "↑" : "↓"}
      </span>
    );
  };

  // Client-side win/loss filter + sort on current page
  let visible = trades;
  if (resultFilter === "win") visible = trades.filter((t) => calcPnl(t) > 0);
  if (resultFilter === "loss") visible = trades.filter((t) => calcPnl(t) < 0);
  const sorted = sortTrades(visible, sortKey, sortDir);

  // Page-level stats
  const pagePnl = trades.reduce((sum, t) => sum + calcPnl(t), 0);
  const pageWins = trades.filter((t) => calcPnl(t) > 0).length;
  const pageLosses = trades.filter((t) => calcPnl(t) < 0).length;

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-baseline gap-4">
          <h2 className="page-title">
            Trade History
          </h2>
          <div className="flex items-center gap-1.5 text-[12px]">
            <span className="numeric text-tertiary">{totalCount} trades</span>
            <span className="text-zinc-700">·</span>
            <span className="numeric text-profit font-medium">{pageWins}W</span>
            <span className="text-zinc-700">/</span>
            <span className="numeric text-loss font-medium">{pageLosses}L</span>
            <span className="text-zinc-700">·</span>
            <span
              className={cn(
                "numeric font-medium",
                pagePnl >= 0 ? "text-profit" : "text-loss"
              )}
            >
              {pagePnl >= 0 ? "+" : ""}${pagePnl.toFixed(2)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Win/Loss filter pills */}
          <div className="flex gap-1">
            {(["all", "win", "loss"] as FilterResult[]).map((f) => (
              <button
                key={f}
                onClick={() => setResultFilter(f)}
                className={cn(pillBase, resultFilter === f ? pillActive : pillInactive)}
              >
                {f === "all" ? "All" : f === "win" ? "Wins" : "Losses"}
              </button>
            ))}
          </div>
          <TradeImport />
          <button
            onClick={handleExportCsv}
            disabled={exporting}
            className="text-[12px] text-tertiary hover:text-white transition-colors disabled:opacity-50"
          >
            {exporting ? "Exporting..." : "Export CSV"}
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-3 py-3 border-t border-white/[0.04]">
        <div>
          <label className="block text-[11px] font-medium text-tertiary uppercase tracking-[0.04em] mb-1.5">
            From
          </label>
          <input
            type="date"
            value={filters.dateFrom || ""}
            onChange={(e) => {
              setFilters((f) => ({ ...f, dateFrom: e.target.value || undefined }));
              setPage(1);
            }}
            className={cn(inputClass, "w-[130px]")}
          />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-tertiary uppercase tracking-[0.04em] mb-1.5">
            To
          </label>
          <input
            type="date"
            value={filters.dateTo || ""}
            onChange={(e) => {
              setFilters((f) => ({ ...f, dateTo: e.target.value || undefined }));
              setPage(1);
            }}
            className={cn(inputClass, "w-[130px]")}
          />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-tertiary uppercase tracking-[0.04em] mb-1.5">
            Ticker
          </label>
          <input
            type="text"
            placeholder="Search..."
            value={tickerInput}
            onChange={(e) => setTickerInput(e.target.value)}
            className={cn(inputClass, "w-24")}
          />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-tertiary uppercase tracking-[0.04em] mb-1.5">
            Side
          </label>
          <div className="flex gap-1">
            {(["all", "long", "short"] as const).map((s) => (
              <button
                key={s}
                onClick={() => {
                  setFilters((f) => ({ ...f, side: s === "all" ? undefined : s }));
                  setPage(1);
                }}
                className={cn(
                  pillBase,
                  (s === "all" && !filters.side) || filters.side === s
                    ? pillActive
                    : pillInactive
                )}
              >
                {s === "all" ? "All" : s === "long" ? "Long" : "Short"}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-[11px] font-medium text-tertiary uppercase tracking-[0.04em] mb-1.5">
            Grade
          </label>
          <div className="flex gap-1">
            {(["all", "A", "B", "C", "D"] as const).map((g) => (
              <button
                key={g}
                onClick={() => {
                  setFilters((f) => ({ ...f, grade: g === "all" ? undefined : g }));
                  setPage(1);
                }}
                className={cn(
                  pillBase,
                  (g === "all" && !filters.grade) || filters.grade === g
                    ? pillActive
                    : pillInactive
                )}
              >
                {g === "all" ? "All" : g}
              </button>
            ))}
          </div>
        </div>
        {hasActiveFilters && (
          <button
            onClick={() => {
              setFilters({});
              setTickerInput("");
              setPage(1);
            }}
            className="text-[12px] text-tertiary hover:text-white transition-colors"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      {sorted.length > 0 ? (
        <div className={cn("transition-opacity", isFetching && "opacity-60")}>
          {/* Mobile card list — phones only (<sm) */}
          <div className="sm:hidden flex flex-col gap-2">
            {sorted.map((t) => {
              const pl = calcPnl(t);
              const isExpanded = expandedId === t.id;
              return (
                <div
                  key={t.id}
                  onClick={() => setExpandedId(isExpanded ? null : t.id)}
                  className={cn(
                    "rounded-lg border border-white/[0.06] p-3 cursor-pointer transition-colors",
                    isExpanded ? "bg-white/[0.04]" : "bg-white/[0.02]"
                  )}
                >
                  <div className="flex items-center justify-between min-h-[32px]">
                    <span className="font-medium text-base font-mono text-primary">
                      {t.ticker}
                    </span>
                    <span
                      className={cn(
                        "font-medium text-base font-mono tabular-nums",
                        pl >= 0 ? "text-profit" : "text-loss"
                      )}
                    >
                      {pl >= 0 ? "+" : ""}${pl.toFixed(2)}
                    </span>
                  </div>
                  {isExpanded && (
                    <div className="mt-3 pt-3 border-t border-white/[0.06]">
                      <TradeDetailContent
                        trade={t}
                        deleting={
                          deleteTrade.isPending &&
                          deleteTrade.variables?.tradeId === t.id
                        }
                        onEdit={onEdit}
                        onDelete={handleDelete}
                        showSummary
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Desktop table — sm and up */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-[13px] text-left">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  <th
                    className={cn(thClass, "cursor-pointer hover:text-secondary transition-colors")}
                    onClick={() => toggleSort("date")}
                  >
                    Date <SortIcon col="date" />
                  </th>
                  <th
                    className={cn(thClass, "cursor-pointer hover:text-secondary transition-colors")}
                    onClick={() => toggleSort("ticker")}
                  >
                    Ticker <SortIcon col="ticker" />
                  </th>
                  <th className={thClass}>
                    Side
                  </th>
                  <th className={cn(thClass, "text-right")}>
                    Entry
                  </th>
                  <th className={cn(thClass, "text-right")}>
                    Exit
                  </th>
                  <th className={cn(thClass, "text-right")}>
                    Size
                  </th>
                  <th
                    className={cn(thClass, "text-right cursor-pointer hover:text-secondary transition-colors")}
                    onClick={() => toggleSort("pnl")}
                  >
                    Profit / Loss <SortIcon col="pnl" />
                  </th>
                  <th className={cn(thClass, "text-right")}>
                    R:R
                  </th>
                  <th className={thClass}>
                    Setup
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((t) => {
                  const pl = calcPnl(t);
                  const rr = calcRR(t);
                  const isExpanded = expandedId === t.id;

                  return (
                    <Fragment key={t.id}>
                      <tr
                        onClick={() =>
                          setExpandedId(isExpanded ? null : t.id)
                        }
                        className={cn(
                          "group cursor-pointer transition-colors border-b border-white/[0.03]",
                          isExpanded ? "bg-white/[0.02]" : "hover:bg-white/[0.02]"
                        )}
                      >
                        <td className="py-2 text-[13px] text-secondary whitespace-nowrap">
                          {t.trade_date}
                        </td>
                        <td className="py-2">
                          <span className="font-mono font-medium text-primary">
                            {t.ticker}
                          </span>
                        </td>
                        <td className="py-2">
                          <span
                            className={cn(
                              "text-[13px] font-medium",
                              t.side === "long" ? "text-profit" : "text-loss"
                            )}
                          >
                            {t.side === "long" ? "Long" : "Short"}
                          </span>
                        </td>
                        <td className="py-2 text-[13px] text-secondary font-mono text-right tabular-nums">
                          ${t.entry_price.toFixed(2)}
                        </td>
                        <td className="py-2 text-[13px] text-secondary font-mono text-right tabular-nums">
                          ${t.exit_price.toFixed(2)}
                        </td>
                        <td className="py-2 text-[13px] text-secondary font-mono text-right tabular-nums">
                          {t.shares}
                        </td>
                        <td
                          className={cn(
                            "py-2 font-medium font-mono text-[13px] text-right tabular-nums",
                            pl >= 0 ? "text-profit" : "text-loss"
                          )}
                        >
                          {pl >= 0 ? "+" : ""}${pl.toFixed(2)}
                        </td>
                        <td className="py-2 text-[13px] text-secondary font-mono text-right tabular-nums">
                          {rr !== null ? `${rr.toFixed(1)}R` : "\u2014"}
                        </td>
                        <td className="py-2 text-[13px] text-tertiary max-w-[200px] truncate">
                          {t.setup || "\u2014"}
                        </td>
                      </tr>
                      {/* Expanded detail row */}
                      {isExpanded && (
                        <TradeRowDetail
                          trade={t}
                          deleting={deleteTrade.isPending && deleteTrade.variables?.tradeId === t.id}
                          onEdit={onEdit}
                          onDelete={handleDelete}
                        />
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="text-center py-10">
          <p className="text-[13px] text-tertiary">
            {hasActiveFilters
              ? "No trades match your filters."
              : "No trades to show on this page."}
          </p>
          {hasActiveFilters && (
            <button
              onClick={() => {
                setFilters({});
                setTickerInput("");
                setPage(1);
              }}
              className="text-[12px] text-tertiary hover:text-white mt-2 transition-colors"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 pt-1">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className={cn(
              "text-[12px] transition-colors",
              page <= 1
                ? "text-zinc-700 cursor-default"
                : "text-secondary hover:text-white"
            )}
          >
            ← Prev
          </button>
          <span className="text-[12px] text-tertiary tabular-nums">
            {page} / {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className={cn(
              "text-[12px] transition-colors",
              page >= totalPages
                ? "text-zinc-700 cursor-default"
                : "text-secondary hover:text-white"
            )}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
