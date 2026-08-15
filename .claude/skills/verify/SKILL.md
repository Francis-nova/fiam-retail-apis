---
name: verify
description: Launch and drive the Fiam APIs (auth, payment, postoffice) for runtime verification
---

# Verifying apis/apps/*

No git repo here (root and `apis/` are both un-versioned — only `mobile-app/` has its own git repo). Scope is whatever changed since the last verification pass, not a diff.

## Launch

```bash
cd "apis" && npm run start:auth:dev       # nest watch mode, port 7001 (AUTH_PORT)
cd "apis" && npm run start:payment:dev    # port 7003 (PAYMENT_PORT) — hybrid HTTP+RMQ, own fiam_payment DB
cd "apis" && npm run start:postoffice:dev # port 7002 (POSTOFFICE_PORT) — health-only stub
curl -s http://localhost:7001/health  # {"status":"ok"}
curl -s http://localhost:7003/health  # {"status":"ok","service":"payment"}
curl -s http://localhost:7002/health  # {"status":"ok","service":"postoffice"}
```

Postgres is a local Homebrew instance (`postgresql@17`) already running on 5432 — `fiam_auth` and `fiam_payment` are separate DBs, no need to start either manually. RabbitMQ is also a local Homebrew instance (not Docker) on `5672`/mgmt UI `15672`, guest/guest — `brew services start rabbitmq` if `brew services list` shows it stopped. Hot-reloads on save — no restart needed between edits and re-tests, **except** when an env var changes: each app only reads its `.env` once at process start, so that specific case needs a kill + restart of the `nest start --watch` process.

**Each app has its own `.env`** (`apps/auth/.env`, `apps/payment/.env`) — there is no shared root `apis/.env` anymore. `TERMII_API_KEY`/`TERMII_SENDER_ID`/`QOREID_CLIENT_ID`/`QOREID_SECRET` (in `apps/auth/.env`) and `VFD_CONSUMER_KEY`/`VFD_CONSUMER_SECRET` (in `apps/payment/.env`) are empty placeholders — phone-add, BVN-submit, and VFD account-creation calls return a clean `503` rather than crashing. That's expected, not a bug, unless the user says they've added real keys. `VFD_WEBHOOK_SECRET` in `apps/payment/.env` **is** filled in locally (it's our own secret, not VFD-issued) — the webhook endpoint is fully drivable.

Every app serves interactive docs at `/docs` (raw spec at `/docs-json`) via `@nestjs/swagger` — useful for a quick endpoint/schema inventory before driving anything with curl.

## Drive — auth

Plain `curl` against the real endpoints — happy-path sequence: register → otp/verify → me → phone → phone/verify → bvn → bvn/verify, plus the password-reset trio (password-reset/request → /verify → /confirm). Always create a **fresh** email per test run (`user_$(date +%s)@example.com`) — the OTP resend cooldown (60s, `OTP_RESEND_COOLDOWN_SECONDS`) will 429 a reused email across quick successive test runs.

`POST /auth/bvn` now requires **both** `bvn` and `dateOfBirth` (`YYYY-MM-DD`, `@IsDateString({strict:true})` — rejects nonexistent calendar dates like `1995-02-30`, not just malformed strings). Since `QOREID_*` is unconfigured, this endpoint always 503s past validation — can't be driven further than "did my input pass validation and reach the provider call" without real QoreID creds.

**Driving `verifyBvnOtp` (and anything past it, like the payment-provisioning trigger) without real QoreID creds**: `submitBvn` never generates a BVN OTP because it 503s before reaching that line, so there's no way to get a real OTP through the actual `/auth/bvn` flow. Workaround that still exercises the real `/auth/bvn/verify` endpoint (only the OTP's *origin* is stubbed): seed an `otps` row directly —
```sql
INSERT INTO otps (user_id, purpose, code_hash, expires_at)
VALUES ('<userId>', 'BVN_VERIFICATION', '<sha256 of your chosen code, hex>', now() + interval '5 minutes');
```
(`codeHash` is plain `sha256(code)`, no salt — see `apps/auth/src/otp/otp.util.ts`) — then `POST /auth/bvn/verify {"code": "<your code>"}` with a valid access token. Also update `users.bvn`/`date_of_birth`/`bvn_verified_at` directly first (same reasoning — `submitBvn` never got to persist them).

**Login gotcha once a transaction PIN exists**: `POST /auth/login` stops returning `accessToken` directly — it returns `{pinRequired:true, loginTicket}` unless the request's `x-device-id` header matches an already-trusted device. Send a stable `x-device-id` header, then `POST /auth/login/pin {loginTicket, pin}` to get real tokens.

## Drive — payment

`POST /webhooks/vfd/inward-credit?secret=<VFD_WEBHOOK_SECRET from apps/payment/.env>` — real payload fields: `reference`, `amount` (string, assumed naira — ×100 to kobo), `account_number`, plus optional `originator_*`/`timestamp`/`transaction_channel`/`session_id`. No secret or wrong secret → `401`. Missing required field → `400` (class-validator). As of phase 5, the ledger and webhook-audit tables were folded into one `transactions` row (the old `provider_webhook_events`/`wallet_transactions` tables no longer exist) — an `account_number` with no matching `ACTIVE` address → `200` but the row lands in `transactions` as `status='UNMATCHED'`, no wallet mutation; check via `psql fiam_payment -c "select status, wallet_id, amount_minor from transactions where reference='<ref>';"`, not just the HTTP response, since matched and unmatched both return `200`. Redelivering the identical `reference` is a deliberate no-op (dedup on `(provider, reference)`) — check `wallets.balance_minor` didn't move a second time. As of phase 6, the handler also calls VFD's TSQ (`queryTransferStatus`) before crediting — with `VFD_CONSUMER_KEY`/`SECRET` unset that call itself throws inside `VfdPaymentProvider` and is swallowed there (logged as `[VfdPaymentProvider] VFD TSQ request threw...`), returning a `REQUERY` outcome rather than propagating — so `WebhooksService`'s own catch-and-fail-open branch never actually fires in this dev env; the credit still proceeds, just via the "outcome isn't FAILED" path rather than the "requery call threw" path. Functionally equivalent, but don't expect to see the `WebhooksService`-level warning log in output.

The RabbitMQ producer→consumer path (auth publishes on BVN+PIN completion, payment consumes and calls VFD) is only observable via app logs, not HTTP — tail whichever process ran `npm run start:payment:dev` for a `[AccountProvisioningConsumer]` log line after triggering the auth-side condition.

**Payout surface (phase 6, `apps/payment/src/payouts|banks|beneficiaries`)**: `GET /banks` and `POST /payouts/recipient`/`POST /payouts` all reach VFD and 503 cleanly with `VFD_CONSUMER_KEY`/`SECRET` unset — same expected-not-a-bug caveat as everywhere else. `GET /banks` is Redis-cached 24h at key `payment:banks:VFD` (`redis-cli GET "payment:banks:VFD"` / `redis-cli TTL ...` to inspect; `redis-cli DEL "payment:banks:VFD"` to force a refetch) — a failed VFD call does not get cached, confirmed via `redis-cli KEYS "payment:banks:*"` staying empty after a 503. `POST /payouts` needs a funded `wallets` row **and** an `ACTIVE` `addresses` row for the test user to get past the "no wallet"/"no active payout account" checks before it can reach VFD — seed both directly the same way phase 4/5 verification did, and delete them afterward (an address here uses whatever fake `provider_account_number` you choose, so leaving one behind on a real test account would silently short-circuit that account's real future VFD provisioning — `AddressService.provisionAddress` returns early on any existing `ACTIVE` address without calling VFD at all).

## Gotchas found so far

- Emails are normalized (lowercased) as of the case-sensitivity fix — don't expect two different-case registrations to create two accounts.
- `ConfirmPasswordResetDto` validation errors come back as `"message": [...]` (an **array**, from class-validator/ValidationPipe), not a plain string — worth checking how any new client renders it.
- Password reset tokens are single-use and consumed only *after* DTO validation passes — a request that 400s on validation does NOT consume the token, so it can still be retried with a valid password.
- Malformed JSON body (not just malformed field values) also comes back as a clean `400` with a body-parser message, on both auth and payment — Express's JSON body-parser error is caught by the same global exception filter, doesn't crash the process.
