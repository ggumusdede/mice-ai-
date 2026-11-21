#!/usr/bin/env bash
# Restore a scripts/backup.sh archive into an EMPTY database, as the owner role.
#   RESTORE_DATABASE_URL=postgres://postgres:…@host:5432/mice_restore scripts/restore.sh backups/mice-….dump[.gpg]
# Steps: verify checksum → (decrypt) → create role mice_app if missing (roles are cluster-wide, not in the dump) →
# pg_restore (tables, RLS policies, triggers, SECURITY DEFINER functions, GRANTs to mice_app) → set the mice_app password
# (`APP_DB_PASSWORD=… npm run migrate:deploy -w apps/api` also applies any newer migrations) → point the API's
# DATABASE_URL at it → GET /api/ready. The dump is taken with --no-owner: objects become owned by the restoring role,
# which must be the owner / superuser role (never mice_app — RLS must keep applying to the API).
# Never restore over a live database: restore next to it, verify, then switch connection strings.
set -euo pipefail
FILE="${1:?usage: restore.sh <dump file>}"
URL="${RESTORE_DATABASE_URL:?set RESTORE_DATABASE_URL (owner role, empty target database)}"

if [ -f "$FILE.sha256" ]; then sha256sum -c "$FILE.sha256"; fi
if [[ "$FILE" == *.gpg ]]; then
  OUT="${FILE%.gpg}"
  gpg --batch --yes --decrypt --output "$OUT" "$FILE"
  FILE="$OUT"
fi

existing=$(psql "$URL" -Atc "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")
if [ "$existing" != "0" ]; then echo "target database is not empty ($existing tables) — refusing" >&2; exit 1; fi

psql "$URL" -v ON_ERROR_STOP=1 -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mice_app') THEN
  CREATE ROLE mice_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE; END IF; END \$\$;"
pg_restore --exit-on-error --no-owner --dbname="$URL" "$FILE"
echo "[restore] done. Next: MIGRATION_DATABASE_URL=$URL APP_DB_PASSWORD=… npm run migrate:deploy -w apps/api  (sets the mice_app password, applies newer migrations)"
