# Build stage
FROM node:18-alpine3.20 AS builder
WORKDIR /usr/src/bot

# Copy package files first for better caching
COPY ./root/package.json ./root/yarn.lock ./

# Install dependencies
RUN yarn install --frozen-lockfile --production=false --network-timeout 100000

# Copy source code
COPY ./root ./

# Build if needed (uncomment if you have a build step)
# RUN yarn build

# Production stage
FROM node:18-alpine3.20
WORKDIR /usr/src/bot

# Add non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copy only production dependencies and built files
COPY --from=builder /usr/src/bot/node_modules ./node_modules
COPY --from=builder /usr/src/bot/dist ./dist
COPY --from=builder /usr/src/bot/package.json ./

# Set production environment
ENV NODE_ENV=production

# Use non-root user
USER appuser

# Start the application
CMD ["yarn", "start"]