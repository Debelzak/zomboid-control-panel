# Zomboid Control Panel - Docker
# Multi-stage build: build client in stage 1, lean runtime in stage 2.
#
# Default base is Alpine (smallest image). On CentOS/RHEL hosts with SELinux,
# use `:z` on bind-mount volumes (already set in docker-compose.yml).
#
# IMPORTANT: This image runs the *panel*, not the Project Zomboid server.
# PZ runs separately (on the host or in another container). See docker-compose.yml
# for realistic topology examples.

# --- Build stage ---
FROM node:22-alpine AS builder

WORKDIR /app

# Install client dependencies (includes devDeps for build tooling).
# We use `npm install` rather than `npm ci` because esbuild/@emnapi ship
# OS-specific optional binaries; a Windows-generated lockfile won't contain
# the linux/amd64 + linux/arm64 entries that `npm ci` requires.
COPY client/package.json client/package-lock.json* ./client/
RUN cd client && npm install --no-audit --prefer-offline --include=optional

# Copy client source and build.
# The root package.json is needed because vite.config.ts reads the panel version from it.
COPY package.json ./
COPY client/ ./client/
RUN cd client && npm run build

# --- Runtime stage ---
FROM node:22-alpine

# Configurable UID/GID to match the host user — avoids bind-mount permission issues.
# Override at build time:
#   docker compose build --build-arg UID=$(id -u) --build-arg GID=$(id -g)
# node:20-alpine already ships with a `node` user at 1000:1000, so we reuse that
# user (just renamed/aliased) when the requested IDs are already taken.
ARG UID=1000
ARG GID=1000
RUN set -eux; \
    if getent group "$GID" >/dev/null 2>&1; then \
        existing_group=$(getent group "$GID" | cut -d: -f1); \
        [ "$existing_group" = "panel" ] || addgroup panel "$existing_group" 2>/dev/null || true; \
        groupname="$existing_group"; \
    else \
        addgroup -g "$GID" -S panel; \
        groupname="panel"; \
    fi; \
    if getent passwd "$UID" >/dev/null 2>&1; then \
        existing_user=$(getent passwd "$UID" | cut -d: -f1); \
        [ "$existing_user" = "panel" ] || ln -sf "/home/$existing_user" /home/panel 2>/dev/null || true; \
    else \
        adduser -u "$UID" -S panel -G "$groupname"; \
    fi

WORKDIR /app

# Install server dependencies only (no devDeps).
# Same reasoning as the client: cross-platform optional deps make `npm ci` fragile.
COPY package.json package-lock.json* ./
RUN npm install --no-audit --prefer-offline --omit=dev

# Copy server source
COPY server/ ./server/

# Copy built client from builder stage
COPY --from=builder /app/client/dist ./client/dist

# Copy PanelBridge mod so users can extract it (docker cp)
COPY pz-mod/ ./pz-mod/

# Create runtime directories owned by the panel user (numeric IDs survive
# the case where we're reusing the base image's existing user).
RUN mkdir -p data logs && chown -R ${UID}:${GID} /app

USER ${UID}:${GID}

EXPOSE 3001

ENV NODE_ENV=production

# Healthcheck hits the unauthenticated /api/health endpoint.
# start_period is generous because first-run DB init + JWT secret generation can be slow on cold disks.
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
    CMD node -e "import('http').then(h => h.get('http://localhost:3001/api/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1)))"

CMD ["node", "server/index.js"]
