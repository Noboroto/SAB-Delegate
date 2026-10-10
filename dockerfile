# Same pinned base as QR-Production-Manager: its layers are already on the
# Coolify host, so only the app layers are new on each deploy.
ARG NODE_IMAGE=node:24.21.0-alpine3.23@sha256:9ec4a2e289874ed0d722e1772ec2de45d2801541db8612f3638b26f128c69ac2

# Build stage
FROM ${NODE_IMAGE} AS builder
WORKDIR /usr/src/bot

# better-sqlite3 13 ships no prebuilt binaries and compiles on install. The node
# image already carries its headers, so node-gyp must not download them.
RUN apk add --no-cache python3 make g++ && npm install -g pnpm@12.3.4
ENV npm_config_nodedir=/usr/local

# Copy manifest + lockfile first for better caching
COPY ./root/package.json ./root/pnpm-lock.yaml ./root/pnpm-workspace.yaml ./

# Install exactly the locked versions. Without a committed lockfile every build
# resolved the newest releases, and one transitive package broke the node version.
RUN pnpm install --frozen-lockfile --prod

# Production stage
FROM ${NODE_IMAGE}
WORKDIR /usr/src/bot

COPY --from=builder /usr/src/bot/node_modules ./node_modules
COPY ./root .

# Runs as root on purpose: the sqlite files live on a host bind mount owned by root.
# No recursive chmod: it would duplicate every file into a second layer.
ENV NODE_ENV=production

CMD ["node", "--import", "tsx", "./src/index.ts"]
