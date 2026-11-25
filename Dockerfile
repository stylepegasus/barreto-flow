# ==============================================================================
# Stage 1: Build (Vite production bundle)
# ==============================================================================
FROM node:22-slim AS builder

WORKDIR /app

# Install all dependencies deterministically (supports package-lock.json when present)
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then \
      npm ci --no-audit --no-fund; \
    else \
      npm install --no-audit --no-fund; \
    fi

# Copy application source (filtered by .dockerignore) and build static assets into dist/
COPY . .
RUN npm run build

# ==============================================================================
# Stage 2: Production runtime dependencies only
# ==============================================================================
FROM node:22-slim AS prod-deps

WORKDIR /app

COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then \
      npm ci --omit=dev --no-audit --no-fund; \
    else \
      npm install --omit=dev --no-audit --no-fund; \
    fi && npm cache clean --force

# ==============================================================================
# Stage 3: Minimal Cloud Run production runtime (Node.js 22 native ESM + TS)
# ==============================================================================
FROM node:22-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

# Copy production dependencies and required runtime artifacts only
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/firebase-applet-config.json ./firebase-applet-config.json
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/server.ts ./server.ts
COPY --from=builder --chown=node:node /app/src/utils ./src/utils
COPY --from=builder --chown=node:node /app/src/services ./src/services
COPY --from=builder --chown=node:node /app/src/types ./src/types

USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.ts"]
