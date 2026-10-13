#!/usr/bin/env bash

# Lets pre-push skip the workspace gates (prettier, typecheck, eslint) pre-commit
# already proved on the exact same bytes. The legacy root/ gates are never
# skipped by it: they run whenever root/ is part of the change.
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
GATE_SET="v2:prettier+typecheck+eslint"

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

# The key is read once before the first gate (gate_stamp_begin) and once more
# when the stamp is written. A gate runs minutes against the live worktree, so a
# file edited meanwhile would otherwise get a stamp for bytes no gate ever saw.
# A stamp is written only when both readings agree.
GATE_STAMP_BEFORE=""

# Call after anything that rewrites files on purpose (prettier --write) and
# before the first gate, so the formatter's own edits are not mistaken for
# concurrent ones.
gate_stamp_begin() {
  GATE_STAMP_BEFORE="$(gate_stamp_key)"
}

# Echoes the key to record, or nothing when the tree moved (or no begin call).
gate_stamp_stable_key() {
  local after
  after="$(gate_stamp_key)"
  if [[ -z "$GATE_STAMP_BEFORE" || "$after" != "$GATE_STAMP_BEFORE" ]]; then
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
SUITE_SET="v2:vitest-full-suite"

suite_stamp_file() {
  printf '%s/full-suite-stamp' "$(git rev-parse --git-dir)"
}

# Takes the content key as an optional argument so a write can bind the stamp to
# the already-verified (unchanged) reading instead of hashing the tree again.
suite_stamp_key() {
  local content_key="${1:-}"
  if [[ -z "$content_key" ]]; then
    content_key="$(gate_stamp_key)"
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
  key="$(suite_stamp_key)" || return 1
  [[ -n "$key" && "$(cat "$f")" == "$key" ]]
}
