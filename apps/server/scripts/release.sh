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
# Plain sh on purpose: the image is Alpine, which ships no bash.
#
# Env (names only, values are credentials):
#   POSTGRES_DB, POSTGRES_MIGRATE_USER, POSTGRES_MIGRATE_PASSWORD  required
#   POSTGRES_HOST (default sab-postgres), POSTGRES_PORT (default 5432)
set -euo pipefail

for name in POSTGRES_DB POSTGRES_MIGRATE_USER POSTGRES_MIGRATE_PASSWORD; do
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

echo "release: done"
