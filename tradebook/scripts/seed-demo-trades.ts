import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

// ---------------------------------------------------------------------------
// Demo seed — crypto day trader persona
// ---------------------------------------------------------------------------
// Persona: ~3 months into trading, intraday on BTC/ETH/SOL plus a couple of
// small-cap alts (WIF, JTO). Roughly breakeven but improving: ~50 trades over
// the last ~9 weeks, win rate near 50%, slightly net-positive P&L trending up.
//
// The data is deliberately shaped to surface the app's analytics:
//   • one clear tilt day (big loss → scratch → oversized revenge losses)
//   • a morning-outperforms-afternoon time-of-day edge
//   • a few missed-trade log entries
//   • short emotional-state notes on some trades
//
// Seed this into a DEDICATED demo user (the app shows that account read-only):
//   npx tsx scripts/seed-demo-trades.ts <demo_user_id>
//   npx tsx scripts/seed-demo-trades.ts --dry-run        (generate + print stats, no DB)
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const USER_ID = args.find((a) => !a.startsWith("--")) ?? (DRY_RUN ? "dry-run-demo-user" : undefined);

if (!USER_ID) {
  console.error("Usage: npx tsx scripts/seed-demo-trades.ts <user_id> [--dry-run]");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function rand(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}
function randInt(min: number, max: number): number {
  return Math.floor(rand(min, max + 1));
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function weightedPick<T>(items: T[], weights: number[]): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}
function roundTo(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}
function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}
function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function formatTime(h: number, m: number): string {
  return `${pad2(h)}:${pad2(m)}:00`;
}

// ---------------------------------------------------------------------------
// Crypto constants
// ---------------------------------------------------------------------------
// Majors carry most of the volume; a couple of small-cap alts for spice.
const TICKERS = ["BTC", "ETH", "SOL", "WIF", "JTO"];
const TICKER_WEIGHTS = [3, 3, 3, 1, 1];

// Intraday price ranges (USD). Level doesn't drive P&L — we target dollar P&L
// directly and back out the exit — but realistic prices make the log believable.
const PRICE_RANGE: Record<string, [number, number]> = {
  BTC: [58_000, 72_000],
  ETH: [2_800, 3_800],
  SOL: [130, 195],
  WIF: [1.4, 3.6],
  JTO: [1.8, 4.2],
};

// Per-asset quantity precision (crypto positions are fractional).
function roundQty(ticker: string, qty: number): number {
  if (ticker === "BTC") return Math.max(0.0005, roundTo(qty, 4));
  if (ticker === "ETH") return Math.max(0.005, roundTo(qty, 3));
  if (ticker === "SOL") return Math.max(0.1, roundTo(qty, 2));
  return Math.max(1, Math.round(qty)); // $1–4 alts: whole units
}
function roundPrice(p: number): number {
  return roundTo(p, p < 10 ? 4 : 2);
}

const SETUPS = [
  "VWAP reclaim",
  "range breakout",
  "support bounce",
  "trend continuation",
  "liquidity sweep reclaim",
  "EMA pullback",
  "funding flush dip",
  "breakdown short",
];
// Used only on the tilt day so it always falls outside the top-3 setups
// (triggers the "off-plan" flag in TiltDetection).
const OFF_PLAN_SETUP = "FOMO chase";

const CATALYST_TYPES = ["technical", "news_pr", "sympathy", "other"] as const;
const CATALYSTS: Record<(typeof CATALYST_TYPES)[number], string[]> = {
  technical: ["Reclaimed daily VWAP", "Broke range high on volume", "Bounced off prior support", "Higher-low forming on the 15m"],
  news_pr: ["ETF inflow headline", "Mainnet upgrade announced", "Listing rumor", "Macro/CPI print reaction"],
  sympathy: ["Following BTC strength", "SOL ecosystem running", "Alt rotation underway", "Whole market bid"],
  other: ["Funding reset after a flush", "Weekend low-liquidity grind", "Asia session momentum", "No clear catalyst, price action only"],
};

const TAGS_POOL = ["momentum", "scalp", "majors", "alts", "breakout", "mean-reversion", "high-volume"];

const HESITATION_REASONS = [
  "Didn't trust the setup",
  "Was already in a position",
  "Chasing felt too risky",
  "Waited for a better entry",
  "Hit my daily loss limit",
  "Stepped away from the desk",
];

// ---------------------------------------------------------------------------
// Date range — last ~9 weeks (crypto trades 7 days/week, weekends included)
// ---------------------------------------------------------------------------
const DAYS_BACK = 63;
const today = new Date();
const allDays: string[] = [];
for (let i = DAYS_BACK; i >= 1; i--) {
  const d = new Date(today);
  d.setDate(d.getDate() - i);
  allDays.push(formatDate(d));
}
// Tilt day sits ~60% through the window: the equity curve rises, dips hard on
// the meltdown, then recovers to new highs — the "improving" story.
const TILT_DAY_IDX = Math.floor(allDays.length * 0.6);
const TILT_DAY = allDays[TILT_DAY_IDX];

// ---------------------------------------------------------------------------
// Trade type
// ---------------------------------------------------------------------------
interface TradeRow {
  user_id: string;
  ticker: string;
  side: "long" | "short";
  entry_price: number;
  exit_price: number;
  shares: number;
  trade_date: string;
  entry_time: string;
  exit_time: string;
  setup: string;
  notes: string;
  emotions: string;
  stop_loss_price: number | null;
  tags: string[];
  grade: string | null;
  premarket_plan: string;
  screenshot_url: null;
  catalyst: string;
  catalyst_type: string | null;
  float_shares: number | null;
  market_cap: number | null;
  rvol: number | null;
  commission: number;
  is_scaled: boolean;
  avg_entry_price: number | null;
  avg_exit_price: number | null;
  total_shares: number | null;
}

function netPnl(t: TradeRow): number {
  const gross = (t.side === "long" ? 1 : -1) * (t.exit_price - t.entry_price) * t.shares;
  return gross - (t.commission || 0);
}
function isMorning(t: TradeRow): boolean {
  return parseInt(t.entry_time.slice(0, 2), 10) < 12;
}

// Build one trade by targeting a dollar P&L and a notional, then deriving the
// exit price so the on-screen numbers reconcile exactly with calcNetPnl().
function buildTrade(opts: {
  date: string;
  ticker: string;
  side: "long" | "short";
  entryHour: number;
  entryMin: number;
  holdMin: number;
  notional: number;
  pnlTarget: number;
  setup: string;
  emotion: string;
  notes: string;
  commission: number;
  progress: number;
}): TradeRow {
  const { ticker } = opts;
  const [lo, hi] = PRICE_RANGE[ticker];
  // Mild upward price drift across the window for believability.
  const entry = roundPrice(rand(lo, hi) * (0.95 + 0.08 * opts.progress));
  const shares = roundQty(ticker, opts.notional / entry);

  // exit such that side*(exit-entry)*shares == pnlTarget
  const perUnit = opts.pnlTarget / shares;
  let exit = opts.side === "long" ? entry + perUnit : entry - perUnit;
  exit = roundPrice(Math.max(exit, entry * 0.01));

  // Stop loss on ~65% of trades, sized to the asset.
  let stop: number | null = null;
  if (Math.random() < 0.65) {
    const stopPct = rand(0.008, 0.03);
    stop = roundPrice(opts.side === "long" ? entry * (1 - stopPct) : entry * (1 + stopPct));
  }

  const catalystType = pick([...CATALYST_TYPES]);

  let exitMinutes = opts.entryHour * 60 + opts.entryMin + opts.holdMin;
  if (exitMinutes > 15 * 60 + 55) exitMinutes = 15 * 60 + 55;
  const exitHour = Math.floor(exitMinutes / 60);
  const exitMin = exitMinutes % 60;

  return {
    user_id: USER_ID!,
    ticker,
    side: opts.side,
    entry_price: entry,
    exit_price: exit,
    shares,
    trade_date: opts.date,
    entry_time: formatTime(opts.entryHour, opts.entryMin),
    exit_time: formatTime(exitHour, exitMin),
    setup: opts.setup,
    notes: opts.notes,
    emotions: opts.emotion,
    stop_loss_price: stop,
    tags: [...TAGS_POOL].sort(() => Math.random() - 0.5).slice(0, randInt(1, 3)),
    grade: null, // beginner persona doesn't grade every trade (column allows A–D or NULL)
    premarket_plan: "",
    screenshot_url: null,
    catalyst: pick(CATALYSTS[catalystType]),
    catalyst_type: catalystType,
    float_shares: null,
    market_cap: null,
    rvol: null,
    commission: opts.commission,
    is_scaled: false,
    avg_entry_price: null,
    avg_exit_price: null,
    total_shares: null,
  };
}

// ---------------------------------------------------------------------------
// Short emotional notes (only on ~60% of trades — "some trades")
// ---------------------------------------------------------------------------
const NOTES = {
  morningWin: [
    "Clean reclaim, confident entry.",
    "Patient wait paid off.",
    "In and out, no stress.",
    "Followed the plan. Calm.",
    "Took partials into strength.",
  ],
  afternoonLoss: [
    "Chased it, should've sat out.",
    "Low conviction, FOMO'd in.",
    "Afternoon chop got me again.",
    "Forced this one, no real edge.",
    "Stop too wide. Frustrated.",
  ],
  genWin: ["Solid R:R, executed well.", "Waited for confirmation.", "Discipline paying off."],
  genLoss: ["Timing was off, stopped out.", "Broke my own rule here.", "Hesitated, bad fill."],
};
function noteFor(morning: boolean, winner: boolean): string {
  if (Math.random() > 0.6) return ""; // only some trades carry a note
  if (morning && winner) return pick(NOTES.morningWin);
  if (!morning && !winner) return pick(NOTES.afternoonLoss);
  return winner ? pick(NOTES.genWin) : pick(NOTES.genLoss);
}
function emotionFor(winner: boolean): string {
  return winner
    ? weightedPick(["confident", "disciplined", "patient", "calm"], [3, 3, 2, 2])
    : weightedPick(["frustrated", "nervous", "fomo", "hesitant"], [3, 2, 2, 1]);
}

// ---------------------------------------------------------------------------
// The tilt day — fixed scenario so the meltdown always lights up the analytics
// ---------------------------------------------------------------------------
function buildTiltDay(): TradeRow[] {
  const p = TILT_DAY_IDX / (allDays.length - 1);
  const t = (
    side: "long" | "short",
    ticker: string,
    eh: number, em: number, hold: number,
    notional: number, pnl: number, setup: string, emotion: string, notes: string,
  ) => buildTrade({
    date: TILT_DAY, ticker, side, entryHour: eh, entryMin: em, holdMin: hold,
    notional, pnlTarget: pnl, setup, emotion, notes, commission: 0, progress: p,
  });

  // 1) The large loss. 2) A second loss → 2 consecutive (tilt trigger).
  // 3) A tiny scratch win, re-entered ~1 min after the stop-out (impulse) —
  //    this ENDS the streak so the oversized revenge trades that follow are
  //    classified as "post-tilt". 4-6) Oversized off-plan revenge losses.
  return [
    t("long", "SOL", 10, 42, 23, 3_100, -430, "trend continuation", "frustrated",
      "Knew the level was breaking and held anyway. Big one."),
    t("long", "ETH", 11, 20, 18, 2_900, -200, "VWAP reclaim", "frustrated",
      "Down on the day now, pressing."),
    t("long", "SOL", 11, 39, 5, 1_600, 15, "support bounce", "nervous",
      "Tiny scratch. Should've stopped here."),
    t("long", "BTC", 12, 5, 25, 9_400, -380, OFF_PLAN_SETUP, "revenge trading",
      "Revenge trade, sized way up to win it back. Stupid."),
    t("long", "SOL", 12, 36, 34, 10_600, -460, OFF_PLAN_SETUP, "revenge trading",
      "Doubled down again. This is full tilt."),
    t("long", "ETH", 13, 22, 31, 8_800, -230, OFF_PLAN_SETUP, "frustrated",
      "Finally stopped. Worst day in weeks."),
  ];
}

// ---------------------------------------------------------------------------
// Regular trades (everything except the tilt day), capped at 2/day so no
// accidental tilt episodes form — the showcase tilt day stays the only one.
// ---------------------------------------------------------------------------
function buildRegularTrades(): TradeRow[] {
  const target = randInt(42, 46);
  const candidateDays = allDays.filter((d) => d !== TILT_DAY).sort(() => Math.random() - 0.5);

  const trades: TradeRow[] = [];
  let di = 0;
  while (trades.length < target && di < candidateDays.length) {
    const date = candidateDays[di++];
    const dayIdx = allDays.indexOf(date);
    const p = dayIdx / (allDays.length - 1); // 0 = oldest, 1 = newest
    const perDay = Math.min(weightedPick([1, 2], [0.6, 0.4]), target - trades.length);

    const used: Array<[number, number]> = []; // entry windows to space same-day trades
    for (let k = 0; k < perDay; k++) {
      const morning = Math.random() < 0.58;

      // Win probability and sizing both improve over time → upward trend,
      // and mornings clearly beat afternoons.
      const winProb = morning ? 0.55 + 0.18 * p : 0.33 + 0.13 * p;
      const winner = Math.random() < winProb;

      const sizeProg = 0.85 + 0.3 * p;
      const trendProg = 0.8 + 0.5 * p; // winners grow over the window
      let pnl: number;
      if (winner) {
        pnl = morning ? rand(90, 230) * trendProg : rand(45, 130) * trendProg;
      } else {
        const shrink = 1.1 - 0.3 * p; // losers get smaller as discipline improves
        pnl = -(morning ? rand(40, 110) : rand(60, 150)) * shrink;
      }

      // Entry time within the session, spaced from earlier trades that day.
      let eh: number, em: number;
      let tries = 0;
      do {
        eh = morning ? randInt(9, 11) : randInt(12, 15);
        em = eh === 15 ? randInt(0, 45) : randInt(0, 59);
        tries++;
      } while (used.some(([h, m]) => Math.abs(h * 60 + m - (eh * 60 + em)) < 75) && tries < 12);
      used.push([eh, em]);

      const ticker = weightedPick(TICKERS, TICKER_WEIGHTS);
      const side: "long" | "short" = Math.random() < 0.8 ? "long" : "short";
      const holdMin = weightedPick([randInt(1, 5), randInt(5, 30), randInt(30, 90), randInt(90, 210)], [3, 4, 2, 1]);
      const notional = rand(1_500, 4_500) * sizeProg;
      const commission = Math.random() < 0.35 ? roundTo(rand(1, 6), 2) : 0;

      trades.push(
        buildTrade({
          date, ticker, side, entryHour: eh, entryMin: em, holdMin,
          notional, pnlTarget: pnl, setup: pick(SETUPS),
          emotion: emotionFor(winner), notes: noteFor(morning, winner),
          commission, progress: p,
        }),
      );
    }
  }
  return trades;
}

// ---------------------------------------------------------------------------
// Generate the full trade set, retrying until the persona targets are hit
// ---------------------------------------------------------------------------
interface Stats {
  total: number;
  winRate: number;
  netPnl: number;
  morningAvg: number;
  afternoonAvg: number;
  morningNet: number;
  afternoonNet: number;
  earlyThird: number;
  lateThird: number;
}
function computeStats(trades: TradeRow[]): Stats {
  const sorted = [...trades].sort((a, b) =>
    a.trade_date === b.trade_date ? a.entry_time.localeCompare(b.entry_time) : a.trade_date.localeCompare(b.trade_date),
  );
  const pnls = sorted.map(netPnl);
  const total = sorted.length;
  const wins = pnls.filter((p) => p > 0).length;
  const morning = sorted.filter(isMorning);
  const afternoon = sorted.filter((t) => !isMorning(t));
  const mNet = morning.reduce((s, t) => s + netPnl(t), 0);
  const aNet = afternoon.reduce((s, t) => s + netPnl(t), 0);
  const third = Math.floor(total / 3);
  return {
    total,
    winRate: (wins / total) * 100,
    netPnl: pnls.reduce((s, p) => s + p, 0),
    morningAvg: morning.length ? mNet / morning.length : 0,
    afternoonAvg: afternoon.length ? aNet / afternoon.length : 0,
    morningNet: mNet,
    afternoonNet: aNet,
    earlyThird: pnls.slice(0, third).reduce((s, p) => s + p, 0),
    lateThird: pnls.slice(total - third).reduce((s, p) => s + p, 0),
  };
}
function meetsTargets(s: Stats): boolean {
  return (
    s.total >= 48 && s.total <= 53 &&
    s.winRate >= 46 && s.winRate <= 54 &&
    s.netPnl >= 400 && s.netPnl <= 1300 &&
    s.morningAvg > s.afternoonAvg + 25 &&
    s.morningNet > 0 &&
    s.afternoonNet < s.morningNet * 0.5 &&
    s.lateThird > s.earlyThird &&        // improving
    s.earlyThird >= -350                 // roughly breakeven early, not a disaster
  );
}

function generateTrades(): { trades: TradeRow[]; stats: Stats } {
  const tilt = buildTiltDay();
  for (let attempt = 0; attempt < 4000; attempt++) {
    const trades = [...buildRegularTrades(), ...tilt];
    trades.sort((a, b) =>
      a.trade_date === b.trade_date ? a.entry_time.localeCompare(b.entry_time) : a.trade_date.localeCompare(b.trade_date),
    );
    const stats = computeStats(trades);
    if (meetsTargets(stats)) return { trades, stats };
  }
  throw new Error("Could not converge on persona targets after 4000 attempts — loosen meetsTargets()");
}

// ---------------------------------------------------------------------------
// Missed trades — a few log entries of plays the trader hesitated on
// ---------------------------------------------------------------------------
interface MissedTradeRow {
  user_id: string;
  ticker: string;
  trade_date: string;
  setup: string;
  tags: string[];
  reason: string;
  side: "long" | "short" | null;
  estimated_entry: number | null;
  estimated_exit: number | null;
  estimated_shares: number | null;
  hesitation_reasons: string[];
}
function generateMissedTrades(): MissedTradeRow[] {
  const count = randInt(4, 6);
  const days = [...allDays].sort(() => Math.random() - 0.5);
  const missed: MissedTradeRow[] = [];
  for (let i = 0; i < count; i++) {
    const ticker = weightedPick(TICKERS, TICKER_WEIGHTS);
    const [lo, hi] = PRICE_RANGE[ticker];
    const entry = roundPrice(rand(lo, hi));
    const movePct = rand(0.04, 0.16);
    const exit = roundPrice(entry * (1 + movePct));
    const shares = roundQty(ticker, rand(1_500, 5_000) / entry);
    const setup = pick(SETUPS);
    const reasons = [...HESITATION_REASONS].sort(() => Math.random() - 0.5).slice(0, randInt(1, 2));
    const blurbs = [
      `${ticker} broke out of a ${setup.toLowerCase()} and ran ${(movePct * 100).toFixed(0)}%. Had it flagged but didn't pull the trigger.`,
      `Watched ${ticker} reclaim and rip ${(movePct * 100).toFixed(0)}%. ${reasons[0]}.`,
      `${ticker} gapped and never came back. Missed the whole move. ${reasons[0]}.`,
      `Saw the volume come into ${ticker} but hesitated. Would've been a clean ${(movePct * 100).toFixed(0)}%.`,
    ];
    missed.push({
      user_id: USER_ID!,
      ticker,
      trade_date: days[i],
      setup,
      tags: [...TAGS_POOL].sort(() => Math.random() - 0.5).slice(0, randInt(1, 2)),
      reason: pick(blurbs),
      side: Math.random() < 0.85 ? "long" : "short",
      estimated_entry: entry,
      estimated_exit: exit,
      estimated_shares: shares,
      hesitation_reasons: reasons,
    });
  }
  missed.sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  return missed;
}

// ---------------------------------------------------------------------------
// Journal entries — a light, realistic habit (incl. the tilt-day post-mortem)
// ---------------------------------------------------------------------------
interface JournalRow {
  user_id: string;
  entry_date: string;
  premarket_plan: string;
  postmarket_review: string;
  lessons: string;
  mood: string | null;
  grade: string | null;
  goals_for_tomorrow: string;
}
function generateJournalEntries(trades: TradeRow[]): JournalRow[] {
  const byDate = new Map<string, TradeRow[]>();
  for (const t of trades) {
    if (!byDate.has(t.trade_date)) byDate.set(t.trade_date, []);
    byDate.get(t.trade_date)!.push(t);
  }
  const tradedDays = [...byDate.keys()];
  // Always journal the tilt day; sample ~12 others.
  const others = tradedDays.filter((d) => d !== TILT_DAY).sort(() => Math.random() - 0.5).slice(0, 12);
  const selected = [...new Set([TILT_DAY, ...others])].sort();

  const premarketPlans = [
    "Watching BTC at the range high and SOL for a VWAP reclaim. Majors only until I get a green trade. Risk small.",
    "Funding reset overnight — looking for a flush-and-reclaim on ETH. Daily max loss $300. No revenge trades.",
    "SOL and a couple alts on the radar. Plan: take the A+ morning setup, then walk away. Mornings are my edge.",
    "Quiet pre-market. Being selective. Only trading a clean breakout on BTC/ETH. 1R risk per trade.",
    "Alt rotation looks early. Watching WIF/JTO for momentum but keeping size tiny. Majors are the bread and butter.",
  ];
  const lessonsPool = [
    "Mornings are where my edge is. Stop trading after lunch.",
    "Afternoon chop is -EV for me. The data keeps proving it.",
    "Oversizing after a loss is my biggest leak.",
    "When I trade the plan I win; off-script I bleed.",
    "Size down after two losses in a row.",
    "Quality over quantity — 2 clean trades beat 6 forced ones.",
  ];
  const goalsPool = [
    "Max 3 trades. Done by noon if I'm green.",
    "Morning session only. Protect the green.",
    "Pre-mark levels tonight. Mornings should be execution only.",
    "Daily max loss $250 — walk away if I hit it.",
    "No FOMO entries. Wait for the reclaim.",
  ];

  const entries: JournalRow[] = [];
  for (const day of selected) {
    const dayTrades = byDate.get(day) ?? [];
    const dayPnl = dayTrades.reduce((s, t) => s + netPnl(t), 0);
    const green = dayPnl >= 0;
    const pnlStr = `${dayPnl >= 0 ? "+" : "-"}$${Math.abs(dayPnl).toFixed(0)}`;

    let review: string;
    let mood: string;
    let grade: string;
    if (day === TILT_DAY) {
      review = `Disaster. ${pnlStr} on ${dayTrades.length} trades. Took a big loss on SOL, then revenge-sized into BTC and SOL trying to win it back and just dug the hole deeper. Textbook tilt. Should have shut the laptop after the second red.`;
      mood = "tilted";
      grade = "D"; // worst allowed grade (column is constrained to A–D)
    } else if (green) {
      review = `Green day, ${pnlStr} on ${dayTrades.length} trade${dayTrades.length === 1 ? "" : "s"}. Morning setups worked, took profit and stepped away. That's the move.`;
      mood = weightedPick(["great", "good", "neutral"], [0.3, 0.5, 0.2]);
      grade = weightedPick(["A", "B", "C"], [0.3, 0.5, 0.2]);
    } else {
      review = `Red day, ${pnlStr}. Got chopped up — should have been more patient. Nothing catastrophic, just sloppy.`;
      mood = weightedPick(["neutral", "frustrated", "good"], [0.4, 0.4, 0.2]);
      grade = weightedPick(["B", "C", "D"], [0.3, 0.5, 0.2]);
    }

    entries.push({
      user_id: USER_ID!,
      entry_date: day,
      premarket_plan: pick(premarketPlans),
      postmarket_review: review,
      lessons:
        day === TILT_DAY
          ? "After two losses in a row, step away for 30 minutes. Never increase size to win money back."
          : [...lessonsPool].sort(() => Math.random() - 0.5).slice(0, randInt(1, 2)).join(" "),
      mood,
      grade,
      goals_for_tomorrow: [...goalsPool].sort(() => Math.random() - 0.5).slice(0, randInt(1, 2)).join(" "),
    });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function printSummary(trades: TradeRow[], stats: Stats, missed: MissedTradeRow[], journal: JournalRow[]) {
  const tiltTrades = trades.filter((t) => t.trade_date === TILT_DAY);
  const tiltPnl = tiltTrades.reduce((s, t) => s + netPnl(t), 0);
  console.log("\n" + "=".repeat(56));
  console.log("CRYPTO DEMO — generated data");
  console.log("=".repeat(56));
  console.log(`  Date range:   ${allDays[0]} → ${allDays[allDays.length - 1]}`);
  console.log(`  Trades:       ${stats.total}  (win rate ${stats.winRate.toFixed(1)}%)`);
  console.log(`  Net P&L:      $${stats.netPnl.toFixed(0)}  (slightly positive, trending up)`);
  console.log(`  Early third:  $${stats.earlyThird.toFixed(0)}   →   Late third: $${stats.lateThird.toFixed(0)}`);
  console.log(`  Morning:      $${stats.morningNet.toFixed(0)} net  ($${stats.morningAvg.toFixed(0)}/trade)`);
  console.log(`  Afternoon:    $${stats.afternoonNet.toFixed(0)} net  ($${stats.afternoonAvg.toFixed(0)}/trade)`);
  console.log(`  Tilt day:     ${TILT_DAY}  →  ${tiltTrades.length} trades, $${tiltPnl.toFixed(0)}`);
  console.log(`  Missed logs:  ${missed.length}`);
  console.log(`  Journal:      ${journal.length} entries`);
  console.log("=".repeat(56) + "\n");
}

async function main() {
  const { trades, stats } = generateTrades();
  const missedTrades = generateMissedTrades();
  const journalEntries = generateJournalEntries(trades);

  if (DRY_RUN) {
    console.log("\n[dry-run] No database writes.");
    printSummary(trades, stats, missedTrades, journalEntries);
    return;
  }

  // --- Supabase client (only needed for a real seed) ---
  const envPath = resolve(process.cwd(), ".env.seed");
  const envContent = readFileSync(envPath, "utf-8");
  const env: Record<string, string> = {};
  for (const line of envContent.split("\n")) {
    const m = line.match(/^\s*([\w]+)\s*=\s*(.+?)\s*$/);
    if (m) env[m[1]] = m[2];
  }
  const SUPABASE_URL = env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.seed");
    process.exit(1);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  console.log(`\nSeeding crypto demo data for user: ${USER_ID}`);
  console.log("=".repeat(56));

  // Step 1: wipe existing data for this demo user
  console.log("\nDeleting existing data...");
  for (const table of ["trades", "missed_trades", "journal_entries"]) {
    const { error } = await supabase.from(table).delete().eq("user_id", USER_ID);
    if (error) {
      console.error(`Failed to delete ${table}:`, error.message);
      process.exit(1);
    }
    console.log(`  Cleared ${table}`);
  }

  // Step 2: reset the demo profile (free plan, trial available)
  console.log("\nResetting demo profile...");
  const { error: profileErr } = await supabase
    .from("profiles")
    .update({
      plan: "free",
      trial_ends_at: null,
      subscription_status: "none",
      stripe_customer_id: null,
      stripe_subscription_id: null,
    })
    .eq("id", USER_ID);
  if (profileErr) {
    console.error("Failed to reset profile:", profileErr.message);
    process.exit(1);
  }
  const { error: delSub } = await supabase.from("subscriptions").delete().eq("user_id", USER_ID);
  if (delSub) console.warn("  Warning: could not delete subscription row:", delSub.message);
  console.log("  Profile reset — plan: free, subscription: none");

  // Step 3: insert
  console.log("\nInserting...");
  const BATCH = 50;
  for (let i = 0; i < trades.length; i += BATCH) {
    const { error } = await supabase.from("trades").insert(trades.slice(i, i + BATCH));
    if (error) {
      console.error(`Failed to insert trades batch ${i}:`, error.message);
      process.exit(1);
    }
  }
  console.log(`  ${trades.length} trades`);

  const { error: missedErr } = await supabase.from("missed_trades").insert(missedTrades);
  if (missedErr) {
    console.error("Failed to insert missed trades:", missedErr.message);
    process.exit(1);
  }
  console.log(`  ${missedTrades.length} missed trades`);

  const { error: journalErr } = await supabase.from("journal_entries").insert(journalEntries);
  if (journalErr) {
    console.error("Failed to insert journal entries:", journalErr.message);
    process.exit(1);
  }
  console.log(`  ${journalEntries.length} journal entries`);

  console.log("\nSEED COMPLETE");
  printSummary(trades, stats, missedTrades, journalEntries);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
