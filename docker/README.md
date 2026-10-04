# Staging deployment (Hetzner, Docker Swarm)

Four Nest services (`auth`, `payment`, `postoffice`, `admin`) built from one shared
image (`../Dockerfile`), deployed as a Docker Swarm stack alongside
Postgres, Redis, RabbitMQ, and MinIO. Traefik sits in front and terminates
TLS for the three public services:

- `auth` → https://api.auth.staging.usefiam.com
- `payment` → https://api.payment.staging.usefiam.com
- `admin` → https://api.admin.staging.usefiam.com (the staff console's API; the
  console itself is a static site on Vercel)
- `postoffice` has no public route — it's only reached over RabbitMQ.

CI (`.github/workflows/ci.yml`) builds and pushes the image to
`ghcr.io/francis-nova/fiam-retail-apis` on every push to `staging`, tagged
both `:staging` and `:<commit-sha>`. **Rolling that image out to the server
is automated for `staging`** by the `deploy-staging` job in the same workflow
(SSH into the box and `docker service update` each service to the new
`:<sha>` tag). Migrations and `stack.yml`/`.env` changes stay manual (see
"Deploying a new build" below).

## One-time server setup

1. **Docker + Swarm.** Install Docker Engine on the Hetzner box, then:
   ```
   docker swarm init
   ```

2. **GHCR access.** GitHub Actions publishes the image as *private* by
   default (tied to the repo). Either:
   - make the package public — repo → Packages → `fiam-retail-apis` →
     Package settings → Change visibility, or
   - `docker login ghcr.io` on the server with a GitHub PAT that has
     `read:packages` scope.

3. **Shared overlay network** (Traefik + the app stack both join this):
   ```
   docker network create --driver overlay --attachable edge
   ```

4. **Fill in secrets** — one shared `.env` file for both stacks:
   ```
   cd docker
   cp .env.example .env
   # edit .env — see inline comments for what each value does
   ```
   `JWT_ACCESS_SECRET` must be identical to what `payment` uses to verify
   auth-issued tokens — since both read the same `docker/.env`, that's
   automatic as long as you don't duplicate the file.

   **`docker stack deploy` does not read `.env` on its own** — no
   `--env-file` flag, and unlike `docker compose` it doesn't auto-load a
   `.env` file from the working directory either (confirmed directly on
   this box: `${VAR}` substitution silently resolves to an empty string
   with no error — Postgres refused to start with "superuser password is
   not specified", and Traefik's ACME email came through blank, both
   without any complaint from `docker stack deploy` itself). Every deploy
   command below sources the file into the actual shell environment first:
   `set -a && . ./.env && set +a`.

5. **Deploy Traefik** (reverse proxy + Let's Encrypt, one-time — this stack
   is not touched by app redeploys):
   ```
   cd docker && set -a && . ./.env && set +a && docker stack deploy -c traefik-stack.yml traefik
   ```
   DNS for both `api.auth.staging.usefiam.com` and
   `api.payment.staging.usefiam.com` must already point at this box's IP
   (it does, per the records already added) before Let's Encrypt's HTTP-01
   challenge will succeed. Use `traefik:v3.6` or later — v3.1 (and v3.5)
   hardcode Docker API version 1.24 for the Swarm provider with no
   negotiation, which Docker Engine 29+ rejects outright ("client version
   1.24 is too old"); v3.6 fixed this (traefik/traefik#12253).

6. **First deploy:**
   ```
   cd docker && set -a && . ./.env && set +a && docker stack deploy -c stack.yml fiam
   ```

7. **Run migrations** (not automatic on container boot — deliberately a
   separate step so schema changes stay explicit). This builds the
   `builder` stage locally (has `ts-node`/`tsconfig-paths`/the TypeORM CLI,
   which the slim runtime image doesn't) and runs it once against the
   `internal` network — as a **Swarm service**, not `docker run`: the
   `internal` network in `stack.yml` isn't `attachable`, so a plain
   `docker run --network fiam_internal` is refused ("not manually
   attachable"); only Swarm-managed services can join it, hence
   `docker service create` + `--restart-condition none` (run once, don't
   restart) below:
   ```
   git clone <this repo> && cd fiam-retail-apis   # or `git pull` if already checked out on the box
   docker build --target builder -t fiam-apis-migrate .
   set -a && . docker/.env && set +a

   docker service create --name migrate-auth --network fiam_internal --restart-condition none \
     --env AUTH_DATABASE_URL="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/fiam_auth" \
     fiam-apis-migrate npm run migration:run:auth
   docker service logs migrate-auth --no-trunc   # confirm it reached "query: COMMIT"
   docker service rm migrate-auth

   docker service create --name migrate-payment --network fiam_internal --restart-condition none \
     --env PAYMENT_DATABASE_URL="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/fiam_payment" \
     fiam-apis-migrate npm run migration:run:payment
   docker service logs migrate-payment --no-trunc
   docker service rm migrate-payment
   ```

8. **Create the RabbitMQ dead-letter exchanges.** Both queues
   (`PAYMENT_ACCOUNT_PROVISIONING_QUEUE` = `payment.account_provisioning_requested`,
   `POSTOFFICE_NOTIFICATION_QUEUE` = `postoffice.notification_requested`, see
   `libs/common/src/messaging/`) are declared with a `deadLetterExchange`
   argument of `<queue-name>.dlx`, but the exchange itself isn't
   auto-created — a nacked message with no matching exchange is just
   silently dropped, not retried. `rabbitmqadmin` is bundled in the
   `rabbitmq:4-management-alpine` image, so this runs via `docker exec`
   rather than needing a tunnel to the management UI (note: `rabbitmqadmin`
   2.x's flag syntax is `--name value`, not the old 1.x `name=value` form):
   ```
   cd docker && set -a && . ./.env && set +a
   CID=$(docker ps -q -f name=fiam_rabbitmq)

   docker exec "$CID" rabbitmqadmin -u "$RABBITMQ_USER" -p "$RABBITMQ_PASSWORD" \
     declare exchange --name payment.account_provisioning_requested.dlx --type fanout --durable true
   docker exec "$CID" rabbitmqadmin -u "$RABBITMQ_USER" -p "$RABBITMQ_PASSWORD" \
     declare queue --name payment.account_provisioning_requested.dlq --durable true
   docker exec "$CID" rabbitmqadmin -u "$RABBITMQ_USER" -p "$RABBITMQ_PASSWORD" \
     declare binding --source payment.account_provisioning_requested.dlx --destination-type queue --destination payment.account_provisioning_requested.dlq --routing-key ""

   docker exec "$CID" rabbitmqadmin -u "$RABBITMQ_USER" -p "$RABBITMQ_PASSWORD" \
     declare exchange --name postoffice.notification_requested.dlx --type fanout --durable true
   docker exec "$CID" rabbitmqadmin -u "$RABBITMQ_USER" -p "$RABBITMQ_PASSWORD" \
     declare queue --name postoffice.notification_requested.dlq --durable true
   docker exec "$CID" rabbitmqadmin -u "$RABBITMQ_USER" -p "$RABBITMQ_PASSWORD" \
     declare binding --source postoffice.notification_requested.dlx --destination-type queue --destination postoffice.notification_requested.dlq --routing-key ""
   ```

   This is a pre-existing gap in the app code (same in local dev), not
   specific to staging — worth fixing properly (auto-declare the DLX on
   boot) at some point rather than repeating this by hand per environment.

## Admin console API (one-time setup)

`admin` is the back-office API for the staff console. It needs its own
database and two dedicated Postgres roles so the container never holds the
Postgres superuser password (`postgres/admin-roles.sql` explains exactly what
each role may do). Do this **after** a CI deploy has applied the auth and
payment migrations (the roles script refuses to run against a missing table).

1. **DNS** — `api.admin.staging.usefiam.com` → this box (needed before
   Let's Encrypt can issue the certificate).

2. **Keep `/internal` off the public routers.** Payment's router must exclude
   it (auth's already does) — `stack.yml` has this; if the stack hasn't been
   redeployed yet, apply it live first:
   ```
   docker service update --label-add \
     'traefik.http.routers.payment.rule=Host(`api.payment.staging.usefiam.com`) && !PathPrefix(`/internal`)' \
     fiam_payment
   ```

3. **Secrets** — append to `docker/.env` (hex values only: they go into
   connection URLs). `INTERNAL_API_KEY` must already be set.
   ```
   ADMIN_DB_PASSWORD=$(openssl rand -hex 24)
   READONLY_DB_PASSWORD=$(openssl rand -hex 24)
   ADMIN_JWT_ACCESS_SECRET=$(openssl rand -hex 32)
   ADMIN_JWT_ACCESS_TTL=15m
   ADMIN_JWT_REFRESH_TTL_DAYS=7
   ADMIN_CORS_ORIGIN=https://<the console's Vercel origin, no trailing slash>
   ```

4. **Roles and database** (idempotent — re-run it whenever auth/payment gain
   columns the admin API reads, since grants are column-level):
   ```
   cd docker && set -a && . ./.env && set +a
   docker exec -i "$(docker ps -q -f name=fiam_postgres)" \
     psql -U "$POSTGRES_USER" -v ON_ERROR_STOP=1 \
       -v admin_pw="$ADMIN_DB_PASSWORD" -v ro_pw="$READONLY_DB_PASSWORD" \
     < postgres/admin-roles.sql
   ```

5. **Create the service** (also refreshes the Traefik labels):
   ```
   cd docker && set -a && . ./.env && set +a && docker stack deploy -c stack.yml fiam
   ```

6. **Migrate and seed.** Same one-shot-job technique CI uses (CI skips admin
   until `fiam_admin` exists, then migrates it on every deploy). The seed
   prints the first super admin's one-time temporary password in the job log —
   read it once, then remove the job:
   ```
   IMG=$(docker service inspect fiam_admin --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}' | cut -d@ -f1)
   DB=$(docker service inspect fiam_admin --format '{{range .Spec.TaskTemplate.ContainerSpec.Env}}{{println .}}{{end}}' | grep '^ADMIN_DATABASE_URL=' | cut -d= -f2-)

   docker service create --detach=false --name migrate-admin --mode replicated-job \
     --network fiam_internal --restart-condition none --env ADMIN_DATABASE_URL="$DB" \
     "$IMG" node node_modules/typeorm/cli.js migration:run \
     -d dist/apps/admin/apps/admin/src/database/data-source.js
   docker service logs migrate-admin --no-trunc | tail -5; docker service rm migrate-admin

   docker service create --detach=false --name seed-admin --mode replicated-job \
     --network fiam_internal --restart-condition none --env ADMIN_DATABASE_URL="$DB" \
     --env SEED_EMAIL=you@fiam.ng --env SEED_NAME="Your Name" \
     "$IMG" node dist/apps/admin/apps/admin/src/database/seed-super-admin.js
   docker service logs seed-admin --no-trunc | grep -i "temporary password"; docker service rm seed-admin
   ```

7. **Check**: `curl https://api.admin.staging.usefiam.com/health` → `{"status":"ok"}`.

**Console on Vercel.** Import the `fiam-console` repo, set the build env var
`VITE_API_URL=https://api.admin.staging.usefiam.com`, deploy. `vercel.json`
in that repo provides the SPA routing and security headers (strict CSP whose
`connect-src` allows only that API). Only the production domain can call the
API — Vercel *preview* URLs have different origins and will be blocked by
CORS unless added to `ADMIN_CORS_ORIGIN` (comma-separated).

## Admin console hardening

**Two-factor sign-in (TOTP).** `ADMIN_TOTP_ENCRYPTION_KEY` (64 hex chars,
`openssl rand -hex 32`) is required: it encrypts every staff authenticator
secret at rest. **Keep a copy outside the server** — if it is lost every
enrolled authenticator becomes unreadable and each staff member must be reset
(super admin → Staff → *Reset 2FA*) and re-enrol. Rollout:

1. Deploy with `ADMIN_REQUIRE_2FA=false`; each person enrols from the console
   (*Security* link, bottom-left) and saves their recovery codes.
2. Once everyone is enrolled set `ADMIN_REQUIRE_2FA=true`
   (`docker service update --env-add ADMIN_REQUIRE_2FA=true fiam_admin`, and in
   `docker/.env`). From then on anyone who isn't enrolled is walked through
   enrolment at their next sign-in, and 2FA can't be turned off.
3. Lost phone + lost recovery codes: a super admin uses *Reset 2FA* on the
   person's page. Lost the *only* super admin's device: run the seed script
   for a new super admin (see "Migrate and seed" above) and reset the old one.

**IP allowlist.** `ADMIN_ALLOWED_IPS` is a comma-separated list of IPs/CIDRs
(`203.0.113.7, 198.51.100.0/24`). Blank/unset = **not enforced**. When set,
every request from elsewhere gets `403` (except `/health`). It reads the
client address Traefik forwards (`trust proxy` = 1 hop), so it only works with
Traefik directly in front. A malformed entry fails the boot on purpose.
Set it with `docker service update --env-add ADMIN_ALLOWED_IPS=... fiam_admin`
(and in `docker/.env`); clear it with `--env-rm`. Note this restricts the
*API*, i.e. the staff's browsers — it must contain the office/VPN egress IPs
or nobody can sign in.

**Staff alerts.** With `RABBITMQ_URL` set on `fiam_admin` (it is in
`stack.yml`), every active super admin is emailed when someone creates,
changes, resets or deletes a staff account, a staff account locks, 2FA is
turned off, a manual posting is approved/fails, or a customer account is
closed (`ALERT_ACTIONS` in `apps/admin/src/audit/alerts.service.ts`).

**Audit log.** `audit_logs` is append-only (database triggers reject
`UPDATE`/`DELETE`/`TRUNCATE`). Combine with off-box backups below.

**Idle sign-out.** The console signs staff out after 30 idle minutes
(`VITE_IDLE_MINUTES` at build time; `0` disables).

**Read-only grants.** CI re-runs `postgres/admin-roles.sql` on every deploy so
columns added by new migrations are visible to the admin API. If you ever run
a migration by hand, re-run it too (step 4 above).

## Backups

`backup/backup.sh` dumps `fiam_auth`, `fiam_payment` and `fiam_admin`
(`pg_dump -Fc`), the database roles, and the MinIO volume (KYC documents) into
`/var/backups/fiam/<UTC timestamp>/` with a `SHA256SUMS` file, and prunes
backups older than `BACKUP_KEEP_DAYS` (default 14). `backup/restore-check.sh`
restores the newest backup into throwaway databases and counts the rows, so
you *know* it works — run it after setting up and after any schema change.

```
# nightly at 02:00 UTC (/etc/cron.d/fiam-backup)
0 2 * * * root set -a; . /opt/fiam/apis/docker/.env; set +a; /opt/fiam/apis/docker/backup/backup.sh >> /var/log/fiam-backup.log 2>&1
```

**A backup on the same disk is not disaster recovery.** Set
`BACKUP_RCLONE_REMOTE` (e.g. `s3:fiam-backups/staging`, after `rclone config`)
so each run is also copied off the server. Also store `docker/.env` (it holds
`ADMIN_TOTP_ENCRYPTION_KEY` and every secret) somewhere safe — a restored
database is useless without them.

## Object storage (KYC documents)

Documents are stored in any S3-compatible bucket; staging started on the
in-stack MinIO and moves to **Hetzner Object Storage**. The app needs only
object read/write/delete — create the bucket in the Hetzner console (private,
and **enable object versioning**) and use a key that is limited to it.

Settings in `docker/.env` (the stack reads these, flat — nested `${A:-${B}}`
defaults are not supported by this Docker's stack loader):

```
OBJECT_STORAGE_ENDPOINT=fsn1.your-objectstorage.com   # no scheme; "minio" = the in-stack MinIO
OBJECT_STORAGE_PORT=443
OBJECT_STORAGE_USE_SSL=true
OBJECT_STORAGE_REGION=fsn1                            # fsn1 / nbg1 / hel1; blank for MinIO
OBJECT_STORAGE_AUTO_CREATE_BUCKET=false               # bucket made in the Hetzner console
OBJECT_STORAGE_ACCESS_KEY=...
OBJECT_STORAGE_SECRET_KEY=...
OBJECT_STORAGE_BUCKET=fiam-kyc-staging
OBJECT_STORAGE_PREFIX=                                # optional folder in a SHARED bucket, e.g. fiam-staging/
```

Staging uses the shared bucket `awuya-digital` with the folder `fiam-staging/`
(documents in `fiam-staging/kyc/`, encrypted backups in `fiam-staging/backups/`).
The prefix is applied by the storage layer only, so database keys stay
prefix-free. A key for a shared bucket can read *everything* in it, so
production should use its own bucket and key, with versioning on.

**Cut-over (no downtime, nothing deleted from MinIO):**

1. Copy and verify. This runs the app image as a one-shot job on the internal
   network (MinIO isn't reachable from outside), is idempotent, and ends with a
   "VERIFIED" line or a non-zero exit:
   ```
   IMG=$(docker service inspect fiam_auth --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}' | cut -d@ -f1)
   set -a; . docker/.env; set +a
   # `timeout`: Swarm waits forever on a job that *fails*, so cap it.
   timeout 600 docker service create --detach=false --name migrate-storage --mode replicated-job \
     --network fiam_internal --restart-condition none \
     --env SRC_ENDPOINT=minio --env SRC_PORT=9000 --env SRC_USE_SSL=false \
     --env SRC_ACCESS_KEY="$MINIO_ROOT_USER" --env SRC_SECRET_KEY="$MINIO_ROOT_PASSWORD" \
     --env SRC_BUCKET=fiam-kyc-documents \
     --env DST_ENDPOINT="$HETZNER_ENDPOINT" --env DST_PORT=443 --env DST_USE_SSL=true \
     --env DST_REGION="$HETZNER_REGION" --env DST_ACCESS_KEY="$HETZNER_KEY" \
     --env DST_SECRET_KEY="$HETZNER_SECRET" --env DST_BUCKET="$HETZNER_BUCKET" \
     --env DST_PREFIX="$HETZNER_PREFIX" \
     "$IMG" node dist/apps/auth/apps/auth/src/storage/migrate-storage.js
   docker service logs migrate-storage --no-trunc | tail; docker service rm migrate-storage
   ```
2. Point auth at the new store: set the `OBJECT_STORAGE_*` values above in
   `docker/.env`, then `docker service update --env-add ... fiam_auth` for each
   `MINIO_*` variable (or redeploy the stack).
3. Open a KYC document in the console to confirm, then re-run step 1 once more
   (it copies anything uploaded during the window).
4. Keep the MinIO volume for a while as a fallback; remove the service later.

## Off-box backups (Hetzner)

`rclone` is configured purely from environment variables (no config file).
Add to `docker/.env` (use a **different bucket** from the KYC documents):

```
RCLONE_CONFIG_HETZNER_TYPE=s3
RCLONE_CONFIG_HETZNER_PROVIDER=Other
RCLONE_CONFIG_HETZNER_ACCESS_KEY_ID=...
RCLONE_CONFIG_HETZNER_SECRET_ACCESS_KEY=...
RCLONE_CONFIG_HETZNER_ENDPOINT=https://fsn1.your-objectstorage.com
RCLONE_CONFIG_HETZNER_REGION=fsn1
RCLONE_CONFIG_HETZNER_NO_CHECK_BUCKET=true
BACKUP_RCLONE_REMOTE=hetzner:fiam-backups/staging
BACKUP_ENCRYPTION_PASSPHRASE=<long random; store it somewhere other than this server>
```

The script **refuses to upload without the passphrase** and encrypts every file
(AES-256) first. To restore from Hetzner: `rclone copy hetzner:fiam-backups/staging/<stamp> ./enc`,
`BACKUP_ENCRYPTION_PASSPHRASE=... backup/decrypt-backup.sh ./enc ./plain`, then
`pg_restore -d <db> ./plain/<db>.dump`. Without the passphrase the backups
cannot be read — keep a copy of it away from the server.

## Reconciliation and stuck money (console)

*Reconciliation* (Finance/Compliance) compares what we owe customers (sum of
wallets) with the provider's reported pool balance and lists exceptions. On a
payout stuck in PENDING/PROCESSING a Finance user can **Re-query with provider**
(only a definite *failed* answer refunds; anything unclear changes nothing). An
**UNMATCHED** deposit can be **assigned** to a customer: Finance requests it, a
different Compliance user approves it on the Postings page (maker-checker), and
the same transaction row becomes that customer's credit — it is never counted
twice. *Transactions → Export CSV* (Finance) and *Audit log → Export CSV*
(Compliance) are themselves audited; spreadsheet formulas in exported text are
neutralised. Error tracking (Sentry) is off until `SENTRY_DSN` is set on the
API services (and `VITE_SENTRY_DSN` + `SENTRY_ORIGIN` for the console); request
bodies, headers and cookies are always stripped.

## Production checklist (admin console)

Nothing below exists yet; staging values are the only ones in the repo.

- [ ] Separate production stack: own Postgres, Redis, RabbitMQ, MinIO and
      **fresh secrets** (never reuse staging's `INTERNAL_API_KEY`, JWT secrets,
      `ADMIN_TOTP_ENCRYPTION_KEY`, DB passwords).
- [ ] DNS + TLS for the console and API hostnames.
- [ ] Build the console with `VITE_API_URL=<prod admin API origin>` and run it
      with `API_ORIGIN=<same origin>` (the CSP follows it — no code change).
- [ ] `ADMIN_CORS_ORIGIN` = the console's exact production origin.
- [ ] `ADMIN_REQUIRE_2FA=true`, `ADMIN_ALLOWED_IPS` set to the office/VPN.
- [ ] At least **two** super admins, each with 2FA and saved recovery codes.
- [ ] Backups scheduled, copied off-box, and a restore check passed.
- [ ] Error tracking + uptime monitoring on `/health` of every service.
- [ ] Run `postgres/admin-roles.sql` after the auth/payment migrations.

## Deploying a new build

Once CI has pushed a new image for a commit on `staging`:

```
docker service update --image ghcr.io/francis-nova/fiam-retail-apis:staging fiam_auth
docker service update --image ghcr.io/francis-nova/fiam-retail-apis:staging fiam_payment
docker service update --image ghcr.io/francis-nova/fiam-retail-apis:staging fiam_postoffice
docker service update --image ghcr.io/francis-nova/fiam-retail-apis:staging fiam_admin
```

`update_config.order: start-first` in `stack.yml` means the new container
starts and passes its healthcheck before the old one is stopped — no
downtime window, and a failed healthcheck auto-rolls back
(`failure_action: rollback`).

If the deploy includes a migration, run step 7 above *before* updating the
services — new code should never run against an unmigrated schema.

## Notes / known trade-offs

- **`NODE_ENV=production` disables CORS entirely** (`main.ts` only calls
  `app.enableCors(...)` when `env !== 'production'`, and the Joi schema for
  `NODE_ENV` doesn't have a `staging` value — `production` is what's set
  here). Fine for the mobile app (native, no CORS enforcement), but if you
  ever want to hit staging from a browser tool, this is where to look.
- Swagger docs (`/docs` on each service) are **not** gated by environment —
  they're reachable on staging same as local dev.
- `eng.traineddata` (tesseract.js OCR, used by auth's KYC flow) is baked
  into the image so OCR works without an outbound fetch to jsdelivr's CDN
  on first use.
- Provider credentials (QoreID, VFD, Termii, ZeptoMail) are all optional at
  boot — leaving them blank in `docker/.env` keeps the rest of each service
  working; only the specific provider-backed endpoint returns a clear error
  until real credentials are filled in.
- **MinIO's OSS edition is archived** (as of early 2026) and `minio/minio`
  was pulled from Docker Hub entirely — `stack.yml` points at
  `quay.io/minio/minio` instead, which still serves the same images. Worth
  a separate conversation about longer-term object storage given the OSS
  edition is no longer maintained upstream.
