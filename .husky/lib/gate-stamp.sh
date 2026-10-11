#!/usr/bin/env bash

# Lets pre-push skip the three gates pre-commit already proved on the exact same
# bytes.
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
GATE_SET="v1:prettier+typecheck+eslint"

gate_stamp_file() {
  printf '%s/content-gate-stamp' "$(git rev-parse --git-dir)"
}

# Hash every file git considers part of the project (tracked + untracked but not
# ignored), by name AND content. Ignored paths are excluded on purpose: the
# generated trees (packages/shared/src/generated, packages/shared/dist) are derived from
# tracked inputs, and the hooks regenerate them before any gate runs.
gate_stamp_key() {
  local list
  list="$(mktemp)"
  git ls-files -c -o --exclude-standard -z |
    while IFS= read -r -d '' f; do
      if [[ -f "$f" ]]; then printf '%s\0' "$f"; fi
    done | LC_ALL=C sort -z -u > "$list"
  {
    printf '%s\n' "$GATE_SET"
    tr '\0' '\n' < "$list"
    xargs -0 -n 200 git hash-object -- < "$list"
  } | git hash-object --stdin
  rm -f "$list"
}

gate_stamp_write() {
  gate_stamp_key > "$(gate_stamp_file)"
}

# 0 when the recorded content matches the working tree exactly.
gate_stamp_is_current() {
  local f key
  f="$(gate_stamp_file)"
  [[ -f "$f" ]] || return 1
  key="$(gate_stamp_key)" || return 1
  [[ -n "$key" && "$(cat "$f")" == "$key" ]]
}

# The same argument, applied to the test suite — which is where the time
# actually is. Vitest reads the WORKING TREE exactly like the three gates above,
# so a full suite that just passed on this content cannot come out differently
# when re-run on the identical content one `git commit` later.
#
# Kept as a SEPARATE stamp rather than folded into GATE_SET, because the two are
# earned differently: pre-commit clears the three content gates on every
# commit, but only runs the FULL suite on the RUN_ALL_TESTS path; every other
# commit runs a narrow `vitest related`. Writing one combined stamp would let a
# narrow run license a skip of the full suite. So this stamp is written ONLY
# where the full suite actually ran, and any commit that did not run it simply
# leaves the stamp stale, which fails closed into running the suite.
SUITE_SET="v1:vitest-full-suite"

suite_stamp_file() {
  printf '%s/full-suite-stamp' "$(git rev-parse --git-dir)"
}

suite_stamp_key() {
  {
    printf '%s\n' "$SUITE_SET"
    gate_stamp_key
  } | git hash-object --stdin
}

suite_stamp_write() {
  suite_stamp_key > "$(suite_stamp_file)"
}

suite_stamp_is_current() {
  local f key
  f="$(suite_stamp_file)"
  [[ -f "$f" ]] || return 1
  key="$(suite_stamp_key)" || return 1
  [[ -n "$key" && "$(cat "$f")" == "$key" ]]
}
