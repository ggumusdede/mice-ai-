-- 007 Security review hardening (docs/09-guvenlik-incelemesi.md).

-- ---------------------------------------------------------------- KVKK: no recipient / message body copies in audit_log
-- outbox rows carry recipient addresses (guests' e-mail in the consent notice) and message bodies. The outbox row itself is
-- the send record; the append-only audit log must not keep an undeletable copy that survives anonymisation (§17.9).
CREATE OR REPLACE FUNCTION audit_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_after jsonb := to_jsonb(NEW);
  v_before jsonb;
  v_project uuid;
  v_strip text[] := CASE WHEN TG_TABLE_NAME = 'outbox' THEN ARRAY['to_address','body','reply_to'] ELSE ARRAY[]::text[] END;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_before := to_jsonb(OLD);
    IF (v_before - 'updated_at') = (v_after - 'updated_at') THEN RETURN NEW; END IF;
  END IF;
  v_project := CASE WHEN TG_TABLE_NAME = 'projects' THEN (v_after->>'id')::uuid
                    ELSE NULLIF(v_after->>'project_id', '')::uuid END;
  INSERT INTO audit_log (tenant_id, actor_type, actor_id, entity, entity_id, project_id, action, before, after, device)
  VALUES (NULLIF(v_after->>'tenant_id', '')::uuid, app_actor_type(), app_user_id(), TG_TABLE_NAME, v_after->>'id',
          v_project, lower(TG_OP), audit_redact(v_before - v_strip), audit_redact(v_after - v_strip),
          NULLIF(current_setting('app.device', true), ''));
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------- suspended tenants: no login, no public links
CREATE OR REPLACE FUNCTION auth_lookup_user(p_email text)
RETURNS TABLE (user_id uuid, tenant_id uuid, password_hash text, active boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.tenant_id, u.password_hash, u.active AND t.status = 'active'
    FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE lower(u.email) = lower(p_email) LIMIT 1
$$;

CREATE OR REPLACE FUNCTION resolve_public_token(p_kind text, p_hash text)
RETURNS TABLE (tenant_id uuid, entity_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  SELECT x.tenant_id, x.entity_id FROM (
    SELECT r.tenant_id, r.id AS entity_id FROM rfqs r WHERE p_kind = 'rfq' AND r.token_hash = p_hash
    UNION ALL SELECT q.tenant_id, q.id FROM quotes q WHERE p_kind = 'quote' AND q.public_token_hash = p_hash
    UNION ALL SELECT s.tenant_id, s.id FROM surveys s WHERE p_kind = 'survey' AND s.token_hash = p_hash
    UNION ALL SELECT t.tenant_id, t.entity_id FROM public_tokens t
      WHERE p_kind NOT IN ('rfq', 'quote') AND t.purpose = p_kind AND t.token_hash = p_hash AND t.revoked_at IS NULL
  ) x JOIN tenants tn ON tn.id = x.tenant_id AND tn.status = 'active';
END $$;

REVOKE ALL ON FUNCTION auth_lookup_user(text), resolve_public_token(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_lookup_user(text), resolve_public_token(text, text) TO mice_app;
