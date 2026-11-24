#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLATFORM_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_ROOT="$(dirname "$PLATFORM_DIR")"
DOCKER_DIR="$PLATFORM_DIR/docker"
AGENT_DIR="$PROJECT_ROOT/packages/agent"

# Auto-detect container CLI: podman → docker
if command -v podman &>/dev/null; then
  CONTAINER_CLI="podman"
elif command -v docker &>/dev/null; then
  CONTAINER_CLI="docker"
else
  echo "Error: neither podman nor docker found"
  exit 1
fi
echo "==> Using container CLI: $CONTAINER_CLI"

echo "==> Building agent..."
cd "$AGENT_DIR" && pnpm build

echo "==> Preparing isolated build context..."
BUILD_CONTEXT=$(mktemp -d "${TMPDIR:-/tmp}/prism-workspace-build.XXXXXX")
cleanup() { rm -rf "$BUILD_CONTEXT"; }
trap cleanup EXIT
cp -R "$DOCKER_DIR/." "$BUILD_CONTEXT/"
cp -R "$AGENT_DIR/dist" "$BUILD_CONTEXT/agent-dist"
cp "$AGENT_DIR/package.json" "$BUILD_CONTEXT/agent-package.json"

echo "==> Building workspace image..."
$CONTAINER_CLI build -t prism-workspace:latest -f "$BUILD_CONTEXT/Dockerfile.workspace" "$BUILD_CONTEXT"

echo "==> Done! Image: prism-workspace:latest"
