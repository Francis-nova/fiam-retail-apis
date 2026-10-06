#!/usr/bin/env bash
# Proves the newest backup is restorable: restores each database into a
# throwaway database, counts tables/rows, then drops it. Safe to run on the
# live server — it never touches the real databases.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/fiam}"
LATEST="${1:-$(ls -1d "$BACKUP_DIR"/*/ 2>/dev/null | sort | tail -1)}"
[ -d "${LATEST:-}" ] || { echo "no backup found in $BACKUP_DIR" >&2; exit 1; }
LATEST="${LATEST%/}"
. "$(dirname "$0")/pg.sh"

echo "checking $LATEST"
( cd "$LATEST" && sha256sum -c SHA256SUMS --quiet ) && echo "checksums OK"

for dump in "$LATEST"/*.dump; do
  db="$(basename "$dump" .dump)"
  tmp="restorecheck_${db}"
  pgx psql -qc "DROP DATABASE IF EXISTS $tmp" -c "CREATE DATABASE $tmp"
  pgx pg_restore --no-owner --no-acl -d "$tmp" < "$dump"
  tables="$(pgx psql -d "$tmp" -Atc "select count(*) from information_schema.tables where table_schema='public'")"
  rows="$(pgx psql -d "$tmp" -Atc "select coalesce(sum(n_live_tup),0)::bigint from pg_stat_user_tables")"
  echo "$db: restored OK ($tables tables, ~$rows rows)"
  pgx psql -qc "DROP DATABASE $tmp"
done
echo "restore check passed"
