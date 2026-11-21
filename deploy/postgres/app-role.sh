#!/bin/sh
# Sandpiper GRC with compose.postgres.yaml: the application's own least-privilege database role.
#
# Run by the one-off "db-roles" service before the application starts, every time (it is safe to
# repeat). It makes sure the role "grc_app" exists with a password of its own, and writes that
# password to /run/grc-db/app_password (the grc-db-app volume) for the application to read:
# - "grc" (POSTGRES_USER, password in deploy/secrets/db_password.txt) owns the tables and runs the
#   migrations; the application uses it only for that, at start (GRC_DATABASE_MIGRATE_URL);
# - "grc_app" is what the application runs as: it may read and write rows, nothing else. It cannot
#   create, alter or drop tables or triggers, and may not change or delete audit events. The grants
#   are made by the application's own migration run (docs/installation.md, "A least-privilege
#   database role").
# The password is generated once and kept; delete the file in the volume to have a new one made.
set -eu

out=/run/grc-db/app_password
if [ ! -s "$out" ]; then
  umask 077
  # 48 hex characters from the kernel's random source.
  od -An -N24 -tx1 /dev/urandom | tr -d ' \n' >"$out.new"
  mv "$out.new" "$out"
fi
# The application runs as uid 1000 and only reads it.
chown 1000:1000 "$out"
chmod 0400 "$out"

# Line ends removed: a password file written on Windows may end in CR LF.
PGPASSWORD="$(tr -d '\r\n' </run/secrets/db_password)" \
psql -v ON_ERROR_STOP=1 -q -h "${PGHOST:-db}" -U "${PGUSER:-grc}" -d "${PGDATABASE:-grc}" \
  -v app_password="$(cat "$out")" <<'SQL'
select 'create role grc_app login' where not exists (select 1 from pg_roles where rolname = 'grc_app') \gexec
alter role grc_app with login nosuperuser nocreatedb nocreaterole noinherit nobypassrls password :'app_password';
-- Only the owner may create objects; the role reaches the tables through the grants alone.
revoke create on schema public from public;
grant connect on database :"DBNAME" to grc_app;
SQL
echo "Database role grc_app is ready."
