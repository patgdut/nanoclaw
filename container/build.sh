#!/bin/bash
# Build the NanoClaw agent container image

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

IMAGE_NAME="nanoclaw-agent"
TAG="${1:-latest}"
CONTAINER_RUNTIME="${CONTAINER_RUNTIME:-docker}"

echo "Building NanoClaw agent container image..."
echo "Image: ${IMAGE_NAME}:${TAG}"

# Pack local bb-browser into the build context
BB_BROWSER_DIR="$SCRIPT_DIR/../../bb-browser"
if [ -d "$BB_BROWSER_DIR" ]; then
  echo "Packing local bb-browser..."
  (cd "$BB_BROWSER_DIR" && npm pack --pack-destination "$SCRIPT_DIR") 2>/dev/null
  # npm pack names it bb-browser-X.X.X.tgz, rename to fixed name
  mv "$SCRIPT_DIR"/bb-browser-*.tgz "$SCRIPT_DIR/bb-browser.tgz" 2>/dev/null || true
else
  echo "Warning: local bb-browser not found at $BB_BROWSER_DIR, skipping pack"
fi

${CONTAINER_RUNTIME} build -t "${IMAGE_NAME}:${TAG}" .

# Cleanup
rm -f "$SCRIPT_DIR/bb-browser.tgz"

echo ""
echo "Build complete!"
echo "Image: ${IMAGE_NAME}:${TAG}"
echo ""
echo "Test with:"
echo "  echo '{\"prompt\":\"What is 2+2?\",\"groupFolder\":\"test\",\"chatJid\":\"test@g.us\",\"isMain\":false}' | ${CONTAINER_RUNTIME} run -i ${IMAGE_NAME}:${TAG}"
