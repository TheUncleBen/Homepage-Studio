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
# The image build installs, compiles and compresses. Its source gates (the
# production dependency audit, redirect security check, lint and unit tests)
# run once per workflow in the required native-checks CI job, which every
# architecture build job needs; a new registry advisory therefore fails that
# job instead of every image build.
COPY homepage/ ./
COPY upstream.lock.json scripts/install-pinned-pnpm.mjs scripts/compress-static-assets.mjs /tmp/studio-toolchain/
RUN node /tmp/studio-toolchain/install-pinned-pnpm.mjs /tmp/studio-toolchain/upstream.lock.json && pnpm install --frozen-lockfile --prefer-offline
RUN NEXT_PUBLIC_VERSION="studio-${STUDIO_BUILD_REVISION}" NEXT_PUBLIC_REVISION="${STUDIO_BUILD_REVISION}" pnpm run build
RUN node /tmp/studio-toolchain/compress-static-assets.mjs /build/homepage/.next/static

FROM ${NODE_IMAGE} AS controller-source
WORKDIR /src
# Controller tests and their fixtures stay in the build context for CI, but
# nothing at runtime imports them, so they never enter the application image.
COPY server ./server
RUN rm -rf server/fixtures && find server -type f -name '*.test.mjs' -delete \
    && test -z "$(find server \( -name fixtures -o -name '*.test.*' \) -print -quit)"

FROM ${NODE_IMAGE}
ARG STUDIO_BUILD_REVISION=unreleased
LABEL org.opencontainers.image.title="Homepage Studio" \
      org.opencontainers.image.source="https://github.com/TheUncleBen/Homepage-Studio" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later" \
      org.opencontainers.image.revision="${STUDIO_BUILD_REVISION}" \
      io.homepage-studio.upstream="51cc1684f9f34a7877ed462b8f94c9cc687b4dde"
WORKDIR /app
# Refresh the inherited Perl runtime as well: the pinned Node base predates
# Debian's Bookworm perl-base security update (5.36.0-7+deb12u4).
#
# The supplied templates drop every capability. Debian's ping is installed with
# either the setuid bit or a cap_net_raw file capability, and the kernel
# refuses to exec a file-capability binary whose capabilities are outside the
# bounding set. Reinstall ping as a plain executable (cp drops both) and strip
# every setuid/setgid bit, so ping always uses the unprivileged ICMP datagram
# socket that Docker permits via net.ipv4.ping_group_range.
RUN apt-get update && apt-get install --no-install-recommends -y iputils-ping ca-certificates perl-base && rm -rf /var/lib/apt/lists/* \
    && ping="$(readlink -f "$(command -v ping)")" && cp "$ping" "$ping.plain" && mv -f "$ping.plain" "$ping" && chmod 0755 "$ping" \
    && find / -xdev -type f -perm /6000 -exec chmod ug-s {} + \
    && test -z "$(find / -xdev -type f -perm /6000 -print -quit)"
# Application code stays owned by root. Only the configuration and state
# volumes below are writable by the runtime user.
COPY --from=controller-dependencies /app/node_modules ./node_modules
COPY --from=native-builder /build/homepage/.next/standalone/ ./homepage/
COPY --from=native-builder /build/homepage/.next/static/ ./homepage/.next/static/
COPY --from=native-builder /build/homepage/public/ ./homepage/public/
COPY package.json LICENSE VERSION upstream.lock.json ./
COPY homepage/LICENSE ./homepage/LICENSE
COPY homepage/src/utils/config/environment.mjs ./homepage/src/utils/config/environment.mjs
COPY homepage/src/utils/config/yaml-parser.mjs ./homepage/src/utils/config/yaml-parser.mjs
COPY homepage/src/components/studio/appearance.mjs ./homepage/src/components/studio/appearance.mjs
COPY --from=controller-source /src/server ./server
COPY public ./public
COPY third-party ./third-party
COPY scripts/runtime-host.mjs scripts/healthcheck.mjs ./scripts/
COPY --chmod=755 docker/studio-entrypoint.sh ./docker/studio-entrypoint.sh
RUN mkdir -p /app/config /app/state && chown 1000:1000 /app/config /app/state && chmod 750 /app/config && chmod 700 /app/state
ENV NODE_ENV=production PORT=3000 HOMEPAGE_CONFIG_DIR=/app/config STUDIO_STATE_DIR=/app/state \
    STUDIO_RENDERER_DIR=/app/homepage STUDIO_BACKUP_RETENTION=25 STUDIO_BUILD_REVISION=${STUDIO_BUILD_REVISION} \
    HOMEPAGE_MCP_ALLOW_WRITE=false LOG_TARGETS=stdout NEXT_TELEMETRY_DISABLED=1
USER 1000:1000
# Fail the build if the runtime user could modify anything under /app other
# than its two data directories. Next.js does not write .next/cache here:
# images are unoptimized and pages render with getServerSideProps (no ISR).
RUN test -w /app/config && test -w /app/state \
    && test -z "$(find /app \( -path /app/config -o -path /app/state \) -prune -o -writable -print -quit)"
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=40s --start-period=120s --retries=3 CMD ["node", "scripts/healthcheck.mjs", "application"]
ENTRYPOINT ["/app/docker/studio-entrypoint.sh"]
CMD ["node", "server/index.mjs"]
