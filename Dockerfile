# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:24-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5
FROM ${NODE_IMAGE} AS controller-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM ${NODE_IMAGE} AS native-builder
ARG STUDIO_BUILD_REVISION=unreleased
WORKDIR /build/homepage
ENV NEXT_TELEMETRY_DISABLED=1 LOG_TARGETS=stdout STUDIO_BUILD_REVISION=${STUDIO_BUILD_REVISION}
# Build only the complete controlled fork from this same source commit.
COPY homepage/ ./
COPY upstream.lock.json scripts/install-pinned-pnpm.mjs /tmp/studio-toolchain/
RUN node /tmp/studio-toolchain/install-pinned-pnpm.mjs /tmp/studio-toolchain/upstream.lock.json && pnpm install --frozen-lockfile --prefer-offline
COPY test/native-redirect-security.mjs ./studio-native-tests/native-redirect-security.mjs
RUN STUDIO_NATIVE_SOURCE=/build/homepage node --test studio-native-tests/native-redirect-security.mjs
RUN pnpm audit --prod
RUN pnpm lint
RUN pnpm test
RUN NEXT_PUBLIC_VERSION="studio-${STUDIO_BUILD_REVISION}" NEXT_PUBLIC_REVISION="${STUDIO_BUILD_REVISION}" pnpm run build

FROM ${NODE_IMAGE}
ARG STUDIO_BUILD_REVISION=unreleased
LABEL org.opencontainers.image.title="Homepage Studio" \
      org.opencontainers.image.source="https://github.com/TheUncleBen/Homepage-Studio" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later" \
      org.opencontainers.image.revision="${STUDIO_BUILD_REVISION}" \
      io.homepage-studio.upstream="51cc1684f9f34a7877ed462b8f94c9cc687b4dde"
WORKDIR /app
RUN apt-get update && apt-get install --no-install-recommends -y iputils-ping ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=controller-dependencies --chown=1000:1000 /app/node_modules ./node_modules
COPY --from=native-builder --chown=1000:1000 /build/homepage/.next/standalone/ ./homepage/
COPY --from=native-builder --chown=1000:1000 /build/homepage/.next/static/ ./homepage/.next/static/
COPY --from=native-builder --chown=1000:1000 /build/homepage/public/ ./homepage/public/
COPY --chown=1000:1000 package.json LICENSE VERSION upstream.lock.json ./
COPY --chown=1000:1000 homepage/LICENSE ./homepage/LICENSE
COPY --chown=1000:1000 homepage/src/utils/config/environment.mjs ./homepage/src/utils/config/environment.mjs
COPY --chown=1000:1000 homepage/src/utils/config/yaml-parser.mjs ./homepage/src/utils/config/yaml-parser.mjs
COPY --chown=1000:1000 server ./server
COPY --chown=1000:1000 public ./public
COPY --chown=1000:1000 third-party ./third-party
COPY --chown=1000:1000 scripts/runtime-host.mjs scripts/healthcheck.mjs ./scripts/
COPY --chmod=755 docker/studio-entrypoint.sh ./docker/studio-entrypoint.sh
RUN mkdir -p /app/config /app/state && chown 1000:1000 /app/config /app/state && chmod 750 /app/config && chmod 700 /app/state
ENV NODE_ENV=production PORT=3000 HOMEPAGE_CONFIG_DIR=/app/config STUDIO_STATE_DIR=/app/state \
    STUDIO_RENDERER_DIR=/app/homepage STUDIO_BACKUP_RETENTION=25 STUDIO_BUILD_REVISION=${STUDIO_BUILD_REVISION} \
    HOMEPAGE_MCP_ALLOW_WRITE=false LOG_TARGETS=stdout NEXT_TELEMETRY_DISABLED=1
USER 1000:1000
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=40s --start-period=120s --retries=3 CMD ["node", "scripts/healthcheck.mjs", "application"]
ENTRYPOINT ["/app/docker/studio-entrypoint.sh"]
CMD ["node", "server/index.mjs"]
