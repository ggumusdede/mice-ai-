-- 019 v0.5-A "Para ve tedarik çekirdeği"
--  S-19 (ana çatı 7, ürün sahibi kararı 22.11.2026): agency base currency (TRY / EUR / USD), changeable for NEW projects only; each
--      project is fixed to the base currency it was created with. Nothing is renamed: the *_base columns hold amounts in the project's
--      base currency (the code reads them); the old *_eur columns stay populated with the EUR equivalent (deprecated; = *_base when the
--      base is EUR). Existing rows are backfilled as EUR.
--  S-03 tedarik çekirdeği: contract_rates (K-11), allotment_blocks (K-12), supplier_options (K-13).
--  S-07 quote FX policy (quotes.fx_policy), D-1 revision of an accepted quote (quotes.revises_accepted_quote_id).

-- ---------------------------------------------------------------- S-19 base currency
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS base_currency text NOT NULL DEFAULT 'EUR' CHECK (base_currency IN ('EUR','TRY','USD'));

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS base_currency text CHECK (base_currency IN ('EUR','TRY','USD')),
  ADD COLUMN IF NOT EXISTS historical_cost_base numeric(14,2),
  ADD COLUMN IF NOT EXISTS historical_sale_base numeric(14,2);
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS base_currency text CHECK (base_currency IN ('EUR','TRY','USD')),
  ADD COLUMN IF NOT EXISTS fx_policy jsonb,
  ADD COLUMN IF NOT EXISTS revises_accepted_quote_id uuid REFERENCES quotes(id);
ALTER TABLE quote_lines
  ADD COLUMN IF NOT EXISTS unit_cost_base numeric(14,4),
  ADD COLUMN IF NOT EXISTS unit_price_base numeric(14,4);
ALTER TABLE finance_entries
  ADD COLUMN IF NOT EXISTS base_currency text CHECK (base_currency IN ('EUR','TRY','USD')),
  ADD COLUMN IF NOT EXISTS amount_base numeric(14,2),
  ADD COLUMN IF NOT EXISTS base_fx_rate numeric(18,6); -- 1 <base_currency> = x <currency> (system rate at entry time)
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS condition_risk_base numeric(14,2);

-- backfill as EUR (append-only tables: their own guard / audit triggers are bypassed for this one-off data migration)
ALTER TABLE projects DISABLE TRIGGER USER;
UPDATE projects SET base_currency = 'EUR', historical_cost_base = historical_cost_eur, historical_sale_base = historical_sale_eur WHERE base_currency IS NULL;
ALTER TABLE projects ENABLE TRIGGER USER;
ALTER TABLE quotes DISABLE TRIGGER USER;
UPDATE quotes SET base_currency = 'EUR' WHERE base_currency IS NULL;
ALTER TABLE quotes ENABLE TRIGGER USER;
ALTER TABLE quote_lines DISABLE TRIGGER USER;
UPDATE quote_lines SET unit_cost_base = unit_cost_eur, unit_price_base = unit_price_eur WHERE unit_cost_base IS NULL;
ALTER TABLE quote_lines ENABLE TRIGGER USER;
ALTER TABLE finance_entries DISABLE TRIGGER USER;
UPDATE finance_entries SET base_currency = 'EUR', amount_base = amount_eur, base_fx_rate = fx_rate WHERE amount_base IS NULL;
ALTER TABLE finance_entries ENABLE TRIGGER USER;
ALTER TABLE contracts DISABLE TRIGGER USER;
UPDATE contracts SET condition_risk_base = condition_risk_eur WHERE condition_risk_base IS NULL AND condition_risk_eur IS NOT NULL;
ALTER TABLE contracts ENABLE TRIGGER USER;

-- EUR → base with the tenant's latest system rate (1 EUR = rate × currency); only a fallback for writers that set *_eur alone.
CREATE OR REPLACE FUNCTION eur_to_base(p_amount numeric, p_base text, p_tenant uuid) RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN p_amount IS NULL THEN NULL WHEN p_base IS NULL OR p_base = 'EUR' THEN p_amount
    ELSE p_amount * (SELECT rate FROM fx_rates WHERE tenant_id = p_tenant AND currency = p_base AND rate_type IS NULL
                      ORDER BY rate_date DESC, created_at DESC LIMIT 1) END
$$;

-- a project takes the agency's CURRENT base currency at creation and keeps it for life
CREATE OR REPLACE FUNCTION project_base_currency() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.base_currency IS NULL THEN
      NEW.base_currency := COALESCE((SELECT base_currency FROM tenants WHERE id = NEW.tenant_id), 'EUR');
    END IF;
    IF NEW.historical_cost_base IS NULL AND NEW.historical_cost_eur IS NOT NULL THEN NEW.historical_cost_base := eur_to_base(NEW.historical_cost_eur, NEW.base_currency, NEW.tenant_id); END IF;
    IF NEW.historical_sale_base IS NULL AND NEW.historical_sale_eur IS NOT NULL THEN NEW.historical_sale_base := eur_to_base(NEW.historical_sale_eur, NEW.base_currency, NEW.tenant_id); END IF;
  ELSIF NEW.base_currency IS DISTINCT FROM OLD.base_currency THEN
    RAISE EXCEPTION 'Projenin ana para birimi oluşturulduğu anda sabittir (%)', OLD.base_currency USING ERRCODE = 'MI019';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS project_base_currency ON projects;
CREATE TRIGGER project_base_currency BEFORE INSERT OR UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION project_base_currency();

CREATE OR REPLACE FUNCTION quote_base_currency() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.base_currency IS NULL THEN NEW.base_currency := COALESCE((SELECT base_currency FROM projects WHERE id = NEW.project_id), 'EUR'); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS quote_base_currency ON quotes;
CREATE TRIGGER quote_base_currency BEFORE INSERT ON quotes FOR EACH ROW EXECUTE FUNCTION quote_base_currency();

CREATE OR REPLACE FUNCTION quote_line_base_amounts() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_base text;
BEGIN
  IF NEW.unit_cost_base IS NULL OR NEW.unit_price_base IS NULL THEN
    SELECT base_currency INTO v_base FROM quotes WHERE id = NEW.quote_id;
    NEW.unit_cost_base := COALESCE(NEW.unit_cost_base, eur_to_base(NEW.unit_cost_eur, v_base, NEW.tenant_id));
    NEW.unit_price_base := COALESCE(NEW.unit_price_base, eur_to_base(NEW.unit_price_eur, v_base, NEW.tenant_id));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS quote_line_base_amounts ON quote_lines;
CREATE TRIGGER quote_line_base_amounts BEFORE INSERT ON quote_lines FOR EACH ROW EXECUTE FUNCTION quote_line_base_amounts();

CREATE OR REPLACE FUNCTION finance_base_amount() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.base_currency IS NULL THEN
    NEW.base_currency := COALESCE((SELECT base_currency FROM projects WHERE id = NEW.project_id),
                                  (SELECT base_currency FROM tenants WHERE id = NEW.tenant_id), 'EUR');
  END IF;
  IF NEW.base_fx_rate IS NULL THEN
    -- 1 base = x currency, from the EUR-convention system rate of the entry (fx_rate: 1 EUR = x currency)
    NEW.base_fx_rate := CASE WHEN NEW.currency = NEW.base_currency THEN 1
      WHEN NEW.fx_rate IS NOT NULL AND eur_to_base(1, NEW.base_currency, NEW.tenant_id) > 0 THEN round(NEW.fx_rate / eur_to_base(1, NEW.base_currency, NEW.tenant_id), 6) END;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.amount_base IS NULL THEN
    NEW.amount_base := CASE WHEN NEW.currency = NEW.base_currency THEN NEW.amount ELSE eur_to_base(NEW.amount_eur, NEW.base_currency, NEW.tenant_id) END;
  ELSIF TG_OP = 'UPDATE' AND NEW.amount_base IS NOT DISTINCT FROM OLD.amount_base AND NEW.amount_eur IS DISTINCT FROM OLD.amount_eur THEN
    -- a legacy writer changed only the EUR column: keep the base amount consistent
    NEW.amount_base := CASE WHEN NEW.currency = NEW.base_currency THEN NEW.amount ELSE eur_to_base(NEW.amount_eur, NEW.base_currency, NEW.tenant_id) END;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS finance_base_amount ON finance_entries;
CREATE TRIGGER finance_base_amount BEFORE INSERT OR UPDATE ON finance_entries FOR EACH ROW EXECUTE FUNCTION finance_base_amount();

-- finance staleness also watches the base amount
DROP TRIGGER IF EXISTS propagate_staleness ON finance_entries;
CREATE TRIGGER propagate_staleness AFTER INSERT OR UPDATE ON finance_entries FOR EACH ROW EXECUTE FUNCTION propagate_staleness(
  'finance_entry', 'project_id', 'amount', 'amount_eur', 'amount_base', 'currency', 'kind', 'status');

-- ---------------------------------------------------------------- S-03 / K-11 contract rates
CREATE TABLE IF NOT EXISTS contract_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  kind text NOT NULL,
  room_type text,
  board text,
  unit text NOT NULL DEFAULT 'room_night',
  valid_from date NOT NULL,
  valid_to date NOT NULL,
  price numeric(14,2) NOT NULL CHECK (price > 0),
  currency text NOT NULL CHECK (currency IN ('EUR','TRY','USD','GBP')),
  vat_included boolean NOT NULL DEFAULT false,
  conditions text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to >= valid_from)
);
CREATE INDEX IF NOT EXISTS contract_rates_lookup ON contract_rates (tenant_id, supplier_id, kind, valid_from);
SELECT apply_standard_policies('contract_rates');

-- ---------------------------------------------------------------- S-03 / K-12 allotment blocks
CREATE TABLE IF NOT EXISTS allotment_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  project_id uuid REFERENCES projects(id),
  service_item_id uuid REFERENCES service_items(id),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  room_type text,
  date_from date NOT NULL,
  date_to date NOT NULL,
  rooms_per_night integer NOT NULL CHECK (rooms_per_night > 0),
  rate_per_room_night numeric(14,2) NOT NULL CHECK (rate_per_room_night >= 0),
  currency text NOT NULL CHECK (currency IN ('EUR','TRY','USD','GBP')),
  release_date date,
  attrition_pct numeric(6,4) NOT NULL DEFAULT 0 CHECK (attrition_pct >= 0 AND attrition_pct <= 1),
  penalty_pct numeric(6,4) NOT NULL DEFAULT 1 CHECK (penalty_pct >= 0 AND penalty_pct <= 1),
  penalty_terms text,
  released_rooms integer NOT NULL DEFAULT 0 CHECK (released_rooms >= 0),
  pickup jsonb NOT NULL DEFAULT '[]',         -- [{date, rooms}] nameless count
  releases jsonb NOT NULL DEFAULT '[]',       -- [{rooms, at, by, reason}] history (append)
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','released','closed')),
  release_alerted_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (date_to >= date_from)
);
CREATE INDEX IF NOT EXISTS allotment_blocks_project ON allotment_blocks (tenant_id, project_id);
SELECT apply_standard_policies('allotment_blocks');

-- ---------------------------------------------------------------- S-03 / K-13 supplier options (1st / 2nd option, extensions)
CREATE TABLE IF NOT EXISTS supplier_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  service_item_id uuid NOT NULL REFERENCES service_items(id),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  offer_id uuid REFERENCES supplier_offers(id),
  rank smallint NOT NULL DEFAULT 1 CHECK (rank IN (1, 2)),
  option_until date NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','extension_requested','released','confirmed','expired')),
  extensions jsonb NOT NULL DEFAULT '[]',     -- [{from, to, at, by}]
  note text,
  alerted_until date,                          -- option date the T-3 card was opened for (one card per date)
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS supplier_options_project ON supplier_options (tenant_id, project_id);
SELECT apply_standard_policies('supplier_options');

-- K-13: an extended option changes the customer quote's option → the dependent quote documents become stale ("supplier_offer …"
-- reason → the quote must be revised, it cannot be re-sent as is)
CREATE OR REPLACE FUNCTION supplier_option_staleness() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.option_until IS DISTINCT FROM OLD.option_until THEN
    PERFORM mark_documents_stale(NEW.tenant_id, NEW.project_id, 'supplier_offer', NEW.offer_id,
      format('supplier_offer opsiyonu uzatıldı: %s → %s', OLD.option_until, NEW.option_until));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS supplier_option_staleness ON supplier_options;
CREATE TRIGGER supplier_option_staleness AFTER UPDATE ON supplier_options FOR EACH ROW EXECUTE FUNCTION supplier_option_staleness();

SELECT apply_tenant_foreign_keys();
