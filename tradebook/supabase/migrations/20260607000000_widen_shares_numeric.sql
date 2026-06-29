-- Widen share quantity columns from integer to numeric(12, 4).
--
-- Crypto positions are fractional (e.g. 0.0461 BTC, 1.175 ETH, 18.74 SOL), but
-- the live DB still had these columns as integer from the original (stock-only)
-- schema. The repo schema (supabase-schema.sql) already declares shares as
-- numeric(12, 4); this brings the deployed DB in line with it.
--
-- Widening integer -> numeric is a safe, lossless cast; existing whole-share
-- rows are preserved exactly.

alter table public.trades
  alter column shares type numeric(12, 4);

alter table public.trades
  alter column total_shares type numeric(12, 4);

alter table public.missed_trades
  alter column estimated_shares type numeric(12, 4);
