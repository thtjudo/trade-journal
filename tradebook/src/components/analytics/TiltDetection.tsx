import { useMemo, type ReactNode } from "react";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "../../lib/utils";
import type { Trade } from "../../types/trade";
import { calcNetPnl } from "../../lib/calc";

interface Props {
  trades: Trade[];
  dateRangeLabel?: string;
}

interface TiltEpisode {
  date: string;
  losingStreak: Trade[];
  postTiltTrades: Trade[];
  streakPnls: number[];
  postPnls: number[];
  postSizeIncrease: number | null; // percentage
  impulseEntry: boolean;
  impulseEntryGapMin: number | null; // minutes between last streak exit and first post-tilt entry
  deviatedSetup: boolean;
}

/* ── thresholds (eyeball these) ─────────────────────────────── */

const DEFAULT_TILT_THRESHOLD = 2;              // consecutive losses to trigger an episode
const REVENGE_SIZE_THRESHOLD_PCT = 15;         // per-episode: post-streak avg size > streak avg by this % → flagged (onset, not late-stage)
const IMPULSE_ENTRY_THRESHOLD_MIN = 2;         // per-episode: re-entry within this many minutes of last stop-out → flagged
const TRUSTWORTHY_SAMPLE = 10;                 // post-tilt trades needed before the WATCH verdict stops calling itself a small sample

/* ── helpers ────────────────────────────────────────────────── */

function parseMinutes(time: string): number | null {
  if (!time) return null;
  const m = time.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + (m[3] ? parseInt(m[3], 10) / 60 : 0);
}

function fmtDollar(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : v > 0 ? "+" : "";
  if (abs >= 10_000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(2)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

function fmtImpulseGap(gapMin: number): string {
  const safe = Math.max(0, gapMin);
  if (safe < 1) return `${Math.round(safe * 60)}s`;
  return `${safe.toFixed(1)} min`;
}

/** One trigger line per fired condition, threshold inline — rendered as a vertical checklist. */
function buildChecklist(
  ep: TiltEpisode,
  threshold: number,
): { trigger: string; flags: string[] } {
  const trigger = `${ep.losingStreak.length} consecutive losses (threshold: ${threshold})`;
  const flags: string[] = [];

  if (ep.impulseEntry && ep.impulseEntryGapMin !== null) {
    flags.push(
      `Re-entered ${fmtImpulseGap(ep.impulseEntryGapMin)} after stop-out (threshold: <${IMPULSE_ENTRY_THRESHOLD_MIN} min)`,
    );
  }

  if (ep.postSizeIncrease !== null && ep.postSizeIncrease > REVENGE_SIZE_THRESHOLD_PCT) {
    flags.push(
      `Sized +${ep.postSizeIncrease.toFixed(0)}% vs streak avg (threshold: +${REVENGE_SIZE_THRESHOLD_PCT}%)`,
    );
  }

  if (ep.deviatedSetup) {
    flags.push(`Traded outside top-3 setups`);
  }

  return { trigger, flags };
}

/** Joins ["a", "b", "c"] → "a, b and c" for inline behavior copy. */
function joinList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/* ── component ──────────────────────────────────────────────── */

export default function TiltDetection({ trades, dateRangeLabel = "this period" }: Props) {
  const threshold = DEFAULT_TILT_THRESHOLD;

  const analysis = useMemo(() => {
    if (trades.length === 0) return null;

    // Most common setups (top 3)
    const setupCounts = new Map<string, number>();
    for (const t of trades) {
      if (t.setup) {
        setupCounts.set(t.setup, (setupCounts.get(t.setup) || 0) + 1);
      }
    }
    const topSetups = new Set(
      [...setupCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([s]) => s),
    );

    // Group trades by date, sorted chronologically within each day
    const byDate = new Map<string, Trade[]>();
    for (const t of trades) {
      const arr = byDate.get(t.trade_date) || [];
      arr.push(t);
      byDate.set(t.trade_date, arr);
    }

    for (const arr of byDate.values()) {
      arr.sort((a, b) => {
        const am = parseMinutes(a.entry_time);
        const bm = parseMinutes(b.entry_time);
        return (am ?? 0) - (bm ?? 0);
      });
    }

    // Detect tilt episodes
    const episodes: TiltEpisode[] = [];

    for (const [date, dayTrades] of byDate) {
      let i = 0;
      while (i < dayTrades.length) {
        // Look for N consecutive losses
        const streakStart = i;
        let consecutiveLosses = 0;

        while (i < dayTrades.length && calcNetPnl(dayTrades[i]) < 0) {
          consecutiveLosses++;
          i++;
        }

        if (consecutiveLosses >= threshold && i < dayTrades.length) {
          // We have a tilt trigger — remaining trades that day are post-tilt
          const losingStreak = dayTrades.slice(streakStart, i);
          const postTiltTrades = dayTrades.slice(i);

          const streakPnls = losingStreak.map((t) => calcNetPnl(t));
          const postPnls = postTiltTrades.map((t) => calcNetPnl(t));

          // Size increase check
          const avgStreakSize =
            losingStreak.reduce((s, t) => s + t.shares * t.entry_price, 0) /
            losingStreak.length;
          const avgPostSize =
            postTiltTrades.reduce((s, t) => s + t.shares * t.entry_price, 0) /
            postTiltTrades.length;
          const postSizeIncrease =
            avgStreakSize > 0
              ? ((avgPostSize - avgStreakSize) / avgStreakSize) * 100
              : null;

          // Impulse entry: next trade entered within IMPULSE_ENTRY_THRESHOLD_MIN of last loss exit
          const lastLoss = losingStreak[losingStreak.length - 1];
          const firstPost = postTiltTrades[0];
          const lastLossExit = parseMinutes(lastLoss.exit_time);
          const firstPostEntry = parseMinutes(firstPost.entry_time);
          const impulseEntryGapMin =
            lastLossExit !== null && firstPostEntry !== null
              ? firstPostEntry - lastLossExit
              : null;
          const impulseEntry =
            impulseEntryGapMin !== null &&
            impulseEntryGapMin < IMPULSE_ENTRY_THRESHOLD_MIN;

          // Setup deviation
          const deviatedSetup = postTiltTrades.some(
            (t) => t.setup && topSetups.size > 0 && !topSetups.has(t.setup),
          );

          episodes.push({
            date,
            losingStreak,
            postTiltTrades,
            streakPnls,
            postPnls,
            postSizeIncrease,
            impulseEntry,
            impulseEntryGapMin,
            deviatedSetup,
          });

          // Skip past this episode
          break;
        }

        // No tilt here, move to next trade
        if (consecutiveLosses < threshold) {
          i++;
        }
      }
    }

    // Aggregate stats
    const allPostTiltPnls = episodes.flatMap((e) => e.postPnls);

    const postTiltAvgPnl =
      allPostTiltPnls.length > 0
        ? allPostTiltPnls.reduce((s, p) => s + p, 0) / allPostTiltPnls.length
        : 0;

    // Normal trades = all trades minus those in any episode
    const episodeTradeIds = new Set(
      episodes.flatMap((e) => [
        ...e.losingStreak.map((t) => t.id),
        ...e.postTiltTrades.map((t) => t.id),
      ]),
    );
    const normalTrades = trades.filter((t) => !episodeTradeIds.has(t.id));
    const normalPnls = normalTrades.map((t) => calcNetPnl(t));
    const normalAvgPnl =
      normalPnls.length > 0
        ? normalPnls.reduce((s, p) => s + p, 0) / normalPnls.length
        : 0;

    // Average size increase
    const sizeIncreases = episodes
      .map((e) => e.postSizeIncrease)
      .filter((v): v is number => v !== null);
    const avgSizeIncrease =
      sizeIncreases.length > 0
        ? sizeIncreases.reduce((s, v) => s + v, 0) / sizeIncreases.length
        : 0;

    // Aggregate post-tilt P/L (sum across every post-tilt trade) — drives the COSTING YOU verdict.
    const aggregatePostTiltPnl = allPostTiltPnls.reduce((s, p) => s + p, 0);
    const postTiltTradeCount = allPostTiltPnls.length;

    // Which behavioral flags fired anywhere this period? (impulse re-entry / sized up / off-plan)
    const anyImpulse = episodes.some((e) => e.impulseEntry);
    const anySizedUp = episodes.some(
      (e) =>
        e.postSizeIncrease !== null &&
        e.postSizeIncrease > REVENGE_SIZE_THRESHOLD_PCT,
    );
    const anyDeviated = episodes.some((e) => e.deviatedSetup);
    const hasBehavioralFlags = anyImpulse || anySizedUp || anyDeviated;

    return {
      episodes,
      postTiltAvgPnl,
      aggregatePostTiltPnl,
      postTiltTradeCount,
      normalAvgPnl,
      avgSizeIncrease,
      hasBehavioralFlags,
      anyImpulse,
      anySizedUp,
      anyDeviated,
    };
  }, [trades, threshold]);

  /* ── empty state ─────────────────────────────────────────── */

  if (trades.length === 0) {
    return (
      <p className="text-[13px] text-tertiary">
        No trades to analyze.
      </p>
    );
  }

  if (!analysis) return null;

  const {
    episodes,
    postTiltAvgPnl,
    aggregatePostTiltPnl,
    postTiltTradeCount,
    normalAvgPnl,
    avgSizeIncrease,
    hasBehavioralFlags,
    anyImpulse,
    anySizedUp,
    anyDeviated,
  } = analysis;

  const tiltEpisodes = episodes.length;
  const totalTrades = trades.length;
  const hasEpisodes = tiltEpisodes > 0;
  const epWord = tiltEpisodes === 1 ? "episode" : "episodes";
  const smallSample = postTiltTradeCount < TRUSTWORTHY_SAMPLE;

  /* ── Computed verdict ─────────────────────────────────────────
   * The dot/colour follows the data — no red alarm when the numbers
   * are green. Order matters: a negative aggregate outranks behaviour.
   */
  type Verdict = "costing" | "watch" | "variance" | "clean" | "neutral";
  let verdict: Verdict;
  if (!hasEpisodes) {
    verdict = totalTrades >= 10 ? "clean" : "neutral";
  } else if (aggregatePostTiltPnl < 0) {
    verdict = "costing";
  } else if (hasBehavioralFlags) {
    verdict = "watch";
  } else {
    verdict = "variance";
  }

  // Behaviours that actually fired this period — used in the WATCH copy.
  const firedBehaviors: string[] = [];
  if (anyImpulse) firedBehaviors.push("re-enter within minutes");
  if (anySizedUp) firedBehaviors.push("size up");
  if (anyDeviated) firedBehaviors.push("trade off-plan setups");

  const verdictMeta: Record<
    Verdict,
    { label: string; dotClass: string; labelClass: string; borderClass: string }
  > = {
    costing: {
      label: "Costing you",
      dotClass: "alert-dot",
      labelClass: "!text-loss",
      borderClass: "border-l-2 border-loss pl-5",
    },
    watch: {
      label: "Watch it",
      dotClass:
        "inline-block w-2 h-2 rounded-full bg-amber shadow-[0_0_0_4px_rgba(245,158,11,0.15)]",
      labelClass: "!text-amber",
      borderClass: "border-l-2 border-amber pl-5",
    },
    variance: {
      label: "Likely variance",
      dotClass: "inline-block w-2 h-2 rounded-full bg-tertiary",
      labelClass: "!text-tertiary",
      borderClass: "",
    },
    clean: {
      label: "No tilt",
      dotClass:
        "inline-block w-2 h-2 rounded-full bg-profit shadow-[0_0_0_4px_rgba(34,197,94,0.15)]",
      labelClass: "!text-profit",
      borderClass: "border-l-2 border-brand pl-5",
    },
    neutral: {
      label: "Not enough data",
      dotClass: "inline-block w-2 h-2 rounded-full bg-tertiary",
      labelClass: "!text-tertiary",
      borderClass: "",
    },
  };

  let verdictHeadline: string;
  let verdictSub: ReactNode;

  if (verdict === "clean") {
    verdictHeadline = "You don't tilt.";
    verdictSub = (
      <>0 tilt episodes in the last {dateRangeLabel}. Your post-loss discipline holds.</>
    );
  } else if (verdict === "neutral") {
    verdictHeadline = "Not enough data yet.";
    verdictSub = (
      <>Log at least 10 trades to detect tilt patterns. You have {totalTrades}.</>
    );
  } else if (verdict === "costing") {
    verdictHeadline = "Tilt is costing you.";
    verdictSub = (
      <>
        Post-tilt trades average{" "}
        <span className="font-mono text-loss">{fmtDollar(postTiltAvgPnl)}</span> vs{" "}
        <span className="font-mono">{fmtDollar(normalAvgPnl)}</span> normal across{" "}
        {tiltEpisodes} {epWord}. The losing streaks are leaking into what comes next.
      </>
    );
  } else if (verdict === "watch") {
    verdictSub = (
      <>
        After {threshold} losses you {joinList(firedBehaviors)} — but it isn't costing
        you yet ({fmtDollar(postTiltAvgPnl)} avg vs {fmtDollar(normalAvgPnl)} normal).{" "}
        {smallSample
          ? `${tiltEpisodes} ${epWord} (${postTiltTradeCount} post-tilt trades) is a small sample to trust. Watch it.`
          : `The behavior is consistent enough to act on. Watch it.`}
      </>
    );
    verdictHeadline = smallSample
      ? "The behavior fired — but it's a small sample."
      : "The behavior fired — and it's holding up.";
  } else {
    // variance
    verdictHeadline = "Probably just variance.";
    verdictSub = (
      <>
        {tiltEpisodes} loss {tiltEpisodes === 1 ? "streak" : "streaks"}, but no tilt
        behavior — sizing held, no impulse re-entries, stayed on plan. Looks like
        variance, not tilt.
      </>
    );
  }

  /* ── Footer rule / insight — aligned to the verdict ──────────── */
  let footerLabel: string;
  let footerBody: ReactNode;
  let footerTone: "clean" | "costing" | "watch" | "variance";

  if (verdict === "clean" || verdict === "neutral") {
    footerLabel = "Insight";
    footerBody = "Your post-loss trading is disciplined. No rule needed.";
    footerTone = "clean";
  } else if (verdict === "costing") {
    footerLabel = "Suggested rule";
    footerBody = (
      <>
        After {threshold} consecutive losses, step away for 30 minutes before the next
        trade. The data says the trades you take right after a streak are net negative.
      </>
    );
    footerTone = "costing";
  } else if (verdict === "watch") {
    footerLabel = smallSample ? "Insight" : "Suggested rule";
    footerBody = smallSample ? (
      <>
        The behavior is real, but the P/L hasn't turned yet and {postTiltTradeCount}{" "}
        post-tilt trades {postTiltTradeCount === 1 ? "is" : "are"} too few to call it.
        Don't congratulate the wins — flag the pattern and keep logging.
      </>
    ) : (
      <>
        The behavior keeps firing across {tiltEpisodes} {epWord}. It hasn't cost you yet,
        but pre-commit your size and setup after {threshold} losses before it does.
      </>
    );
    footerTone = "watch";
  } else {
    footerLabel = "Insight";
    footerBody =
      "Loss streaks happen to everyone. Without behavioral flags, there's no tilt to fix here — just variance.";
    footerTone = "variance";
  }

  /* ── Secondary stats (the hero stat is rendered separately) ───── */
  const sizeUp = avgSizeIncrease >= 0;
  const secondaryMetrics = [
    {
      key: "episodes",
      label: "Tilt Episodes",
      value: String(tiltEpisodes),
      valueClass: "text-primary",
      sub: `over ${totalTrades} trades`,
    },
    {
      key: "cost",
      // Net of every post-tilt trade — keyed to the same number as the verdict so the
      // two can never disagree. No net cost ⇒ a confident "$0 — no leak", never a dash.
      label: "Cost of Tilt",
      value: aggregatePostTiltPnl < 0 ? fmtDollar(aggregatePostTiltPnl) : "$0",
      valueClass: aggregatePostTiltPnl < 0 ? "text-loss" : "text-profit",
      sub: aggregatePostTiltPnl < 0 ? "net, post-tilt trades" : "no leak",
    },
    {
      key: "size",
      // avgSizeIncrease = mean of each episode's (post-tilt avg notional vs that
      // streak's avg notional). A single +30% episode can sit inside a negative mean.
      label: "Post-Tilt Sizing",
      value: `${sizeUp ? "+" : "−"}${Math.abs(avgSizeIncrease).toFixed(0)}%`,
      valueClass:
        avgSizeIncrease > REVENGE_SIZE_THRESHOLD_PCT ? "text-amber" : "text-primary",
      sub: `avg vs streak · ${tiltEpisodes} ${epWord}`,
    },
  ];

  const vm = verdictMeta[verdict];

  return (
    <section className={cn("space-y-8", vm.borderClass)}>
      {/* ── Verdict hero ─────────────────────────────────────── */}
      <div className="space-y-2 min-w-0">
        <div className="flex items-center gap-2">
          <span className={vm.dotClass} aria-hidden="true" />
          <span className={cn("metric-label", vm.labelClass)}>{vm.label}</span>
        </div>
        <h2 className="page-title">{verdictHeadline}</h2>
        <p className="text-[13px] text-secondary leading-relaxed">{verdictSub}</p>
      </div>

      {/* ── Stat hierarchy — one hero stat + three secondary ─────── */}
      {hasEpisodes && (
        <>
          <div className="section-divider" />

          {/* Hero stat: the verdict's key number */}
          <div className="metric-card">
            <p className="metric-label mb-3">Post-Tilt Avg P/L</p>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <p
                className={cn(
                  "hero-metric leading-none",
                  postTiltAvgPnl >= 0 ? "text-profit" : "text-loss",
                )}
              >
                {fmtDollar(postTiltAvgPnl)}
              </p>
              <p className="numeric text-[13px] text-tertiary">
                vs <span className="text-secondary">{fmtDollar(normalAvgPnl)}</span> normal
              </p>
            </div>
          </div>

          {/* Secondary stats */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {secondaryMetrics.map((m) => (
              <div key={m.key} className="metric-card">
                <p className="metric-label mb-2">{m.label}</p>
                <p
                  className={cn(
                    "numeric text-[26px] font-semibold leading-none",
                    m.valueClass,
                  )}
                >
                  {m.value}
                </p>
                <p className="numeric text-[11px] text-tertiary mt-2 leading-tight">
                  {m.sub}
                </p>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Footer rule / insight ────────────────────────────── */}
      <div
        className={cn(
          "rounded-md border-l-2 border border-white/[0.04] bg-white/[0.02] px-4 py-3",
          footerTone === "clean" && "border-l-brand",
          footerTone === "costing" && "border-l-loss",
          footerTone === "watch" && "border-l-amber",
          footerTone === "variance" && "border-l-white/20",
        )}
      >
        <p
          className={cn(
            "metric-label mb-1",
            footerTone === "clean" && "!text-brand",
            footerTone === "costing" && "!text-loss",
            footerTone === "watch" && "!text-amber",
          )}
        >
          {footerLabel}
        </p>
        <p className="text-[13px] text-secondary leading-relaxed">
          {footerBody}
        </p>
      </div>

      {/* ── Episode timeline ───────────────────────────────────── */}
      {episodes.length > 0 && (
        <>
          <div className="section-divider" />
          <div>
            <div className="flex items-center justify-between mb-4">
              <p className="metric-label">Tilt Episodes</p>
              <span className="numeric text-[11px] text-tertiary">
                {episodes.length} total
              </span>
            </div>

            <div className="flex flex-col gap-4">
              {episodes.map((ep, idx) => {
                const streakTotal = ep.streakPnls.reduce((s, p) => s + p, 0);
                const postTotal = ep.postPnls.reduce((s, p) => s + p, 0);
                return (
                  <article
                    key={ep.date + idx}
                    className="episode-card group relative"
                  >
                    {/* Header row — date + badges + hover chevron */}
                    <div className="flex items-start justify-between gap-3 mb-4">
                      <div className="flex items-baseline gap-3 min-w-0">
                        <span className="numeric text-[13px] font-medium text-primary">
                          {ep.date}
                        </span>
                        <span className="text-[11px] text-tertiary">
                          {ep.losingStreak.length} losses → {ep.postTiltTrades.length} post-tilt
                          {ep.postTiltTrades.length !== 1 ? " trades" : " trade"}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {ep.impulseEntry && (
                          <span className="tag-badge tag-badge--orange">Impulse</span>
                        )}
                        {ep.deviatedSetup && (
                          <span className="tag-badge tag-badge--purple">Off-plan</span>
                        )}
                        {ep.postSizeIncrease !== null &&
                          ep.postSizeIncrease > REVENGE_SIZE_THRESHOLD_PCT && (
                            <span className="tag-badge tag-badge--amber">
                              +{ep.postSizeIncrease.toFixed(0)}% size
                            </span>
                          )}
                        <ChevronDown
                          size={14}
                          strokeWidth={2}
                          className="episode-chevron -rotate-90 ml-1"
                          aria-hidden="true"
                        />
                      </div>
                    </div>

                    {/* Why flagged — vertical checklist, one trigger per line */}
                    {(() => {
                      const { trigger, flags } = buildChecklist(ep, threshold);
                      return (
                        <div className="mb-4">
                          <p className="metric-label mb-2">Why flagged</p>
                          <ul className="flex flex-col gap-1.5">
                            <li className="flex items-start gap-2 text-[11px] leading-relaxed">
                              <Check
                                size={12}
                                strokeWidth={2.5}
                                className="mt-[3px] shrink-0 text-tertiary"
                                aria-hidden="true"
                              />
                              <span className="text-secondary">{trigger}</span>
                            </li>
                            {flags.map((line) => (
                              <li
                                key={line}
                                className="flex items-start gap-2 text-[11px] leading-relaxed"
                              >
                                <Check
                                  size={12}
                                  strokeWidth={2.5}
                                  className="mt-[3px] shrink-0 text-amber"
                                  aria-hidden="true"
                                />
                                <span className="text-secondary">{line}</span>
                              </li>
                            ))}
                          </ul>
                          {flags.length === 0 && (
                            <p className="text-[11px] text-tertiary mt-2 leading-relaxed pl-[20px]">
                              Loss streak only — no behavioral flags. May be variance.
                            </p>
                          )}
                        </div>
                      );
                    })()}

                    {/* Trade rows — constrained inside card */}
                    <div className="flex flex-col">
                      {ep.losingStreak.map((t, ti) => {
                        const pnl = ep.streakPnls[ti];
                        return (
                          <div
                            key={t.id}
                            className="flex items-center gap-3 h-8 border-b border-white/[0.04] last:border-b-0"
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-loss shrink-0" />
                            <span className="numeric text-[12px] font-medium text-secondary w-[60px] shrink-0">
                              {t.ticker}
                            </span>
                            <span className="numeric text-[11px] text-tertiary w-[90px] shrink-0">
                              {t.entry_time?.slice(0, 5)}–{t.exit_time?.slice(0, 5)}
                            </span>
                            <span className="flex-1 min-w-0 text-[11px] text-tertiary truncate">
                              {t.setup || "—"}
                            </span>
                            <span className="numeric w-[80px] shrink-0 text-right text-[12px] font-medium text-loss leading-tight">
                              {fmtDollar(pnl)}
                            </span>
                          </div>
                        );
                      })}

                      {/* Post-tilt divider */}
                      <div className="flex items-center gap-2 my-2">
                        <div className="flex-1 h-px bg-amber/30" />
                        <span className="text-[10px] font-medium uppercase tracking-wider text-amber/70">
                          Post-tilt
                        </span>
                        <div className="flex-1 h-px bg-amber/30" />
                      </div>

                      {ep.postTiltTrades.map((t, ti) => {
                        const pnl = ep.postPnls[ti];
                        return (
                          <div
                            key={t.id}
                            className="flex items-center gap-3 h-8 border-b border-white/[0.04] last:border-b-0 bg-amber/[0.04] rounded-sm px-2 -mx-2"
                          >
                            <span
                              className={cn(
                                "w-1.5 h-1.5 rounded-full shrink-0",
                                pnl >= 0 ? "bg-profit" : "bg-amber",
                              )}
                            />
                            <span className="numeric text-[12px] font-medium text-secondary w-[60px] shrink-0">
                              {t.ticker}
                            </span>
                            <span className="numeric text-[11px] text-tertiary w-[90px] shrink-0">
                              {t.entry_time?.slice(0, 5)}–{t.exit_time?.slice(0, 5)}
                            </span>
                            <span className="flex-1 min-w-0 text-[11px] text-tertiary truncate">
                              {t.setup || "—"}
                            </span>
                            <span
                              className={cn(
                                "numeric w-[80px] shrink-0 text-right text-[12px] font-medium leading-tight",
                                pnl >= 0 ? "text-profit" : "text-amber",
                              )}
                            >
                              {fmtDollar(pnl)}
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    {/* Episode totals */}
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mt-4 pt-3 border-t border-white/[0.04]">
                      <span className="text-[10px] text-tertiary">
                        <span className="metric-label inline">Streak P/L</span>{" "}
                        <span className="numeric text-[12px] font-medium text-loss ml-1">
                          {fmtDollar(streakTotal)}
                        </span>
                      </span>
                      <span className="text-[10px] text-tertiary">
                        <span className="metric-label inline">Post-tilt P/L</span>{" "}
                        <span
                          className={cn(
                            "numeric text-[12px] font-medium ml-1",
                            postTotal >= 0 ? "text-profit" : "text-amber",
                          )}
                        >
                          {fmtDollar(postTotal)}
                        </span>
                      </span>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
