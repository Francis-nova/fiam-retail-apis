-- Database roles for the admin console API. Run as the Postgres superuser,
-- AFTER the auth/payment migrations have been applied. Idempotent: re-run it
-- whenever those schemas gain columns the admin API needs to read (grants are
-- column-level, so new columns are NOT readable until this is re-run).
--
--   cd docker && set -a && . ./.env && set +a
--   docker exec -i "$(docker ps -q -f name=fiam_postgres)" \
--     psql -U "$POSTGRES_USER" -v ON_ERROR_STOP=1 \
--       -v admin_pw="$ADMIN_DB_PASSWORD" -v ro_pw="$READONLY_DB_PASSWORD" \
--     < postgres/admin-roles.sql
--
-- Two stages, because creating roles needs a Postgres superuser (or at least
-- CREATEROLE) that the application's own DB user usually is not:
--   -v roles_only=1   roles + the admin database. Run ONCE, as a superuser, on
--                     the database host (before the admin service first starts).
--   -v grants_only=1  the column-level read grants. Run as the DB owner after
--                     every migration (CI does this each deploy).
--   neither           both stages (the in-stack Postgres, where the user is superuser).
--
-- Why this exists: without it the admin container would carry the Postgres
-- superuser password for every database. With it, a compromised admin
-- service can only
--   - manage its own database (fiam_admin_app), and
--   - read the specific columns below from auth/payment (fiam_readonly) —
--     never password hashes, PIN hashes, token hashes, or stored file keys,
-- and every other write to those databases still has to go through the
-- owning service's /internal API.

-- Database names are variables only so this can be rehearsed against scratch
-- databases; leave them unset in staging/production.
\if :{?auth_db} \else \set auth_db fiam_auth \endif
\if :{?payment_db} \else \set payment_db fiam_payment \endif
\if :{?admin_db} \else \set admin_db fiam_admin \endif

\if :{?grants_only} \else
-- ---------------------------------------------------------------- roles
SELECT 'CREATE ROLE fiam_admin_app LOGIN'
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fiam_admin_app')
\gexec
SELECT 'CREATE ROLE fiam_readonly LOGIN'
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fiam_readonly')
\gexec

ALTER ROLE fiam_admin_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'admin_pw';
ALTER ROLE fiam_readonly  WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'ro_pw';
-- Belt and braces on top of the app's own read-only session setting.
ALTER ROLE fiam_readonly SET default_transaction_read_only = on;

-- ------------------------------------------------------- the admin's own DB
SELECT format('CREATE DATABASE %I OWNER fiam_admin_app', :'admin_db')
 WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'admin_db')
\gexec
SELECT format('ALTER DATABASE %I OWNER TO fiam_admin_app', :'admin_db')
\gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'admin_db')
\gexec

\connect :"admin_db"
-- The admin migrations use uuid_generate_v4(); a database owner may install
-- this trusted extension but creating it here keeps migrations privilege-free.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
GRANT ALL ON SCHEMA public TO fiam_admin_app;

\endif

\if :{?roles_only} \else
-- ------------------------------------------- read-only: auth service data
\connect :"auth_db"
-- One transaction: the REVOKE + re-GRANT below must never be visible half-done,
-- or the console's reads would fail for the instant in between on a re-run.
BEGIN;
GRANT CONNECT ON DATABASE :"auth_db" TO fiam_readonly;
GRANT USAGE ON SCHEMA public TO fiam_readonly;
-- Start from nothing so a re-run converges on exactly the list below.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM fiam_readonly;

DO $$
DECLARE
  spec record;
  cols text;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      -- table, columns that must NOT be readable
      ('users',                     ARRAY['password_hash', 'transaction_pin_hash']),
      ('sessions',                  ARRAY[]::text[]),
      ('trusted_devices',           ARRAY[]::text[]),
      ('kyc_documents',             ARRAY['object_key']),
      ('account_deletion_requests', ARRAY[]::text[])
    ) AS t(tbl, excluded)
  LOOP
    SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
      INTO cols
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = spec.tbl
       AND NOT (column_name = ANY (spec.excluded));
    IF cols IS NULL THEN
      RAISE EXCEPTION 'table % is missing — run the auth migrations first', spec.tbl;
    END IF;
    EXECUTE format('GRANT SELECT (%s) ON public.%I TO fiam_readonly', cols, spec.tbl);
  END LOOP;
END $$;
COMMIT;

-- ----------------------------------------- read-only: payment service data
\connect :"payment_db"
-- One transaction: the REVOKE + re-GRANT below must never be visible half-done,
-- or the console's reads would fail for the instant in between on a re-run.
BEGIN;
GRANT CONNECT ON DATABASE :"payment_db" TO fiam_readonly;
GRANT USAGE ON SCHEMA public TO fiam_readonly;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM fiam_readonly;

DO $$
DECLARE
  spec record;
  cols text;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('wallets',       ARRAY[]::text[]),
      ('addresses',     ARRAY['provider_metadata']),
      ('transactions',  ARRAY[]::text[]),
      ('beneficiaries', ARRAY[]::text[])
    ) AS t(tbl, excluded)
  LOOP
    SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
      INTO cols
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = spec.tbl
       AND NOT (column_name = ANY (spec.excluded));
    IF cols IS NULL THEN
      RAISE EXCEPTION 'table % is missing — run the payment migrations first', spec.tbl;
    END IF;
    EXECUTE format('GRANT SELECT (%s) ON public.%I TO fiam_readonly', cols, spec.tbl);
  END LOOP;
END $$;
COMMIT;
\endif
