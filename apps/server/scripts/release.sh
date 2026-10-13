#!/bin/sh
# One-shot release step (the `release` image target): applies pending Prisma
# migrations as the migrate role, then proves the history is clean. Never
# serves traffic.
#
# Fails closed: any doubt about the database state exits non-zero, and the
# server only starts once this job has completed successfully.
#
# There is no pre-migration dump yet. Until the backup step is added in front of
# `prisma migrate deploy`, a migration that destroys data has no restore point,
# so migrations stay additive.
#
# Plain POSIX sh on purpose: the image is Alpine, which ships no bash, so there
# is no `pipefail`. Every command whose failure matters is therefore run on its
# own (no pipes) and checked by `set -e`.
#
# Env (names only, values are credentials):
#   POSTGRES_DB, POSTGRES_USER                                      required
#   POSTGRES_MIGRATE_USER, POSTGRES_MIGRATE_PASSWORD                required
#   POSTGRES_HOST (default sab-postgres), POSTGRES_PORT (default 5432)
set -eu

for name in POSTGRES_DB POSTGRES_USER POSTGRES_MIGRATE_USER POSTGRES_MIGRATE_PASSWORD; do
	eval "value=\${$name:-}"
	if [ -z "$value" ]; then
		echo "release: $name is required" >&2
		exit 1
	fi
done

PGHOST="${POSTGRES_HOST:-sab-postgres}"
PGPORT="${POSTGRES_PORT:-5432}"
PGUSER="$POSTGRES_MIGRATE_USER"
PGPASSWORD="$POSTGRES_MIGRATE_PASSWORD"
PGDATABASE="$POSTGRES_DB"
export PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE

# psql prints a connection error and exits non-zero when the database cannot be
# reached; set -e turns that into a failed release instead of a guess that the
# schema is empty.
state="$(psql --no-psqlrc --tuples-only --no-align --field-separator='|' --command \
	"select to_regclass('public.\"_prisma_migrations\"') is not null,
	        (select count(*) from pg_tables where schemaname = 'public' and tablename <> '_prisma_migrations')")"

case "$state" in
't|'* | 'f|0') ;;
*)
	# Tables without a migration history: the schema was created outside Prisma.
	# Applying the first migration would fail half-way or collide with it.
	echo "release: public schema has tables but no _prisma_migrations; baseline it by hand" >&2
	exit 1
	;;
esac

# A migration queues behind any open transaction that touches the same table,
# and every request after it queues behind the migration. A role-level setting
# is used because Prisma's engine opens its own connections and ignores libpq
# environment variables; the server applies it to every session of this role.
# Only the release job connects as the migrate role.
psql --no-psqlrc --set ON_ERROR_STOP=1 --quiet --set migrate="$POSTGRES_MIGRATE_USER" <<'SQL'
ALTER ROLE :"migrate" SET lock_timeout = '10s';
SQL

echo "release: applying migrations"
./node_modules/.bin/prisma migrate deploy

# `migrate deploy` exits 0 with "No pending migrations" even when an earlier
# attempt is still marked unfinished, so the table is read back.
unfinished="$(psql --no-psqlrc --tuples-only --no-align --command \
	"select count(*) from public.\"_prisma_migrations\" where finished_at is null and rolled_back_at is null")"
if [ "$unfinished" != "0" ]; then
	echo "release: $unfinished migration(s) are recorded as unfinished" >&2
	exit 1
fi

# The migrate role owns every table it creates; the runtime role gets data
# access only, never DDL. Tables created by later migrations are covered by the
# default privileges, which apply only to objects created by the migrate role.
# GRANT is idempotent, so a re-run changes nothing.
echo "release: granting runtime access"
psql --no-psqlrc --set ON_ERROR_STOP=1 --single-transaction --quiet \
	--set runtime="$POSTGRES_USER" --set migrate="$POSTGRES_MIGRATE_USER" <<'SQL'
GRANT USAGE ON SCHEMA public TO :"runtime";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"runtime";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO :"runtime";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migrate" IN SCHEMA public
	GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"runtime";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migrate" IN SCHEMA public
	GRANT USAGE, SELECT ON SEQUENCES TO :"runtime";
SQL

echo "release: done"
