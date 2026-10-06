#!/usr/bin/env bash
# One-time preparation of a FRESH Ubuntu/Debian production box. Run as root:
#   curl -fsSL <raw url> | bash        # or copy it up and: bash bootstrap.sh
# Safe to re-run. It does NOT touch sshd_config (a bad edit locks you out) —
# see docker/README.md "Production server" for the SSH hardening you do by hand
# once you've confirmed key login works.
#
#   DEPLOY_USER   unprivileged account CI deploys as (default: deploy)
#   DEPLOY_PUBKEY the CI deploy public key to authorise for that account (optional;
#                 add it later to ~deploy/.ssh/authorized_keys if blank)
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 1; }

DEPLOY_USER="${DEPLOY_USER:-deploy}"

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl gnupg ufw fail2ban unattended-upgrades rclone git

# --- Docker Engine ---
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi

# Container logs grow without bound by default and fill the disk. Rotate them.
install -d /etc/docker
if [ ! -f /etc/docker/daemon.json ]; then
  cat > /etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "20m", "max-file": "5" }
}
JSON
  systemctl restart docker
fi

# --- Swarm + the shared network Traefik and the app stack join ---
docker info --format '{{.Swarm.LocalNodeState}}' | grep -q '^active$' || docker swarm init
docker network inspect edge >/dev/null 2>&1 || \
  docker network create --driver overlay --attachable edge

# --- Firewall: only SSH + web. Postgres/Redis/RabbitMQ publish no host ports. ---
# (Docker-published ports bypass ufw; the stacks only publish 80/443 on purpose.)
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

systemctl enable --now fail2ban
# Automatic security patches (no automatic reboots).
dpkg-reconfigure -f noninteractive unattended-upgrades

# --- Deploy user (CI logs in as this, not root) ---
id "$DEPLOY_USER" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$DEPLOY_USER"
usermod -aG docker "$DEPLOY_USER"   # docker group == root-equivalent; key must stay private
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
if [ -n "${DEPLOY_PUBKEY:-}" ]; then
  echo "$DEPLOY_PUBKEY" >> "/home/$DEPLOY_USER/.ssh/authorized_keys"
  sort -u -o "/home/$DEPLOY_USER/.ssh/authorized_keys" "/home/$DEPLOY_USER/.ssh/authorized_keys"
  chmod 600 "/home/$DEPLOY_USER/.ssh/authorized_keys"
  chown "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh/authorized_keys"
fi

# --- Working dirs ---
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" /opt/fiam
install -d -m 700 /var/backups/fiam

cat <<MSG

Bootstrap done. Next (docker/README.md "Production server"):
  1. su - $DEPLOY_USER; git clone the repo to /opt/fiam/apis (branch main)
  2. cp docker/.env.production.example docker/.env and fill it in
  3. bash docker/production/preflight.sh
  4. deploy Traefik, then the app stack
MSG
