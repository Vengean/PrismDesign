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

echo "==> Copying agent dist to docker context..."
rm -rf "$DOCKER_DIR/agent-dist"
cp -r "$AGENT_DIR/dist" "$DOCKER_DIR/agent-dist"
cp "$AGENT_DIR/package.json" "$DOCKER_DIR/agent-package.json"

echo "==> Building workspace image..."
$CONTAINER_CLI build -t prism-workspace:latest -f "$DOCKER_DIR/Dockerfile.workspace" "$DOCKER_DIR"

echo "==> Cleaning up..."
rm -rf "$DOCKER_DIR/agent-dist" "$DOCKER_DIR/agent-package.json"

echo "==> Done! Image: prism-workspace:latest"
