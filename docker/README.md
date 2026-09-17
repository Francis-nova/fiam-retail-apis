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

4. **Deploy Traefik** (reverse proxy + Let's Encrypt, one-time — this stack
   is not touched by app redeploys):
   ```
   echo "ACME_EMAIL=you@usefiam.com" > docker/traefik.env
   docker stack deploy -c docker/traefik-stack.yml --env-file docker/traefik.env traefik
   ```
   DNS for both `api.auth.staging.usefiam.com` and
   `api.payment.staging.usefiam.com` must already point at this box's IP
   (it does, per the records already added) before Let's Encrypt's HTTP-01
   challenge will succeed.

5. **Fill in secrets:**
   ```
   cp docker/stack.env.example docker/stack.env
   # edit docker/stack.env — see inline comments for what each value does
   ```
   `JWT_ACCESS_SECRET` must be identical to what `payment` uses to verify
   auth-issued tokens — since both read the same `docker/stack.env` in this
   setup, that's automatic as long as you don't duplicate the file.

6. **First deploy:**
   ```
   docker stack deploy -c docker/stack.yml --env-file docker/stack.env fiam
   ```

7. **Run migrations** (not automatic on container boot — deliberately a
   separate step so schema changes stay explicit). This builds the
   `builder` stage locally (has `ts-node`/`tsconfig-paths`/the TypeORM CLI,
   which the slim runtime image doesn't) and runs it once against the
   `internal` network:
   ```
   git clone <this repo> && cd fiam-retail-apis   # or `git pull` if already checked out on the box
   docker build --target builder -t fiam-apis-migrate .
   docker run --rm --network fiam_internal \
     --env AUTH_DATABASE_URL="postgres://postgres:<POSTGRES_PASSWORD>@postgres:5432/fiam_auth" \
     fiam-apis-migrate npm run migration:run:auth
   docker run --rm --network fiam_internal \
     --env PAYMENT_DATABASE_URL="postgres://postgres:<POSTGRES_PASSWORD>@postgres:5432/fiam_payment" \
     fiam-apis-migrate npm run migration:run:payment
   ```

8. **Create the RabbitMQ dead-letter exchanges.** Both queues
   (`account-provisioning`, `notification`) are declared with a
   `deadLetterExchange` argument, but the exchange itself isn't
   auto-created — a nacked message with no matching exchange is just
   silently dropped, not retried. Via the management UI
   (`http://<server-ip>:15672`, exposed on the `internal` network only —
   tunnel in with `ssh -L 15672:rabbitmq:15672 <server>` or temporarily
   publish the port) create:
   - exchange `account-provisioning.dlx` + a bound `account-provisioning.dlq`
   - exchange `notification.dlx` + a bound `notification.dlq`

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
  boot — leaving them blank in `stack.env` keeps the rest of each service
  working; only the specific provider-backed endpoint returns a clear error
  until real credentials are filled in.
