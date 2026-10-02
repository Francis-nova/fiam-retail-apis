# Admin API (`apps/admin`)

Back-office API behind the staff console (`fiam-console` repo): staff
accounts and roles, customer 360, KYC review, transactions, manual postings
and account-deletion requests. Port **7004**.

- **Own database** (`fiam_admin`): staff, refresh tokens, audit log, postings.
- **Reads** customer/payment data straight from `fiam_auth` / `fiam_payment`
  through read-only connections (raw SQL, column-limited role in staging —
  see `docker/postgres/admin-roles.sql`).
- **Writes** never touch those databases: they call the owning service's
  `/internal` API (`x-internal-key`), so its business rules still apply.
- Staff tokens use `ADMIN_JWT_ACCESS_SECRET`, deliberately different from the
  customer `JWT_ACCESS_SECRET`.

## Local development

```
cp apps/admin/.env.example apps/admin/.env   # fill ADMIN_JWT_ACCESS_SECRET and INTERNAL_API_KEY
npm run migration:run:admin
SEED_EMAIL=you@fiam.ng SEED_NAME="Your Name" npm run seed:admin   # prints a one-time temporary password
npm run start:admin:dev
```

The seeded account must change its temporary password at first sign-in.
**Never write real passwords into this repo** (not in this file, not in
`.env.example`) — the temporary password is shown once, in the terminal.

## Roles

| Role | Can |
| --- | --- |
| SUPER_ADMIN | Everything, including managing staff |
| COMPLIANCE | Review KYC, suspend / reactivate / close accounts, handle deletion requests, approve or reject postings |
| FINANCE | Request manual postings, view transactions |
| SUPPORT | Read customers and transactions |

## Deploying

See `docker/README.md` ("Admin console API") for staging setup.
