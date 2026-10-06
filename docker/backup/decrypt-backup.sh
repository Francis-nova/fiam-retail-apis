#!/usr/bin/env bash
# Decrypts a backup that was uploaded off-box by backup.sh.
#   BACKUP_ENCRYPTION_PASSPHRASE=... ./decrypt-backup.sh <dir-with-.enc-files> <output-dir>
# then restore with pg_restore (see docker/README.md "Backups").
set -euo pipefail
IN="${1:?encrypted backup directory}"; OUT="${2:?output directory}"
: "${BACKUP_ENCRYPTION_PASSPHRASE:?set BACKUP_ENCRYPTION_PASSPHRASE}"
umask 077; mkdir -p "$OUT"
for f in "$IN"/*.enc; do
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
    -pass env:BACKUP_ENCRYPTION_PASSPHRASE -in "$f" -out "$OUT/$(basename "${f%.enc}")"
done
( cd "$OUT" && sha256sum -c SHA256SUMS --quiet ) && echo "decrypted and checksums OK: $OUT"
