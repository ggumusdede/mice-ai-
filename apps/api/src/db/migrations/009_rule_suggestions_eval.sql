-- 009 §16.5 Kural önerisi üreticisi (rule suggestion generator) + data it learns from.
-- rule_suggestions already exists (002, standard policies applied by 003: RLS, no delete, audit). Additive columns only.
ALTER TABLE rule_suggestions
  ADD COLUMN IF NOT EXISTS kind text,
  ADD COLUMN IF NOT EXISTS fingerprint text,
  ADD COLUMN IF NOT EXISTS scope jsonb,
  ADD COLUMN IF NOT EXISTS patch jsonb,
  ADD COLUMN IF NOT EXISTS current_value jsonb,
  ADD COLUMN IF NOT EXISTS confidence numeric(5,4),
  ADD COLUMN IF NOT EXISTS sample_size integer,
  ADD COLUMN IF NOT EXISTS rationale text,
  ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES suppliers(id),
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS decided_at timestamptz;
ALTER TABLE rule_suggestions DROP CONSTRAINT IF EXISTS rule_suggestions_source_check;
ALTER TABLE rule_suggestions ADD CONSTRAINT rule_suggestions_source_check CHECK (source IN ('user','generator'));
CREATE INDEX IF NOT EXISTS rule_suggestions_fingerprint ON rule_suggestions (tenant_id, fingerprint, created_at);
CREATE INDEX IF NOT EXISTS rule_suggestions_source_created ON rule_suggestions (tenant_id, source, created_at);

-- §16.5 (b): what the tier table suggested vs what the human applied, kept on the quote line (learning data)
ALTER TABLE quote_lines
  ADD COLUMN IF NOT EXISTS suggested_markup numeric(8,4),
  ADD COLUMN IF NOT EXISTS advantage numeric(8,4);

-- conventions: standard policies (idempotent) + tenant-consistent FKs for the new supplier_id reference
SELECT apply_standard_policies('rule_suggestions');
SELECT apply_tenant_foreign_keys();

-- Generic per-tenant job run log (weekly jobs are idempotent: "ran in the last 7 days?" is answered here).
CREATE TABLE IF NOT EXISTS job_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  job text NOT NULL,
  ran_at timestamptz NOT NULL DEFAULT now(),
  result jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS job_runs_lookup ON job_runs (tenant_id, job, ran_at DESC);
SELECT apply_standard_policies('job_runs', false);
SELECT apply_tenant_foreign_keys();
