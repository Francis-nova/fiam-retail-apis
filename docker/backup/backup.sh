#!/usr/bin/env bash
# Backs up every Fiam database (pg_dump custom format) and the MinIO volume
# (KYC documents) on the Swarm node. Run from cron; see docker/README.md
# "Backups". A backup on the same disk protects against a bad migration or a
# deleted row, NOT against losing the server — set BACKUP_RCLONE_REMOTE to
# copy each run off the box.
#
#   BACKUP_DIR            where dumps go            (default /var/backups/fiam)
#   BACKUP_KEEP_DAYS      local retention in days   (default 14)
#   BACKUP_RCLONE_REMOTE  e.g. "hetzner:fiam-backups/staging" (optional, needs rclone;
#                         configure the remote with RCLONE_CONFIG_<NAME>_* env vars)
#   BACKUP_REMOTE_KEEP_DAYS  retention on the remote   (default 30; 0 = keep forever)
#   BACKUP_ENCRYPTION_PASSPHRASE  REQUIRED when uploading off-box: every file is
#                         AES-256 encrypted first (dumps contain personal data)
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/fiam}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
DATABASES="${BACKUP_DATABASES:-fiam_auth fiam_payment fiam_admin}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$BACKUP_DIR/$STAMP"

. "$(dirname "$0")/pg.sh"

umask 077
mkdir -p "$OUT"

for db in $DATABASES; do
  echo "dumping $db"
  # --no-owner/--no-acl so a dump restores cleanly into a fresh instance.
  pgx pg_dump -Fc --no-owner --no-acl "$db" > "$OUT/$db.dump"
  # A dump that can't even be listed is worthless: catch that now, not at 3am.
  pgx pg_restore --list < "$OUT/$db.dump" > /dev/null
done

# Roles aren't part of a per-database dump (fiam_admin_app, fiam_readonly...).
# A superuser gets the full dump (with password hashes); a plain owner role
# (external managed/self-hosted Postgres) can't read pg_authid, so fall back to
# the same dump without role passwords.
pgx pg_dumpall --roles-only > "$OUT/roles.sql" 2>/dev/null \
  || { echo "roles: not a superuser, dumping without role passwords"; \
       pgx pg_dumpall --roles-only --no-role-passwords > "$OUT/roles.sql"; }

# KYC documents: archive the in-stack MinIO volume. Skipped once documents live
# in external object storage (OBJECT_STORAGE_ENDPOINT is anything but "minio"):
# that data isn't on this box, so protect it with bucket versioning there.
MINIO_VOL="$(docker volume ls -q | grep -E 'minio-data$' | head -1 || true)"
if [ "${OBJECT_STORAGE_ENDPOINT:-minio}" != "minio" ]; then
  echo "documents are in external object storage - skipping the MinIO volume archive"
elif [ -n "$MINIO_VOL" ]; then
  echo "archiving MinIO volume $MINIO_VOL"
  docker run --rm -v "$MINIO_VOL":/data:ro -v "$OUT":/backup alpine \
    tar czf /backup/minio-data.tgz -C /data .
fi

( cd "$OUT" && sha256sum ./* > SHA256SUMS )
echo "backup written to $OUT ($(du -sh "$OUT" | cut -f1))"

if [ -n "${BACKUP_RCLONE_REMOTE:-}" ]; then
  # Never ship personal data off the box in the clear.
  [ -n "${BACKUP_ENCRYPTION_PASSPHRASE:-}" ] || {
    echo "refusing to upload: set BACKUP_ENCRYPTION_PASSPHRASE" >&2
    exit 1
  }
  ENC="$OUT.enc"
  mkdir -p "$ENC"
  for f in "$OUT"/*; do
    openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt \
      -pass env:BACKUP_ENCRYPTION_PASSPHRASE -in "$f" -out "$ENC/$(basename "$f").enc"
  done
  echo "copying encrypted backup off-box to $BACKUP_RCLONE_REMOTE"
  rclone copy "$ENC" "$BACKUP_RCLONE_REMOTE/$STAMP"
  rm -rf "$ENC"
  # Remote retention: only ever removes backups older than the window, and
  # only under this backup path — never anything else in a shared bucket.
  REMOTE_KEEP="${BACKUP_REMOTE_KEEP_DAYS:-30}"
  if [ "$REMOTE_KEEP" -gt 0 ]; then
    rclone delete "$BACKUP_RCLONE_REMOTE" --min-age "${REMOTE_KEEP}d" --rmdirs >/dev/null 2>&1 || \
      echo "warning: could not prune old remote backups" >&2
  fi
fi

# Retention (local only; manage the remote's lifecycle on the remote).
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -mtime +"$KEEP_DAYS" -exec rm -rf {} +
