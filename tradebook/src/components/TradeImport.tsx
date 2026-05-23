import { useState, useRef } from "react";

import { useToast } from "./Toast";
import { useImportTrades } from "../hooks/useMutations";
import { cn } from "../lib/utils";

const REQUIRED_FIELDS = [
  "ticker",
  "side",
  "entry_price",
  "exit_price",
  "shares",
  "trade_date",
] as const;

const OPTIONAL_FIELDS = [
  "entry_time",
  "exit_time",
  "stop_loss_price",
] as const;

type Field = (typeof REQUIRED_FIELDS)[number] | (typeof OPTIONAL_FIELDS)[number];

const FIELD_LABELS: Record<Field, string> = {
  ticker: "Ticker / Symbol",
  side: "Side (Buy/Sell)",
  entry_price: "Entry Price",
  exit_price: "Exit Price",
  shares: "Shares / Qty",
  trade_date: "Date",
  entry_time: "Entry Time",
  exit_time: "Exit Time",
  stop_loss_price: "Stop Loss",
};

function parseCsv(text: string): string[][] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return [];

  // auto-detect delimiter: tab vs comma
  const firstLine = lines[0];
  const delimiter = firstLine.includes("\t") ? "\t" : ",";

  return lines.map((line) => {
    const cells: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          current += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        cells.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    cells.push(current.trim());
    return cells;
  });
}

function normalizeSide(val: string): "long" | "short" | null {
  const v = val.trim().toUpperCase();
  if (["BUY", "B", "LONG"].includes(v)) return "long";
  if (["SELL", "S", "SHORT"].includes(v)) return "short";
  return null;
}

export default function TradeImport({
  variant = "primary",
  label,
}: {
  variant?: "primary" | "cta";
  label?: string;
}) {
  const { showToast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const importTrades = useImportTrades();

  const [open, setOpen] = useState(false);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<Field, string>>({} as Record<Field, string>);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      const parsed = parseCsv(text);
      if (parsed.length < 2) {
        showToast("File has no data rows", "error");
        return;
      }
      setHeaders(parsed[0]);
      setRows(parsed.slice(1));

      // auto-guess mappings from header names
      const guesses: Partial<Record<Field, string>> = {};
      for (const h of parsed[0]) {
        const lower = h.toLowerCase().replace(/[^a-z]/g, "");
        if (["symbol", "ticker"].includes(lower)) guesses.ticker = h;
        else if (["side", "buysell", "action"].includes(lower)) guesses.side = h;
        else if (["price", "entryprice", "avgprice", "fillprice"].includes(lower)) guesses.entry_price = h;
        else if (["exitprice"].includes(lower)) guesses.exit_price = h;
        else if (["qty", "quantity", "shares", "size"].includes(lower)) guesses.shares = h;
        else if (["date", "tradedate", "datetime", "filledtime"].includes(lower)) guesses.trade_date = h;
        else if (["time", "entrytime"].includes(lower)) guesses.entry_time = h;
        else if (["exittime"].includes(lower)) guesses.exit_time = h;
        else if (["stoploss", "stoplossprice", "stop"].includes(lower)) guesses.stop_loss_price = h;
      }
      setMapping(guesses as Record<Field, string>);
      setOpen(true);
    };
    reader.readAsText(file);

    // reset input so the same file can be re-selected
    e.target.value = "";
  }

  function getCellValue(row: string[], header: string): string {
    const idx = headers.indexOf(header);
    return idx >= 0 ? (row[idx] ?? "") : "";
  }

  async function handleImport() {
    // validate required mappings
    for (const field of REQUIRED_FIELDS) {
      if (!mapping[field]) {
        showToast(`Map the "${FIELD_LABELS[field]}" column before importing`, "error");
        return;
      }
    }

    const trades: Record<string, unknown>[] = [];
    const errors: string[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const ticker = getCellValue(row, mapping.ticker).toUpperCase();
      const sideRaw = getCellValue(row, mapping.side);
      const side = normalizeSide(sideRaw);
      const entryPrice = parseFloat(getCellValue(row, mapping.entry_price).replace(/[$,]/g, ""));
      const exitPrice = parseFloat(getCellValue(row, mapping.exit_price).replace(/[$,]/g, ""));
      const shares = parseInt(getCellValue(row, mapping.shares).replace(/,/g, ""), 10);
      const tradeDateRaw = getCellValue(row, mapping.trade_date);

      if (!ticker || !side || isNaN(entryPrice) || isNaN(exitPrice) || isNaN(shares)) {
        errors.push(`Row ${i + 1}: missing or invalid required data`);
        continue;
      }

      // parse date -- try ISO (YYYY-MM-DD) first, then MM/DD/YYYY
      let tradeDate = "";
      const isoMatch = tradeDateRaw.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
      const usMatch = tradeDateRaw.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
      if (isoMatch) {
        tradeDate = `${isoMatch[1]}-${isoMatch[2].padStart(2, "0")}-${isoMatch[3].padStart(2, "0")}`;
      } else if (usMatch) {
        const yr = usMatch[3].length === 2 ? `20${usMatch[3]}` : usMatch[3];
        tradeDate = `${yr}-${usMatch[1].padStart(2, "0")}-${usMatch[2].padStart(2, "0")}`;
      } else {
        errors.push(`Row ${i + 1}: unrecognized date format "${tradeDateRaw}"`);
        continue;
      }

      const trade: Record<string, unknown> = {
        ticker,
        side,
        entry_price: entryPrice,
        exit_price: exitPrice,
        shares,
        trade_date: tradeDate,
        setup: "",
        notes: "",
        emotions: "",
        tags: [],
        grade: "",
        premarket_plan: "",
        entry_time: "",
        exit_time: "",
        stop_loss_price: null,
        screenshot_url: null,
      };

      // optional fields
      if (mapping.entry_time) {
        trade.entry_time = getCellValue(row, mapping.entry_time);
      }
      if (mapping.exit_time) {
        trade.exit_time = getCellValue(row, mapping.exit_time);
      }
      if (mapping.stop_loss_price) {
        const sl = parseFloat(getCellValue(row, mapping.stop_loss_price).replace(/[$,]/g, ""));
        if (!isNaN(sl)) trade.stop_loss_price = sl;
      }

      trades.push(trade);
    }

    if (trades.length === 0) {
      showToast(errors[0] || "No valid trades found in file", "error");
      return;
    }

    const errorCount = errors.length;
    const tradeCount = trades.length;
    importTrades.mutate(trades, {
      onSuccess: () => {
        const msg =
          errorCount > 0
            ? `Imported ${tradeCount} trades (${errorCount} rows skipped)`
            : `Imported ${tradeCount} trades`;
        showToast(msg, "success");
        setOpen(false);
      },
      onError: (err) => {
        showToast(`Import failed: ${err.message}`, "error");
      },
    });
  }

  const previewRows = rows.slice(0, 5);
  const allFields: Field[] = [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS];

  const isCta = variant === "cta";
  const triggerClass = cn(
    "flex items-center font-medium text-[13px] bg-brand hover:bg-brand/90 text-white transition-colors",
    isCta ? "gap-2 px-5 py-2 rounded-[6px]" : "gap-1.5 px-3 py-1.5 rounded-md"
  );
  const buttonLabel = label ?? (isCta ? "Import CSV" : "Import");

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,.tsv"
        className="hidden"
        onChange={handleFileChange}
      />
      <button onClick={() => fileRef.current?.click()} className={triggerClass}>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className={isCta ? "w-4 h-4" : "w-3.5 h-3.5"}
        >
          <path d="M9.25 13.25a.75.75 0 0 0 1.5 0V4.636l2.955 3.129a.75.75 0 0 0 1.09-1.03l-4.25-4.5a.75.75 0 0 0-1.09 0l-4.25 4.5a.75.75 0 1 0 1.09 1.03L9.25 4.636v8.614Z" />
          <path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z" />
        </svg>
        {buttonLabel}
      </button>

      {/* Preview / mapping modal */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-0/80 backdrop-blur-sm">
          <div className="bg-surface-1 border border-border rounded-xl w-full max-w-3xl max-h-[85vh] overflow-y-auto mx-4">
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div>
                <h3 className="text-base font-medium text-primary">
                  Import Trades
                </h3>
                <p className="text-xs text-tertiary mt-0.5">
                  {rows.length} rows found -- map columns to fields below
                </p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="text-tertiary hover:text-primary transition-colors text-lg leading-none px-1"
              >
                &times;
              </button>
            </div>

            {/* Column mapping */}
            <div className="px-6 py-4 border-b border-border">
              <h4 className="text-[13px] font-medium text-secondary mb-3">
                Column Mapping
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {allFields.map((field) => {
                  const isRequired = (REQUIRED_FIELDS as readonly string[]).includes(field);
                  return (
                    <div key={field}>
                      <label className="text-[11px] text-secondary mb-1 block">
                        {FIELD_LABELS[field]}
                        {isRequired && (
                          <span className="text-loss ml-0.5">*</span>
                        )}
                      </label>
                      <select
                        value={mapping[field] || ""}
                        onChange={(e) =>
                          setMapping((m) => ({ ...m, [field]: e.target.value }))
                        }
                        className="w-full border border-white/[0.06] bg-transparent rounded-md px-2.5 py-1.5 text-xs text-primary hover:border-white/[0.1] focus:outline-none focus:border-white/[0.15] transition-colors"
                      >
                        <option value="">-- skip --</option>
                        {headers.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Preview table */}
            <div className="px-6 py-4">
              <h4 className="text-[13px] font-medium text-secondary mb-3">
                Preview (first {previewRows.length} rows)
              </h4>
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-surface-2">
                      {headers.map((h, i) => (
                        <th
                          key={i}
                          className="px-3 py-2 text-left text-[13px] font-medium text-secondary whitespace-nowrap"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, ri) => (
                      <tr
                        key={ri}
                        className="border-t border-border"
                      >
                        {headers.map((_, ci) => (
                          <td
                            key={ci}
                            className="px-3 py-2 text-secondary whitespace-nowrap"
                          >
                            {row[ci] ?? ""}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Footer actions */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
              <button
                onClick={() => setOpen(false)}
                className="px-4 py-2 rounded-md text-xs font-medium text-secondary border border-border hover:text-primary hover:border-border-hover transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleImport}
                disabled={importTrades.isPending}
                className="bg-brand hover:bg-brand/90 text-surface-0 font-medium text-[13px] px-4 py-2 rounded-md transition-colors disabled:opacity-50"
              >
                {importTrades.isPending ? "Importing..." : `Import ${rows.length} Trades`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
