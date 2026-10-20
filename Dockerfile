# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:24-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5
FROM ${NODE_IMAGE} AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM ${NODE_IMAGE}
ARG STUDIO_BUILD_REVISION=unreleased
LABEL org.opencontainers.image.title="Homepage Studio configuration service" \
      org.opencontainers.image.source="https://github.com/TheUncleBen/Homepage-Studio" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later" \
      org.opencontainers.image.revision="${STUDIO_BUILD_REVISION}"
ENV NODE_ENV=production PORT=3001 HOMEPAGE_CONFIG_DIR=/app/config STUDIO_STATE_DIR=/app/state \
    STUDIO_BACKUP_RETENTION=25 STUDIO_BUILD_REVISION=${STUDIO_BUILD_REVISION}
WORKDIR /app
COPY --from=dependencies --chown=1000:1000 /app/node_modules ./node_modules
COPY --chown=1000:1000 package.json LICENSE VERSION ./
COPY --chown=1000:1000 server ./server
COPY --chown=1000:1000 public ./public
COPY --chown=1000:1000 third-party ./third-party
COPY --chown=1000:1000 scripts/seed-config.mjs scripts/runtime-host.mjs scripts/healthcheck.mjs ./scripts/
COPY --chmod=755 docker/writer-entrypoint.sh ./docker/writer-entrypoint.sh
RUN mkdir -p /app/config /app/state && chown 1000:1000 /app/config /app/state && chmod 750 /app/config && chmod 700 /app/state
USER 1000:1000
EXPOSE 3001
# Swarm enables service routing only after container health succeeds. Keep this
# local to configuration so the renderer can reach its startup prerequisite.
HEALTHCHECK --interval=15s --timeout=4s --start-period=120s --retries=3 CMD ["node", "scripts/healthcheck.mjs", "configuration"]
ENTRYPOINT ["/app/docker/writer-entrypoint.sh"]
CMD ["node", "server/index.mjs"]
