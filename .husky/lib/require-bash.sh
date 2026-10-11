#!/usr/bin/env bash

# Sourced as the FIRST line of every hook, before any bash-4 syntax is parsed.
#
# Husky's wrapper (.husky/_/h) runs hooks with `sh -e`, which ignores the
# shebang. On macOS `sh` is bash 3.2 in POSIX mode: `mapfile` does not exist and
# process substitution is disabled, so the hooks would die with a syntax error
# at the first `mapfile ... < <(...)` — before a single check ran. SIP pins
# /bin/sh to that 3.2, so the interpreter has to be swapped from inside the
# script.
#
# Git Bash on Windows and Linux both start these hooks under bash >= 4 already,
# where this file returns immediately and changes nothing.
#
# Deliberately kept POSIX-parseable: bash 3.2 in sh mode must be able to READ
# it. Nothing below may use array subscripts, `local`, or process substitution.

# 4.4, not 4.0: the hooks use `mapfile -d`, which 4.4 introduced.
if [ -n "${BASH_VERSINFO+x}" ] && [ "${BASH_VERSINFO}" -ge 4 ]; then
  case "$BASH_VERSION" in
    4.[0-3].*) ;;
    *) return 0 ;;
  esac
fi

# Homebrew's paths are probed explicitly because a hook launched from a GUI
# client (an IDE) inherits a login PATH that often omits them, and the bare
# `bash` there resolves to the same 3.2 being escaped.
for _lb_cand in /opt/homebrew/bin/bash /usr/local/bin/bash bash; do
  _lb_bash=$(command -v "$_lb_cand" 2>/dev/null) || continue
  _lb_major=$("$_lb_bash" -c 'echo "${BASH_VERSINFO}"' 2>/dev/null) || continue
  case "$_lb_major" in
    '' | *[!0-9]*) continue ;;
  esac
  if [ "$_lb_major" -ge 4 ]; then
    exec "$_lb_bash" "$0" "$@"
  fi
done

echo "ERROR: git hooks require bash >= 4 (running ${BASH_VERSION:-an unknown shell})." >&2
echo "       macOS ships bash 3.2 and SIP pins /bin/sh to it. Install a modern bash:" >&2
echo "         brew install bash" >&2
exit 1
