import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SlidersHorizontal, X, Lock } from "lucide-react";
import { cn } from "../lib/utils";
import type { Trade } from "../types/trade";
import { useSubscription } from "../contexts/SubscriptionContext";
import {
  type DashboardFilterState,
  buildFilterChips,
  clearAllFilters,
} from "./dashboard/filters";
import { QuickDatePills, FilterFields } from "./dashboard/DashboardFilters";

/**
 * Shared filter bar for Dashboard and Analytics.
 *
 * Layout: quick date presets stay on the bar; everything else lives in a
 * dropdown anchored to the Filters button (closes on outside-click + Escape).
 * Active filters surface as removable chips below the bar.
 *
 * Advanced filters are Pro-only. Free users still get the presets and can open
 * the popover to preview the (disabled) fields with an upgrade CTA.
 */
export default function FilterBar({
  trades,
  filters,
  onUpdate,
  filtered,
  total,
}: {
  trades: Trade[];
  filters: DashboardFilterState;
  onUpdate: (patch: Partial<DashboardFilterState>) => void;
  filtered: number;
  total: number;
}) {
  const { isPro, isTrialing } = useSubscription();
  const advanced = isPro || isTrialing;
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Dropdown dismissal — outside click and Escape.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Free users can't set advanced filters, so they never have chips.
  const chips = advanced ? buildFilterChips(filters, onUpdate) : [];
  const hasFilters = chips.length > 0;
  const showSummary = filtered !== total;

  return (
    <div className="space-y-3">
      {/* Bar: presets left, Filters trigger right */}
      <div className="flex items-center gap-3 flex-wrap">
        <QuickDatePills filters={filters} onUpdate={onUpdate} />

        <div className="relative ml-auto" ref={wrapRef}>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className={cn(
              "inline-flex items-center gap-1.5 h-[34px] px-3 rounded-[6px] border text-[13px] font-medium transition-colors",
              open || hasFilters
                ? "border-white/[0.12] bg-white/[0.04] text-primary"
                : "border-white/[0.06] text-secondary hover:text-primary hover:border-white/[0.1]",
            )}
          >
            <SlidersHorizontal size={14} strokeWidth={1.8} />
            Filters
            {advanced
              ? hasFilters && (
                  <span className="ml-0.5 inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full bg-brand text-white text-[10px] font-semibold tabular-nums">
                    {chips.length}
                  </span>
                )
              : (
                  <Lock
                    size={12}
                    strokeWidth={1.8}
                    className="ml-0.5 text-tertiary"
                  />
                )}
          </button>

          {open && (
            <div className="absolute right-0 mt-2 z-50 w-[min(420px,calc(100vw-2rem))] rounded-lg border border-white/[0.08] bg-surface-1 p-4 shadow-lg animate-popover">
              {advanced ? (
                <>
                  <FilterFields
                    trades={trades}
                    filters={filters}
                    onUpdate={onUpdate}
                  />
                  <div className="mt-4 pt-3 border-t border-white/[0.06] flex items-center justify-between">
                    <span className="text-xs text-tertiary tabular-nums">
                      {filtered} of {total} trades
                    </span>
                    {hasFilters && (
                      <button
                        type="button"
                        onClick={() => clearAllFilters(onUpdate)}
                        className="text-xs text-tertiary hover:text-primary transition-colors"
                      >
                        Clear all
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <>
                  {/* Preview the real fields, disabled, behind the upgrade CTA. */}
                  <div
                    aria-hidden
                    className="opacity-40 pointer-events-none select-none"
                  >
                    <FilterFields
                      trades={trades}
                      filters={filters}
                      onUpdate={onUpdate}
                    />
                  </div>
                  <div className="mt-4 pt-3 border-t border-white/[0.06]">
                    <div className="flex items-center gap-1.5 mb-2.5 text-[12px] text-secondary">
                      <Lock size={12} strokeWidth={1.8} className="text-brand" />
                      Advanced filters are a Pro feature
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        navigate("/app/settings");
                      }}
                      className="w-full rounded-md bg-brand px-4 py-2 text-[13px] font-medium text-white hover:bg-brand-hover transition-colors"
                    >
                      Upgrade to Pro
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Active-filter chips + result summary */}
      {(hasFilters || showSummary) && (
        <div className="flex items-center gap-2 flex-wrap">
          {chips.map((chip) => (
            <span
              key={chip.key}
              className="inline-flex items-center gap-1 h-[26px] pl-2.5 pr-1 rounded-[6px] bg-white/[0.04] border border-white/[0.06] text-[12px] text-secondary"
            >
              {chip.label}
              <button
                type="button"
                onClick={chip.onClear}
                aria-label={`Clear ${chip.label}`}
                className="flex items-center justify-center h-4 w-4 rounded text-tertiary hover:text-primary hover:bg-white/[0.06] transition-colors"
              >
                <X size={12} strokeWidth={2} />
              </button>
            </span>
          ))}
          {hasFilters && (
            <button
              type="button"
              onClick={() => clearAllFilters(onUpdate)}
              className="px-1 text-[12px] text-tertiary hover:text-primary transition-colors"
            >
              Clear all
            </button>
          )}
          {showSummary && (
            <span className="ml-auto text-xs text-tertiary tabular-nums">
              Showing {filtered} of {total}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
