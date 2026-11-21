#!/bin/sh
# API container entrypoint.
#   serve   (default)  start the API as mice_app (DATABASE_URL); MIGRATE_ON_START=1 → run `migrate` first
#   migrate            apply migrations as the owner role (MIGRATION_DATABASE_URL); APP_DB_PASSWORD → ALTER ROLE mice_app
#   worker [--once]    follow-up / digest / outbox-retry worker loop
#   seed [--reset]     demo tenant (never in production)
set -eu
TSX="/app/node_modules/.bin/tsx --no-experimental-require-module"
cd /app/apps/api
cmd="${1:-serve}"
[ "$#" -gt 0 ] && shift
case "$cmd" in
  serve)
    if [ "${MIGRATE_ON_START:-0}" = "1" ]; then $TSX src/db/bootstrap.ts; fi
    exec $TSX src/server.ts "$@" ;;
  migrate) exec $TSX src/db/bootstrap.ts "$@" ;;
  worker)  exec $TSX src/worker.ts "$@" ;;
  seed)    exec $TSX src/db/seed.ts "$@" ;;
  *)       exec "$cmd" "$@" ;;
esac
