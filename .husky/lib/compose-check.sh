#!/usr/bin/env bash

# Validates every compose file the way Coolify will parse it, on copies in a
# scratch directory with a placeholder for every variable the files reference;
# nothing real is read, and `config -q` prints nothing. Relative build contexts
# and mounts are not resolved by `config`, so flattening the files is harmless.
compose_check() {
  local root tmp file name var
  root=$(git rev-parse --show-toplevel)
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' RETURN
  local files=(compose.yml coolify.compose.yml deploy/postgres.compose.yml deploy/local-smoke.compose.yml docker/test-db.compose.yml)

  : >"$tmp/.env"
  for file in "${files[@]}"; do
    [[ -f "$root/$file" ]] || continue
    # Names only: `${NAME}`, `${NAME:-default}`.
    grep -oE '\$\{[A-Z][A-Z0-9_]*' "$root/$file" | sed 's/^\${//' || true
  done | sort -u | while read -r var; do
    printf '%s=placeholder\n' "$var"
  done >"$tmp/.env"

  for file in "${files[@]}"; do
    [[ -f "$root/$file" ]] || continue
    name=$(basename "$file")
    cp "$root/$file" "$tmp/$name"
    (cd "$tmp" && docker compose -f "$name" config -q)
    echo "  $file: valid"
  done
}
