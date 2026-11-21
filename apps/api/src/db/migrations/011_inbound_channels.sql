-- 011 Inbound channels (§7 Adım 0 / Adım 1 yanıt okuma, docs/07 §6–§7) and e-Fatura UBL-TR reading (§7 Adım 7, docs/07 §4).
--
-- * inbound_channels — per-tenant inbound endpoint settings: route key (URL part / WhatsApp phone_number_id) and the HMAC
--   secret of the e-mail webhook. NOT row-audited (the secret must never be copied into the append-only audit log).
-- * inbound_messages — linking fields (thread, sender role, RFQ / offer / task / intake project), idempotency per
--   provider message id, attachment metadata (the file bodies are stored only where they are used, e.g. offer_files).
-- * suppliers.tax_number (VKN / TCKN) — e-Fatura supplier matching.
-- * finance_entries.ubl_uuid — e-Fatura ETTN; one invoice per ETTN.

CREATE TABLE inbound_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  channel text NOT NULL CHECK (channel IN ('email', 'whatsapp')),
  -- e-mail: optional opaque key usable instead of the tenant slug in /api/inbound/email/:key; whatsapp: phone_number_id
  route_key text,
  -- e-mail webhook HMAC-SHA256 secret (WhatsApp uses the app secret from the environment)
  secret text,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX inbound_channels_route ON inbound_channels (channel, route_key) WHERE route_key IS NOT NULL AND active;
CREATE UNIQUE INDEX inbound_channels_one_active ON inbound_channels (tenant_id, channel) WHERE active;
SELECT apply_standard_policies('inbound_channels', false);

ALTER TABLE inbound_messages
  ADD COLUMN IF NOT EXISTS sender_name text,
  ADD COLUMN IF NOT EXISTS to_addresses text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS cc_addresses text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS in_reply_to text,
  ADD COLUMN IF NOT EXISTS thread_refs text[] NOT NULL DEFAULT '{}',
  -- webhook | postmark | mailgun | mime | imap | whatsapp | manual
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  -- new_request | supplier_reply | supplier_message | customer_reply | customer_revision | customer_acceptance | project_reply
  -- | extra_approval | auto_reply | unlinked | rejected
  ADD COLUMN IF NOT EXISTS kind text,
  -- message_id | plus_address | subject_tag | open_rfq | contact | new_intake | button | none
  ADD COLUMN IF NOT EXISTS link_method text,
  ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES suppliers(id),
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES customers(id),
  ADD COLUMN IF NOT EXISTS rfq_id uuid REFERENCES rfqs(id),
  ADD COLUMN IF NOT EXISTS offer_id uuid REFERENCES supplier_offers(id),
  ADD COLUMN IF NOT EXISTS task_id uuid REFERENCES tasks(id),
  ADD COLUMN IF NOT EXISTS outbox_id uuid REFERENCES outbox(id),
  ADD COLUMN IF NOT EXISTS field_extra_id uuid REFERENCES field_extras(id),
  -- the project created by this message (new intake) — project_id is the project it belongs to either way
  ADD COLUMN IF NOT EXISTS intake_project_id uuid REFERENCES projects(id),
  ADD COLUMN IF NOT EXISTS processing_status text NOT NULL DEFAULT 'processed'
    CHECK (processing_status IN ('received', 'processed', 'needs_review', 'ignored', 'failed')),
  ADD COLUMN IF NOT EXISTS processing_note text,
  -- [{filename, contentType, size, sha256, accepted, reason?, usedFor?}] — metadata only
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]';
-- idempotency: one row per provider message id (RFC 5322 Message-ID, WhatsApp wamid) per channel
CREATE UNIQUE INDEX IF NOT EXISTS inbound_messages_provider_id
  ON inbound_messages (tenant_id, channel, provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS inbound_messages_project ON inbound_messages (tenant_id, project_id, received_at);

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS tax_number text;
CREATE INDEX IF NOT EXISTS suppliers_tax_number ON suppliers (tenant_id, tax_number) WHERE tax_number IS NOT NULL;

ALTER TABLE finance_entries ADD COLUMN IF NOT EXISTS ubl_uuid text;
CREATE UNIQUE INDEX IF NOT EXISTS finance_entries_ubl_uuid ON finance_entries (tenant_id, lower(ubl_uuid))
  WHERE ubl_uuid IS NOT NULL AND status <> 'cancelled';

-- Webhook entry point: route key (tenant slug, an inbound_channels.route_key or a WhatsApp phone_number_id) → tenant +
-- secret, BEFORE the tenant is known (SECURITY DEFINER; everything afterwards runs under RLS in withTenant()).
CREATE OR REPLACE FUNCTION resolve_inbound_channel(p_channel text, p_key text)
RETURNS TABLE (tenant_id uuid, slug text, secret text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id, t.slug, c.secret
    FROM inbound_channels c JOIN tenants t ON t.id = c.tenant_id AND t.status = 'active'
   WHERE c.channel = p_channel AND c.active AND c.route_key = p_key
  UNION ALL
  SELECT t.id, t.slug, (SELECT c.secret FROM inbound_channels c WHERE c.tenant_id = t.id AND c.channel = p_channel AND c.active LIMIT 1)
    FROM tenants t
   WHERE t.status = 'active' AND t.slug = p_key
     AND NOT EXISTS (SELECT 1 FROM inbound_channels c WHERE c.channel = p_channel AND c.active AND c.route_key = p_key)
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION resolve_inbound_channel(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_inbound_channel(text, text) TO mice_app;

SELECT apply_tenant_foreign_keys();
