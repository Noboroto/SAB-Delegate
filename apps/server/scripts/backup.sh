#!/bin/sh
# Logical backup of the application database: one script for the release job
# (`pre-migrate`), the daily job (`daily`) and manual runs (`baseline`,
# `pre-cutover`, `pre-rollback`, ...).
#
# Usage: backup.sh <tag>   or   backup.sh --tag <tag>
#
# Fail-closed: any failure exits non-zero and leaves no partial file. A dump is
# written to a hidden temp file in the destination directory, proven readable
# with `pg_restore --list`, and only then renamed into place (same directory, so
# the rename is atomic). A file named `*.dump` is therefore always a verified
# dump.
#
# Files are `<db>-<tag>-<UTC yyyymmddThhmmssZ>.dump`, mode 0600, in a 0700
# directory. Rotation keeps the newest N files that match exactly its own
# `<db>-<tag>-<timestamp>.dump` pattern (the fixed-width timestamp stops tag
# `pre` from matching `pre-migrate`) and runs only for `daily` and
# `pre-migrate`; every other tag is an archive point and is never rotated.
#
# Plain POSIX sh on purpose: the image is Alpine, which ships no bash.
#
# Env (names only, values are credentials):
#   POSTGRES_DB, POSTGRES_BACKUP_USER, POSTGRES_BACKUP_PASSWORD     required
#   POSTGRES_HOST (default sab-postgres), POSTGRES_PORT (default 5432)
#   BACKUP_ENABLED     false|0|no exits 0 without dumping (dev, local smoke)
#   BACKUP_DIR         default /backups
#   BACKUP_KEEP_DAILY (default 14), BACKUP_KEEP_PRE_MIGRATE (default 5)
set -eu
umask 077

log() {
	printf 'backup: %s\n' "$*"
}

die() {
	printf 'backup: %s\n' "$*" >&2
	exit 1
}

usage() {
	die "usage: backup.sh <tag> | --tag <tag>   (tag: lowercase letters, digits, hyphens)"
}

tag=""
while [ $# -gt 0 ]; do
	case "$1" in
	--tag)
		[ $# -ge 2 ] || usage
		tag="$2"
		shift 2
		;;
	--tag=*)
		tag="${1#--tag=}"
		shift
		;;
	-*) usage ;;
	*)
		[ -z "$tag" ] || usage
		tag="$1"
		shift
		;;
	esac
done

case "$tag" in
'' | -* | *- | *[!a-z0-9-]*) usage ;;
esac

case "$(printf '%s' "${BACKUP_ENABLED:-true}" | tr '[:upper:]' '[:lower:]')" in
false | 0 | no)
	log "BACKUP_ENABLED is off, nothing to do"
	exit 0
	;;
true | 1 | yes | '') ;;
*) die "BACKUP_ENABLED must be true or false" ;;
esac

for name in POSTGRES_DB POSTGRES_BACKUP_USER POSTGRES_BACKUP_PASSWORD; do
	eval "value=\${$name:-}"
	[ -n "$value" ] || die "$name is required"
done

# The database name becomes part of file names and of the rotation glob, so it
# must not carry glob or path characters.
case "$POSTGRES_DB" in
*[!A-Za-z0-9_]*) die "POSTGRES_DB may contain only letters, digits and underscores" ;;
esac

keep=""
case "$tag" in
daily) keep="${BACKUP_KEEP_DAILY:-14}" ;;
pre-migrate) keep="${BACKUP_KEEP_PRE_MIGRATE:-5}" ;;
esac
# A zero or garbage retention would delete every backup, so it is refused
# before anything is dumped.
if [ -n "$keep" ]; then
	case "$keep" in
	*[!0-9]* | 0 | 0[0-9]*) die "retention for tag $tag must be a positive integer" ;;
	esac
fi

dir="${BACKUP_DIR:-/backups}"
mkdir -p "$dir" || die "cannot create $dir"
chmod 700 "$dir" || die "cannot restrict $dir to 0700"

host="${POSTGRES_HOST:-sab-postgres}"
port="${POSTGRES_PORT:-5432}"
db="$POSTGRES_DB"
prefix="$db-$tag-"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
final="$dir/$prefix$stamp.dump"
tmp="$dir/.$prefix$stamp.partial"
work="$(mktemp -d)"

cleanup() {
	rm -f "$tmp"
	rm -rf "$work"
}
trap cleanup EXIT
trap 'exit 1' INT TERM HUP

# libpq error text never contains the password, but connection URLs and the
# literal secret are removed anyway because this output ends up in job logs.
scrub() {
	sed -E 's#[A-Za-z][A-Za-z0-9+.-]*://[^[:space:]]+#<url>#g' "$1" |
		SECRET="$POSTGRES_BACKUP_PASSWORD" awk '
			BEGIN { s = ENVIRON["SECRET"] }
			{
				while (s != "" && (i = index($0, s)) > 0) {
					$0 = substr($0, 1, i - 1) "***" substr($0, i + length(s))
				}
				print
			}' >&2
}

[ ! -e "$final" ] || die "$final already exists"

# Left behind only by a killed run; the age bound keeps a concurrent run's
# live temp file safe.
find "$dir" -maxdepth 1 -type f -name ".$prefix*.partial" -mmin +120 -exec rm -f {} + 2>/dev/null || true

log "dumping $db ($tag) from $host:$port"
if ! PGPASSWORD="$POSTGRES_BACKUP_PASSWORD" PGCONNECT_TIMEOUT=10 pg_dump \
	--format=custom --no-password --lock-wait-timeout=60s \
	--host="$host" --port="$port" --username="$POSTGRES_BACKUP_USER" --dbname="$db" \
	--file="$tmp" 2>"$work/err"; then
	scrub "$work/err"
	die "pg_dump failed"
fi

# A truncated or corrupt archive fails here, before it can replace or outlive a
# good one.
if ! pg_restore --list "$tmp" >/dev/null 2>"$work/err"; then
	scrub "$work/err"
	die "pg_restore --list rejected the dump"
fi
[ -s "$tmp" ] || die "dump is empty"

chmod 600 "$tmp" || die "cannot restrict the dump to 0600"
mv "$tmp" "$final" || die "cannot move the dump into place"
log "wrote $(basename "$final") ($(wc -c <"$final" | tr -d ' ') bytes)"

if [ -n "$keep" ]; then
	ts_glob='[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z'
	total=0
	for f in "$dir/$prefix"$ts_glob.dump; do
		if [ -f "$f" ] && [ ! -L "$f" ]; then
			total=$((total + 1))
		fi
	done
	drop=$((total - keep))
	if [ "$drop" -gt 0 ]; then
		# The glob expands in name order, and the fixed-width UTC timestamp
		# makes name order age order, so the first entries are the oldest.
		for f in "$dir/$prefix"$ts_glob.dump; do
			[ "$drop" -gt 0 ] || break
			if [ -f "$f" ] && [ ! -L "$f" ]; then
				rm -f "$f" || die "cannot remove old backup $(basename "$f")"
				log "rotated out $(basename "$f")"
				drop=$((drop - 1))
			fi
		done
	fi
fi
