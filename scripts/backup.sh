#!/usr/bin/env bash
# PostgreSQL backup with retention (docs/05 DevOps: "yedekleme"; KVKK: backups hold encrypted guest PII — store them
# encrypted, access-controlled, and let them expire: anonymisation in the live DB reaches backups only through retention).
#
#   BACKUP_DATABASE_URL=postgres://postgres:…@db:5432/mice  BACKUP_DIR=/backups  BACKUP_RETENTION_DAYS=14  scripts/backup.sh
#   docker compose exec -T db pg_dump …   (or run this script from a host with pg_dump 16 and network access to the DB)
#
# Output: $BACKUP_DIR/mice-YYYYmmddTHHMMSSZ.dump (pg_dump custom format, compressed) + .sha256; optional GPG encryption
# with BACKUP_GPG_RECIPIENT. Files older than BACKUP_RETENTION_DAYS are removed. Exit code ≠ 0 on any failure (cron alert).
#
# Restore (see README → Dağıtım → Yedekleme / geri yükleme):
#   scripts/restore.sh /backups/mice-20261121T020000Z.dump   (target DB must be empty; runs as the owner role)
# Managed PostgreSQL: prefer the provider's PITR (docs/05: "PITR dahil") and keep these logical dumps as a second line.
set -euo pipefail

URL="${BACKUP_DATABASE_URL:-${MIGRATION_DATABASE_URL:-postgres://postgres@localhost:5432/mice}}"
DIR="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${BACKUP_RETENTION_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$DIR/mice-$STAMP.dump"

command -v pg_dump >/dev/null || { echo "pg_dump not found (install postgresql-client-16)" >&2; exit 1; }
mkdir -p "$DIR"
umask 077

echo "[backup] dumping → $FILE"
pg_dump --format=custom --compress=6 --no-owner --dbname="$URL" --file="$FILE.partial"
mv "$FILE.partial" "$FILE"
# sanity: the archive must list the core tables
pg_restore --list "$FILE" | grep -q "TABLE public projects" || { echo "[backup] archive check failed" >&2; exit 1; }

if [ -n "${BACKUP_GPG_RECIPIENT:-}" ]; then
  gpg --batch --yes --encrypt --recipient "$BACKUP_GPG_RECIPIENT" --output "$FILE.gpg" "$FILE"
  rm -f "$FILE"
  FILE="$FILE.gpg"
fi
sha256sum "$FILE" > "$FILE.sha256"
echo "[backup] ok $(du -h "$FILE" | cut -f1) $FILE"

# retention: remove dumps (and checksums) older than KEEP_DAYS days
find "$DIR" -maxdepth 1 -type f -name 'mice-*.dump*' -mtime "+$KEEP_DAYS" -print -delete | sed 's/^/[backup] expired /'
