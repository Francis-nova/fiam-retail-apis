#!/usr/bin/env bash
# Deploys the production app stack. Use this instead of a bare `docker stack
# deploy`: it loads .env, URL-encodes the Postgres password for the connection
# URLs (the raw password may contain @ $ : / # etc.), and applies the overlay.
#   bash docker/production/deploy-stack.sh [extra docker stack deploy flags]
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
POSTGRES_PASSWORD_URL="$(python3 -c 'import os,urllib.parse as u; print(u.quote(os.environ["POSTGRES_PASSWORD"], safe=""))')"
export POSTGRES_PASSWORD_URL
docker stack deploy --with-registry-auth "$@" -c stack.yml -c production/stack.production.yml fiam
