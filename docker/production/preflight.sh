#!/usr/bin/env bash
# Refuses to let a half-filled or staging-flavoured docker/.env go to production.
# Run from anywhere on the server:  bash docker/production/preflight.sh [path/to/.env]
# Exit 0 = safe to deploy, non-zero = fix the listed problems first.
set -o pipefail

ENV_FILE="${1:-$(dirname "$0")/../.env}"
[ -f "$ENV_FILE" ] || { echo "no env file at $ENV_FILE" >&2; exit 2; }
fail=0
bad() { echo "  FAIL  $*"; fail=1; }
ok()  { echo "  ok    $*"; }

# Checked on the RAW file, before sourcing. The Postgres password may contain
# special characters (deploy-stack.sh URL-encodes it) but then MUST be wrapped in
# single quotes in .env, or the shell expands `$`. The other passwords are ours:
# letters and digits only.
echo "Password handling"
raw="$(grep -E "^POSTGRES_PASSWORD=" "$ENV_FILE" | head -1 | cut -d= -f2-)"
if [ -z "$raw" ]; then bad "POSTGRES_PASSWORD is missing"
elif printf '%s' "$raw" | grep -Eq '^[A-Za-z0-9]+$'; then ok "POSTGRES_PASSWORD (plain)"
elif printf '%s' "$raw" | grep -Eq "^'[^']+'$"; then ok "POSTGRES_PASSWORD (single-quoted)"
else bad "POSTGRES_PASSWORD has special characters: wrap it in single quotes in .env (and it may not contain a ' itself)"; fi
for v in ADMIN_DB_PASSWORD READONLY_DB_PASSWORD RABBITMQ_PASSWORD; do
  raw="$(grep -E "^$v=" "$ENV_FILE" | head -1 | cut -d= -f2-)"
  if [ -z "$raw" ]; then bad "$v is missing"
  elif printf '%s' "$raw" | grep -Eq '^[A-Za-z0-9]+$'; then ok "$v"
  else bad "$v must be letters/digits only (openssl rand -hex 24)"; fi
done

set -a; . "$ENV_FILE"; set +a

need() { # need VAR [min_length]
  local v="${!1:-}" min="${2:-1}"
  if [ "${#v}" -lt "$min" ]; then bad "$1 is empty or shorter than $min chars"; else ok "$1"; fi
}

echo "Required secrets"
need POSTGRES_PASSWORD 8
for v in RABBITMQ_PASSWORD ADMIN_DB_PASSWORD READONLY_DB_PASSWORD; do need "$v" 20; done
for v in JWT_ACCESS_SECRET JWT_REFRESH_SECRET ADMIN_JWT_ACCESS_SECRET; do need "$v" 48; done
need INTERNAL_API_KEY 64
need ADMIN_TOTP_ENCRYPTION_KEY 64
need BACKUP_ENCRYPTION_PASSPHRASE 24

echo "Secrets that must differ from each other"
[ "${JWT_ACCESS_SECRET:-x}" != "${ADMIN_JWT_ACCESS_SECRET:-y}" ] && ok "admin JWT secret != customer JWT secret" || bad "ADMIN_JWT_ACCESS_SECRET must differ from JWT_ACCESS_SECRET"
[ "${JWT_ACCESS_SECRET:-x}" != "${JWT_REFRESH_SECRET:-y}" ] && ok "access secret != refresh secret" || bad "JWT_ACCESS_SECRET must differ from JWT_REFRESH_SECRET"

echo "Providers (must be live, not sandbox)"
case "${VFD_AUTH_BASE_URL:-}${VFD_WALLET_BASE_URL:-}" in
  *devapps*|"") bad "VFD_*_BASE_URL is empty or still the dev/sandbox host (devapps)";;
  *) ok "VFD base URLs";;
esac
need VFD_CONSUMER_KEY; need VFD_CONSUMER_SECRET; need VFD_WEBHOOK_AUTH_TOKEN
[ "${VFD_BANK_CODE:-999999}" != "999999" ] && ok "VFD_BANK_CODE" || bad "VFD_BANK_CODE is the sandbox default 999999"
[ "${KYC_PROVIDER:-qoreid}" = "qoreid" ] && ok "KYC_PROVIDER=qoreid" || bad "KYC_PROVIDER must be qoreid (passthrough skips BVN verification)"
need QOREID_CLIENT_ID; need QOREID_SECRET
need TERMII_API_KEY; need TERMII_SENDER_ID
need ZEPTOMAIL_TOKEN
need ONESIGNAL_APP_ID; need ONESIGNAL_REST_API_KEY

echo "Database (external Postgres)"
case "${POSTGRES_HOST:-}" in ""|postgres) bad "POSTGRES_HOST must be the external database host";; *) ok "POSTGRES_HOST=$POSTGRES_HOST";; esac
[ "${DB_SSL:-false}" = "true" ] && ok "DB_SSL=true" || bad "DB_SSL must be true (the database is reached over the internet)"
if [ -n "${DB_SSL_CA_HOST:-}" ] && [ -r "$DB_SSL_CA_HOST" ]; then ok "DB_SSL_CA_HOST $DB_SSL_CA_HOST"; else bad "DB_SSL_CA_HOST must be a readable certificate file"; fi
[ "${DB_SSL_CA:-}" = "/etc/fiam/db-ca.pem" ] && ok "DB_SSL_CA" || bad "DB_SSL_CA must be /etc/fiam/db-ca.pem (where the overlay mounts the certificate)"
if [ -n "${POSTGRES_HOST:-}" ] && [ -r "${DB_SSL_CA_HOST:-/nonexistent}" ] && command -v docker >/dev/null; then
  . "$(dirname "$0")/../backup/pg.sh"
  if out="$(pgx psql -d postgres -Atc "select (select version()), (select count(*) from pg_database where datname in ('fiam_auth','fiam_payment','fiam_admin') and pg_get_userbyid(datdba) = current_user), (select count(*) from pg_roles where rolname in ('fiam_admin_app','fiam_readonly'))" </dev/null 2>&1)"; then
    ok "connected over TLS: $(echo "$out" | cut -d'|' -f1 | cut -c1-40)"
    [ "$(echo "$out" | cut -d'|' -f2)" = "3" ] && ok "POSTGRES_USER owns fiam_auth, fiam_payment, fiam_admin" || bad "one or more of fiam_auth/fiam_payment/fiam_admin is missing or not owned by POSTGRES_USER"
  else
    bad "cannot connect to the database: $(echo "$out" | tail -1)"
  fi
else
  echo "  skip  connection test (needs POSTGRES_HOST and a readable DB_SSL_CA_HOST)"
fi

echo "Environment separation"
[ "${OBJECT_STORAGE_PREFIX:-}" = "fiam-production/" ] && ok "OBJECT_STORAGE_PREFIX=fiam-production/" || bad "OBJECT_STORAGE_PREFIX must be exactly fiam-production/ (shared bucket!)"
case "${BACKUP_RCLONE_REMOTE:-}" in
  *fiam-production*) ok "BACKUP_RCLONE_REMOTE";;
  *) bad "BACKUP_RCLONE_REMOTE must point under fiam-production/";;
esac
case "${IMAGE:-}" in *:main) ok "IMAGE tag :main";; *) bad "IMAGE must be the :main tag, got '${IMAGE:-}'";; esac
for h in AUTH_HOST PAYMENT_HOST ADMIN_API_HOST; do
  v="${!h:-}"
  case "$v" in ""|*staging*) bad "$h is empty or a staging hostname ('$v')";; *) ok "$h=$v";; esac
done
case "${ADMIN_CORS_ORIGIN:-}" in
  https://*staging*|""|*/) bad "ADMIN_CORS_ORIGIN must be the https production console origin, no trailing slash";;
  https://*) ok "ADMIN_CORS_ORIGIN";;
  *) bad "ADMIN_CORS_ORIGIN must start with https://";;
esac

echo "Admin console hardening"
[ "${ADMIN_REQUIRE_2FA:-false}" = "true" ] && ok "ADMIN_REQUIRE_2FA=true" || bad "ADMIN_REQUIRE_2FA must be true"
need ADMIN_ALLOWED_IPS

echo "Other"
need ACME_EMAIL

echo
if [ "$fail" -eq 0 ]; then echo "preflight passed"; else echo "preflight FAILED"; fi
exit "$fail"
