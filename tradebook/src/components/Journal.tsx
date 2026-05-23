import { useState, useEffect, useRef } from "react";
import { calcPnl } from "../lib/calc";
import { todayLocal } from "../lib/date";
import { useToast } from "./Toast";
import { cn } from "../lib/utils";
import type { JournalEntry, JournalMood } from "../types/journal";
import { useJournalEntry, useJournalDates, useTradesForDate } from "../hooks/useTrades";
import { useSaveJournalEntry } from "../hooks/useMutations";

const MOODS: { value: JournalMood; label: string; emoji: string }[] = [
  { value: "great", label: "Great", emoji: "🟢" },
  { value: "good", label: "Good", emoji: "🔵" },
  { value: "neutral", label: "Neutral", emoji: "⚪" },
  { value: "frustrated", label: "Frustrated", emoji: "🟠" },
  { value: "tilted", label: "Tilted", emoji: "🔴" },
];

const GRADES = [
  { value: "A" as const, label: "A", desc: "Textbook", bg: "bg-profit-bg", border: "border-profit", text: "text-profit", activeBg: "bg-profit-bg" },
  { value: "B" as const, label: "B", desc: "Good", bg: "bg-brand-muted", border: "border-brand", text: "text-brand", activeBg: "bg-brand-muted" },
  { value: "C" as const, label: "C", desc: "Sloppy", bg: "bg-amber-muted", border: "border-amber", text: "text-amber", activeBg: "bg-amber-muted" },
  { value: "D" as const, label: "D", desc: "Broke rules", bg: "bg-loss-bg", border: "border-loss", text: "text-loss", activeBg: "bg-loss-bg" },
];

const inputClass =
  "w-full rounded-[6px] border border-white/[0.06] bg-transparent px-[10px] py-[7px] text-base sm:text-[13px] text-primary placeholder-tertiary hover:border-white/[0.1] focus:border-white/[0.15] focus:outline-none transition-colors duration-150";
const labelClass =
  "block text-[13px] font-medium text-secondary mb-1.5";

export default function Journal() {
  const { showToast } = useToast();
  const [selectedDate, setSelectedDate] = useState(todayLocal());
  const [entry, setEntry] = useState<JournalEntry | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const entryRef = useRef(entry);
  entryRef.current = entry;

  // Query hooks
  const { data: queryEntry, isLoading: entryLoading, isError: entryError, refetch: refetchEntry } = useJournalEntry(selectedDate);
  const { data: datesWithEntries = new Set<string>(), isError: datesError, refetch: refetchDates } = useJournalDates();
  const { data: dayTrades = [], isError: tradesError, refetch: refetchTrades } = useTradesForDate(selectedDate);
  const saveJournalEntry = useSaveJournalEntry();

  // Sync query data into local state for editing
  useEffect(() => {
    if (queryEntry) {
      setEntry(queryEntry);
      setSaveStatus("idle");
    }
  }, [queryEntry]);

  // Auto-save with debounce
  function updateField<K extends keyof JournalEntry>(key: K, value: JournalEntry[K]) {
    if (!entry) return;
    const updated = { ...entry, [key]: value };
    setEntry(updated);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSaveStatus("saving");
      saveJournalEntry.mutate(
        { entry: entryRef.current!, updates: { [key]: value } },
        {
          onSuccess: (newEntry) => {
            // If this was an insert, update local entry with the real id
            if (newEntry) {
              setEntry(newEntry);
            }
            setSaveStatus("saved");
            setTimeout(() => setSaveStatus((s) => (s === "saved" ? "idle" : s)), 2000);
          },
          onError: () => {
            showToast("Failed to save", "error");
            setSaveStatus("idle");
          },
        }
      );
    }, 1000);
  }

  // Trade summary calculations
  const tradeCount = dayTrades.length;
  const totalPnl = dayTrades.reduce((sum, t) => sum + calcPnl(t), 0);
  const wins = dayTrades.filter((t) => calcPnl(t) > 0).length;
  const winRate = tradeCount > 0 ? Math.round((wins / tradeCount) * 100) : 0;

  const isToday = selectedDate === todayLocal();
  const hasTradesNoEntry = isToday && tradeCount > 0 && entry && !entry.premarket_plan && !entry.postmarket_review && !entry.lessons && !entry.mood && !entry.grade;

  // Calendar helpers
  const { year, month } = calendarMonth;
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthLabel = new Date(year, month).toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const calendarDays: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) calendarDays.push(null);
  for (let d = 1; d <= daysInMonth; d++) calendarDays.push(d);

  function prevMonth() {
    setCalendarMonth((m) => m.month === 0 ? { year: m.year - 1, month: 11 } : { year: m.year, month: m.month - 1 });
  }
  function nextMonth() {
    setCalendarMonth((m) => m.month === 11 ? { year: m.year + 1, month: 0 } : { year: m.year, month: m.month + 1 });
  }

  function dateStr(day: number) {
    return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  return (
    <div className="flex gap-6 items-start">
      {/* Left sidebar — Calendar */}
      <div className="hidden md:block w-64 shrink-0">
        <div className="sticky top-24">
          {/* Month navigation */}
          <div className="flex items-center justify-between mb-3">
            <button onClick={prevMonth} className="p-1 rounded hover:bg-surface-2 text-secondary hover:text-primary transition-colors duration-150">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
              </svg>
            </button>
            <span className="text-[13px] font-medium text-primary">{monthLabel}</span>
            <button onClick={nextMonth} className="p-1 rounded hover:bg-surface-2 text-secondary hover:text-primary transition-colors duration-150">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
              </svg>
            </button>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 gap-0.5 mb-1">
            {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
              <div key={d} className="text-center text-[10px] font-medium text-tertiary py-1">{d}</div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7 gap-0.5">
            {calendarDays.map((day, i) => {
              if (day === null) return <div key={`e-${i}`} />;
              const ds = dateStr(day);
              const isSelected = ds === selectedDate;
              const hasEntry = datesWithEntries.has(ds);
              const isFuture = ds > todayLocal();

              return (
                <button
                  key={ds}
                  onClick={() => !isFuture && setSelectedDate(ds)}
                  disabled={isFuture}
                  className={cn(
                    "relative py-1.5 rounded text-xs font-medium transition-colors duration-150",
                    isSelected
                      ? "bg-brand-muted text-brand"
                      : isFuture
                        ? "text-surface-3 cursor-not-allowed"
                        : "text-secondary hover:bg-surface-2 hover:text-primary"
                  )}
                >
                  {day}
                  {hasEntry && (
                    <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-brand" />
                  )}
                </button>
              );
            })}
          </div>

          {datesError && (
            <p className="text-[11px] text-loss mt-2 text-center">
              Failed to load dates.{" "}
              <button onClick={() => refetchDates()} className="underline hover:text-white transition-colors">Retry</button>
            </p>
          )}

          {/* Quick nav */}
          <button
            onClick={() => {
              const today = todayLocal();
              setSelectedDate(today);
              const d = new Date();
              setCalendarMonth({ year: d.getFullYear(), month: d.getMonth() });
            }}
            className="mt-3 w-full text-center text-xs text-tertiary hover:text-brand transition-colors duration-150 py-1.5 rounded-md hover:bg-surface-2"
          >
            Go to today
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0 max-w-2xl space-y-5">
        {/* Header with date and save status */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="page-title">Journal</h2>
            <p className="numeric text-[13px] text-secondary mt-2 leading-tight">
              {new Date(selectedDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Mobile date picker */}
            <input
              type="date"
              value={selectedDate}
              max={todayLocal()}
              onChange={(e) => e.target.value && setSelectedDate(e.target.value)}
              className="md:hidden rounded-md border border-transparent bg-surface-2 px-2 py-1.5 text-base sm:text-xs text-primary hover:border-border-hover focus:border-brand focus:outline-none transition-colors duration-150"
            />
            {/* Save status */}
            <span className={cn(
              "text-xs font-medium transition-opacity",
              saveStatus === "idle" ? "opacity-0" : "opacity-100",
              saveStatus === "saving" ? "text-amber" : "text-brand"
            )}>
              {saveStatus === "saving" ? "Saving..." : saveStatus === "saved" ? "Saved" : ""}
            </span>
          </div>
        </div>

        {/* Reflection banner */}
        {hasTradesNoEntry && (
          <div className="border border-white/[0.04] rounded-md p-3">
            <p className="text-[13px] text-secondary">
              You took <span className="font-medium text-primary">{tradeCount} trade{tradeCount !== 1 ? "s" : ""}</span> today. Take a minute to reflect.
            </p>
          </div>
        )}

        {/* Trades error */}
        {tradesError && (
          <div className="flex items-center gap-3 text-[13px]">
            <span className="text-loss">Failed to load trades for this day</span>
            <button
              onClick={() => refetchTrades()}
              className="text-tertiary hover:text-white transition-colors text-[12px]"
            >
              Retry
            </button>
          </div>
        )}

        {/* Trades summary */}
        {tradeCount > 0 && (
          <>
            <div className="section-divider" />
            <div className="flex flex-wrap gap-x-8 gap-y-2">
              <div>
                <p className="metric-label mb-1">Trades</p>
                <p className="numeric text-[18px] font-semibold text-primary leading-tight">{tradeCount}</p>
              </div>
              <div>
                <p className="metric-label mb-1">Profit / Loss</p>
                <p
                  className={cn(
                    "numeric text-[18px] font-semibold leading-tight",
                    totalPnl >= 0 ? "text-profit" : "text-loss"
                  )}
                >
                  {totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)}
                </p>
              </div>
              <div>
                <p className="metric-label mb-1">Win Rate</p>
                <p className="numeric text-[18px] font-semibold text-primary leading-tight">{winRate}%</p>
              </div>
            </div>
          </>
        )}

        {entryError ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <p className="text-[13px] text-loss">Failed to load journal entry</p>
            <button
              onClick={() => refetchEntry()}
              className="text-[12px] text-tertiary hover:text-white transition-colors"
            >
              Retry
            </button>
          </div>
        ) : entryLoading ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="h-4 w-4 border-2 border-white/10 border-t-white/50 rounded-full animate-spin" />
            <p className="text-[13px] text-secondary">Loading...</p>
          </div>
        ) : entry ? (
          <div className="space-y-5">
            {/* Pre-market Plan */}
            <div>
              <label className={labelClass}>Pre-market Plan</label>
              <textarea
                className={cn(inputClass, "min-h-[60px]")}
                rows={3}
                placeholder="What's on your watchlist? What setups are you looking for?"
                value={entry.premarket_plan}
                onChange={(e) => updateField("premarket_plan", e.target.value)}
              />
            </div>

            {/* Post-market Review */}
            <div className="section-divider" />
            <div>
              <label className={labelClass}>Post-market Review</label>
              <textarea
                className={cn(inputClass, "min-h-[60px]")}
                rows={3}
                placeholder="How did the day go? What worked, what didn't?"
                value={entry.postmarket_review}
                onChange={(e) => updateField("postmarket_review", e.target.value)}
              />
            </div>

            {/* Lessons Learned */}
            <div className="section-divider" />
            <div>
              <label className={labelClass}>Lessons Learned</label>
              <textarea
                className={cn(inputClass, "min-h-[60px]")}
                rows={2}
                placeholder="What will you do differently?"
                value={entry.lessons}
                onChange={(e) => updateField("lessons", e.target.value)}
              />
            </div>

            {/* Mood */}
            <div>
              <label className={labelClass}>Mood</label>
              <div className="flex flex-wrap gap-2">
                {MOODS.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => updateField("mood", entry.mood === m.value ? null : m.value)}
                    className={cn(
                      "px-3 py-2 rounded-md text-[13px] font-medium transition-colors duration-150",
                      entry.mood === m.value
                        ? m.value === "great"
                          ? "bg-profit-bg text-profit"
                          : m.value === "good"
                            ? "bg-brand-muted text-brand"
                            : m.value === "neutral"
                              ? "bg-surface-3/20 text-secondary"
                              : m.value === "frustrated"
                                ? "bg-amber-muted text-amber"
                                : "bg-loss-bg text-loss"
                        : "bg-surface-2 text-tertiary hover:text-secondary"
                    )}
                  >
                    <span className="mr-1.5">{m.emoji}</span>
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Day Grade */}
            <div>
              <label className={labelClass}>Day Grade</label>
              <div className="flex gap-2">
                {GRADES.map((g) => (
                  <button
                    key={g.value}
                    type="button"
                    onClick={() => updateField("grade", entry.grade === g.value ? null : g.value)}
                    className={cn(
                      "flex-1 py-2 rounded-md text-center font-medium text-[13px] transition-colors duration-150",
                      entry.grade === g.value
                        ? `${g.activeBg} ${g.text}`
                        : "bg-surface-2 text-tertiary hover:text-secondary"
                    )}
                  >
                    <span className="text-base">{g.label}</span>
                    <span className="block text-[10px] font-medium opacity-70 mt-0.5">{g.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Goals for Tomorrow */}
            <div className="section-divider" />
            <div>
              <label className={labelClass}>Goals for Tomorrow</label>
              <textarea
                className={cn(inputClass, "min-h-[60px]")}
                rows={2}
                placeholder="What do you want to focus on next session?"
                value={entry.goals_for_tomorrow}
                onChange={(e) => updateField("goals_for_tomorrow", e.target.value)}
              />
            </div>
          </div>
        ) : (
          <div className="text-center py-16">
            <p className="text-[13px] text-secondary">Could not load journal entry.</p>
          </div>
        )}
      </div>
    </div>
  );
}
