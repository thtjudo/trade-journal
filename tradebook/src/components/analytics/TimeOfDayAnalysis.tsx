import { useMemo } from "react";
import { cn } from "../../lib/utils";
import { get24hClock } from "../../lib/clockFormat";
import type { Trade } from "../../types/trade";
import { calcNetPnl } from "../../lib/calc";

interface Props {
  trades: Trade[];
}

interface BucketData {
  label: string;
  startMin: number;
  endMin: number;
  count: number;
  netPnl: number;
  wins: number;
  losses: number;
  winRate: number;
  avgPnl: number;
}

/* ── helpers ────────────────────────────────────────────────── */

function parseMinutes(time: string): number | null {
  if (!time) return null;
  const m = time.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function fmtTime(h24: number, m: number, use24h: boolean): string {
  if (use24h) {
    return `${String(h24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
  const h = h24 > 12 ? h24 - 12 : h24 === 0 ? 12 : h24;
  return `${h}:${String(m).padStart(2, "0")}`;
}

function fmtDollar(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : v > 0 ? "+" : "";
  if (abs >= 10_000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(2)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

/* ── thresholds (eyeball these) ─────────────────────────────── */

const MIN_SLOT_SAMPLE = 5;              // trades needed in a slot before win rate / avg P&L display as meaningful
const DANGER_ZONE_WIN_RATE_PCT = 35;    // slots with ≥ MIN_SLOT_SAMPLE and win rate below this get flagged

// 14 x 30-min windows: 9:00 AM → 4:00 PM
const WINDOWS: { startMin: number; endMin: number }[] = [];
for (let h = 9; h < 16; h++) {
  for (let m = 0; m < 60; m += 30) {
    const start = h * 60 + m;
    if (start >= 960) break;
    const end = start + 30;
    WINDOWS.push({ startMin: start, endMin: end });
  }
}

function windowLabel(w: { startMin: number; endMin: number }, use24h: boolean): string {
  const sH = Math.floor(w.startMin / 60);
  const sM = w.startMin % 60;
  const eH = Math.floor(w.endMin / 60);
  const eM = w.endMin % 60;
  return `${fmtTime(sH, sM, use24h)}\u2013${fmtTime(eH, eM, use24h)}`;
}

// "First 30 min" = 9:30-10:00 (market open)
const OPEN_START = 9 * 60 + 30; // 570
const OPEN_END = 10 * 60; // 600

/* ── component ──────────────────────────────────────────────── */

export default function TimeOfDayAnalysis({ trades }: Props) {
  const use24h = get24hClock();

  const { buckets, maxAbsPnl, first30, restOfDay, insights } = useMemo(() => {
    // Bucket trades
    const bucketMap = new Map<number, Trade[]>();
    for (const w of WINDOWS) bucketMap.set(w.startMin, []);

    for (const t of trades) {
      const mins = parseMinutes(t.entry_time);
      if (mins === null) continue;
      for (const w of WINDOWS) {
        if (mins >= w.startMin && mins < w.endMin) {
          bucketMap.get(w.startMin)!.push(t);
          break;
        }
      }
    }

    // Build bucket data
    const buckets: BucketData[] = WINDOWS.map((w) => {
      const bt = bucketMap.get(w.startMin)!;
      const pnls = bt.map((t) => calcNetPnl(t));
      const netPnl = pnls.reduce((s, p) => s + p, 0);
      const wins = pnls.filter((p) => p > 0).length;
      const losses = pnls.filter((p) => p <= 0).length;
      return {
        label: windowLabel(w, use24h),
        startMin: w.startMin,
        endMin: w.endMin,
        count: bt.length,
        netPnl,
        wins,
        losses,
        winRate: bt.length > 0 ? (wins / bt.length) * 100 : 0,
        avgPnl: bt.length > 0 ? netPnl / bt.length : 0,
      };
    });

    const maxAbsPnl = Math.max(1, ...buckets.map((b) => Math.abs(b.netPnl)));

    // First 30 min vs rest
    const first30Trades: Trade[] = [];
    const restTrades: Trade[] = [];
    for (const t of trades) {
      const mins = parseMinutes(t.entry_time);
      if (mins === null) continue;
      if (mins >= OPEN_START && mins < OPEN_END) first30Trades.push(t);
      else restTrades.push(t);
    }

    function buildGroupStats(group: Trade[]) {
      const pnls = group.map((t) => calcNetPnl(t));
      const total = pnls.reduce((s, p) => s + p, 0);
      const wins = pnls.filter((p) => p > 0).length;
      return {
        count: group.length,
        totalPnl: total,
        winRate: group.length > 0 ? (wins / group.length) * 100 : 0,
        avgTrade: group.length > 0 ? total / group.length : 0,
      };
    }

    const first30 = buildGroupStats(first30Trades);
    const restOfDay = buildGroupStats(restTrades);

    // Insights — best/worst only picked from slots with enough samples to be meaningful;
    // mostActive stays across any active slot (popularity is factual regardless of n).
    const activeBuckets = buckets.filter((b) => b.count > 0);
    const significantBuckets = buckets.filter((b) => b.count >= MIN_SLOT_SAMPLE);
    const best = significantBuckets.length
      ? significantBuckets.reduce((a, b) => (b.avgPnl > a.avgPnl ? b : a))
      : null;
    const worst = significantBuckets.length
      ? significantBuckets.reduce((a, b) => (b.avgPnl < a.avgPnl ? b : a))
      : null;
    const mostActive = activeBuckets.length
      ? activeBuckets.reduce((a, b) => (b.count > a.count ? b : a))
      : null;
    const dangerZones = buckets.filter(
      (b) => b.count >= MIN_SLOT_SAMPLE && b.winRate < DANGER_ZONE_WIN_RATE_PCT,
    );

    return {
      buckets,
      maxAbsPnl,
      first30,
      restOfDay,
      insights: { best, worst, mostActive, dangerZones },
    };
  }, [trades, use24h]);

  if (trades.length === 0) {
    return (
      <p className="text-[13px] text-tertiary">
        No trades to analyze.
      </p>
    );
  }

  /* ── SVG chart dimensions ─────────────────────────────────── */
  const ROW_H = 28;
  const PAD = { t: 8, b: 8, l: 100, r: 240 };
  const W = 800;
  const chartW = W - PAD.l - PAD.r;
  const centerX = PAD.l + chartW / 2;
  const H = PAD.t + WINDOWS.length * ROW_H + PAD.b;

  /* ── Subtitle helpers ──────────────────────────────────────── */
  const first30Sub = use24h ? "09:30 \u2013 10:00" : "9:30 \u2013 10:00 AM";
  const restSub = use24h ? "10:00 \u2013 16:00" : "10:00 AM \u2013 4:00 PM";

  return (
    <div className="space-y-8">
      {/* ── Bar chart ───────────────────────────────────────── */}
      <div className="border-t border-white/[0.04] pt-4">
        <p className="metric-label mb-4">
          Profit / Loss by Time of Day
        </p>

        <svg
          width="100%"
          viewBox={`0 0 ${W} ${H}`}
          className="overflow-visible"
        >
          {/* center zero line */}
          <line
            x1={centerX}
            y1={PAD.t}
            x2={centerX}
            y2={H - PAD.b}
            stroke="rgba(255,255,255,0.06)"
            strokeWidth="1"
            strokeDasharray="3,3"
          />

          {buckets.map((b, i) => {
            const y = PAD.t + i * ROW_H;
            const cy = y + ROW_H / 2;
            const barMaxW = chartW / 2 - 4;
            const barW =
              b.count > 0
                ? (Math.abs(b.netPnl) / maxAbsPnl) * barMaxW
                : 0;
            const isProfit = b.netPnl >= 0;
            const barX = isProfit ? centerX : centerX - barW;
            const barColor = isProfit ? "#22c55e" : "#ef4444";
            const hasEnough = b.count >= MIN_SLOT_SAMPLE;
            const isInsufficient = b.count > 0 && !hasEnough;

            return (
              <g key={b.startMin}>
                {/* alternating row bg */}
                {i % 2 === 0 && (
                  <rect
                    x={0}
                    y={y}
                    width={W}
                    height={ROW_H}
                    fill="rgba(255,255,255,0.015)"
                  />
                )}

                {/* time label */}
                <text
                  x={PAD.l - 8}
                  y={cy + 4}
                  fill="#9ca3af"
                  fontSize="10"
                  textAnchor="end"
                  fontFamily="Inter, sans-serif"
                >
                  {b.label}
                </text>

                {/* bar — dimmed when sample is insufficient */}
                {barW > 0 && (
                  <rect
                    x={barX}
                    y={cy - 8}
                    width={barW}
                    height={16}
                    rx={3}
                    fill={barColor}
                    fillOpacity={isInsufficient ? 0.3 : 0.75}
                  />
                )}

                {/* Right-aligned label — three states: empty / insufficient / enough */}
                {b.count === 0 ? (
                  <text
                    x={W - 12}
                    y={cy + 3.5}
                    textAnchor="end"
                    fontSize="9.5"
                    fill="#3f3f46"
                    fontFamily="Inter, sans-serif"
                  >
                    —
                  </text>
                ) : isInsufficient ? (
                  <text
                    x={W - 12}
                    y={cy + 3.5}
                    textAnchor="end"
                    fontSize="9.5"
                    fontFamily="Inter, sans-serif"
                  >
                    <tspan
                      fill={barColor}
                      fontWeight="600"
                      fontFamily="ui-monospace, SFMono-Regular, monospace"
                      fontSize="10"
                      fillOpacity={0.5}
                    >
                      {fmtDollar(b.netPnl)}
                    </tspan>
                    <tspan fill="#52525b">
                      {"  ·  need more trades in this slot ("}{b.count}/{MIN_SLOT_SAMPLE}{")"}
                    </tspan>
                  </text>
                ) : (
                  <text
                    x={W - 12}
                    y={cy + 3.5}
                    textAnchor="end"
                    fontSize="9.5"
                    fontFamily="Inter, sans-serif"
                  >
                    <tspan
                      fill={barColor}
                      fontWeight="600"
                      fontFamily="ui-monospace, SFMono-Regular, monospace"
                      fontSize="10"
                    >
                      {fmtDollar(b.netPnl)}
                    </tspan>
                    <tspan fill="#52525b">
                      {"  ·  "}{b.count} trade{b.count !== 1 ? "s" : ""}  ·  {b.winRate.toFixed(0)}% Win Rate
                    </tspan>
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* ── First 30 min vs Rest of Day ─────────────────────── */}
      <div className="border-t border-white/[0.04] pt-4">
        <p className="metric-label mb-4">
          First 30 min vs Rest of Day
        </p>

        <div className="grid grid-cols-2 gap-4">
          <ComparisonColumn
            title="First 30 min"
            subtitle={first30Sub}
            stats={first30}
            hasEnoughSamples={first30.count >= MIN_SLOT_SAMPLE}
          />
          <ComparisonColumn
            title="Rest of Day"
            subtitle={restSub}
            stats={restOfDay}
            hasEnoughSamples={restOfDay.count >= MIN_SLOT_SAMPLE}
          />
        </div>
      </div>

      {/* ── Key Insights ────────────────────────────────────── */}
      <div className="border-t border-white/[0.04] pt-4">
        <p className="metric-label mb-4">
          Key Insights
        </p>

        {(insights.best?.count || insights.worst?.count || insights.mostActive?.count) ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {insights.best && insights.best.count > 0 && (
              <InsightCard
                label="Best window"
                value={`${fmtDollar(insights.best.avgPnl)}/trade`}
                sub={`${insights.best.label} · ${insights.best.count} trades`}
                tone="profit"
              />
            )}
            {insights.worst && insights.worst.count > 0 && (
              <InsightCard
                label="Worst window"
                value={`${fmtDollar(insights.worst.avgPnl)}/trade`}
                sub={`${insights.worst.label} · ${insights.worst.count} trades`}
                tone="loss"
              />
            )}
            {insights.mostActive && insights.mostActive.count > 0 && (
              <InsightCard
                label="Most active"
                value={`${insights.mostActive.count} trades`}
                sub={insights.mostActive.label}
                tone="brand"
              />
            )}
          </div>
        ) : (
          <p className="text-xs text-tertiary">
            Not enough data to generate insights.
          </p>
        )}

        {insights.dangerZones.length > 0 && (
          <div className="mt-4 rounded-md border border-loss/20 bg-loss-muted px-3 py-2.5">
            <p className="text-[13px] font-medium text-loss mb-1.5">
              Danger Zones
            </p>
            {insights.dangerZones.map((dz) => (
              <p
                key={dz.startMin}
                className="text-xs text-loss/80"
              >
                {dz.label} — {dz.winRate.toFixed(0)}% win rate
                across {dz.count} trades
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── sub-components ─────────────────────────────────────────── */

function ComparisonColumn({
  title,
  subtitle,
  stats,
  hasEnoughSamples,
}: {
  title: string;
  subtitle: string;
  stats: {
    count: number;
    totalPnl: number;
    winRate: number;
    avgTrade: number;
  };
  hasEnoughSamples: boolean;
}) {
  const pnlColor =
    stats.totalPnl > 0
      ? "text-profit"
      : stats.totalPnl < 0
        ? "text-loss"
        : "text-secondary";

  // Three states: empty (count===0) / insufficient (0<count<MIN) / enough
  const showStats = stats.count > 0 && hasEnoughSamples;

  return (
    <div className="border-t border-white/[0.04] pt-4">
      <p className="text-xs font-medium text-primary">{title}</p>
      <p className="text-[10px] text-tertiary mb-3">{subtitle}</p>

      <div className="space-y-2">
        <StatRow label="Total Profit / Loss" value={stats.count > 0 ? fmtDollar(stats.totalPnl) : "—"} color={pnlColor} />
        <StatRow
          label="Win Rate"
          value={showStats ? `${stats.winRate.toFixed(1)}%` : "—"}
          color={showStats && stats.winRate >= 50 ? "text-profit" : showStats ? "text-loss" : "text-tertiary"}
        />
        <StatRow
          label="Avg Trade"
          value={showStats ? fmtDollar(stats.avgTrade) : "—"}
          color={
            !showStats
              ? "text-tertiary"
              : stats.avgTrade > 0
                ? "text-profit"
                : stats.avgTrade < 0
                  ? "text-loss"
                  : "text-secondary"
          }
        />
        <StatRow label="Trades" value={String(stats.count)} color="text-secondary" />
      </div>

      {stats.count > 0 && !hasEnoughSamples && (
        <p className="text-[10px] text-tertiary mt-3 leading-relaxed">
          Need more trades in this slot — {stats.count} of {MIN_SLOT_SAMPLE} logged.
        </p>
      )}
    </div>
  );
}

function StatRow({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[13px] font-medium text-secondary">
        {label}
      </span>
      <span className={cn("text-[13px] font-medium font-mono", color)}>
        {value}
      </span>
    </div>
  );
}

function InsightCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: "profit" | "loss" | "brand";
}) {
  const valueColor =
    tone === "profit" ? "text-profit" : tone === "loss" ? "text-loss" : "text-brand";
  const accent =
    tone === "profit"
      ? "border-profit/20 bg-profit-muted"
      : tone === "loss"
        ? "border-loss/20 bg-loss-muted"
        : "border-brand/20 bg-brand-muted";

  return (
    <div className={cn("rounded-lg border px-3.5 py-3", accent)}>
      <p className="text-[11px] font-medium text-tertiary uppercase tracking-wide">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 text-lg font-medium font-mono tabular-nums leading-tight tracking-tight",
          valueColor,
        )}
      >
        {value}
      </p>
      <p className="mt-1 text-[11px] text-secondary">{sub}</p>
    </div>
  );
}
