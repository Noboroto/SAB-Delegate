# The build context is the repository root (the workspace lockfile lives there):
#   docker build -f apps/server/Dockerfile .
#
# Base image pinned by digest, the same one the legacy bot image and the other
# apps on the deploy host use, so its layers are already present there.
ARG NODE_IMAGE=node:24.21.0-alpine3.23@sha256:9ec4a2e289874ed0d722e1772ec2de45d2801541db8612f3638b26f128c69ac2

# ── shared-build: compile the @sab/shared workspace package ──────────────────
FROM ${NODE_IMAGE} AS shared-build
# Must match `packageManager` in the root package.json.
RUN npm install -g pnpm@12.3.4
WORKDIR /app
# Manifests first, so a source edit does not invalidate the install layer. The
# root `prepare` script runs on every install and needs this one file; it does
# nothing in an image, where there is no `.husky/`.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY scripts/fix-hook-perms.mjs ./scripts/
COPY packages/shared/package.json ./packages/shared/
# `--no-prod` and `--frozen-lockfile` are explicit: the deploy platform
# injects every environment variable (NODE_ENV included) as an ARG into every
# stage, so the install must not depend on what NODE_ENV happens to be here, and
# a build must never resolve versions the lockfile does not hold.
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
	pnpm install --frozen-lockfile --no-prod --filter @sab/shared...
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
RUN pnpm --filter @sab/shared run build

# ── gen: Prisma client and generated Zod schemas, from a clean tree ──────────
# Generated files are gitignored and the ignore file keeps host copies out of the
# context, so nothing stale from a developer machine can reach the image. The
# Zod schemas land inside @sab/shared, which is then compiled once more.
FROM shared-build AS gen
COPY apps/server/package.json ./apps/server/
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
	pnpm install --frozen-lockfile --no-prod --filter @sab/server...
# prisma.config.ts imports the database-url helper from src.
COPY apps/server/prisma ./apps/server/prisma
COPY apps/server/prisma.config.ts ./apps/server/
COPY apps/server/scripts/fix-generated-esm.mjs ./apps/server/scripts/
COPY apps/server/src/config/database-url.ts ./apps/server/src/config/
# `prisma generate` never connects: the config falls back to an unresolvable
# URL for it, and for nothing else.
RUN pnpm --filter @sab/server run db:generate \
	&& pnpm --filter @sab/shared run build

# ── release: one-shot migration job (never serves traffic) ───────────────────
# Kept ahead of `runner` on purpose: a build without --target builds the LAST
# stage, and that must stay the runtime image.
# Runs as root: it will write dumps to a host bind mount whose ownership the
# host decides, and unlike the runner it is short-lived with no listener.
FROM gen AS release
# pg_dump refuses to dump a server newer than itself; keep this on the same
# major as the postgres image the stack runs.
RUN apk add --no-cache postgresql18-client
WORKDIR /app/apps/server
COPY apps/server/scripts/release.sh ./scripts/release.sh
ENTRYPOINT ["/bin/sh", "/app/apps/server/scripts/release.sh"]

# ── deploy: compiled server plus its production dependencies only ────────────
# Starts from gen so the workspace holds @sab/shared with its generated schemas
# compiled in.
FROM gen AS deploy
COPY apps/server/tsconfig.json apps/server/tsconfig.build.json apps/server/nest-cli.json ./apps/server/
COPY apps/server/src ./apps/server/src
# `nest build` directly: the package's `prebuild` regenerates artifacts through
# root scripts this stage does not carry, and gen already produced them.
RUN cd apps/server && pnpm exec nest build
# `pnpm deploy`, not `pnpm install` + `pnpm prune --prod`: prune does not support
# a workspace and silently drops packages that only one member uses. `--prod` is
# explicit for the same reason as above. `inject-workspace-packages` copies
# @sab/shared's `files` (its dist) into the result instead of symlinking the
# workspace, and is passed to this one command rather than set for every install.
# No `--legacy`: it re-resolves peer dependencies.
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
	CI=true pnpm --filter @sab/server --config.inject-workspace-packages=true \
	deploy --prod /out/server

# ── runner ───────────────────────────────────────────────────────────────────
# The server does not load the Prisma client yet. `pnpm deploy` reinstalls the
# packages, which discards a client generated into their directory, so the first
# code that imports it must copy a client generated outside node_modules (or
# generate one here) before this image can start it.
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deploy --chown=node:node /out/server/ ./
USER node
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
	CMD wget -q -O /dev/null http://127.0.0.1:3100/health || exit 1
# node directly rather than through pnpm: SIGTERM from `docker stop` must reach
# the process that runs the shutdown hooks.
CMD ["node", "dist/main.js"]
