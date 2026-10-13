# Coolify host: base images and build cache (measured 2026-10-13, read-only via the Coolify session)

- One shared BuildKit builder (`default`, docker driver, BuildKit v0.33.1): layer cache is shared across apps by digest, but FROM images live in BuildKit's content store, so `docker image ls` does not show `node:*` bases.
- Coolify runs docker cleanup daily at 00:00 Asia/Saigon with `force_docker_cleanup=true` (prunes on schedule regardless of the 80% threshold). Build cache after prune ~2 GB. Consequence: cross-day cache does not exist; a build is fast only if another build pulled the same base digest earlier the same day. Do not design around warm cache.
- Node base: SAB-Store uses exactly our pin `node:24.21.0-alpine3.23@sha256:9ec4a2e2…` (same digest -> shared layers). Other apps run node 24.15–24.18.
- Postgres on host: mailmerge `postgres:18-alpine@sha256:77f58511…` (18.6, only PG18 from registry); sabstore/spm/psyus `postgres:17-alpine`; coolify-db `postgres:15-alpine`. Nobody uses Debian `postgres:18.6`.
- Decision: keep Debian `postgres:18.6` (pinned digest) for SAB instead of sharing mailmerge's alpine layers. Reason: alpine Postgres uses musl locales, and the schema relies on `lower()` for Vietnamese words (WordGameUsedWord CHECK) and future case-insensitive search; glibc collation/case mapping is the safer default and switching collation later requires a reindex/dump. Layer sharing gain is small (pulled once, a few hundred MB) and erased by the daily prune.
- Disk `/` 96G, 38G free (61%) on 2026-10-13 (was 81% used at the 2026-10-12 spike — re-check `df -h /` before W6 build).
- Process: before pinning a base image, ask the Coolify session for the host inventory (owner rule 2026-10-13).
