# The build context is the repository root (the workspace lockfile lives there):
#   docker build -f apps/web/Dockerfile .
#
# Same Node base, pinned by digest, as the server image and the other apps on
# the deploy host, so its layers are already present there.
ARG NODE_IMAGE=node:24.21.0-alpine3.23@sha256:9ec4a2e289874ed0d722e1772ec2de45d2801541db8612f3638b26f128c69ac2

# ── install: the workspace dependencies the image build needs ────────────────
# @sab/shared imports Zod schemas that `prisma generate` writes into it, so the
# install also carries the server's manifest (Prisma and its Zod generator are
# its dev dependencies). None of that reaches the runner.
FROM ${NODE_IMAGE} AS install
# Must match `packageManager` in the root package.json.
RUN npm install -g pnpm@12.3.4
WORKDIR /app
# Manifests first, so a source edit does not invalidate the install layer. The
# root `prepare` script runs on every install and needs this one file; it does
# nothing in an image, where there is no `.husky/`.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY scripts/fix-hook-perms.mjs ./scripts/
COPY packages/shared/package.json ./packages/shared/
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/
# `--no-prod` and `--frozen-lockfile` are explicit: the deploy platform injects
# every environment variable (NODE_ENV included) as an ARG into every stage, so
# the install must not depend on what NODE_ENV happens to be here, and a build
# must never resolve versions the lockfile does not hold.
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
	pnpm install --frozen-lockfile --no-prod --filter @sab/web... --filter @sab/server...

# ── gen: generated Zod schemas, then the shared package, from a clean tree ───
# Generated files are gitignored and the ignore file keeps host copies out of the
# context, so nothing stale from a developer machine can reach the image.
FROM install AS gen
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
# prisma.config.ts imports the database-url helper from src.
COPY apps/server/prisma ./apps/server/prisma
COPY apps/server/prisma.config.ts ./apps/server/
COPY apps/server/scripts/fix-generated-esm.mjs ./apps/server/scripts/
COPY apps/server/src/config/database-url.ts ./apps/server/src/config/
# `prisma generate` never connects: the config falls back to an unresolvable
# URL for it, and for nothing else.
RUN pnpm --filter @sab/server run db:generate \
	&& pnpm --filter @sab/shared run build

# ── compile: the Next production bundle ──────────────────────────────────────
FROM gen AS compile
# `next build` typechecks every .ts under apps/web, vitest.config.mts included,
# and that file imports this root helper.
COPY vitest-workers.mjs ./
COPY apps/web ./apps/web
# The runner copies public/ (logo files); the mkdir keeps that COPY valid if the
# folder is ever emptied, since git does not track an empty directory.
RUN mkdir -p apps/web/public
ENV NEXT_TELEMETRY_DISABLED=1
# `next build` directly: the package's `prebuild` regenerates artifacts through
# root scripts this stage does not carry, and gen already produced them.
# The browser reaches the server through the `/api/*` rewrite, which Next bakes
# into the routes manifest at this point: no NEXT_PUBLIC_* value is needed, and
# the bundle names no API host.
RUN cd apps/web && pnpm exec next build

# ── runner ───────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3101
ENV HOSTNAME=0.0.0.0
# The traced server and its dependencies (the shared package included), laid out
# as in the workspace, so the entry point is apps/web/server.js.
COPY --from=compile --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=compile --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=compile --chown=node:node /app/apps/web/public ./apps/web/public
USER node
WORKDIR /app/apps/web
EXPOSE 3101
# /healthz answers without touching the Nest server, so a Nest restart does not
# take this container out of rotation with it.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --start-interval=3s --retries=3 \
	CMD wget -q -O /dev/null http://127.0.0.1:3101/healthz || exit 1
# node directly rather than through pnpm: SIGTERM from `docker stop` must reach
# the process.
CMD ["node", "server.js"]
