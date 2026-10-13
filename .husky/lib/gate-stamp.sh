#!/usr/bin/env bash

# Lets pre-push skip the workspace gates (prettier, typecheck, eslint, knip, the
# suite) pre-commit already proved on the exact same bytes. The legacy root/
# gates are never skipped by it: they run whenever root/ is part of the change.
#
# Why this is not a weakened gate: prettier, tsc and eslint all read the WORKING
# TREE from disk, not git history. A commit that changes HEAD but not one byte
# of what those three tools read would otherwise pay their full cost again on
# push for a verdict that cannot have changed. The stamp records the content
# the gates passed on; pre-push skips them only when the content is
# byte-identical.
#
# The key is therefore a pure function of worktree CONTENT, deliberately not of
# HEAD or the index: keying on HEAD would break at the moment of commit, which
# is exactly the transition this is meant to bridge.
#
# Failure mode is one-directional by construction. Anything the key does not
# model — a file appearing, vanishing, or changing by a byte — produces a
# different key and re-runs everything. Over-invalidating costs time; it cannot
# let an unchecked change through.
#
# GATE_SET is part of the stamp so that editing which checks the hooks run
# invalidates every existing stamp. Bump it whenever the covered steps change.
GATE_SET="v3:prettier+typecheck+eslint+knip+vitest"

gate_stamp_file() {
  printf '%s/content-gate-stamp' "$(git rev-parse --git-dir)"
}

# Hash every file git considers part of the project (tracked + untracked but not
# ignored), by name AND content. Ignored paths are excluded on purpose: the
# generated trees (packages/shared/src/generated, packages/shared/dist) are derived from
# tracked inputs, and the hooks regenerate them before any gate runs.
gate_stamp_key() {
  local list rc=0
  list="$(mktemp)" || return 1
  # `if` rather than `[[ ... ]] && printf`: under `set -e` + pipefail a loop
  # whose LAST iteration skips a file would exit 1 and fail the hook spuriously.
  # `sort -z` is load-bearing: `git ls-files -c -o` emits cached and untracked
  # paths in different positions, so `git add` of a new file would reorder the
  # list and change the key with not one byte changed on disk. LC_ALL=C keeps
  # the order independent of the developer's locale.
  git ls-files -c -o --exclude-standard -z |
    while IFS= read -r -d '' f; do
      if [[ -f "$f" ]]; then printf '%s\0' "$f"; fi
    done | LC_ALL=C sort -z -u >"$list" || rc=$?
  {
    printf '%s\n' "$GATE_SET"
    tr '\0' '\n' <"$list"
    # stdin redirection, not `xargs -a`: that flag is a GNU extension and BSD
    # xargs on macOS rejects it.
    xargs -0 -n 200 git hash-object -- <"$list"
  } | git hash-object --stdin || rc=$?
  # A pipeline that half-died (truncated file list, failed hash) still prints a
  # plausible hash computed over fewer inputs; the status must survive `rm` so
  # callers refuse the key instead of stamping it.
  rm -f "$list"
  return "$rc"
}

# A stamp vouches for the WORKTREE, but a push sends COMMITS; the two are the
# same bytes only when nothing is left uncommitted. With `git add -p` the gates
# can pass on a tree whose unstaged hunk fixes the staged one, and the commit
# then carries only the broken half. So a stamp is written only when the
# worktree equals the index, and honoured only when it equals HEAD.
# Output is captured before testing it: a failing `git` (index lock,
# corruption) prints nothing, and an inline `[[ -z "$(...)" ]]` would read that
# as a clean tree.
worktree_matches_index() {
  local untracked
  git diff --quiet || return 1
  untracked="$(git ls-files -o --exclude-standard)" || return 1
  [[ -z "$untracked" ]]
}

worktree_matches_head() {
  local status
  status="$(git status --porcelain --untracked-files=all)" || return 1
  [[ -z "$status" ]]
}

# The key is read once before the first gate (gate_stamp_begin) and once more
# when the stamp is written. A gate runs minutes against the live worktree, so a
# file edited meanwhile would otherwise get a stamp for bytes no gate ever saw.
# A stamp is written only when both readings agree.
GATE_STAMP_BEFORE=""

# Call after anything that rewrites files on purpose (prettier --write) and
# before the first gate, so the formatter's own edits are not mistaken for
# concurrent ones.
gate_stamp_begin() {
  GATE_STAMP_BEFORE="$(gate_stamp_key)" || GATE_STAMP_BEFORE=""
}

# Echoes the key to record, or nothing when the tree moved (or no begin call).
gate_stamp_stable_key() {
  local after
  # A key that cannot be computed costs the stamp, never the commit or push.
  after="$(gate_stamp_key)" || after=""
  if ! worktree_matches_index; then
    echo "⚠ working tree differs from the index; no stamp recorded (the next push re-runs the gates)" >&2
    return 0
  fi
  if [[ -z "$GATE_STAMP_BEFORE" || -z "$after" || "$after" != "$GATE_STAMP_BEFORE" ]]; then
    echo "⚠ working tree changed while the gates ran; no stamp recorded (the next push re-runs them)" >&2
    return 0
  fi
  printf '%s\n' "$after"
}

# Call only after EVERY gate the stamp vouches for has passed.
gate_stamp_write() {
  local key
  key="$(gate_stamp_stable_key)"
  if [[ -n "$key" ]]; then
    printf '%s\n' "$key" > "$(gate_stamp_file)"
  fi
}

# 0 when the recorded content matches the working tree exactly.
gate_stamp_is_current() {
  local f key
  f="$(gate_stamp_file)"
  [[ -f "$f" ]] || return 1
  worktree_matches_head || return 1
  # Captured, not inlined into the comparison: inside `$( )` the producer's exit
  # status is discarded. Empty is rejected too: an interrupted write can leave a
  # 0-byte stamp, and "" == "" would read as a match.
  key="$(gate_stamp_key)" || return 1
  [[ -n "$key" && "$(cat "$f")" == "$key" ]]
}

# The same argument, applied to the test suite - which is where the time
# actually is. Vitest reads the WORKING TREE exactly like the gates above, so a
# full suite that just passed on this content cannot come out differently when
# re-run on the identical content one `git commit` later.
#
# Kept as a SEPARATE stamp rather than folded into GATE_SET, because it is
# earned separately: it is written ONLY right after the full suite passed. A
# path that ran something narrower (or nothing) leaves it stale, which fails
# closed into running the suite, instead of letting a narrow run license a skip
# of the full one.
SUITE_SET="v3:vitest-full-suite"

suite_stamp_file() {
  printf '%s/full-suite-stamp' "$(git rev-parse --git-dir)"
}

# Takes the content key as an optional argument so a write can bind the stamp to
# the already-verified (unchanged) reading instead of hashing the tree again.
suite_stamp_key() {
  local content_key="${1:-}"
  if [[ -z "$content_key" ]]; then
    content_key="$(gate_stamp_key)" || return 1
    [[ -n "$content_key" ]] || return 1
  fi
  {
    printf '%s\n' "$SUITE_SET"
    printf '%s\n' "$content_key"
  } | git hash-object --stdin
}

suite_stamp_write() {
  local key
  key="$(gate_stamp_stable_key)"
  if [[ -n "$key" ]]; then
    suite_stamp_key "$key" > "$(suite_stamp_file)"
  fi
}

suite_stamp_is_current() {
  local f key
  f="$(suite_stamp_file)"
  [[ -f "$f" ]] || return 1
  worktree_matches_head || return 1
  key="$(suite_stamp_key)" || return 1
  [[ -n "$key" && "$(cat "$f")" == "$key" ]]
}
