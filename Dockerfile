# Builder stage: compile native addons and prune devDependencies
FROM node:24-slim AS builder

WORKDIR /app

# node-gyp dependencies required by @rafaelkallis/fasttext native addon
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY src/ src/
COPY views/ views/

# Strip devDependencies in-place
RUN npm prune --omit=dev

# Production stage
FROM node:24-slim

WORKDIR /app

# Copy only what the app needs at runtime
COPY --from=builder /app/node_modules node_modules/
COPY --from=builder /app/src src/
COPY --from=builder /app/views views/
COPY package.json ./

# Run as the built-in unprivileged node user
USER node

EXPOSE 3000

# Use node directly so SIGTERM reaches the process for graceful shutdown
CMD ["node", "src/index.js"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 3000) + '/status', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

