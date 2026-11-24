#!/usr/bin/env bash
# Starts a local PostgreSQL 16 cluster for development/tests (no Docker needed).
set -euo pipefail
PGBIN=${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}
DATA=${PGDATA_DIR:-"$(cd "$(dirname "$0")/.." && pwd)/.pgdata"}
PORT=${PGPORT:-5432}
if [ ! -f "$DATA/PG_VERSION" ]; then
  mkdir -p "$DATA"
  if [ "$(id -u)" = "0" ]; then chown postgres "$DATA"; RUN="runuser -u postgres --"; else RUN=""; fi
  $RUN "$PGBIN/initdb" -D "$DATA" -U postgres --auth=trust -E UTF8 >/dev/null
fi
if [ "$(id -u)" = "0" ]; then RUN="runuser -u postgres --"; chown -R postgres "$DATA"; else RUN=""; fi
if ! $RUN "$PGBIN/pg_ctl" -D "$DATA" status >/dev/null 2>&1; then
  $RUN "$PGBIN/pg_ctl" -D "$DATA" -o "-p $PORT -k /tmp" -l "$DATA/server.log" start >/dev/null
fi
for i in $(seq 1 30); do pg_isready -h localhost -p "$PORT" >/dev/null 2>&1 && break; sleep 0.5; done
psql -h localhost -p "$PORT" -U postgres -tc "SELECT 1 FROM pg_database WHERE datname='mice'" | grep -q 1 || psql -h localhost -p "$PORT" -U postgres -c "CREATE DATABASE mice" >/dev/null
psql -h localhost -p "$PORT" -U postgres -tc "SELECT 1 FROM pg_database WHERE datname='mice_test'" | grep -q 1 || psql -h localhost -p "$PORT" -U postgres -c "CREATE DATABASE mice_test" >/dev/null
echo "PostgreSQL ready on localhost:$PORT (databases: mice, mice_test)"
