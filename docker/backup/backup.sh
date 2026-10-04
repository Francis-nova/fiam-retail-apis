#!/usr/bin/env bash
# Backs up every Fiam database (pg_dump custom format) and the MinIO volume
# (KYC documents) on the Swarm node. Run from cron; see docker/README.md
# "Backups". A backup on the same disk protects against a bad migration or a
# deleted row, NOT against losing the server — set BACKUP_RCLONE_REMOTE to
# copy each run off the box.
#
#   BACKUP_DIR            where dumps go            (default /var/backups/fiam)
#   BACKUP_KEEP_DAYS      local retention in days   (default 14)
#   BACKUP_RCLONE_REMOTE  e.g. "s3:fiam-backups/staging" (optional, needs rclone)
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/fiam}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
DATABASES="${BACKUP_DATABASES:-fiam_auth fiam_payment fiam_admin}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$BACKUP_DIR/$STAMP"

PG="$(docker ps -q -f name=fiam_postgres | head -1)"
[ -n "$PG" ] || { echo "postgres container not found" >&2; exit 1; }

umask 077
mkdir -p "$OUT"

for db in $DATABASES; do
  echo "dumping $db"
  # --no-owner/--no-acl so a dump restores cleanly into a fresh instance.
  docker exec "$PG" pg_dump -U "${POSTGRES_USER:-postgres}" -Fc --no-owner --no-acl "$db" > "$OUT/$db.dump"
  # A dump that can't even be listed is worthless: catch that now, not at 3am.
  docker exec -i "$PG" pg_restore --list < "$OUT/$db.dump" > /dev/null
done

# Roles aren't part of a per-database dump (fiam_admin_app, fiam_readonly...).
docker exec "$PG" pg_dumpall -U "${POSTGRES_USER:-postgres}" --roles-only > "$OUT/roles.sql"

# KYC documents live in the MinIO volume.
MINIO_VOL="$(docker volume ls -q | grep -E 'minio-data$' | head -1 || true)"
if [ -n "$MINIO_VOL" ]; then
  echo "archiving MinIO volume $MINIO_VOL"
  docker run --rm -v "$MINIO_VOL":/data:ro -v "$OUT":/backup alpine \
    tar czf /backup/minio-data.tgz -C /data .
fi

( cd "$OUT" && sha256sum ./* > SHA256SUMS )
echo "backup written to $OUT ($(du -sh "$OUT" | cut -f1))"

if [ -n "${BACKUP_RCLONE_REMOTE:-}" ]; then
  echo "copying off-box to $BACKUP_RCLONE_REMOTE"
  rclone copy "$OUT" "$BACKUP_RCLONE_REMOTE/$STAMP"
fi

# Retention (local only; manage the remote's lifecycle on the remote).
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -mtime +"$KEEP_DAYS" -exec rm -rf {} +
