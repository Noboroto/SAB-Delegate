#!/bin/sh
# One-shot release step (the `release` image target): dumps a non-empty
# database, applies pending Prisma migrations as the migrate role, then proves
# the history is clean. Never serves traffic.
#
# Fails closed: any doubt about the database state exits non-zero, and the
# server only starts once this job has completed successfully.
#
# A non-empty database is dumped (backup.sh, tag pre-migrate) before any
# migration touches it, and a failed dump stops the release. An empty database
# has nothing to lose, so the first deploy skips the dump.
#
# Plain POSIX sh on purpose: the image is Alpine, which ships no bash, so there
# is no `pipefail`. Every command whose failure matters is therefore run on its
# own (no pipes) and checked by `set -e`.
#
# Env (names only, values are credentials):
#   POSTGRES_DB, POSTGRES_USER                                      required
#   POSTGRES_MIGRATE_USER, POSTGRES_MIGRATE_PASSWORD                required
#   POSTGRES_HOST (default sab-postgres), POSTGRES_PORT (default 5432)
#   BACKUP_DIR, BACKUP_ENABLED, BACKUP_KEEP_PRE_MIGRATE             read by backup.sh
set -eu

for name in POSTGRES_DB POSTGRES_USER POSTGRES_MIGRATE_USER POSTGRES_MIGRATE_PASSWORD; do
	eval "value=\${$name:-}"
	if [ -z "$value" ]; then
		echo "release: $name is required" >&2
		exit 1
	fi
done

scripts_dir="$(dirname "$0")"

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
't|'*)
	# This job holds no backup credentials of its own: it dumps as the migrate
	# role, which owns every table.
	if [ ! -f "$scripts_dir/backup.sh" ]; then
		echo "release: backup.sh is missing; refusing to migrate a non-empty database without a dump" >&2
		exit 1
	fi
	echo "release: database has data, taking a pre-migrate dump"
	POSTGRES_BACKUP_USER="$POSTGRES_MIGRATE_USER" \
		POSTGRES_BACKUP_PASSWORD="$POSTGRES_MIGRATE_PASSWORD" \
		/bin/sh "$scripts_dir/backup.sh" pre-migrate
	;;
'f|0')
	echo "release: database is empty, skipping the pre-migrate dump"
	;;
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

# Prisma and the driver can echo a connection string in an error. The output is
# collected first so the exit status survives (there is no pipefail in sh), then
# printed with URLs and the password removed. The password is matched literally
# (awk index, read from ENVIRON so backslashes stay intact), not as a pattern.
run_scrubbed() {
	out="$(mktemp)"
	status=0
	"$@" >"$out" 2>&1 || status=$?
	SCRUB="$POSTGRES_MIGRATE_PASSWORD" awk '
		BEGIN { secret = ENVIRON["SCRUB"] }
		{
			gsub(/[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^ \t]*/, "<url>")
			while (length(secret) > 0 && (i = index($0, secret)) > 0) {
				$0 = substr($0, 1, i - 1) "<redacted>" substr($0, i + length(secret))
			}
			print
		}' "$out"
	rm -f "$out"
	return "$status"
}

echo "release: applying migrations"
run_scrubbed ./node_modules/.bin/prisma migrate deploy

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

# pg-boss keeps its own schema, outside Prisma's migrations. The runtime role
# cannot create it, so it is installed (or upgraded) here and then granted. The
# migrate role needs CREATE on the database for that.
echo "release: installing pg-boss schema"
node "$scripts_dir/install-pgboss.mjs"

echo "release: done"
