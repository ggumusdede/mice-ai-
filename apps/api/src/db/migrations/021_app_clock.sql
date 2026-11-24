-- 021: DB-generated timestamps follow the application clock when one is injected (tests).
-- withTenant sets app.now (transaction-local) only when the app runs with an injected clock; otherwise it is '' and
-- app_now() = clock_timestamp(). Production behaviour is unchanged. Fixes reports that mix app-clock (received_at, quote_sent_at)
-- and DB-clock (audit_log.at, created_at) timestamps when the test clock is not "today".
CREATE OR REPLACE FUNCTION app_now() RETURNS timestamptz LANGUAGE sql STABLE AS $$
  -- base = injected clock at transaction start; + time elapsed in this transaction keeps rows ordered within it
  SELECT COALESCE(NULLIF(current_setting('app.now', true), '')::timestamptz + (clock_timestamp() - now()), clock_timestamp())
$$;
GRANT EXECUTE ON FUNCTION app_now() TO mice_app;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.table_name, c.column_name
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND c.data_type = 'timestamp with time zone'
       AND c.column_default IN ('now()', 'CURRENT_TIMESTAMP', 'clock_timestamp()')
  LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN %I SET DEFAULT app_now()', r.table_name, r.column_name);
  END LOOP;
END $$;
