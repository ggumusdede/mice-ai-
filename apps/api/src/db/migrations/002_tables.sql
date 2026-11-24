-- 002 Complete data model for the whole PRD (steps 0–8). snake_case mirrors packages/shared/src/models.ts.
-- Every table carries tenant_id (multi-tenant from day one, §3.8). Nothing is ever deleted (§3.6):
-- state columns (status / superseded_by / ended_at / anonymized_at) are used instead.

-- ============ Block 0: tenants, users, auth ============
CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid GENERATED ALWAYS AS (id) STORED,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  branding jsonb NOT NULL DEFAULT '{}',
  locale text NOT NULL DEFAULT 'tr',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenant_sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  value integer NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, name)
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  email text NOT NULL,
  password_hash text NOT NULL,
  full_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin','clerk_sales','clerk_ops','field','finance','signatory')),
  authority_level text NOT NULL DEFAULT 'all_need_approval' CHECK (authority_level IN ('all_need_approval','scoped','full')),
  authority_scope jsonb NOT NULL DEFAULT '{}',
  can_sign boolean NOT NULL DEFAULT false,
  languages text[] NOT NULL DEFAULT '{tr}',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
-- login is by e-mail across tenants → globally unique (case-insensitive)
CREATE UNIQUE INDEX users_email_uq ON users (lower(email));

CREATE TABLE webauthn_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id),
  credential_id text NOT NULL UNIQUE,
  public_key bytea NOT NULL,
  counter bigint NOT NULL DEFAULT 0,
  transports text[] NOT NULL DEFAULT '{}',
  device_label text,
  backed_up boolean,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

CREATE TABLE auth_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id),
  purpose text NOT NULL CHECK (purpose IN ('register','authenticate')),
  challenge text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE delegations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  admin_id uuid NOT NULL REFERENCES users(id),
  delegate_id uuid NOT NULL REFERENCES users(id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  ended_at timestamptz,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (admin_id <> delegate_id)
);

-- ============ Block 5: rules & thresholds (table, not code) ============
CREATE TABLE rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  key text NOT NULL,
  value jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1,
  changed_by uuid,
  reason text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, key)
);

CREATE TABLE fx_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  currency text NOT NULL CHECK (currency IN ('EUR','TRY','USD','GBP')),
  rate numeric(18,6) NOT NULL CHECK (rate > 0), -- 1 EUR = rate × currency
  source text NOT NULL,
  rate_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fx_rates_lookup ON fx_rates (tenant_id, currency, rate_date DESC, created_at DESC);

-- ============ Block 1: suppliers ============
CREATE TABLE suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  kinds text[] NOT NULL DEFAULT '{}',
  city text NOT NULL,
  district text,
  lat double precision,
  lng double precision,
  capacity_pax integer,
  room_count integer,
  halls jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate','accredited','passive')),
  segment text,
  email text,
  phone text,
  contact_name text,
  commission jsonb,
  payment_terms text,
  performance_score numeric(5,2),
  avg_response_hours numeric(8,2),
  accredited_by uuid,
  accredited_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kinds <@ ARRAY['accommodation','hall','fnb','transfer','technical','activity','ticket','other']::text[]),
  CHECK (status <> 'accredited' OR accredited_by IS NOT NULL)
);

CREATE TABLE supplier_contacts_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  channel text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('in','out')),
  summary text NOT NULL,
  user_id uuid,
  at timestamptz NOT NULL DEFAULT now()
);

-- ============ Block 4: customers & projects ============
CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  short_code text NOT NULL,
  tax_office text,
  tax_number text,
  billing_address text,
  contacts jsonb NOT NULL DEFAULT '[]',
  -- §17.2 default for new customers: signed_or_po, no deposit
  rules jsonb NOT NULL DEFAULT '{"firmApproval":"signed_or_po","depositRate":0,"omitPaymentCancellationClauses":false,"specialClauses":[],"preferredLanguage":"tr","preferredCurrency":"EUR"}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  seq integer NOT NULL,
  code text NOT NULL,
  customer_id uuid REFERENCES customers(id),
  customer_name text,
  title text NOT NULL,
  event_type text,
  start_date date,
  end_date date,
  date_flexibility text,
  pax integer,
  rooms_sgl integer,
  rooms_dbl integer,
  city text,
  district text,
  hall_layout text,
  fnb_needs text,
  technical_needs text,
  transfer_needs text,
  budget numeric(14,2),
  budget_currency text CHECK (budget_currency IN ('EUR','TRY','USD','GBP')),
  budget_segment text,
  decision_date date,
  billing_info text,
  extraction jsonb,
  step smallint NOT NULL DEFAULT 0 CHECK (step BETWEEN 0 AND 8),
  outcome text NOT NULL DEFAULT 'open' CHECK (outcome IN ('open','won','lost','cancelled','closed')),
  lost_reason text,
  owner_id uuid REFERENCES users(id),
  venue_name text,
  received_at timestamptz NOT NULL DEFAULT now(),
  quote_sent_at timestamptz,
  target_business_days numeric(5,2) NOT NULL DEFAULT 2,
  target_override_reason text,
  customer_wait_minutes integer NOT NULL DEFAULT 0,
  event_ended_at timestamptz,
  closed_at timestamptz,
  lessons_learned text,
  overdue_alerted_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, seq),
  CHECK (outcome <> 'lost' OR (lost_reason IS NOT NULL AND length(trim(lost_reason)) > 0))
);
CREATE INDEX projects_tenant_outcome ON projects (tenant_id, outcome);

CREATE TABLE inbound_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  project_id uuid REFERENCES projects(id),
  channel text NOT NULL CHECK (channel IN ('email','whatsapp','phone_note','voice','manual')),
  from_address text,
  subject text,
  body text NOT NULL,
  provider_message_id text,
  received_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE service_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  kind text NOT NULL CHECK (kind IN ('accommodation','hall','fnb','transfer','technical','activity','ticket','other')),
  description text NOT NULL,
  date_from date,
  date_to date,
  quantity numeric(12,2) NOT NULL DEFAULT 1,
  unit text NOT NULL DEFAULT 'lump_sum',
  nights integer,
  specs jsonb NOT NULL DEFAULT '{}',
  selected_offer_id uuid,
  value_add boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','rfq','offered','selected','confirmed','cancelled')),
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX service_items_project ON service_items (project_id);

-- ============ Step 1: RFQ ============
CREATE TABLE rfqs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  service_item_id uuid NOT NULL REFERENCES service_items(id),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','sent','responded','closed','cancelled')),
  -- SHA-256 (hex) of a 32-byte random token. The plain token is NEVER stored.
  token_hash text UNIQUE,
  language text NOT NULL DEFAULT 'tr',
  draft_id uuid,
  decision_id uuid,
  sent_by uuid,
  sent_at timestamptz,
  deadline_hours integer NOT NULL DEFAULT 48,
  deadline_at timestamptz,
  link_expires_at timestamptz,
  reminder_hours integer,
  call_hours integer,
  reminder_sent_at timestamptz,
  call_task_created_at timestamptz,
  override_reason text,
  closed_reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rfqs_item ON rfqs (service_item_id);

-- ============ Step 2: offers, price history, channel prices, negotiation ============
CREATE TABLE supplier_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  rfq_id uuid REFERENCES rfqs(id),
  service_item_id uuid NOT NULL REFERENCES service_items(id),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  version integer NOT NULL,
  source text NOT NULL CHECK (source IN ('form','email','pdf','excel','image','manual')),
  currency text NOT NULL CHECK (currency IN ('EUR','TRY','USD','GBP')),
  lines jsonb NOT NULL DEFAULT '[]',
  option_until date,
  guarantee_pax integer,
  attrition_terms text,
  payment_terms text,
  prepayment_rate numeric(6,4),
  cancellation_terms text,
  overtime_terms text,
  notes text,
  confidence numeric(5,4),
  field_confidence jsonb,
  raw_text text,
  file_name text,
  verified_by uuid,
  verified_at timestamptz,
  superseded_by uuid REFERENCES supplier_offers(id),
  negotiation_round integer NOT NULL DEFAULT 0,
  ai_action_id uuid,
  alarmed_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (service_item_id, supplier_id, version)
);
CREATE INDEX supplier_offers_item ON supplier_offers (service_item_id);
ALTER TABLE service_items ADD CONSTRAINT service_items_selected_offer_fk FOREIGN KEY (selected_offer_id) REFERENCES supplier_offers(id);

CREATE TABLE offer_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  rfq_id uuid REFERENCES rfqs(id),
  offer_id uuid REFERENCES supplier_offers(id),
  file_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes integer NOT NULL,
  data bytea NOT NULL,
  uploaded_via text NOT NULL DEFAULT 'staff',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE price_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  supplier_id uuid REFERENCES suppliers(id),
  project_id uuid REFERENCES projects(id),
  service_item_id uuid REFERENCES service_items(id),
  offer_id uuid REFERENCES supplier_offers(id),
  kind text NOT NULL CHECK (kind IN ('accommodation','hall','fnb','transfer','technical','activity','ticket','other')),
  description text,
  city text,
  district text,
  segment text,
  season text,
  service_date date,
  pax integer,
  room_type text,
  board text,
  cancellation text,
  unit text,
  price_type text NOT NULL CHECK (price_type IN ('initial','negotiated','realized')),
  unit_price numeric(14,2) NOT NULL,
  currency text NOT NULL,
  unit_price_eur numeric(14,2) NOT NULL, -- ex VAT, ex accommodation tax
  verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX price_history_lookup ON price_history (tenant_id, kind, city, unit);

CREATE TABLE channel_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  stay_date date NOT NULL,
  room_type text NOT NULL,
  board text NOT NULL,
  cancellation text NOT NULL CHECK (cancellation IN ('flexible','non_refundable')),
  price numeric(14,2) NOT NULL,
  currency text NOT NULL,
  price_eur numeric(14,2) NOT NULL,
  source text NOT NULL,
  captured_by uuid,
  captured_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX channel_prices_lookup ON channel_prices (tenant_id, supplier_id, stay_date);

CREATE TABLE message_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  project_id uuid REFERENCES projects(id),
  kind text NOT NULL CHECK (kind IN ('missing_info','rfq','rfq_reminder','negotiation','quote_cover','quote_followup','option_extension','revision_request','supplier_confirmation','daily_summary','other')),
  channel text NOT NULL DEFAULT 'email' CHECK (channel IN ('email','whatsapp','sms')),
  to_address text,
  subject text,
  body text NOT NULL,
  original_body text,
  language text NOT NULL DEFAULT 'tr',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','approved','sent','discarded')),
  requires_approval boolean NOT NULL DEFAULT false,
  from_user_id uuid REFERENCES users(id),
  ai_generated boolean NOT NULL DEFAULT false,
  ai_action_id uuid,
  entity_type text,
  entity_id uuid,
  approved_by uuid,
  approved_at timestamptz,
  sent_by uuid,
  sent_at timestamptz,
  from_address text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX message_drafts_project ON message_drafts (project_id);

CREATE TABLE negotiation_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  service_item_id uuid NOT NULL REFERENCES service_items(id),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  offer_id uuid NOT NULL REFERENCES supplier_offers(id),
  round integer NOT NULL CHECK (round >= 1),
  arguments text[] NOT NULL CHECK (arguments <@ ARRAY['volume','relationship','flexible_dates','payment_ease']::text[]),
  draft_id uuid REFERENCES message_drafts(id),
  decision_id uuid,
  violations jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','approved','sent','rejected')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (service_item_id, supplier_id, round)
);

-- ============ Step 3/4: customer quotes ============
CREATE TABLE quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  version integer NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','blocked','pending_approval','approved','sent','accepted','revision_requested','rejected','superseded')),
  currency text NOT NULL CHECK (currency IN ('EUR','TRY','USD','GBP')),
  fx_rate numeric(18,6) NOT NULL,
  fx_source text NOT NULL,
  fx_date date NOT NULL,
  option_until date,
  options_meta jsonb NOT NULL DEFAULT '[]', -- [{optionNo,title}]
  applied_customer_rules jsonb NOT NULL DEFAULT '[]',
  block_reasons jsonb NOT NULL DEFAULT '[]',
  validation jsonb NOT NULL DEFAULT '{}',
  requires_approval boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id),
  approved_by uuid REFERENCES users(id),
  approved_at timestamptz,
  approval_decision_id uuid,
  sent_by uuid,
  sent_at timestamptz,
  public_token_hash text UNIQUE,
  opened_at timestamptz,
  open_count integer NOT NULL DEFAULT 0,
  accepted_option_no integer,
  accepted_at timestamptz,
  accepted_by_name text,
  po_number text,
  awaiting_signed_form boolean NOT NULL DEFAULT false,
  firm_approved_at timestamptz,
  signed_form_file_name text,
  revision_message text,
  revision_diff jsonb,
  margin_override_reason text,
  margin_override_by uuid,
  last_followup_at timestamptz,
  superseded_by uuid REFERENCES quotes(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, version),
  CHECK (status <> 'approved' OR approved_by IS NOT NULL OR approval_decision_id IS NOT NULL)
);

CREATE TABLE quote_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  quote_id uuid NOT NULL REFERENCES quotes(id),
  option_no smallint NOT NULL CHECK (option_no BETWEEN 1 AND 5),
  service_item_id uuid NOT NULL REFERENCES service_items(id),
  offer_id uuid REFERENCES supplier_offers(id),
  supplier_id uuid REFERENCES suppliers(id),
  description text NOT NULL,
  kind text NOT NULL,
  quantity numeric(12,2) NOT NULL,
  unit text NOT NULL,
  nights integer,
  unit_cost_eur numeric(14,4) NOT NULL,
  unit_price_eur numeric(14,4) NOT NULL,
  markup numeric(8,4) NOT NULL,
  vat_rate numeric(6,4) NOT NULL,
  value_add boolean NOT NULL DEFAULT false,
  supplier_option_until date,
  sort integer NOT NULL DEFAULT 0
);
CREATE INDEX quote_lines_quote ON quote_lines (quote_id);

-- ============ Step 5: contracts ============
CREATE TABLE contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  quote_id uuid REFERENCES quotes(id),
  service_item_ids uuid[] NOT NULL DEFAULT '{}',
  version integer NOT NULL DEFAULT 1,
  template text NOT NULL CHECK (template IN ('agency','supplier')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','diff_pending','clean','pending_approval','approved','signed','amended')),
  fields jsonb NOT NULL DEFAULT '{}',
  extraction_confidence numeric(5,4),
  source_text text,
  diff jsonb NOT NULL DEFAULT '[]',
  condition_risk_eur numeric(14,2),
  condition_risk_note text,
  condition_risk_accepted_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  locked boolean NOT NULL DEFAULT false,
  signed_at timestamptz,
  signed_by uuid REFERENCES users(id),
  scan_file_name text,
  amendment_of uuid REFERENCES contracts(id),
  amendment_reason text,
  superseded_by uuid REFERENCES contracts(id),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status NOT IN ('signed','amended') OR locked),
  CHECK (NOT locked OR signed_at IS NOT NULL)
);

CREATE TABLE reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  service_item_id uuid NOT NULL REFERENCES service_items(id),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  contract_id uuid REFERENCES contracts(id),
  confirmation_no text,
  confirmed_at timestamptz,
  confirmed_by uuid,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============ Block 6: documents (generated from data, versioned) ============
CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  kind text NOT NULL CHECK (kind IN ('quote','contract','program','pnl','rooming_list','customer_invoice_draft','supplier_confirmation')),
  version integer NOT NULL,
  status text NOT NULL DEFAULT 'current' CHECK (status IN ('current','stale','pending')),
  stale_reason text,
  stale_at timestamptz,
  entity_type text,
  entity_id uuid,
  content jsonb NOT NULL DEFAULT '{}',
  file_name text,
  mime_type text,
  file_data bytea,
  generated_by uuid,
  generated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  superseded_by uuid REFERENCES documents(id),
  CHECK (status <> 'stale' OR stale_reason IS NOT NULL)
);
CREATE INDEX documents_project ON documents (project_id, kind);

CREATE TABLE document_dependencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  document_id uuid NOT NULL REFERENCES documents(id),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  entity_version integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX document_dependencies_doc ON document_dependencies (document_id);
CREATE INDEX document_dependencies_entity ON document_dependencies (entity_type, entity_id);

-- ============ Operations, decisions, AI ============
CREATE TABLE tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  project_id uuid REFERENCES projects(id),
  assignee_id uuid REFERENCES users(id),
  kind text NOT NULL,
  title text NOT NULL,
  due_at timestamptz,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','cancelled')),
  source text NOT NULL DEFAULT 'user' CHECK (source IN ('ai','rule','user')),
  origin_key text,
  entity_type text,
  entity_id uuid,
  completed_by uuid,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, origin_key)
);

CREATE TABLE decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  project_id uuid REFERENCES projects(id),
  kind text NOT NULL CHECK (kind IN ('quote_approval','margin_override','contract_diff','contract_approval','condition_risk','payment_approval','supplier_accreditation','automation_promotion','automation_demotion','audit_sample','rule_suggestion','checklist_question','assignment','rfq_send','negotiation_message','outbound_message','field_extra','low_confidence_review','unbilled_payment_escalation','low_supplier_score','closing_overdue')),
  badge text NOT NULL CHECK (badge IN ('within_rules','critical','suggestion')),
  summary text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}',
  ai_note text,
  primary_action_label text NOT NULL,
  required_role text NOT NULL DEFAULT 'admin' CHECK (required_role IN ('admin','clerk_sales','clerk_ops','field','finance','signatory')),
  requires_biometric boolean NOT NULL DEFAULT false,
  urgent boolean NOT NULL DEFAULT false,
  entity_type text,
  entity_id uuid,
  draft jsonb,
  ai_action_type text,
  ai_action_id uuid,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','approved','edited','rejected','expired')),
  action text CHECK (action IN ('approve','edit','reject')),
  edits jsonb,
  reason text,
  auto_executed boolean NOT NULL DEFAULT false,
  decided_by uuid REFERENCES users(id),
  decided_at timestamptz,
  decided_device text,
  via_delegation boolean NOT NULL DEFAULT false,
  biometric_method text,
  webauthn_credential_id text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status = 'open' OR status = 'expired' OR auto_executed OR decided_by IS NOT NULL)
);
CREATE INDEX decisions_open ON decisions (tenant_id, status);

CREATE TABLE ai_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  project_id uuid REFERENCES projects(id),
  action_type text NOT NULL,
  authority text NOT NULL CHECK (authority IN ('autonomous','suggest','forbidden')),
  mode text NOT NULL CHECK (mode IN ('autonomous','approval','auto','blocked')),
  model text,
  confidence numeric(5,4),
  input_summary jsonb,
  output jsonb,
  entity_type text,
  entity_id uuid,
  decision_id uuid,
  sampled boolean NOT NULL DEFAULT false,
  outcome text,
  corrected boolean NOT NULL DEFAULT false,
  correction jsonb,
  corrected_by uuid,
  corrected_at timestamptz,
  tokens jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_actions_type ON ai_actions (tenant_id, action_type, created_at);

CREATE TABLE automation_counters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  action_type text NOT NULL,
  mode text NOT NULL DEFAULT 'approval' CHECK (mode IN ('approval','auto')),
  consecutive_clean integer NOT NULL DEFAULT 0,
  threshold integer NOT NULL DEFAULT 20,
  sample_rate numeric(5,4) NOT NULL DEFAULT 0.05,
  promoted_at timestamptz,
  promoted_by uuid,
  demoted_at timestamptz,
  demoted_reason text,
  total_auto integer NOT NULL DEFAULT 0,
  total_sampled integer NOT NULL DEFAULT 0,
  sample_errors integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, action_type)
);

CREATE TABLE automation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  action_type text NOT NULL,
  event text NOT NULL CHECK (event IN ('approved_clean','edited','rejected','sample_ok','sample_error','error_detected','promoted','demoted','auto_executed')),
  decision_id uuid,
  ai_action_id uuid,
  at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE checklist_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  event_type text,
  question text NOT NULL,
  field text,
  status text NOT NULL DEFAULT 'suggested' CHECK (status IN ('active','suggested','rejected')),
  source text NOT NULL DEFAULT 'user' CHECK (source IN ('seed','ai','closing','user')),
  decision_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE rule_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  key text NOT NULL,
  proposed_value jsonb NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','accepted','rejected')),
  decision_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Outbound messages leave the system only through an EmailProvider; the dev/test provider writes here
-- (no real SMTP). Secrets such as one-time links are redacted before persisting.
CREATE TABLE outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  draft_id uuid REFERENCES message_drafts(id),
  channel text NOT NULL DEFAULT 'email',
  from_address text NOT NULL,
  to_address text NOT NULL,
  subject text,
  body text NOT NULL,
  provider text NOT NULL,
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('queued','sent','failed')),
  autonomous boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Generic one-time public links (rooming form, field-extra approval, survey, consent withdrawal — phase B).
CREATE TABLE public_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  purpose text NOT NULL CHECK (purpose IN ('rooming','extra','survey','consent')),
  token_hash text NOT NULL UNIQUE,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  expires_at timestamptz,
  read_only_after timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  use_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============ KVKK personal data layer ============
CREATE TABLE guests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  -- pgp_sym_encrypt(value, GUEST_DATA_KEY); never stored in clear text
  full_name_enc bytea,
  email_enc bytea,
  phone_enc bytea,
  room_type text,
  arrival date,
  departure date,
  consent_reuse boolean NOT NULL DEFAULT false,
  consent_at timestamptz,
  consent_text_version text,
  consent_withdrawn_at timestamptz,
  retention_until date,
  anonymized_at timestamptz,
  source text NOT NULL DEFAULT 'staff',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (anonymized_at IS NULL OR (full_name_enc IS NULL AND email_enc IS NULL AND phone_enc IS NULL))
);

CREATE TABLE consent_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  guest_id uuid NOT NULL REFERENCES guests(id),
  event text NOT NULL CHECK (event IN ('given','withdrawn','anonymized')),
  channel text,
  at timestamptz NOT NULL DEFAULT now()
);

-- ============ Step 6: field ============
CREATE TABLE field_extras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  description text NOT NULL,
  amount_try numeric(14,2) NOT NULL CHECK (amount_try >= 0),
  entered_by uuid NOT NULL REFERENCES users(id),
  needs_admin_approval boolean NOT NULL DEFAULT false,
  admin_decision_id uuid,
  customer_phone text,
  customer_approved_at timestamptz,
  customer_approver_name text,
  reflected_to_customer boolean,
  not_reflected_reason text,
  offline_client_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, offline_client_id),
  CHECK (reflected_to_customer IS DISTINCT FROM false OR not_reflected_reason IS NOT NULL)
);

CREATE TABLE field_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  supplier_id uuid REFERENCES suppliers(id),
  description text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('low','medium','high')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  entered_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============ Step 7: finance ============
CREATE TABLE finance_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  project_id uuid REFERENCES projects(id),
  service_item_id uuid REFERENCES service_items(id),
  supplier_id uuid REFERENCES suppliers(id),
  contract_id uuid REFERENCES contracts(id),
  kind text NOT NULL CHECK (kind IN ('payable','receivable','supplier_invoice','customer_invoice','payment_out','payment_in','commission')),
  amount numeric(14,2) NOT NULL,
  currency text NOT NULL CHECK (currency IN ('EUR','TRY','USD','GBP')),
  fx_rate numeric(18,6),
  amount_eur numeric(14,2) NOT NULL,
  due_date date,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','pending_approval','approved','paid','matched','cancelled')),
  reference text,
  invoice_no text,
  meta jsonb NOT NULL DEFAULT '{}',
  payment_decision_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX finance_entries_project ON finance_entries (project_id);

CREATE TABLE bank_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  booked_at date NOT NULL,
  amount numeric(14,2) NOT NULL,
  currency text NOT NULL,
  description text NOT NULL,
  counterparty text,
  import_batch_id uuid,
  row_hash text,
  matched_entry_id uuid REFERENCES finance_entries(id),
  match_confidence numeric(5,4),
  status text NOT NULL DEFAULT 'unmatched' CHECK (status IN ('unmatched','suggested','matched','ignored')),
  payer_user_id uuid REFERENCES users(id),
  escalated_at timestamptz,
  last_reminder_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, row_hash)
);

-- ============ Step 8: closing & learning ============
CREATE TABLE surveys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  token_hash text UNIQUE,
  sent_at timestamptz,
  answers jsonb,
  answered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============ Audit (append-only) ============
CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  tenant_id uuid,
  actor_type text NOT NULL CHECK (actor_type IN ('user','ai','supplier','customer','system')),
  actor_id text,
  entity text NOT NULL,
  entity_id text,
  project_id uuid,
  action text NOT NULL,
  before jsonb,
  after jsonb,
  device text,
  at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX audit_log_entity ON audit_log (tenant_id, entity, entity_id);
CREATE INDEX audit_log_project ON audit_log (tenant_id, project_id, at);

-- updated_at maintenance
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT table_name FROM information_schema.columns
           WHERE table_schema = 'public' AND column_name = 'updated_at' LOOP
    EXECUTE format('CREATE TRIGGER touch_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION touch_updated_at()', t);
  END LOOP;
END $$;
