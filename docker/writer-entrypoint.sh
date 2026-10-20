#!/bin/sh
set -eu
HOMEPAGE_ALLOWED_HOSTS="$(node /app/scripts/runtime-host.mjs)"
export HOMEPAGE_ALLOWED_HOSTS
STUDIO_HEALTH_HOST="${STUDIO_HEALTH_HOST:-$(node /app/scripts/runtime-host.mjs health)}"
export STUDIO_HEALTH_HOST
node /app/scripts/seed-config.mjs
exec "$@"
