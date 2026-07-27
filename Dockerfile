# Zomboid Control Panel - Docker
# Multi-stage build: build client in stage 1, lean runtime in stage 2.
#
# Runtime base is Debian slim, NOT Alpine — the panel's Server Setup wizard
# (/server-setup) downloads Valve's steamcmd_linux.tar.gz and runs
# steamcmd.sh directly (see server/routes/server.js's /steamcmd/download and
# /steamcmd/* routes) to self-install Project Zomboid. steamcmd.sh needs
# bash + glibc + 32-bit compat libs — Alpine's musl libc breaks steamcmd's
# prebuilt binaries, which is also why upstream's own all-in-one Dockerfile
# (docker/all-in-one/Dockerfile) is Debian-based instead of Alpine. On
# CentOS/RHEL hosts with SELinux, use `:z` on bind-mount volumes (already
# set in docker-compose.yml).
#
# This image runs the *panel*; Project Zomboid can either be installed by
# the panel itself (via /server-setup, into a bind-mounted PZ_SERVER_PATH)
# or already exist on the host/another container — see docker-compose.yml
# for realistic topology examples.

# --- Build stage --- (Alpine is fine here: just builds static client assets)
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
FROM node:22-bookworm-slim

# steamcmd + serverManager.js runtime deps:
#   bash                    steamcmd.sh's shebang requires it (missing bash
#                            is exactly what causes "env: can't execute
#                            'bash': No such file or directory", exit 127)
#   curl, wget               download steamcmd_linux.tar.gz (curl first,
#                            wget fallback — see /steamcmd/download route)
#   ca-certificates          TLS for the download above
#   lib32gcc-s1, lib32stdc++6  steamcmd's binary is 32-bit, needs these on
#                            a 64-bit Debian host
#   procps                   pgrep/ps — serverManager.js process detection
#                            (Alpine's busybox bundles these; Debian slim
#                            does not, so it's an explicit install here)
# tar is already part of Debian's base image, no separate install needed.
RUN apt-get update && apt-get install -y --no-install-recommends \
        bash curl wget ca-certificates lib32gcc-s1 lib32stdc++6 procps \
    && rm -rf /var/lib/apt/lists/*

# Configurable UID/GID to match the host user — avoids bind-mount permission issues.
# Override at build time:
#   docker compose build --build-arg UID=$(id -u) --build-arg GID=$(id -g)
# node:22-bookworm-slim already ships a `node` user at 1000:1000, so the
# default UID/GID just reuses it. Only numeric ids matter below (chown/USER
# use ${UID}:${GID} directly), so we don't bother renaming existing accounts.
ARG UID=1000
ARG GID=1000
RUN set -eux; \
    if getent group "$GID" >/dev/null 2>&1; then \
        groupname=$(getent group "$GID" | cut -d: -f1); \
    else \
        groupadd -g "$GID" panel; \
        groupname="panel"; \
    fi; \
    if getent passwd "$UID" >/dev/null 2>&1; then \
        : already exists, reuse it; \
    else \
        useradd -u "$UID" -g "$groupname" -M -s /usr/sbin/nologin panel; \
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
