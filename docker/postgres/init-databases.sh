#!/bin/sh
# Runs once, automatically, on the Postgres container's first boot (empty
# data volume only — official postgres image convention for anything in
# /docker-entrypoint-initdb.d). Creates the app databases inside the one
# shared Postgres instance; $POSTGRES_USER already exists and owns them.
# (fiam_admin is normally created, with its own owner role, by
# admin-roles.sql — this only covers a brand-new volume.)
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-EOSQL
  CREATE DATABASE fiam_auth;
  CREATE DATABASE fiam_payment;
  CREATE DATABASE fiam_admin;
EOSQL
