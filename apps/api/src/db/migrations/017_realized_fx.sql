-- 017 Evidence-based realized FX (ürün sahibi kararı Q5; §7 Adım 7–8). ADDITIVE: new nullable columns only.
-- The internal currency stays EUR (amount_eur / fx_rate unchanged: they keep the recorded system rate); these columns hold the
-- ACTUAL rate a movement was made at and where that rate comes from, so realized EUR + TRY profit is provable.
-- Rate convention everywhere: 1 EUR = x <currency>; eur_try_rate: 1 EUR = x TRY.

-- invoices (customer / supplier) and imported historical movements
ALTER TABLE finance_entries
  ADD COLUMN IF NOT EXISTS actual_fx_rate numeric(18,6),       -- 1 EUR = x <currency>, proven (NULL = not proven)
  ADD COLUMN IF NOT EXISTS eur_try_rate numeric(18,6),         -- 1 EUR = x TRY, proven (e-Fatura PricingExchangeRate, invoice, import)
  ADD COLUMN IF NOT EXISTS rate_source text,                   -- efatura | invoice | import | manual | payment_derived ...
  ADD COLUMN IF NOT EXISTS value_date date,                    -- movement date (invoice issue / payment value date)
  -- payment record (mark-paid): what was actually paid and at which rate
  ADD COLUMN IF NOT EXISTS paid_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS paid_currency text CHECK (paid_currency IS NULL OR paid_currency IN ('EUR','TRY','USD','GBP')),
  ADD COLUMN IF NOT EXISTS paid_fx_rate numeric(18,6),         -- 1 EUR = x paid_currency
  ADD COLUMN IF NOT EXISTS paid_eur_try_rate numeric(18,6),
  ADD COLUMN IF NOT EXISTS paid_rate_source text;

-- bank lines: rate derived from the matched amounts (TRY line ÷ EUR invoice) or carried from the invoice
ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS fx_rate numeric(18,6),              -- 1 EUR = x <currency>
  ADD COLUMN IF NOT EXISTS eur_try_rate numeric(18,6),
  ADD COLUMN IF NOT EXISTS rate_source text;

-- initial import: optional "finansal hareketler" file (invoice / payment rows of historical projects)
ALTER TABLE import_files DROP CONSTRAINT IF EXISTS import_files_entity_check;
ALTER TABLE import_files ADD CONSTRAINT import_files_entity_check
  CHECK (entity IN ('suppliers', 'customers', 'projects', 'service_lines', 'price_points', 'channel_prices', 'finance_movements'));
