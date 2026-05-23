import { useMemo } from "react";
import type { Trade, CatalystType } from "../../types/trade";
import TagSelect from "../TagSelect";
import { cn } from "../../lib/utils";
import {
  type DashboardFilterState,
  CATALYST_OPTIONS,
  SIDES,
  QUICK_KEYS,
  QUICK_LABELS,
  getQuickRange,
  activeQuickRange,
} from "./filters";

const pillBase =
  "px-2 py-1 rounded-[4px] text-[12px] font-medium transition-colors border cursor-pointer";
const pillActive =
  "bg-white/[0.06] text-white border-white/[0.06]";
const pillInactive =
  "text-tertiary border-transparent hover:text-secondary hover:border-white/[0.06]";

const inputClass =
  "w-full h-[34px] rounded-[6px] border border-white/[0.06] bg-transparent px-[10px] py-[7px] text-base sm:text-[13px] text-primary placeholder-tertiary hover:border-white/[0.1] focus:border-white/[0.15] focus:outline-none transition-colors";
const labelClass =
  "block text-[13px] font-medium text-secondary mb-1.5";

/** The filter fields themselves, laid out to stack inside the FilterBar popover.
 *  No paywall wrapper here — gating lives in <FilterBar>. */
export function FilterFields({
  trades,
  filters,
  onUpdate,
}: {
  trades: Trade[];
  filters: DashboardFilterState;
  onUpdate: (patch: Partial<DashboardFilterState>) => void;
}) {
  const tickers = useMemo(() => {
    const set = new Set<string>();
    for (const t of trades) set.add(t.ticker);
    return Array.from(set).sort();
  }, [trades]);

  function toggleCatalyst(c: CatalystType) {
    const next = filters.catalysts.includes(c)
      ? filters.catalysts.filter((x) => x !== c)
      : [...filters.catalysts, c];
    onUpdate({ catalysts: next });
  }

  return (
    <div className="space-y-4">
      {/* Date range */}
      <div className="flex flex-col gap-1.5">
        <span className={labelClass}>Date Range</span>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={filters.from}
            onChange={(e) => onUpdate({ from: e.target.value })}
            className={inputClass + " flex-1 min-w-0"}
          />
          <span className="text-tertiary text-xs">to</span>
          <input
            type="date"
            value={filters.to}
            onChange={(e) => onUpdate({ to: e.target.value })}
            className={inputClass + " flex-1 min-w-0"}
          />
        </div>
      </div>

      {/* Ticker */}
      <div className="flex flex-col gap-1.5">
        <label className={labelClass}>Ticker</label>
        <input
          type="text"
          list="filter-tickers"
          value={filters.ticker}
          onChange={(e) => onUpdate({ ticker: e.target.value })}
          placeholder="e.g. AAPL"
          className={inputClass}
        />
        <datalist id="filter-tickers">
          {tickers.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </div>

      {/* Side */}
      <div className="flex flex-col gap-1.5">
        <span className={labelClass}>Side</span>
        <div className="flex gap-1">
          {SIDES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onUpdate({ side: s })}
              className={cn(
                pillBase,
                filters.side === s ? pillActive : pillInactive
              )}
            >
              {s === "all" ? "All" : s === "long" ? "Long" : "Short"}
            </button>
          ))}
        </div>
      </div>

      {/* Catalyst Type */}
      <div className="flex flex-col gap-1.5">
        <span className={labelClass}>Catalyst</span>
        <div className="flex flex-wrap gap-1.5">
          {CATALYST_OPTIONS.map((c) => {
            const active = filters.catalysts.includes(c.value);
            return (
              <button
                key={c.value}
                type="button"
                onClick={() => toggleCatalyst(c.value)}
                className={cn(pillBase, active ? pillActive : pillInactive)}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tags */}
      <div className="flex flex-col gap-1.5">
        <span className={labelClass}>Tags</span>
        <TagSelect
          selected={filters.tags}
          onChange={(tags) => onUpdate({ tags })}
        />
      </div>
    </div>
  );
}

export function QuickDatePills({
  filters,
  onUpdate,
}: {
  filters: DashboardFilterState;
  onUpdate: (patch: Partial<DashboardFilterState>) => void;
}) {
  const active = activeQuickRange(filters.from, filters.to);
  return (
    <div className="flex gap-1.5 flex-wrap">
      {QUICK_KEYS.map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => {
            const range = getQuickRange(k);
            onUpdate({ from: range.from, to: range.to });
          }}
          className={cn(pillBase, active === k ? pillActive : pillInactive)}
        >
          {QUICK_LABELS[k]}
        </button>
      ))}
    </div>
  );
}
