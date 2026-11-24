-- 001 Foundation: extensions, application role, tenant-context helpers.
-- Migrations run as a superuser / owner role (MIGRATION_DATABASE_URL). The API connects as the
-- NON-superuser, NON-owner role `mice_app` so that Row Level Security always applies (§3.8, §18.11).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mice_app') THEN
    -- Change the password in production: ALTER ROLE mice_app PASSWORD '...';
    CREATE ROLE mice_app LOGIN PASSWORD 'mice_app' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO mice_app;

-- Tenant context. current_setting(..., true) returns NULL/'' when unset → no row matches (fail closed).
CREATE OR REPLACE FUNCTION app_tenant_id() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app_actor_type() RETURNS text
LANGUAGE sql STABLE AS $$ SELECT COALESCE(NULLIF(current_setting('app.actor_type', true), ''), 'system') $$;

CREATE OR REPLACE FUNCTION app_user_id() RETURNS text
LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.user_id', true), '') $$;

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
