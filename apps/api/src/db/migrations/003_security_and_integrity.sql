-- 003 Database-enforced principles: RLS (§3.8), immutability + audit (§3.6), change propagation (§3.5),
-- contract lock (§7 Adım 5), versioned offers never overwritten, stale documents cannot be sent.

-- ---------------------------------------------------------------- audit
-- Columns never copied into audit_log (secrets, binary blobs, encrypted PII — so KVKK anonymisation leaves no copy).
CREATE OR REPLACE FUNCTION audit_redact(p_row jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_row IS NULL THEN NULL ELSE
    (p_row - ARRAY['password_hash','token_hash','public_token_hash','file_data','data','public_key','challenge',
                   'full_name_enc','email_enc','phone_enc','raw_text','source_text'])
    || CASE WHEN p_row ? 'full_name_enc' THEN jsonb_build_object('pii', '[encrypted]') ELSE '{}'::jsonb END
  END
$$;

CREATE OR REPLACE FUNCTION audit_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_after jsonb := to_jsonb(NEW);
  v_before jsonb;
  v_project uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_before := to_jsonb(OLD);
    IF (v_before - 'updated_at') = (v_after - 'updated_at') THEN RETURN NEW; END IF;
  END IF;
  v_project := CASE WHEN TG_TABLE_NAME = 'projects' THEN (v_after->>'id')::uuid
                    ELSE NULLIF(v_after->>'project_id', '')::uuid END;
  INSERT INTO audit_log (tenant_id, actor_type, actor_id, entity, entity_id, project_id, action, before, after, device)
  VALUES (NULLIF(v_after->>'tenant_id', '')::uuid, app_actor_type(), app_user_id(), TG_TABLE_NAME, v_after->>'id',
          v_project, lower(TG_OP), audit_redact(v_before), audit_redact(v_after),
          NULLIF(current_setting('app.device', true), ''));
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION forbid_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Kayıt silinemez (%): durum değişikliği kullanın (§3.6)', TG_TABLE_NAME USING ERRCODE = 'MI001';
END $$;

CREATE OR REPLACE FUNCTION forbid_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Kayıt değiştirilemez (%): yalnızca ekleme yapılabilir', TG_TABLE_NAME USING ERRCODE = 'MI001';
END $$;

-- ---------------------------------------------------------------- standard policy helper (extension point for phase B)
-- Usage in a later migration: SELECT apply_standard_policies('my_new_table');
CREATE OR REPLACE FUNCTION apply_standard_policies(p_table regclass, p_audit boolean DEFAULT true) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE t text := p_table::text;
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', t);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s', t);
  EXECUTE format('CREATE POLICY tenant_isolation ON %s USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
  EXECUTE format('DROP TRIGGER IF EXISTS no_delete ON %s', t);
  EXECUTE format('CREATE TRIGGER no_delete BEFORE DELETE ON %s FOR EACH ROW EXECUTE FUNCTION forbid_delete()', t);
  EXECUTE format('DROP TRIGGER IF EXISTS no_truncate ON %s', t);
  EXECUTE format('CREATE TRIGGER no_truncate BEFORE TRUNCATE ON %s FOR EACH STATEMENT EXECUTE FUNCTION forbid_delete()', t);
  IF p_audit THEN
    EXECUTE format('DROP TRIGGER IF EXISTS audit ON %s', t);
    EXECUTE format('CREATE TRIGGER audit AFTER INSERT OR UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION audit_row()', t);
  END IF;
  EXECUTE format('REVOKE ALL ON %s FROM mice_app', t);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %s TO mice_app', t);
END $$;

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT c.table_name FROM information_schema.columns c
           JOIN information_schema.tables tb ON tb.table_name = c.table_name AND tb.table_schema = c.table_schema
           WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND tb.table_type = 'BASE TABLE'
             AND c.table_name NOT IN ('audit_log') LOOP
    PERFORM apply_standard_policies(t::regclass, t NOT IN ('auth_challenges'));
  END LOOP;
END $$;

-- audit_log: append-only. mice_app may only read (rows are written by the SECURITY DEFINER trigger).
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_log USING (tenant_id = app_tenant_id());
CREATE TRIGGER no_update BEFORE UPDATE ON audit_log FOR EACH ROW EXECUTE FUNCTION forbid_update();
CREATE TRIGGER no_delete BEFORE DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION forbid_delete();
CREATE TRIGGER no_truncate BEFORE TRUNCATE ON audit_log FOR EACH STATEMENT EXECUTE FUNCTION forbid_delete();
REVOKE ALL ON audit_log FROM mice_app;
GRANT SELECT ON audit_log TO mice_app;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO mice_app;

-- Append-only business records
CREATE TRIGGER no_update BEFORE UPDATE ON price_history FOR EACH ROW EXECUTE FUNCTION forbid_update();
CREATE TRIGGER no_update BEFORE UPDATE ON quote_lines FOR EACH ROW EXECUTE FUNCTION forbid_update();
CREATE TRIGGER no_update BEFORE UPDATE ON automation_events FOR EACH ROW EXECUTE FUNCTION forbid_update();
CREATE TRIGGER no_update BEFORE UPDATE ON consent_events FOR EACH ROW EXECUTE FUNCTION forbid_update();
CREATE TRIGGER no_update BEFORE UPDATE ON document_dependencies FOR EACH ROW EXECUTE FUNCTION forbid_update();

-- ---------------------------------------------------------------- supplier offers are never overwritten
-- Only bookkeeping columns may change; a revision is a NEW row (version+1) and the old one gets superseded_by.
CREATE OR REPLACE FUNCTION offer_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['superseded_by','verified_by','verified_at','alarmed_at'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['superseded_by','verified_by','verified_at','alarmed_at']) THEN
    RAISE EXCEPTION 'Tedarikçi teklifi değiştirilemez; yeni sürüm ekleyin' USING ERRCODE = 'MI004';
  END IF;
  IF OLD.superseded_by IS NOT NULL AND NEW.superseded_by IS DISTINCT FROM OLD.superseded_by THEN
    RAISE EXCEPTION 'Teklif sürümü zaten geçersiz kılınmış' USING ERRCODE = 'MI004';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER offer_immutable BEFORE UPDATE ON supplier_offers FOR EACH ROW EXECUTE FUNCTION offer_immutable();

-- ---------------------------------------------------------------- signed contracts are locked
CREATE OR REPLACE FUNCTION contract_lock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.locked THEN
    IF (to_jsonb(NEW) - ARRAY['status','superseded_by','updated_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','superseded_by','updated_at'])
       OR NOT (NEW.status = OLD.status OR (OLD.status = 'signed' AND NEW.status = 'amended')) THEN
      RAISE EXCEPTION 'İmzalı sözleşme kilitli; değişiklik ek protokol ile yapılır (§7 Adım 5)' USING ERRCODE = 'MI002';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER contract_lock BEFORE UPDATE ON contracts FOR EACH ROW EXECUTE FUNCTION contract_lock();

-- ---------------------------------------------------------------- change propagation (§3.5)
-- Mirrors DOCUMENT_DEPENDENCIES in packages/domain/src/propagation.ts (a test asserts both are identical).
CREATE OR REPLACE FUNCTION doc_kinds_for(p_entity text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_entity
    WHEN 'project'        THEN ARRAY['quote','contract','program','pnl','rooming_list','customer_invoice_draft','supplier_confirmation']
    WHEN 'service_item'   THEN ARRAY['quote','contract','program','pnl','supplier_confirmation','customer_invoice_draft']
    WHEN 'supplier_offer' THEN ARRAY['quote','pnl','contract']
    WHEN 'quote'          THEN ARRAY['pnl','contract','customer_invoice_draft','program']
    WHEN 'contract'       THEN ARRAY['pnl','program','customer_invoice_draft','supplier_confirmation']
    WHEN 'finance_entry'  THEN ARRAY['pnl','customer_invoice_draft']
    WHEN 'guest'          THEN ARRAY['rooming_list']
    WHEN 'field_extra'    THEN ARRAY['pnl','customer_invoice_draft']
    WHEN 'customer'       THEN ARRAY['quote','contract','customer_invoice_draft']
    ELSE ARRAY[]::text[] END
$$;

-- TG_ARGV[0] = entity type, TG_ARGV[1] = column holding the project id, TG_ARGV[2..] = watched columns.
-- A document is marked stale when it is of a dependent kind in the same project and either it recorded no
-- dependency on this entity type (project-wide dependency) or it recorded a dependency on this very row.
CREATE OR REPLACE FUNCTION mark_documents_stale(p_tenant uuid, p_project uuid, p_entity text, p_entity_id uuid, p_reason text)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  UPDATE documents d SET status = 'stale', stale_reason = p_reason, stale_at = now()
   WHERE d.tenant_id = p_tenant AND d.project_id = p_project AND d.status <> 'stale' AND d.superseded_by IS NULL
     AND d.kind = ANY (doc_kinds_for(p_entity))
     AND (NOT EXISTS (SELECT 1 FROM document_dependencies dd WHERE dd.document_id = d.id AND dd.entity_type = p_entity)
          OR EXISTS (SELECT 1 FROM document_dependencies dd WHERE dd.document_id = d.id AND dd.entity_type = p_entity AND dd.entity_id = p_entity_id));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION propagate_staleness() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_new jsonb := to_jsonb(NEW);
  v_old jsonb;
  v_changed text[] := ARRAY[]::text[];
  i integer;
  v_pid uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD);
    FOR i IN 2 .. TG_NARGS - 1 LOOP
      IF (v_new -> TG_ARGV[i]) IS DISTINCT FROM (v_old -> TG_ARGV[i]) THEN
        v_changed := v_changed || TG_ARGV[i];
      END IF;
    END LOOP;
    IF cardinality(v_changed) = 0 THEN RETURN NEW; END IF;
  ELSE
    v_changed := ARRAY['yeni kayıt'];
  END IF;
  v_pid := NULLIF(v_new ->> TG_ARGV[1], '')::uuid;
  IF v_pid IS NULL THEN RETURN NEW; END IF;
  PERFORM mark_documents_stale((v_new->>'tenant_id')::uuid, v_pid, TG_ARGV[0], (v_new->>'id')::uuid,
     format('%s değişti: %s', TG_ARGV[0], array_to_string(v_changed, ', ')));
  RETURN NEW;
END $$;

CREATE TRIGGER propagate_staleness AFTER UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION propagate_staleness(
  'project', 'id', 'customer_id', 'customer_name', 'title', 'event_type', 'start_date', 'end_date', 'pax', 'rooms_sgl', 'rooms_dbl',
  'city', 'district', 'hall_layout', 'fnb_needs', 'technical_needs', 'transfer_needs', 'billing_info', 'venue_name', 'code');
CREATE TRIGGER propagate_staleness AFTER UPDATE ON service_items FOR EACH ROW EXECUTE FUNCTION propagate_staleness(
  'service_item', 'project_id', 'kind', 'description', 'date_from', 'date_to', 'quantity', 'unit', 'nights', 'specs',
  'selected_offer_id', 'value_add');
CREATE TRIGGER propagate_staleness_cancel AFTER UPDATE ON service_items FOR EACH ROW
  WHEN (NEW.status = 'cancelled' AND OLD.status <> 'cancelled') EXECUTE FUNCTION propagate_staleness('service_item', 'project_id', 'status');
CREATE TRIGGER propagate_staleness AFTER UPDATE ON supplier_offers FOR EACH ROW EXECUTE FUNCTION propagate_staleness(
  'supplier_offer', 'project_id', 'superseded_by');
CREATE TRIGGER propagate_staleness AFTER UPDATE ON quotes FOR EACH ROW EXECUTE FUNCTION propagate_staleness(
  'quote', 'project_id', 'currency', 'fx_rate', 'option_until', 'options_meta', 'accepted_option_no');
CREATE TRIGGER propagate_staleness AFTER INSERT OR UPDATE ON contracts FOR EACH ROW EXECUTE FUNCTION propagate_staleness(
  'contract', 'project_id', 'fields', 'supplier_id', 'service_item_ids');
CREATE TRIGGER propagate_staleness AFTER INSERT OR UPDATE ON finance_entries FOR EACH ROW EXECUTE FUNCTION propagate_staleness(
  'finance_entry', 'project_id', 'amount', 'amount_eur', 'currency', 'kind', 'status');
CREATE TRIGGER propagate_staleness AFTER INSERT OR UPDATE ON guests FOR EACH ROW EXECUTE FUNCTION propagate_staleness(
  'guest', 'project_id', 'full_name_enc', 'email_enc', 'phone_enc', 'room_type', 'arrival', 'departure', 'anonymized_at');
CREATE TRIGGER propagate_staleness AFTER INSERT OR UPDATE ON field_extras FOR EACH ROW EXECUTE FUNCTION propagate_staleness(
  'field_extra', 'project_id', 'amount_try', 'reflected_to_customer', 'description');

-- customers are not project-scoped: mark dependent documents in all of the customer's projects.
CREATE OR REPLACE FUNCTION propagate_customer_staleness() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p record;
BEGIN
  IF (to_jsonb(NEW) - 'updated_at') = (to_jsonb(OLD) - 'updated_at') THEN RETURN NEW; END IF;
  FOR p IN SELECT id FROM projects WHERE customer_id = NEW.id AND tenant_id = NEW.tenant_id LOOP
    PERFORM mark_documents_stale(NEW.tenant_id, p.id, 'customer', NEW.id, 'customer değişti');
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER propagate_staleness AFTER UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION propagate_customer_staleness();

-- Stale documents cannot be sent until regenerated (§3.5).
CREATE OR REPLACE FUNCTION documents_send_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.sent_at IS NOT NULL AND OLD.sent_at IS NULL AND NEW.status = 'stale' THEN
    RAISE EXCEPTION 'Eski (stale) belge gönderilemez; önce yeniden üretin: %', NEW.stale_reason USING ERRCODE = 'MI003';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER documents_send_guard BEFORE UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION documents_send_guard();

CREATE OR REPLACE FUNCTION quotes_send_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'sent' AND OLD.status IS DISTINCT FROM 'sent' THEN
    IF OLD.status <> 'approved' THEN
      RAISE EXCEPTION 'Onaylanmamış teklif gönderilemez (durum: %)', OLD.status USING ERRCODE = 'MI005';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM documents d WHERE d.entity_type = 'quote' AND d.entity_id = NEW.id AND d.kind = 'quote'
                     AND d.superseded_by IS NULL AND d.status = 'current') THEN
      RAISE EXCEPTION 'Teklif belgesi güncel değil; yeniden üretilmeden gönderilemez' USING ERRCODE = 'MI003';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER quotes_send_guard BEFORE UPDATE ON quotes FOR EACH ROW EXECUTE FUNCTION quotes_send_guard();

-- Accreditation: only a human (actor_type 'user') can set a supplier to 'accredited' (§6 yasak listesi).
CREATE OR REPLACE FUNCTION supplier_accreditation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'accredited' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'accredited')
     AND app_actor_type() NOT IN ('user', 'system') THEN
    RAISE EXCEPTION 'Tedarikçi akreditasyonu yalnızca yönetici tarafından verilir' USING ERRCODE = 'MI006';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER supplier_accreditation_guard BEFORE INSERT OR UPDATE ON suppliers FOR EACH ROW EXECUTE FUNCTION supplier_accreditation_guard();

-- Contract signature: never by an AI actor.
CREATE OR REPLACE FUNCTION contract_sign_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'signed' AND OLD.status IS DISTINCT FROM 'signed' AND app_actor_type() <> 'user' THEN
    RAISE EXCEPTION 'Sözleşme imzası yalnızca insan tarafından kaydedilir' USING ERRCODE = 'MI006';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER contract_sign_guard BEFORE UPDATE ON contracts FOR EACH ROW EXECUTE FUNCTION contract_sign_guard();

-- ---------------------------------------------------------------- SECURITY DEFINER entry points
-- Login: find a user by e-mail before the tenant is known.
CREATE OR REPLACE FUNCTION auth_lookup_user(p_email text)
RETURNS TABLE (user_id uuid, tenant_id uuid, password_hash text, active boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.tenant_id, u.password_hash, u.active FROM users u WHERE lower(u.email) = lower(p_email) LIMIT 1
$$;

-- Public token routes: resolve tenant + entity by token HASH only; everything after runs under RLS (withTenant).
CREATE OR REPLACE FUNCTION resolve_public_token(p_kind text, p_hash text)
RETURNS TABLE (tenant_id uuid, entity_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_kind = 'rfq' THEN
    RETURN QUERY SELECT r.tenant_id, r.id FROM rfqs r WHERE r.token_hash = p_hash;
  ELSIF p_kind = 'quote' THEN
    RETURN QUERY SELECT q.tenant_id, q.id FROM quotes q WHERE q.public_token_hash = p_hash;
  ELSIF p_kind = 'survey' THEN
    RETURN QUERY SELECT s.tenant_id, s.id FROM surveys s WHERE s.token_hash = p_hash
      UNION ALL SELECT t.tenant_id, t.entity_id FROM public_tokens t WHERE t.purpose = 'survey' AND t.token_hash = p_hash AND t.revoked_at IS NULL;
  ELSE
    RETURN QUERY SELECT t.tenant_id, t.entity_id FROM public_tokens t
      WHERE t.purpose = p_kind AND t.token_hash = p_hash AND t.revoked_at IS NULL;
  END IF;
END $$;

-- Background worker: enumerate tenants, then process each one in its own withTenant() transaction.
CREATE OR REPLACE FUNCTION app_tenant_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT id FROM tenants WHERE status = 'active' $$;

REVOKE ALL ON FUNCTION auth_lookup_user(text), resolve_public_token(text, text), app_tenant_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_lookup_user(text), resolve_public_token(text, text), app_tenant_ids() TO mice_app;
REVOKE ALL ON FUNCTION apply_standard_policies(regclass, boolean) FROM PUBLIC;
