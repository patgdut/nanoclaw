#!/bin/bash
# Wait for Docker Desktop to be ready before starting NanoClaw

MAX_WAIT=120  # max 2 minutes
WAITED=0

echo "[start-with-docker] Waiting for Docker to be ready..."

# Launch Docker if not running
if ! /usr/local/bin/docker info &>/dev/null 2>&1; then
    echo "[start-with-docker] Starting Docker Desktop..."
    open -a Docker
fi

# Wait for Docker socket to be available
while ! /usr/local/bin/docker info &>/dev/null 2>&1; do
    if [ $WAITED -ge $MAX_WAIT ]; then
        echo "[start-with-docker] Timed out waiting for Docker after ${MAX_WAIT}s, starting anyway..."
        break
    fi
    sleep 3
    WAITED=$((WAITED + 3))
    echo "[start-with-docker] Still waiting for Docker... (${WAITED}s)"
done

echo "[start-with-docker] Docker is ready. Starting NanoClaw..."
exec /opt/homebrew/bin/node /Users/pat/Documents/GitHub/nanoclaw/dist/index.js
