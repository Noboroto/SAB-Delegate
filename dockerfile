# Build stage
FROM node:18-alpine3.20 AS builder
WORKDIR /usr/src/bot

# Copy package files first for better caching
COPY ./root/package.json ./

# Install dependencies
RUN yarn install --production=false --network-timeout 100000

# Build if needed (uncomment if you have a build step)
# RUN yarn build

# Production stage
FROM node:18-alpine3.20
WORKDIR /usr/src/bot

# Add non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copy only production dependencies and built files
COPY --from=builder /usr/src/bot/node_modules ./node_modules
COPY ./root .
COPY --from=builder /usr/src/bot/package.json ./

# Set production environment
ENV NODE_ENV=production
RUN chmod -R 777 /usr/src/bot

# Start the application
CMD ["yarn", "start"]