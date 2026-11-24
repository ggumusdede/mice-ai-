-- 015 İlk veri yükü (PRD §8: "yalnızca son 12–18 ayın kapanmış projeleri, elle doğrulanarak yüklenir").
--
-- Staging: import_batches (one admin import session, status open → committed | abandoned; never deleted),
--          import_files (one uploaded file per entity; a re-upload supersedes the previous file of that entity),
--          import_rows (input as uploaded / edited, normalized data, validation status + issues, human review).
-- Nothing reaches the live tables until an admin approves rows and commits the batch (one transaction, audited).
-- Live tables get a nullable import_batch_id (traceability); projects get `historical` (+ source_ref, totals) so imported
-- past projects never appear in active lists / worker jobs but still feed know-how, price medians, scores and rule suggestions.

CREATE TABLE import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  label text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'committed', 'abandoned')),
  summary jsonb NOT NULL DEFAULT '{}',
  created_by uuid NOT NULL REFERENCES users(id),
  committed_by uuid REFERENCES users(id),
  committed_at timestamptz,
  abandoned_by uuid REFERENCES users(id),
  abandoned_at timestamptz,
  abandon_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'committed' OR (committed_by IS NOT NULL AND committed_at IS NOT NULL)),
  CHECK (status <> 'abandoned' OR (abandoned_by IS NOT NULL AND abandoned_at IS NOT NULL))
);
SELECT apply_standard_policies('import_batches');

CREATE TABLE import_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  batch_id uuid NOT NULL REFERENCES import_batches(id),
  entity text NOT NULL CHECK (entity IN ('suppliers', 'customers', 'projects', 'service_lines', 'price_points', 'channel_prices')),
  file_name text NOT NULL,
  file_sha256 text NOT NULL,
  row_count integer NOT NULL DEFAULT 0,
  unknown_headers text[] NOT NULL DEFAULT '{}',
  uploaded_by uuid NOT NULL REFERENCES users(id),
  superseded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX import_files_one_active ON import_files (batch_id, entity) WHERE superseded_at IS NULL;
CREATE INDEX import_files_sha ON import_files (tenant_id, file_sha256);
SELECT apply_standard_policies('import_files');

CREATE TABLE import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  batch_id uuid NOT NULL REFERENCES import_batches(id),
  file_id uuid NOT NULL REFERENCES import_files(id),
  entity text NOT NULL,
  row_no integer NOT NULL,
  raw jsonb NOT NULL,
  input jsonb NOT NULL,
  data jsonb NOT NULL DEFAULT '{}',
  natural_key text,
  status text NOT NULL DEFAULT 'error' CHECK (status IN ('ok', 'warning', 'error')),
  issues jsonb NOT NULL DEFAULT '[]',
  resolved jsonb NOT NULL DEFAULT '{}',
  review text NOT NULL DEFAULT 'pending' CHECK (review IN ('pending', 'approved', 'rejected')),
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  edited_by uuid REFERENCES users(id),
  edited_at timestamptz,
  committed_entity_id uuid,
  committed_action text CHECK (committed_action IN ('created', 'linked')),
  committed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (file_id, row_no),
  CHECK (review = 'pending' OR reviewed_by IS NOT NULL),
  CHECK (committed_at IS NULL OR (review = 'approved' AND status <> 'error'))
);
CREATE INDEX import_rows_batch ON import_rows (batch_id, entity);
SELECT apply_standard_policies('import_rows');

CREATE TRIGGER touch_updated_at BEFORE UPDATE ON import_batches FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER touch_updated_at BEFORE UPDATE ON import_files FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER touch_updated_at BEFORE UPDATE ON import_rows FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- live tables: traceability to the batch (audit rows carry it in `after`)
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS import_batch_id uuid REFERENCES import_batches(id);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS import_batch_id uuid REFERENCES import_batches(id);
ALTER TABLE service_items ADD COLUMN IF NOT EXISTS import_batch_id uuid REFERENCES import_batches(id);
ALTER TABLE price_history ADD COLUMN IF NOT EXISTS import_batch_id uuid REFERENCES import_batches(id);
ALTER TABLE channel_prices ADD COLUMN IF NOT EXISTS import_batch_id uuid REFERENCES import_batches(id);
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS historical boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS import_batch_id uuid REFERENCES import_batches(id),
  ADD COLUMN IF NOT EXISTS source_ref text,
  ADD COLUMN IF NOT EXISTS historical_cost_eur numeric(14,2),
  ADD COLUMN IF NOT EXISTS historical_sale_eur numeric(14,2);
ALTER TABLE projects ADD CONSTRAINT projects_historical_closed
  CHECK (NOT historical OR (outcome IN ('closed', 'lost') AND closed_at IS NOT NULL AND source_ref IS NOT NULL));
-- re-import idempotency: one historical project per source code
CREATE UNIQUE INDEX projects_historical_source ON projects (tenant_id, source_ref) WHERE historical;
CREATE INDEX projects_active ON projects (tenant_id, received_at DESC) WHERE NOT historical;

SELECT apply_tenant_foreign_keys();
