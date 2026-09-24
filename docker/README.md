# Staging deployment (Hetzner, Docker Swarm)

Three Nest services (`auth`, `payment`, `postoffice`) built from one shared
image (`../Dockerfile`), deployed as a Docker Swarm stack alongside
Postgres, Redis, RabbitMQ, and MinIO. Traefik sits in front and terminates
TLS for the two public services:

- `auth` → https://api.auth.staging.usefiam.com
- `payment` → https://api.payment.staging.usefiam.com
- `postoffice` has no public route — it's only reached over RabbitMQ.

CI (`.github/workflows/ci.yml`) builds and pushes the image to
`ghcr.io/francis-nova/fiam-retail-apis` on every push to `staging`, tagged
both `:staging` and `:<commit-sha>`. **Rolling that image out to the server
is a manual step** (see "Deploying a new build" below) — there is no
auto-deploy yet.

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

## Deploying a new build

Once CI has pushed a new image for a commit on `staging`:

```
docker service update --image ghcr.io/francis-nova/fiam-retail-apis:staging fiam_auth
docker service update --image ghcr.io/francis-nova/fiam-retail-apis:staging fiam_payment
docker service update --image ghcr.io/francis-nova/fiam-retail-apis:staging fiam_postoffice
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
