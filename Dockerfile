# Zomboid Control Panel - Docker
# Multi-stage build: build client in stage 1, lean runtime in stage 2

# --- Build stage ---
FROM node:18-alpine AS builder

WORKDIR /app

# Install client dependencies (includes devDeps for build tooling)
COPY client/package.json client/package-lock.json* ./client/
RUN cd client && npm ci

# Copy client source and build
COPY client/ ./client/
RUN cd client && npm run build

# --- Runtime stage ---
FROM node:18-alpine

# Configurable UID/GID to match the host user — avoids bind-mount permission issues
ARG UID=1000
ARG GID=1000
RUN addgroup -g $GID -S panel && adduser -u $UID -S panel -G panel

WORKDIR /app

# Install server dependencies only (no devDeps)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy server source
COPY server/ ./server/

# Copy built client from builder stage
COPY --from=builder /app/client/dist ./client/dist

# Copy PanelBridge mod so users can extract it (docker cp)
COPY pz-mod/ ./pz-mod/

# Create runtime directories owned by panel user
RUN mkdir -p data logs && chown -R panel:panel /app

USER panel

EXPOSE 3001

ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "import('http').then(h => h.get('http://localhost:3001/api/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1)))"

CMD ["node", "server/index.js"]
