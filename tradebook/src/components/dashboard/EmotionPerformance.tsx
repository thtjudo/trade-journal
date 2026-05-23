import type { EmotionStats } from "./helpers";

export default function EmotionPerformance({
  emotionStats,
}: {
  emotionStats: EmotionStats[];
}) {
  return (
    <div>
      <p className="metric-label mb-4">
        By Emotion
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px] text-left">
          <thead>
            <tr className="border-b border-border">
              <th className="pb-2 text-[13px] font-medium text-secondary">
                Emotion
              </th>
              <th className="pb-2 text-[13px] font-medium text-secondary">
                Trades
              </th>
              <th className="pb-2 text-[13px] font-medium text-secondary">
                Win Rate
              </th>
              <th className="pb-2 text-[13px] font-medium text-secondary text-right">
                Avg Profit / Loss
              </th>
              <th className="pb-2 text-[13px] font-medium text-secondary text-right">
                Total Profit / Loss
              </th>
            </tr>
          </thead>
          <tbody>
            {emotionStats.map((s) => (
              <tr key={s.emotion} className="border-t border-border hover:bg-white/[0.02] transition-colors">
                <td className="py-2 text-secondary text-[13px]">{s.emotion}</td>
                <td className="py-2 text-secondary text-[13px]">{s.totalTrades}</td>
                <td className={`py-2 text-[13px] font-medium ${s.winRate >= 50 ? "text-profit" : "text-loss"}`}>
                  {s.winRate.toFixed(0)}%
                </td>
                <td className={`py-2 text-right text-[13px] font-medium font-mono ${s.avgPnl >= 0 ? "text-profit" : "text-loss"}`}>
                  {s.avgPnl >= 0 ? "+" : ""}${s.avgPnl.toFixed(2)}
                </td>
                <td className={`py-2 text-right text-[13px] font-medium font-mono ${s.totalPnl >= 0 ? "text-profit" : "text-loss"}`}>
                  {s.totalPnl >= 0 ? "+" : ""}${s.totalPnl.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
