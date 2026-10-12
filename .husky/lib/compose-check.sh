#!/usr/bin/env bash

# Validates every compose file the way Coolify will parse it. They declare
# `env_file: .env`, which is gitignored and absent in a clean checkout, so the
# check runs on copies next to an empty .env with placeholder values; nothing
# real is read or printed.
compose_check() {
  local root tmp file
  root=$(git rev-parse --show-toplevel)
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' RETURN
  : >"$tmp/.env"
  for file in compose.yml coolify.compose.yml docker/test-db.compose.yml; do
    [[ -f "$root/$file" ]] || continue
    # Flattened: the copy sits next to the empty .env, not in a docker/ subtree.
    name=$(basename "$file")
    cp "$root/$file" "$tmp/$name"
    (cd "$tmp" && TOKENS=placeholder docker compose -f "$name" config -q)
    echo "  $file: valid"
  done
}
