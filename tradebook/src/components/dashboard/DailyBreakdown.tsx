import type { DayStats } from "./helpers";

export default function DailyBreakdown({
  dailyStats,
}: {
  dailyStats: DayStats[];
}) {
  return (
    <div>
      <div className="section-divider mb-8" />
      <p className="metric-label mb-4">
        Daily Breakdown
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px] text-left">
          <thead>
            <tr className="border-b border-border">
              <th className="pb-2 text-[13px] font-medium text-secondary">
                Date
              </th>
              <th className="pb-2 text-[13px] font-medium text-secondary">
                Trades
              </th>
              <th className="pb-2 text-[13px] font-medium text-secondary">
                W / L
              </th>
              <th className="pb-2 text-[13px] font-medium text-secondary">
                Win Rate
              </th>
              <th className="pb-2 text-[13px] font-medium text-secondary text-right">
                Profit / Loss
              </th>
            </tr>
          </thead>
          <tbody>
            {dailyStats.map((day) => {
              const wr =
                day.trades > 0
                  ? ((day.wins / day.trades) * 100).toFixed(0)
                  : "0";
              return (
                <tr
                  key={day.date}
                  className="border-t border-border hover:bg-white/[0.02] transition-colors"
                >
                  <td className="py-2 text-secondary text-[13px]">
                    {day.date}
                  </td>
                  <td className="py-2 text-secondary text-[13px]">
                    {day.trades}
                  </td>
                  <td className="py-2 text-[13px]">
                    <span className="text-profit font-medium">
                      {day.wins}
                    </span>
                    <span className="text-tertiary"> / </span>
                    <span className="text-loss font-medium">
                      {day.losses}
                    </span>
                  </td>
                  <td className="py-2 text-secondary text-[13px]">
                    {wr}%
                  </td>
                  <td
                    className={
                      "py-2 text-right text-[13px] font-medium font-mono " +
                      (day.pnl >= 0 ? "text-profit" : "text-loss")
                    }
                  >
                    {day.pnl >= 0 ? "+" : ""}${day.pnl.toFixed(2)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
