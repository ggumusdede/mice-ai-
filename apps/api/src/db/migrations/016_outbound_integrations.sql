-- 016 Outbound integrations (PRD §3.3, §10, §15, §17.7; docs/07 §1, §6, §7):
--   * per-user OAuth mailboxes (Gmail API / Microsoft Graph "send as me"): the account row (audited, NO secrets), the token row
--     (pgcrypto-encrypted refresh / access token, NOT audited — the audit log is append-only and must never hold a copy) and
--     short-lived connect states (PKCE verifier encrypted, single use, NOT audited);
--   * outbox: provider thread id (Gmail threadId / Graph conversationId) and delivery receipts (WhatsApp status webhook);
--   * notifications: §15 critical-push fallback bookkeeping (WhatsApp / SMS when a critical push is not opened in N minutes);
--   * users.notify_phone: the staff member's own number for that fallback.
-- Nothing is deleted (§3.6): disconnecting a mailbox marks the account 'disconnected' and empties the token columns.

CREATE TABLE user_mail_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id),
  provider text NOT NULL CHECK (provider IN ('google', 'microsoft')),
  -- mailbox address reported by the provider (must equal the user's own address unless MAIL_OAUTH_REQUIRE_SAME_ADDRESS=0)
  email_address text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'needs_reauth', 'disconnected')),
  scopes text[] NOT NULL DEFAULT '{}',
  connected_at timestamptz NOT NULL DEFAULT now(),
  disconnected_at timestamptz,
  disconnected_reason text CHECK (disconnected_reason IS NULL OR disconnected_reason IN ('user', 'admin', 'replaced', 'revoked')),
  last_used_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- one live mailbox per user (a reconnect replaces the previous row: 'disconnected' / 'replaced')
CREATE UNIQUE INDEX user_mail_accounts_one_live ON user_mail_accounts (tenant_id, user_id) WHERE status <> 'disconnected';
SELECT apply_standard_policies('user_mail_accounts');

CREATE TABLE user_mail_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  account_id uuid NOT NULL UNIQUE REFERENCES user_mail_accounts(id),
  -- pgp_sym_encrypt(token, MAIL_TOKEN_KEY); the key never reaches the database
  refresh_token_enc bytea,
  access_token_enc bytea,
  access_expires_at timestamptz,
  refresh_failures integer NOT NULL DEFAULT 0,
  -- backoff after a transient refresh failure
  next_refresh_at timestamptz,
  purged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
SELECT apply_standard_policies('user_mail_tokens', false);

CREATE TABLE mail_oauth_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id),
  provider text NOT NULL CHECK (provider IN ('google', 'microsoft')),
  -- sha256 of the signed state string (the state itself only travels through the browser)
  state_hash text NOT NULL UNIQUE,
  code_verifier_enc bytea,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
SELECT apply_standard_policies('mail_oauth_states', false);

ALTER TABLE outbox
  ADD COLUMN IF NOT EXISTS provider_thread_id text,
  -- delivery receipt from the provider (WhatsApp status webhook): sent → delivered → read | failed
  ADD COLUMN IF NOT EXISTS delivery_status text CHECK (delivery_status IS NULL OR delivery_status IN ('sent', 'delivered', 'read', 'failed')),
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS read_at timestamptz;
CREATE INDEX IF NOT EXISTS outbox_provider_message ON outbox (tenant_id, provider, provider_message_id) WHERE provider_message_id IS NOT NULL;

ALTER TABLE notifications
  -- sent | no_phone | no_channel | failed
  ADD COLUMN IF NOT EXISTS fallback_status text,
  ADD COLUMN IF NOT EXISTS fallback_at timestamptz,
  ADD COLUMN IF NOT EXISTS fallback_outbox_id uuid REFERENCES outbox(id),
  -- push_click | api
  ADD COLUMN IF NOT EXISTS acked_via text;
CREATE INDEX IF NOT EXISTS notifications_fallback_due ON notifications (tenant_id, sent_at)
  WHERE priority = 'critical' AND read_at IS NULL AND fallback_at IS NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_phone text;

SELECT apply_tenant_foreign_keys();
