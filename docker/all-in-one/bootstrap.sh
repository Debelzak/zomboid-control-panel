#!/bin/sh
set -eu

VERSION="${1:-1.0.75}"
BUILD_ROOT="${BUILD_ROOT:-/mnt/cache/appdata/zomboid-panel/build}"
CONTEXT_DIR="$BUILD_ROOT/ctx"
SOURCE_DIR="$BUILD_ROOT/source"
REPOSITORY="fpsacha/zomboid-control-panel"

mkdir -p "$CONTEXT_DIR"

if [ ! -f "$CONTEXT_DIR/.env" ]; then
  TOKEN="$(head -c 32 /dev/urandom | base64 | tr -d '\n')"
  cat > "$CONTEXT_DIR/.env" <<EOF
CORS_ORIGINS=http://zomboid.tower
PANEL_DOCKER_UPDATER_TOKEN=$TOKEN
EOF
  chmod 600 "$CONTEXT_DIR/.env"
  echo "Created $CONTEXT_DIR/.env. Update CORS_ORIGINS before exposing the panel elsewhere."
fi

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

curl --fail --location --silent --show-error \
  "https://github.com/$REPOSITORY/archive/refs/tags/v$VERSION.tar.gz" \
  -o "$WORK_DIR/release.tar.gz"
mkdir -p "$WORK_DIR/extract"
tar -xzf "$WORK_DIR/release.tar.gz" -C "$WORK_DIR/extract"
EXTRACTED_SOURCE="$(find "$WORK_DIR/extract" -mindepth 1 -maxdepth 1 -type d -print -quit)"
test -n "$EXTRACTED_SOURCE"
test -f "$EXTRACTED_SOURCE/docker/all-in-one/Dockerfile"

rm -rf "$SOURCE_DIR"
mv "$EXTRACTED_SOURCE" "$SOURCE_DIR"
cp "$SOURCE_DIR/docker/all-in-one/docker-compose.yml" "$CONTEXT_DIR/docker-compose.yml"

docker build \
  -t zomboid-panel-updater:latest \
  -f "$SOURCE_DIR/docker/all-in-one/updater/Dockerfile" \
  "$SOURCE_DIR"

docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$BUILD_ROOT:/build" \
  -w /build/ctx \
  zomboid-panel-updater:latest \
  docker compose --env-file .env -f docker-compose.yml up -d --build

echo "All-in-one panel is starting. Open http://zomboid.tower:3001 after its health check passes."