#!/bin/sh
set -eu

REPOSITORY="fpsacha/zomboid-control-panel"
VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  VERSION="$(curl --fail --location --silent --show-error \
    "https://api.github.com/repos/$REPOSITORY/releases/latest" \
    | sed -n 's/.*"tag_name": "v\([^"]*\)".*/\1/p' | head -n 1)"
fi
case "$VERSION" in
  ''|*[!0-9.]*) echo "Could not determine a valid release version. Pass it explicitly, for example: ./bootstrap.sh 1.1.4" >&2; exit 1 ;;
esac

PANEL_HOME="${PANEL_HOME:-${XDG_STATE_HOME:-$HOME/.local/state}/zomboid-panel}"
BUILD_ROOT="${BUILD_ROOT:-$PANEL_HOME/build}"
CONTEXT_DIR="$BUILD_ROOT/ctx"
SOURCE_DIR="$BUILD_ROOT/source"

mkdir -p "$CONTEXT_DIR"

if [ ! -f "$CONTEXT_DIR/.env" ]; then
  TOKEN="$(head -c 32 /dev/urandom | base64 | tr -d '\n')"
  cat > "$CONTEXT_DIR/.env" <<EOF
CORS_ORIGINS=${CORS_ORIGINS:-http://localhost:3001}
PANEL_DOCKER_UPDATER_TOKEN=$TOKEN
PANEL_BUILD_DIR=$BUILD_ROOT
PANEL_LAN_IP=${PANEL_LAN_IP:-}
PANEL_WAN_IP=${PANEL_WAN_IP:-}
EOF
  chmod 600 "$CONTEXT_DIR/.env"
  echo "Created $CONTEXT_DIR/.env. Set CORS_ORIGINS to the URL you will use before accessing the panel remotely."
elif ! grep -q '^PANEL_BUILD_DIR=' "$CONTEXT_DIR/.env"; then
  printf '\nPANEL_BUILD_DIR=%s\n' "$BUILD_ROOT" >> "$CONTEXT_DIR/.env"
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

echo "All-in-one panel is starting. Open http://localhost:3001 after its health check passes (or the CORS_ORIGINS value in $CONTEXT_DIR/.env if you changed it for remote access)."
