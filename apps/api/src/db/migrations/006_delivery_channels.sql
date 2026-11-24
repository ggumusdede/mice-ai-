-- 006 Delivery channels: real e-mail (SMTP) delivery state on the outbox, retry payloads, Web Push subscriptions.
-- Nothing is deleted (§3.6): subscriptions are deactivated, retry payloads are emptied after delivery.

-- ---------------------------------------------------------------- outbox: delivery state (SMTP provider)
-- Existing rows (outbox provider) stay 'sent'. SMTP rows go 'queued' → 'sent' | 'failed' (retried by the worker until
-- attempts are exhausted; then next_attempt_at IS NULL).
ALTER TABLE outbox
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id),
  ADD COLUMN IF NOT EXISTS message_id text,
  ADD COLUMN IF NOT EXISTS in_reply_to text,
  ADD COLUMN IF NOT EXISTS reply_to text,
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_message_id text,
  -- set when the sender / admin were told that delivery was given up
  ADD COLUMN IF NOT EXISTS failure_notified_at timestamptz;
CREATE INDEX IF NOT EXISTS outbox_retry ON outbox (tenant_id, status, next_attempt_at) WHERE status IN ('queued', 'failed');
CREATE INDEX IF NOT EXISTS outbox_thread ON outbox (tenant_id, project_id, to_address, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS outbox_message_id ON outbox (message_id) WHERE message_id IS NOT NULL;

-- Unredacted body (it may contain one-time public links, which are redacted in outbox.body) kept ONLY until delivery,
-- pgcrypto-encrypted with OUTBOX_DATA_KEY (never stored in the DB). Not audited (like auth_challenges): the audit log is
-- append-only and must never hold a copy. Emptied (body_enc NULL, purged_at) once sent or given up.
CREATE TABLE outbox_payloads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  outbox_id uuid NOT NULL UNIQUE REFERENCES outbox(id),
  body_enc bytea,
  purged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
SELECT apply_standard_policies('outbox_payloads', false);

-- ---------------------------------------------------------------- Web Push subscriptions (§15 bildirim)
-- One row per browser push endpoint per tenant. POST /api/push/subscribe upserts (a shared device that logs in as another
-- user moves the row to that user), POST /api/push/unsubscribe and 404/410 from the push service set active=false.
-- Not row-audited: endpoint + keys are delivery credentials; the row itself keeps created/deactivated history.
CREATE TABLE push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id),
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth_secret text NOT NULL,
  user_agent text,
  device text,
  active boolean NOT NULL DEFAULT true,
  failure_count integer NOT NULL DEFAULT 0,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error text,
  deactivated_at timestamptz,
  deactivated_reason text CHECK (deactivated_reason IS NULL OR deactivated_reason IN ('user', 'expired', 'failures', 'replaced')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, endpoint)
);
CREATE INDEX push_subscriptions_user ON push_subscriptions (tenant_id, user_id) WHERE active;
SELECT apply_standard_policies('push_subscriptions', false);

-- /api/ready compares applied migrations with the files shipped in the image.
GRANT SELECT ON schema_migrations TO mice_app;
