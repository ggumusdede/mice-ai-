-- 008 Tenant-consistent foreign keys (docs/09-guvenlik-incelemesi.md, G-14).
-- Referential-integrity checks run as the table owner and IGNORE row level security: a plain FK `project_id → projects(id)`
-- accepts a row in tenant B that points at tenant A's project if the UUID is known. For every single-column FK between two
-- tenant-scoped tables we add a composite FK (tenant_id, col) → (tenant_id, id), so a reference can only resolve inside the
-- row's own tenant (MATCH SIMPLE: NULL references stay allowed). The original FKs stay (harmless).
--
-- Idempotent helper — call it again after creating new tables in later migrations:  SELECT apply_tenant_foreign_keys();
CREATE OR REPLACE FUNCTION apply_tenant_foreign_keys() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  fk record;
  n integer := 0;
  v_name text;
BEGIN
  FOR fk IN
    SELECT c.conrelid::regclass AS t, c.conrelid AS t_oid, a.attname AS col, c.confrelid::regclass AS r, c.confrelid AS r_oid,
           cl.relname AS t_name, rl.relname AS r_name
      FROM pg_constraint c
      JOIN pg_attribute a  ON a.attrelid = c.conrelid  AND a.attnum = c.conkey[1]
      JOIN pg_attribute af ON af.attrelid = c.confrelid AND af.attnum = c.confkey[1]
      JOIN pg_class cl ON cl.oid = c.conrelid
      JOIN pg_class rl ON rl.oid = c.confrelid
     WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace AND array_length(c.conkey, 1) = 1
       AND a.attname <> 'tenant_id' AND af.attname = 'id'
       AND EXISTS (SELECT 1 FROM pg_attribute x WHERE x.attrelid = c.conrelid  AND x.attname = 'tenant_id' AND NOT x.attisdropped)
       AND EXISTS (SELECT 1 FROM pg_attribute x WHERE x.attrelid = c.confrelid AND x.attname = 'tenant_id' AND NOT x.attisdropped)
  LOOP
    -- the referenced side needs a unique key on (tenant_id, id)
    IF NOT EXISTS (
      SELECT 1 FROM pg_index i
       WHERE i.indrelid = fk.r_oid AND i.indisunique AND i.indnkeyatts = 2
         AND (SELECT array_agg(att.attname::text ORDER BY att.attname) FROM pg_attribute att
               WHERE att.attrelid = fk.r_oid AND att.attnum = ANY (i.indkey)) = ARRAY['id', 'tenant_id']
    ) THEN
      EXECUTE format('CREATE UNIQUE INDEX %I ON %s (tenant_id, id)', left(fk.r_name, 40) || '_tenant_id_uq', fk.r);
    END IF;
    v_name := left(fk.t_name, 28) || '_' || left(fk.col, 26) || '_tfk';
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = fk.t_oid AND conname = v_name) THEN
      EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (tenant_id, %I) REFERENCES %s (tenant_id, id)',
                     fk.t, v_name, fk.col, fk.r);
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION apply_tenant_foreign_keys() FROM PUBLIC;

SELECT apply_tenant_foreign_keys();
