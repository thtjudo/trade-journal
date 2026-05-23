import { useMemo, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import type { Trade } from "../../types/trade";
import { calcNetPnl } from "../../lib/calc";

interface Props {
  trades: Trade[];
}

interface TradePoint {
  trade: Trade;
  holdMin: number;
  pnl: number;
  positionSize: number;
}

interface HoldBucket {
  label: string;
  min: number;
  max: number;
  count: number;
  wins: number;
  winRate: number;
  avgPnl: number;
  totalPnl: number;
}

/* ── constants ──────────────────────────────────────────────── */

const BUCKET_DEFS = [
  { label: "<2 min", min: 0, max: 2 },
  { label: "2–5 min", min: 2, max: 5 },
  { label: "5–15 min", min: 5, max: 15 },
  { label: "15–30 min", min: 15, max: 30 },
  { label: "30–60 min", min: 30, max: 60 },
  { label: ">60 min", min: 60, max: Infinity },
];

/* ── helpers ────────────────────────────────────────────────── */

function parseMinutes(time: string): number | null {
  if (!time) return null;
  const m = time.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const mins = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  if (m[3]) return mins + parseInt(m[3], 10) / 60;
  return mins;
}

function fmtDollar(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : v > 0 ? "+" : "";
  if (abs >= 10_000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(2)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

function fmtAxisDollar(v: number): string {
  if (v === 0) return "$0";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

function fmtHoldTime(mins: number): string {
  if (mins < 1) return `${Math.round(mins * 60)}s`;
  if (mins < 60) return `${Math.round(mins)} min`;
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/** Pick a human-friendly tick step for a given range and target count. */
function niceStep(range: number, targetTicks: number): number {
  if (range <= 0) return 1;
  const rough = range / targetTicks;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const residual = rough / mag;
  let nice: number;
  if (residual <= 1.5) nice = 1;
  else if (residual <= 3) nice = 2;
  else if (residual <= 7) nice = 5;
  else nice = 10;
  return nice * mag;
}

/* ── component ──────────────────────────────────────────────── */

export default function HoldTimeAnalysis({ trades }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{
    point: TradePoint;
    x: number;
    y: number;
    flipX: boolean;
  } | null>(null);

  const { points, buckets, sweetSpot, insights } = useMemo(() => {
    const points: TradePoint[] = [];

    for (const t of trades) {
      const entry = parseMinutes(t.entry_time);
      const exit = parseMinutes(t.exit_time);
      if (entry === null || exit === null) continue;
      const holdMin = exit - entry;
      if (holdMin <= 0) continue;
      points.push({
        trade: t,
        holdMin,
        pnl: calcNetPnl(t),
        positionSize: t.shares * t.entry_price,
      });
    }

    // Bucketed stats
    const buckets: HoldBucket[] = BUCKET_DEFS.map((def) => {
      const inBucket = points.filter(
        (p) => p.holdMin >= def.min && p.holdMin < def.max,
      );
      const pnls = inBucket.map((p) => p.pnl);
      const total = pnls.reduce((s, v) => s + v, 0);
      const wins = pnls.filter((v) => v > 0).length;
      return {
        ...def,
        count: inBucket.length,
        wins,
        winRate: inBucket.length > 0 ? (wins / inBucket.length) * 100 : 0,
        avgPnl: inBucket.length > 0 ? total / inBucket.length : 0,
        totalPnl: total,
      };
    });

    // Sweet spot: highest avg P&L with >=5 trades
    const eligible = buckets.filter((b) => b.count >= 5);
    const sweetSpot = eligible.length
      ? eligible.reduce((a, b) => (b.avgPnl > a.avgPnl ? b : a))
      : null;

    // "Cutting winners" insight
    const winningPoints = points.filter((p) => p.pnl > 0);
    let cutWinnersInsight: string | null = null;

    if (winningPoints.length >= 4) {
      const sorted = [...winningPoints].sort(
        (a, b) => a.holdMin - b.holdMin,
      );
      const medianHold =
        sorted[Math.floor(sorted.length / 2)].holdMin;

      const shortWins = winningPoints.filter(
        (p) => p.holdMin <= medianHold,
      );
      const longWins = winningPoints.filter(
        (p) => p.holdMin > medianHold,
      );

      const avgShort =
        shortWins.length > 0
          ? shortWins.reduce((s, p) => s + p.pnl, 0) / shortWins.length
          : 0;
      const avgLong =
        longWins.length > 0
          ? longWins.reduce((s, p) => s + p.pnl, 0) / longWins.length
          : 0;

      if (avgLong > avgShort && longWins.length > 0) {
        const diff = avgLong - avgShort;
        cutWinnersInsight = `You tend to cut winners at ${fmtHoldTime(medianHold)} — your wins held past ${fmtHoldTime(medianHold)} averaged ${fmtDollar(diff)} more`;
      }
    }

    return { points, buckets, sweetSpot, insights: { cutWinnersInsight } };
  }, [trades]);

  /* ── empty states ─────────────────────────────────────────── */

  if (trades.length === 0) {
    return (
      <p className="text-[13px] text-tertiary">
        No trades to analyze.
      </p>
    );
  }

  if (points.length === 0) {
    return (
      <p className="text-[13px] text-tertiary">
        No trades with valid entry &amp; exit times.
      </p>
    );
  }

  /* ── SVG scatter plot layout ──────────────────────────────── */

  const W = 600;
  const H = 340;
  const PAD = { t: 15, r: 20, b: 35, l: 55 };
  const cW = W - PAD.l - PAD.r;
  const cH = H - PAD.t - PAD.b;

  const maxHold = Math.max(...points.map((p) => p.holdMin));
  const minPnl = Math.min(0, ...points.map((p) => p.pnl));
  const maxPnl = Math.max(0, ...points.map((p) => p.pnl));
  const pnlRange = maxPnl - minPnl || 1;
  const maxPos = Math.max(...points.map((p) => p.positionSize));
  const minPos = Math.min(...points.map((p) => p.positionSize));
  const posRange = maxPos - minPos || 1;

  // Extend axis bounds to nice tick boundaries so labels never render outside the chart
  const xStep = niceStep(maxHold, 5);
  const xMax = Math.ceil(maxHold / xStep) * xStep || xStep;

  const yStep = niceStep(pnlRange, 4);
  const yMin = Math.floor(minPnl / yStep) * yStep;
  const yMax = Math.ceil(maxPnl / yStep) * yStep;
  const yScale = yMax - yMin || 1;

  const toX = (hold: number) => PAD.l + (hold / xMax) * cW;
  const toY = (pnl: number) =>
    PAD.t + cH - ((pnl - yMin) / yScale) * cH;
  const toR = (pos: number) =>
    3 + ((pos - minPos) / posRange) * 7;

  const zeroY = toY(0);

  const xTicks: number[] = [];
  for (let v = 0; v <= xMax + xStep * 0.01; v += xStep) xTicks.push(v);

  const yTicks: number[] = [];
  for (let v = yMin; v <= yMax + yStep * 0.01; v += yStep) yTicks.push(v);

  function handleDotEnter(point: TradePoint, e: React.PointerEvent) {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setTooltip({ point, x, y, flipX: x > rect.width * 0.6 });
  }

  // Bubble legend reference sizes (uses same toR scale)
  const legendSizes =
    maxPos > minPos
      ? [
          { label: fmtDollar(minPos), r: toR(minPos) },
          { label: fmtDollar((minPos + maxPos) / 2), r: toR((minPos + maxPos) / 2) },
          { label: fmtDollar(maxPos), r: toR(maxPos) },
        ]
      : [{ label: fmtDollar(maxPos), r: toR(maxPos) }];

  return (
    <div className="space-y-8">
      {/* ── Scatter plot ──────────────────────────────────────── */}
      <div className="rounded-lg border border-white/[0.06] bg-white/[0.015] p-4 sm:p-5">
        <div className="flex items-start justify-between gap-4 mb-3 flex-wrap">
          <div>
            <h3 className="text-[13px] font-medium text-primary">
              Hold Time vs Profit / Loss
            </h3>
            <p className="text-[11px] text-tertiary mt-0.5">
              Each dot is a trade. Size = position size ($). Green = win, red = loss.
            </p>
          </div>

          {/* Bubble size legend */}
          <div className="flex items-center gap-3 text-[10px] text-tertiary">
            <span className="text-[10px] text-tertiary">Position size</span>
            <div className="flex items-end gap-3">
              {legendSizes.map((l) => (
                <div key={l.label} className="flex flex-col items-center gap-1">
                  <svg width={l.r * 2 + 2} height={l.r * 2 + 2}>
                    <circle
                      cx={l.r + 1}
                      cy={l.r + 1}
                      r={l.r}
                      fill="#71717a"
                      fillOpacity={0.45}
                      stroke="#71717a"
                      strokeOpacity={0.7}
                    />
                  </svg>
                  <span className="font-mono">{l.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div ref={containerRef} className="relative">
          <svg
            width="100%"
            viewBox={`0 0 ${W} ${H}`}
            className="overflow-visible"
          >
            {/* gridlines */}
            {yTicks.map((v) => (
              <line
                key={`grid-${v}`}
                x1={PAD.l}
                y1={toY(v)}
                x2={W - PAD.r}
                y2={toY(v)}
                stroke="rgba(255,255,255,0.03)"
                strokeWidth="1"
              />
            ))}
            {/* break-even (zero) line */}
            <line
              x1={PAD.l}
              y1={zeroY}
              x2={W - PAD.r}
              y2={zeroY}
              stroke="rgba(255,255,255,0.18)"
              strokeWidth="1"
              strokeDasharray="4,4"
            />
            <text
              x={W - PAD.r - 4}
              y={zeroY - 4}
              fill="#71717a"
              fontSize="9"
              textAnchor="end"
              fontFamily="Inter, sans-serif"
            >
              break-even
            </text>

            {/* X axis */}
            <line
              x1={PAD.l}
              y1={H - PAD.b}
              x2={W - PAD.r}
              y2={H - PAD.b}
              stroke="rgba(255,255,255,0.06)"
              strokeWidth="1"
            />

            {/* Y axis */}
            <line
              x1={PAD.l}
              y1={PAD.t}
              x2={PAD.l}
              y2={H - PAD.b}
              stroke="rgba(255,255,255,0.06)"
              strokeWidth="1"
            />

            {/* X ticks */}
            {xTicks.map((v) => (
              <g key={`x${v}`}>
                <line
                  x1={toX(v)}
                  y1={H - PAD.b}
                  x2={toX(v)}
                  y2={H - PAD.b + 4}
                  stroke="rgba(255,255,255,0.06)"
                  strokeWidth="1"
                />
                <text
                  x={toX(v)}
                  y={H - PAD.b + 16}
                  fill="#52525b"
                  fontSize="9"
                  textAnchor="middle"
                  fontFamily="Inter, sans-serif"
                >
                  {v < 60
                    ? `${Math.round(v)}m`
                    : v % 60 === 0
                      ? `${v / 60}h`
                      : `${(v / 60).toFixed(1)}h`}
                </text>
              </g>
            ))}

            {/* Y ticks */}
            {yTicks.map((v) => (
              <g key={`y${v}`}>
                <line
                  x1={PAD.l - 4}
                  y1={toY(v)}
                  x2={PAD.l}
                  y2={toY(v)}
                  stroke="rgba(255,255,255,0.06)"
                  strokeWidth="1"
                />
                <text
                  x={PAD.l - 7}
                  y={toY(v) + 3}
                  fill="#52525b"
                  fontSize="9"
                  textAnchor="end"
                  fontFamily="Inter, sans-serif"
                >
                  {fmtAxisDollar(v)}
                </text>
              </g>
            ))}

            {/* dots — render losses first so wins layer on top */}
            {points
              .slice()
              .sort((a, b) => a.pnl - b.pnl)
              .map((p, i) => {
                const win = p.pnl > 0;
                return (
                  <circle
                    key={i}
                    cx={toX(p.holdMin)}
                    cy={toY(p.pnl)}
                    r={toR(p.positionSize)}
                    fill={win ? "#22c55e" : "#ef4444"}
                    fillOpacity={0.65}
                    stroke={win ? "#22c55e" : "#ef4444"}
                    strokeWidth="1"
                    strokeOpacity={0.85}
                    className="cursor-pointer"
                    style={{ transition: "r 0.15s" }}
                    onPointerEnter={(e) => handleDotEnter(p, e)}
                    onPointerLeave={() => setTooltip(null)}
                  />
                );
              })}
          </svg>

          {/* Tooltip */}
          {tooltip && (
            <div
              className="absolute z-50 pointer-events-none rounded-md border border-white/[0.06] bg-surface-2 px-3 py-2.5 backdrop-blur-sm"
              style={{
                left: tooltip.flipX
                  ? tooltip.x - 12
                  : tooltip.x + 12,
                top: tooltip.y - 8,
                transform: tooltip.flipX
                  ? "translate(-100%, -100%)"
                  : "translateY(-100%)",
              }}
            >
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-medium text-primary">
                  {tooltip.point.trade.ticker}
                </span>
                <span className="text-[10px] text-tertiary">
                  {tooltip.point.trade.trade_date}
                </span>
              </div>
              <div className="mt-1 space-y-0.5 text-[11px]">
                <p className="text-secondary">
                  Hold:{" "}
                  <span className="text-primary">
                    {fmtHoldTime(tooltip.point.holdMin)}
                  </span>
                </p>
                <p className="text-secondary">
                  Profit / Loss:{" "}
                  <span
                    className={cn(
                      "font-mono",
                      tooltip.point.pnl >= 0
                        ? "text-profit"
                        : "text-loss",
                    )}
                  >
                    {fmtDollar(tooltip.point.pnl)}
                  </span>
                </p>
                {tooltip.point.trade.setup && (
                  <p className="text-secondary">
                    Setup:{" "}
                    <span className="text-primary">
                      {tooltip.point.trade.setup}
                    </span>
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Bucketed stats ────────────────────────────────────── */}
      <div className="border-t border-white/[0.04] pt-4">
        <p className="metric-label mb-4">
          Hold Time Breakdown
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-[13px] text-left">
            <thead>
              <tr className="border-b border-border">
                {["Duration", "Trades", "Win Rate", "Avg Profit / Loss", "Total Profit / Loss"].map(
                  (h, i) => (
                    <th
                      key={h}
                      className={cn(
                        "text-[13px] font-medium text-secondary pb-2",
                        i > 0 && "text-right",
                      )}
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {buckets.map((b) => {
                const isSweetSpot =
                  sweetSpot !== null && b.label === sweetSpot.label;
                return (
                  <tr
                    key={b.label}
                    className={cn(
                      "border-b border-border hover:bg-surface-2 transition-colors",
                      isSweetSpot && "bg-brand-muted",
                    )}
                  >
                    <td className="py-2.5 text-xs text-secondary">
                      {b.label}
                      {isSweetSpot && (
                        <span className="ml-2 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-brand-muted text-profit border border-brand/20">
                          Sweet Spot
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 text-xs text-secondary text-right">
                      {b.count}
                    </td>
                    <td
                      className={cn(
                        "py-2.5 text-xs text-right font-medium",
                        b.count === 0
                          ? "text-tertiary"
                          : b.winRate >= 50
                            ? "text-profit"
                            : "text-loss",
                      )}
                    >
                      {b.count > 0 ? `${b.winRate.toFixed(0)}%` : "—"}
                    </td>
                    <td
                      className={cn(
                        "py-2.5 text-xs text-right font-medium font-mono",
                        b.count === 0
                          ? "text-tertiary"
                          : b.avgPnl > 0
                            ? "text-profit"
                            : "text-loss",
                      )}
                    >
                      {b.count > 0 ? fmtDollar(b.avgPnl) : "—"}
                    </td>
                    <td
                      className={cn(
                        "py-2.5 text-xs text-right font-medium font-mono",
                        b.count === 0
                          ? "text-tertiary"
                          : b.totalPnl > 0
                            ? "text-profit"
                            : "text-loss",
                      )}
                    >
                      {b.count > 0 ? fmtDollar(b.totalPnl) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Auto-insights ─────────────────────────────────────── */}
      <div className="border-t border-white/[0.04] pt-4">
        <p className="metric-label mb-4">
          Hold Time Insights
        </p>

        <div className="space-y-2.5">
          {sweetSpot && (
            <div className="flex items-baseline gap-2">
              <span className="text-[13px] font-medium shrink-0 text-profit">
                Optimal hold
              </span>
              <span className="text-xs text-secondary">
                Your optimal hold time is{" "}
                <span className="text-primary font-medium">
                  {sweetSpot.label}
                </span>{" "}
                (<span className="font-mono">{fmtDollar(sweetSpot.avgPnl)}</span> avg profit / loss, {sweetSpot.count}{" "}
                trades)
              </span>
            </div>
          )}

          {insights.cutWinnersInsight && (
            <div className="flex items-baseline gap-2">
              <span className="text-[13px] font-medium shrink-0 text-amber">
                Cutting winners
              </span>
              <span className="text-xs text-secondary">
                {insights.cutWinnersInsight}
              </span>
            </div>
          )}

          {!sweetSpot && !insights.cutWinnersInsight && (
            <p className="text-xs text-tertiary">
              Not enough data yet. Need at least 5 trades in a single
              hold-time bucket to generate insights.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
