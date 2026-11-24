-- 004 Phase B (steps 6–8, reports, admin): notifications, field-extra approval bookkeeping, payment approval columns,
-- monthly style summaries, survey questions, DB guards for money (§6: AI never approves/pays).

-- ---------------------------------------------------------------- push notifications (§15 Bildirim)
-- Critical notifications are delivered immediately; routine ones are batched into a morning / evening digest.
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id),
  project_id uuid REFERENCES projects(id),
  priority text NOT NULL CHECK (priority IN ('critical','routine','digest')),
  title text NOT NULL,
  body text,
  entity_type text,
  entity_id uuid,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','batched','read')),
  deliver_after timestamptz,
  digest_id uuid REFERENCES notifications(id),
  channel text NOT NULL DEFAULT 'push',
  sent_at timestamptz,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_pending ON notifications (tenant_id, status, deliver_after);
SELECT apply_standard_policies('notifications');

-- ---------------------------------------------------------------- monthly style summary (§15 üslup öğrenme, §16.6)
CREATE TABLE style_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  month text NOT NULL, -- YYYY-MM
  language text NOT NULL DEFAULT 'tr',
  summary text NOT NULL,
  corrections integer NOT NULL DEFAULT 0,
  ai_action_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, month, language)
);
SELECT apply_standard_policies('style_summaries');

-- ---------------------------------------------------------------- field extras (§17.7): admin path + customer approval amount
ALTER TABLE field_extras
  ADD COLUMN admin_status text NOT NULL DEFAULT 'not_required' CHECK (admin_status IN ('not_required','pending','approved','rejected')),
  ADD COLUMN customer_approved_amount_try numeric(14,2),
  ADD COLUMN reflected_by uuid,
  ADD COLUMN reflected_at timestamptz;


-- ---------------------------------------------------------------- finance: payment approval / paid bookkeeping
ALTER TABLE finance_entries
  ADD COLUMN approved_by uuid REFERENCES users(id),
  ADD COLUMN approved_at timestamptz,
  ADD COLUMN requested_by uuid REFERENCES users(id),
  ADD COLUMN requested_at timestamptz,
  ADD COLUMN paid_by uuid REFERENCES users(id),
  ADD COLUMN paid_at timestamptz,
  ADD COLUMN matched_bank_transaction_id uuid REFERENCES bank_transactions(id);

-- §6 money_movement is FORBIDDEN for AI: a finance entry can only be approved / marked paid by a human actor.
CREATE OR REPLACE FUNCTION finance_money_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('approved','paid') AND OLD.status IS DISTINCT FROM NEW.status AND app_actor_type() <> 'user' THEN
    RAISE EXCEPTION 'Ödeme onayı / ödeme kaydı yalnızca insan tarafından yapılır (§6)' USING ERRCODE = 'MI006';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER finance_money_guard BEFORE UPDATE ON finance_entries FOR EACH ROW EXECUTE FUNCTION finance_money_guard();

-- ---------------------------------------------------------------- surveys (§7 Adım 8: 3-question survey)
ALTER TABLE surveys ADD COLUMN questions jsonb NOT NULL DEFAULT '[]', ADD COLUMN created_by uuid;

-- ---------------------------------------------------------------- rules: audit who changed what (table already audited);
-- rule changes by a non-user actor are refused at the DB level as well (§6 rule_change forbidden).
CREATE OR REPLACE FUNCTION rules_change_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF app_actor_type() = 'ai' THEN
    RAISE EXCEPTION 'Kural / eşik / yetki değişikliği yapay zekâ tarafından yapılamaz (§6)' USING ERRCODE = 'MI006';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER rules_change_guard BEFORE INSERT OR UPDATE ON rules FOR EACH ROW EXECUTE FUNCTION rules_change_guard();

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO mice_app;
