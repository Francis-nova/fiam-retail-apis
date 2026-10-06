# Sourced by backup.sh / restore-check.sh. Defines `pgx <client-cmd> [args]`
# (psql, pg_dump, pg_restore, pg_dumpall) with stdin passed through:
#  - in-stack Postgres (staging): docker exec into the fiam_postgres container
#  - external Postgres (POSTGRES_HOST set to something other than "postgres"):
#    a one-shot postgres client container, TLS pinned to DB_SSL_CA_HOST if set.
#    The client must be the same major version as the server or newer
#    (PG_CLIENT_IMAGE, default postgres:18-alpine).
PGUSER_="${POSTGRES_USER:-postgres}"
if [ -n "${POSTGRES_HOST:-}" ] && [ "$POSTGRES_HOST" != "postgres" ]; then
  PG_REMOTE=1
else
  PG_REMOTE=
  PG_CONTAINER="$(docker ps -q -f name=fiam_postgres | head -1)"
  [ -n "$PG_CONTAINER" ] || { echo "postgres container not found" >&2; exit 1; }
fi

pgx() {
  local cmd="$1"; shift
  if [ -z "$PG_REMOTE" ]; then
    docker exec -i "$PG_CONTAINER" "$cmd" -U "$PGUSER_" "$@"
    return
  fi
  local args=(run --rm -i -e PGPASSWORD="$POSTGRES_PASSWORD"
    -e PGHOST="$POSTGRES_HOST" -e PGPORT="${POSTGRES_PORT:-5432}")
  if [ "${DB_SSL:-false}" = "true" ]; then
    if [ -n "${DB_SSL_CA_HOST:-}" ]; then
      args+=(-v "$DB_SSL_CA_HOST":/ca.pem:ro -e PGSSLMODE=verify-ca -e PGSSLROOTCERT=/ca.pem)
    else
      args+=(-e PGSSLMODE=require)
    fi
  fi
  docker "${args[@]}" "${PG_CLIENT_IMAGE:-postgres:18-alpine}" "$cmd" -U "$PGUSER_" "$@"
}
