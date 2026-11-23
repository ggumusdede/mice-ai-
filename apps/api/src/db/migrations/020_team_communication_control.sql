-- 020 v0.5-A "Ekip, iletişim ve kontrol" (docs/12-v05-kararlar.md S-01, S-02, S-08, S-09, S-10…S-15, D-2, D-3; docs/11 K-01,
-- K-04, K-05, K-24, K-27…K-29). ADDITIVE: new tables + nullable columns only. Nothing is deleted (§3.6): teams / shifts /
-- disclosures / packs are closed with status / revoked_at columns. Every new table: tenant_id + FORCE RLS + tenant-scoped FKs.

-- ---------------------------------------------------------------- D-2 küçük çekirdek ekip (alt takım)
CREATE TABLE teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  leader_id uuid REFERENCES users(id),
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX teams_name_uq ON teams (tenant_id, lower(name)) WHERE active;
SELECT apply_standard_policies('teams');

ALTER TABLE users
  -- D-2: one sub-team per person (quote quality is attributed to the author AND this team)
  ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES teams(id),
  -- S-13 meşgul vekili (deadline-linked cards are routed here before the deadline; never auto-approved)
  ADD COLUMN IF NOT EXISTS deputy_user_id uuid REFERENCES users(id),
  -- S-09: admin exception — this user may connect a personal (non-corporate) mailbox
  ADD COLUMN IF NOT EXISTS personal_account_allowed boolean NOT NULL DEFAULT false,
  -- S-14: own quiet hours {enabled,start,end}; NULL = follow the agency rule
  ADD COLUMN IF NOT EXISTS quiet_hours jsonb;
ALTER TABLE users ADD CONSTRAINT users_deputy_not_self CHECK (deputy_user_id IS NULL OR deputy_user_id <> id);

-- ---------------------------------------------------------------- S-01 nöbet çizelgesi
CREATE TABLE on_call_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  note text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX on_call_shifts_window ON on_call_shifts (tenant_id, starts_at, ends_at) WHERE status = 'active';
SELECT apply_standard_policies('on_call_shifts');

-- ---------------------------------------------------------------- S-01 / S-13 kart yönlendirme (atama, eskalasyon, vekil)
ALTER TABLE decisions
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS escalation_level integer NOT NULL DEFAULT 0 CHECK (escalation_level >= 0),
  ADD COLUMN IF NOT EXISTS deadline_at timestamptz,
  ADD COLUMN IF NOT EXISTS approver_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS deputy_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS routed_to_deputy_at timestamptz;
CREATE INDEX IF NOT EXISTS decisions_routing ON decisions (tenant_id, status, assigned_to) WHERE status = 'open';

-- ---------------------------------------------------------------- S-02 kurumsal hat: onaylayanın adı mesajda ve kayıtta
ALTER TABLE message_drafts
  ADD COLUMN IF NOT EXISTS signed_by_name text,
  -- S-01 hazır şablon anahtarı (request_received, delay_notice …)
  ADD COLUMN IF NOT EXISTS template_key text,
  -- S-02 alıcı türü (participant mesajı proje ayarına bağlı)
  ADD COLUMN IF NOT EXISTS recipient_type text CHECK (recipient_type IS NULL OR recipient_type IN ('customer', 'supplier', 'participant', 'field_contact'));
ALTER TABLE message_drafts DROP CONSTRAINT IF EXISTS message_drafts_kind_check;
ALTER TABLE message_drafts ADD CONSTRAINT message_drafts_kind_check CHECK (kind IN ('missing_info','rfq','rfq_reminder','negotiation','quote_cover',
  'quote_followup','option_extension','revision_request','supplier_confirmation','daily_summary','other','quick_template','collection_reminder'));

-- S-02 / S-26 #8 katılımcıya doğrudan mesaj (proje ayarı; NULL = acenta varsayılanı 'off')
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS participant_messaging text CHECK (participant_messaging IS NULL OR participant_messaging IN ('off', 'logistics', 'on'));

-- ---------------------------------------------------------------- S-08 müşteri adı gizleme istisnası (müşterinin kendi anlaşmalı oteli)
CREATE TABLE customer_supplier_disclosures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  granted_by uuid NOT NULL REFERENCES users(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_by uuid REFERENCES users(id),
  revoked_at timestamptz,
  revoke_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX customer_supplier_disclosures_live ON customer_supplier_disclosures (tenant_id, customer_id, supplier_id) WHERE revoked_at IS NULL;
SELECT apply_standard_policies('customer_supplier_disclosures');

-- ---------------------------------------------------------------- K-04 ilişki sahibi + yedek irtibat
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS relationship_owner_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS backup_owner_id uuid REFERENCES users(id);
ALTER TABLE customers ADD CONSTRAINT customers_backup_not_owner CHECK (backup_owner_id IS NULL OR backup_owner_id IS DISTINCT FROM relationship_owner_id);

-- ---------------------------------------------------------------- K-05 devir-teslim
CREATE TABLE handovers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  from_user_id uuid NOT NULL REFERENCES users(id),
  to_user_id uuid NOT NULL REFERENCES users(id),
  mode text NOT NULL CHECK (mode IN ('planned', 'urgent')),
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  effective_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'access_closed', 'completed', 'cancelled')),
  package jsonb NOT NULL DEFAULT '{}',
  access_closed_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  biometric_method text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_user_id <> to_user_id)
);
CREATE UNIQUE INDEX handovers_one_open ON handovers (tenant_id, from_user_id) WHERE status IN ('scheduled', 'access_closed');
SELECT apply_standard_policies('handovers');

CREATE TABLE handover_reads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  handover_id uuid NOT NULL REFERENCES handovers(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  read_by uuid NOT NULL REFERENCES users(id),
  read_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (handover_id, project_id)
);
SELECT apply_standard_policies('handover_reads');

-- ---------------------------------------------------------------- S-15 çevrimdışı saha paketi
ALTER TABLE guests
  ADD COLUMN IF NOT EXISTS room_no text,
  ADD COLUMN IF NOT EXISTS transfer_group text;

CREATE TABLE project_field_staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  user_id uuid NOT NULL REFERENCES users(id),
  -- NULL = the whole project; otherwise only this transfer group ("hostes yalnız kendi otobüsü")
  transfer_group text,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX project_field_staff_live ON project_field_staff (tenant_id, project_id, user_id) WHERE active;
SELECT apply_standard_policies('project_field_staff');

CREATE TABLE field_packs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id),
  pack_date date NOT NULL,
  project_ids uuid[] NOT NULL DEFAULT '{}',
  guest_count integer NOT NULL DEFAULT 0,
  -- sha256 of the device key (the key itself is returned once and never stored)
  key_hash text NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES users(id),
  revoke_reason text,
  device text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX field_packs_user ON field_packs (tenant_id, user_id, issued_at DESC);
SELECT apply_standard_policies('field_packs');

SELECT apply_tenant_foreign_keys();
