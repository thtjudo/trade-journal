import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import type { Trade, CatalystType } from "../../types/trade";

export const CATALYST_OPTIONS: { value: CatalystType; label: string }[] = [
  { value: "earnings", label: "Earnings" },
  { value: "news_pr", label: "News/PR" },
  { value: "fda", label: "FDA" },
  { value: "sec_filing", label: "SEC Filing" },
  { value: "short_squeeze", label: "Short Squeeze" },
  { value: "sympathy", label: "Sympathy" },
  { value: "technical", label: "Technical" },
  { value: "other", label: "Other" },
];

export const SIDES = ["all", "long", "short"] as const;

export type QuickRange = "7d" | "30d" | "60d" | "90d" | "1yr" | "All";

export const QUICK_KEYS: QuickRange[] = ["7d", "30d", "60d", "90d", "1yr", "All"];

export const QUICK_LABELS: Record<QuickRange, string> = {
  "7d": "7D",
  "30d": "30D",
  "60d": "60D",
  "90d": "90D",
  "1yr": "1Y",
  "All": "All",
};

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function getQuickRange(key: QuickRange): { from: string; to: string } {
  const now = new Date();
  const to = toDateStr(now);
  if (key === "All") return { from: "", to: "" };
  const days = key === "7d" ? 7 : key === "30d" ? 30 : key === "60d" ? 60 : key === "90d" ? 90 : 365;
  const from = new Date(now);
  from.setDate(from.getDate() - days);
  return { from: toDateStr(from), to };
}

function defaultFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return toDateStr(d);
}

function defaultTo(): string {
  return toDateStr(new Date());
}

export interface DashboardFilterState {
  from: string;
  to: string;
  ticker: string;
  side: "all" | "long" | "short";
  catalysts: CatalystType[];
  tags: string[];
}

export function activeQuickRange(from: string, to: string): QuickRange | null {
  const today = toDateStr(new Date());
  if (!from && !to) return "All";
  for (const key of ["7d", "30d", "60d", "90d", "1yr"] as QuickRange[]) {
    const r = getQuickRange(key);
    if (r.from === from && (to === today || to === r.to)) return key;
  }
  return null;
}

export function useDashboardFilters(): [DashboardFilterState, (patch: Partial<DashboardFilterState>) => void] {
  const [params, setParams] = useSearchParams();

  const state: DashboardFilterState = useMemo(() => ({
    from: params.get("from") ?? defaultFrom(),
    to: params.get("to") ?? defaultTo(),
    ticker: params.get("ticker") ?? "",
    side: (params.get("side") as DashboardFilterState["side"]) || "all",
    catalysts: params.get("catalyst")
      ? (params.get("catalyst")!.split(",") as CatalystType[])
      : [],
    tags: params.get("tags") ? params.get("tags")!.split(",") : [],
  }), [params]);

  function update(patch: Partial<DashboardFilterState>) {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      const merged = { ...state, ...patch };

      if (merged.from && merged.from !== defaultFrom()) {
        next.set("from", merged.from);
      } else {
        next.delete("from");
      }
      if (merged.to && merged.to !== defaultTo()) {
        next.set("to", merged.to);
      } else {
        next.delete("to");
      }

      if (merged.ticker) next.set("ticker", merged.ticker);
      else next.delete("ticker");

      if (merged.side !== "all") next.set("side", merged.side);
      else next.delete("side");

      if (merged.catalysts.length > 0) next.set("catalyst", merged.catalysts.join(","));
      else next.delete("catalyst");

      if (merged.tags.length > 0) next.set("tags", merged.tags.join(","));
      else next.delete("tags");

      return next;
    }, { replace: true });
  }

  return [state, update];
}

export function applyFilters(trades: Trade[], f: DashboardFilterState): Trade[] {
  return trades.filter((t) => {
    if (f.from && t.trade_date < f.from) return false;
    if (f.to && t.trade_date > f.to) return false;
    if (f.ticker && !t.ticker.toLowerCase().includes(f.ticker.toLowerCase())) return false;
    if (f.side !== "all" && t.side !== f.side) return false;
    if (f.catalysts.length > 0 && (!t.catalyst_type || !f.catalysts.includes(t.catalyst_type))) return false;
    if (f.tags.length > 0 && !f.tags.some((tag) => t.tags.includes(tag))) return false;
    return true;
  });
}

/* -- Active-filter chips ----------------------------------------- */

const CATALYST_LABEL: Record<string, string> = Object.fromEntries(
  CATALYST_OPTIONS.map((o) => [o.value, o.label]),
);

export interface FilterChip {
  key: string;
  label: string;
  onClear: () => void;
}

function fmtChipDate(d: string): string {
  if (!d) return "";
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/** Active advanced filters as removable chips. The date range only becomes a
 *  chip when it's a *custom* range — the quick presets live on the bar and
 *  highlight themselves, so showing a chip for them would be redundant. */
export function buildFilterChips(
  filters: DashboardFilterState,
  onUpdate: (patch: Partial<DashboardFilterState>) => void,
): FilterChip[] {
  const chips: FilterChip[] = [];

  if (
    (filters.from || filters.to) &&
    activeQuickRange(filters.from, filters.to) === null
  ) {
    chips.push({
      key: "date",
      label: `${fmtChipDate(filters.from)} – ${fmtChipDate(filters.to)}`,
      onClear: () => onUpdate({ from: defaultFrom(), to: defaultTo() }),
    });
  }

  if (filters.ticker) {
    chips.push({
      key: "ticker",
      label: filters.ticker.toUpperCase(),
      onClear: () => onUpdate({ ticker: "" }),
    });
  }

  if (filters.side !== "all") {
    chips.push({
      key: "side",
      label: filters.side === "long" ? "Long" : "Short",
      onClear: () => onUpdate({ side: "all" }),
    });
  }

  for (const c of filters.catalysts) {
    chips.push({
      key: `catalyst:${c}`,
      label: CATALYST_LABEL[c] ?? c,
      onClear: () =>
        onUpdate({ catalysts: filters.catalysts.filter((x) => x !== c) }),
    });
  }

  for (const tag of filters.tags) {
    chips.push({
      key: `tag:${tag}`,
      label: tag,
      onClear: () => onUpdate({ tags: filters.tags.filter((x) => x !== tag) }),
    });
  }

  return chips;
}

/** Reset every field the popover controls back to its default. */
export function clearAllFilters(
  onUpdate: (patch: Partial<DashboardFilterState>) => void,
): void {
  onUpdate({
    from: defaultFrom(),
    to: defaultTo(),
    ticker: "",
    side: "all",
    catalysts: [],
    tags: [],
  });
}
