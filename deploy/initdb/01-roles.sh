#!/bin/sh
# Creates (or re-syncs) the three application roles and locks the database down.
# Idempotent: safe to run again after a password rotation.
#
# Runs in two ways:
#   * Local stacks mount this directory at /docker-entrypoint-initdb.d, so it
#     runs once, when the data directory is first initialised.
#   * The production Postgres is a separate Coolify resource with no repository
#     checkout, so run it by hand from a shell that already holds the values
#     (-e NAME without a value passes the variable through, so no secret lands
#     in the process list or the shell history):
#       docker exec -i -e POSTGRES_MIGRATE_USER -e POSTGRES_MIGRATE_PASSWORD \
#         -e POSTGRES_RUNTIME_USER -e POSTGRES_RUNTIME_PASSWORD \
#         -e POSTGRES_BACKUP_USER -e POSTGRES_BACKUP_PASSWORD \
#         <postgres container> sh -s < deploy/initdb/01-roles.sh
#
# Env (names only, values are credentials). POSTGRES_USER and POSTGRES_DB are
# the container's own superuser and database; the three role pairs below are
# the application's (the app's POSTGRES_USER is the runtime role).
#   POSTGRES_USER, POSTGRES_DB
#   POSTGRES_MIGRATE_USER,  POSTGRES_MIGRATE_PASSWORD
#   POSTGRES_RUNTIME_USER,  POSTGRES_RUNTIME_PASSWORD
#   POSTGRES_BACKUP_USER,   POSTGRES_BACKUP_PASSWORD
set -eu

for name in POSTGRES_USER POSTGRES_DB \
	POSTGRES_MIGRATE_USER POSTGRES_MIGRATE_PASSWORD \
	POSTGRES_RUNTIME_USER POSTGRES_RUNTIME_PASSWORD \
	POSTGRES_BACKUP_USER POSTGRES_BACKUP_PASSWORD; do
	eval "value=\${$name:-}"
	if [ -z "$value" ]; then
		echo "roles: $name is required" >&2
		exit 1
	fi
done

# \getenv reads the values inside psql, so no password appears on a command line.
# Passwords travel as %L-quoted literals and role names as %I identifiers.
psql --no-psqlrc -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
\getenv db POSTGRES_DB
\getenv migrate_user POSTGRES_MIGRATE_USER
\getenv migrate_password POSTGRES_MIGRATE_PASSWORD
\getenv runtime_user POSTGRES_RUNTIME_USER
\getenv runtime_password POSTGRES_RUNTIME_PASSWORD
\getenv backup_user POSTGRES_BACKUP_USER
\getenv backup_password POSTGRES_BACKUP_PASSWORD

-- The password literals below are part of the statement text, which the server
-- would write to its log under log_statement = 'all' (or 'ddl') and in an error
-- context line. Switch both off for this session first; both settings need the
-- superuser this script connects as.
SET log_statement = 'none';
SET log_min_error_statement = 'panic';
SET log_min_duration_statement = -1;

SELECT format('CREATE ROLE %I LOGIN', :'migrate_user')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'migrate_user') \gexec
SELECT format('CREATE ROLE %I LOGIN', :'runtime_user')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'runtime_user') \gexec
SELECT format('CREATE ROLE %I LOGIN', :'backup_user')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'backup_user') \gexec

SELECT format('ALTER ROLE %I PASSWORD %L', :'migrate_user', :'migrate_password') \gexec
SELECT format('ALTER ROLE %I PASSWORD %L', :'runtime_user', :'runtime_password') \gexec
SELECT format('ALTER ROLE %I PASSWORD %L', :'backup_user', :'backup_password') \gexec

-- Only the three roles (and the superuser, who bypasses the check) may connect.
SELECT format('REVOKE CONNECT ON DATABASE %I FROM PUBLIC', :'db') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I, %I, %I',
              :'db', :'migrate_user', :'runtime_user', :'backup_user') \gexec

-- The migrate role owns the schema objects and holds CREATE on the database,
-- which installing the pg-boss schema needs. The runtime role gets data access
-- from the release job and never DDL.
SELECT format('ALTER DATABASE %I OWNER TO %I', :'db', :'migrate_user') \gexec
SELECT format('ALTER SCHEMA public OWNER TO %I', :'migrate_user') \gexec

-- The backup role reads every table and sequence and can write nothing.
SELECT format('GRANT pg_read_all_data TO %I', :'backup_user') \gexec
SELECT format('ALTER ROLE %I SET default_transaction_read_only = on', :'backup_user') \gexec
SQL

echo "roles: ready"
