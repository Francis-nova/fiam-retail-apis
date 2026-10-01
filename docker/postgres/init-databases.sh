#!/bin/sh
# Runs once, automatically, on the Postgres container's first boot (empty
# data volume only — official postgres image convention for anything in
# /docker-entrypoint-initdb.d). Creates the two app databases inside the one
# shared Postgres instance; $POSTGRES_USER already exists and owns both.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-EOSQL
  CREATE DATABASE fiam_auth;
  CREATE DATABASE fiam_payment;
EOSQL
