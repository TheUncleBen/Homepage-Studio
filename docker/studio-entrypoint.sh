#!/bin/sh
set -eu
HOMEPAGE_ALLOWED_HOSTS="$(node /app/scripts/runtime-host.mjs)"
export HOMEPAGE_ALLOWED_HOSTS
STUDIO_HEALTH_HOST="${STUDIO_HEALTH_HOST:-$(node /app/scripts/runtime-host.mjs health)}"
export STUDIO_HEALTH_HOST
# All persistent writes belong to the controller's validated transaction queue.
HOMEPAGE_MCP_ALLOW_WRITE=false
export HOMEPAGE_MCP_ALLOW_WRITE
exec "$@"
