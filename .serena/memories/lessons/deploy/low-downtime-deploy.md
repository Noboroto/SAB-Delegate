# Low-downtime deploy for SAB (learned from JudgeHub + SAB measurements, 2026-10-13)

JudgeHub deploys by hand (`docker compose` over SSH); Coolify instead recreates the whole stack per deploy (~60 s measured on SAB-Store). A Discord token allows one gateway login per bot, so blue-green/overlap is impossible: aim for a short, predictable stop -> `Ready` window, not zero downtime.

Rules:
- Build before stop: the image builds while the old container still runs; only the swap interrupts. Never stop the bot by hand before pushing.
- Build sequentially (JudgeHub: building api+web together OOM-killed systemd, 2026-08-28). `df -h /` first; >85% -> only `image prune -f` + `builder prune --filter until=24h` (JudgeHub disk hit 98% and a build failed, 2026-10-01).
- Avoid 23:30–00:30 ICT: Coolify force-prunes images/build cache at 00:00 (`mem:lessons/deploy/coolify-host-images-and-build-cache`).
- Release/migrate one-shot: `depends_on` as a MAP with `condition: service_completed_successfully` (list form does not wait); dump before migrate, failed dump is fatal. JudgeHub lost prod on 2026-07-17 to a stale migrate image ("No pending migrations") and to `run` without `--no-deps` recreating Postgres.
- Migration order by type: additive -> migrate then swap; drop/narrow -> swap first, contract in a later deploy, so old code survives the new schema during the swap.
- Health: readiness (DB + Discord ready, or migration-pending) drives the image HEALTHCHECK/compose healthcheck with `start_period` + `start_interval`; liveness separate. Never report healthy before the bot logs in.
- `stop_grace_period` > pg-boss drain (45 s vs 30 s), exec-form CMD, `restart: unless-stopped` (not `always`).
- Mount directories, not single files (git pull keeps the old inode; JudgeHub nginx served a stale config).
- Measure during rehearsal: 1 req/s probe on `/health` + bot online status; record stop -> Ready seconds.
- Docs-only pushes use `[skip cd]` so the bot is not bounced.
- After push: deployment created within 10 s, 0 restarts, `Ready! Logged in as …`, `_prisma_migrations` count right; keep the previous deployment id/tag for rollback.
