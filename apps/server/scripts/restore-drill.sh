#!/bin/sh
# Proves a backup is restorable: restores the newest dump of this database into
# a throwaway database, compares per-table row counts with the live source and
# drops the throwaway database. Exits non-zero on any failure or mismatch.
#
# Usage: restore-drill.sh [dump-file]   (default: newest `<db>-*-<ts>.dump`)
#
# Only the `public` schema is compared: the application data and the migration
# history. pg-boss keeps its own `pgboss` schema whose tables change every second
# (job rows, maintenance), so counting them would report a mismatch on a healthy
# dump. The dump still restores that schema (`--exit-on-error` proves it loads).
#
# Two roles are involved on purpose: the read-only backup role reads the
# source counts, and an admin role with CREATEDB creates and drops the
# throwaway database. Counts are compared exactly, so run the drill soon after a
# dump; rows written to the source in between show up as a mismatch rather than
# being tolerated silently.
#
# Plain POSIX sh on purpose: the image is Alpine, which ships no bash.
#
# Env (names only, values are credentials):
#   POSTGRES_DB, POSTGRES_BACKUP_USER, POSTGRES_BACKUP_PASSWORD     required
#   RESTORE_DRILL_ADMIN_USER, RESTORE_DRILL_ADMIN_PASSWORD         required
#   RESTORE_DRILL_ADMIN_DB   maintenance database to connect to (default postgres)
#   POSTGRES_HOST (default sab-postgres), POSTGRES_PORT (default 5432)
#   BACKUP_DIR (default /backups)
set -eu
umask 077

log() {
	printf 'restore-drill: %s\n' "$*"
}

die() {
	printf 'restore-drill: %s\n' "$*" >&2
	exit 1
}

for name in POSTGRES_DB POSTGRES_BACKUP_USER POSTGRES_BACKUP_PASSWORD RESTORE_DRILL_ADMIN_USER RESTORE_DRILL_ADMIN_PASSWORD; do
	eval "value=\${$name:-}"
	[ -n "$value" ] || die "$name is required"
done

case "$POSTGRES_DB" in
*[!A-Za-z0-9_]*) die "POSTGRES_DB may contain only letters, digits and underscores" ;;
esac

host="${POSTGRES_HOST:-sab-postgres}"
port="${POSTGRES_PORT:-5432}"
db="$POSTGRES_DB"
dir="${BACKUP_DIR:-/backups}"
admin_db="${RESTORE_DRILL_ADMIN_DB:-postgres}"
ts_glob='[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z'

if [ $# -gt 1 ]; then
	die "usage: restore-drill.sh [dump-file]"
fi

dump="${1:-}"
if [ -z "$dump" ]; then
	# Tags differ between files, so name order is not age order here; the
	# trailing timestamp is compared instead.
	newest_ts=""
	for f in "$dir/$db-"*"-"$ts_glob.dump; do
		[ -f "$f" ] || continue
		base="${f##*/}"
		rest="${base#"$db"-}"
		# Only files shaped like `<db>-<tag>-<ts>.dump` count; anything else
		# in the directory is not a backup of this database.
		tag_part="${rest%-*}"
		case "$tag_part" in
		'' | *[!a-z0-9-]*) continue ;;
		esac
		file_ts="${base%.dump}"
		file_ts="${file_ts##*-}"
		if [ -z "$newest_ts" ] || [ "$file_ts" \> "$newest_ts" ]; then
			newest_ts="$file_ts"
			dump="$f"
		fi
	done
	[ -n "$dump" ] || die "no dump found for $db in $dir"
fi
[ -f "$dump" ] || die "dump file not found: $dump"

drill_db="${db}_restore_drill_$(date -u +%Y%m%d%H%M%S)"
# Postgres truncates identifiers at 63 bytes, which would make the create and
# the drop address different names.
[ "${#drill_db}" -le 63 ] || die "throwaway database name exceeds 63 characters"

work="$(mktemp -d)"
created=0

# Each wrapper sets the credentials for one child process only.
admin_psql() {
	PGPASSWORD="$RESTORE_DRILL_ADMIN_PASSWORD" PGCONNECT_TIMEOUT=10 psql --no-psqlrc --no-password \
		--set ON_ERROR_STOP=1 --quiet \
		--host="$host" --port="$port" --username="$RESTORE_DRILL_ADMIN_USER" "$@"
}

source_psql() {
	PGPASSWORD="$POSTGRES_BACKUP_PASSWORD" PGCONNECT_TIMEOUT=10 psql --no-psqlrc --no-password \
		--set ON_ERROR_STOP=1 \
		--host="$host" --port="$port" --username="$POSTGRES_BACKUP_USER" --dbname="$db" "$@"
}

cleanup() {
	status=$?
	if [ "$created" = 1 ]; then
		if admin_psql --dbname="$admin_db" --command "DROP DATABASE IF EXISTS \"$drill_db\" WITH (FORCE)" >/dev/null; then
			log "dropped $drill_db"
		else
			printf 'restore-drill: could not drop %s; remove it by hand\n' "$drill_db" >&2
			[ "$status" -ne 0 ] || status=1
		fi
	fi
	rm -rf "$work"
	exit "$status"
}
trap cleanup EXIT
trap 'exit 1' INT TERM HUP

# One row per `public` table: `schema.table|count`. query_to_xml counts every
# table with a single statement, so the list cannot drift from the counted set.
COUNT_SQL="select format('%I.%I', schemaname, tablename) || '|' ||
	(xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', schemaname, tablename), false, true, '')))[1]::text
from pg_tables
where schemaname = 'public'
order by 1"

log "restoring $(basename "$dump") into $drill_db"
admin_psql --dbname="$admin_db" --command "CREATE DATABASE \"$drill_db\"" >/dev/null
created=1

# Ownership and grants refer to roles of the source cluster; the drill only
# needs the data and structure.
PGPASSWORD="$RESTORE_DRILL_ADMIN_PASSWORD" PGCONNECT_TIMEOUT=10 pg_restore \
	--no-password --no-owner --no-privileges --exit-on-error \
	--host="$host" --port="$port" --username="$RESTORE_DRILL_ADMIN_USER" --dbname="$drill_db" \
	"$dump" || die "pg_restore failed"

admin_psql --dbname="$drill_db" --tuples-only --no-align --command "$COUNT_SQL" >"$work/restored.txt"
source_psql --tuples-only --no-align --command "$COUNT_SQL" >"$work/source.txt"

# An empty list would compare equal to itself, and the migration history is
# the one table every real database has.
[ -s "$work/source.txt" ] || die "source database has no tables"
grep -q '^public\._prisma_migrations|' "$work/source.txt" || die "source database has no _prisma_migrations table"

if ! diff "$work/source.txt" "$work/restored.txt" >"$work/diff.txt"; then
	printf 'restore-drill: row counts differ (< source, > restored):\n' >&2
	cat "$work/diff.txt" >&2
	exit 1
fi

log "ok: $(wc -l <"$work/source.txt" | tr -d ' ') tables match"
