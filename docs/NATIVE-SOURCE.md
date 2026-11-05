# Controlled native source

`homepage/` is the authoritative, complete native source in this repository.
Edit it directly. The root Dockerfile builds it alongside the controller into
one application image. Preparation scripts, generated overlays, separate native
Dockerfiles and companion-container entrypoints are retired.

## Provenance and updates

The starting point was Homepage v2.6.0, commit
`51cc1684f9f34a7877ed462b8f94c9cc687b4dde`. On 5 November 2026 the upstream
changes to v2.7.0, commit `2e5f10134ae3961bb936d3e7c441f9a1f4a4bf4f`, were
merged in as a reviewed source merge (NetBird widget, Prometheus metric and
Unraid fixes, translations, the Next.js `middleware.js` to `proxy.js` rename,
`js-yaml` 5.5.0). Upstream's Docker, Tilt, k3d and workflow files are not part
of the controlled tree and were left out.

`upstream.lock.json` records the v2.7.0 commit and the hashes of its
`package.json` and `pnpm-lock.yaml`, read from the upstream Git tag. The
v2.6.0 record under `mergedFrom` keeps the original verified archive hash;
no archive hash is recorded for v2.7.0 because the merge was applied from the
upstream Git tag, not from a downloaded archive. Those hashes describe the
upstream inputs; they are not a claim that the controlled source is unchanged.
The current Git commit/tree and committed `homepage/pnpm-lock.yaml` identify the
source and dependency graph being built.

The controlled tree retains functional native source, widgets/proxies, assets,
configuration documentation, tests and GPL license. Studio customizations include
the native board, stable widget hosts, editing, appearance, safe rendering-data
bridge, revision matching, current-request Kubernetes configuration, independent
dashboard routing/context and cookie/cache scoping. The reviewed
`follow-redirects` 1.16.1 dependency correction remains in the lockfile.

Later reviewed corrections to the baseline:

- `next` is `^16.4.2` (locked 16.4.2, from 16.3.8) for GHSA-2464-fhr4-w9xw,
  GHSA-673q-mjm6-r5xr and GHSA-p3m5-59mp-jv5r. `eslint-config-next` stays at
  16.3.3; it is development-only and has no advisory.
- `pnpm-workspace.yaml` overrides `ip-address` to `^10.7.4` (locked 10.7.4) for
  GHSA-rxp7-6hxx-x8q5, reached through `@kubernetes/client-node` > `socks`.
- `allowBuilds` is the single build-script policy, and it keeps the
  `protobufjs` install script disabled; nothing in the build needs it.
- The TrueNAS WebSocket and APC UPS proxies return a fixed list of sanitized
  error codes and messages instead of raw socket or RPC error text. The TrueNAS
  WebSocket also limits messages to 32 MiB and closes the socket on every path.

`upstream.lock.json` runtime package and lockfile hashes match the committed
`homepage/package.json` and `pnpm-lock.yaml`.

An upstream update is a reviewed source merge. Record the proposed upstream
commit, review release/security changes, preserve Studio behavior and isolation,
update provenance and lockfiles deliberately, and qualify the resulting complete
application. Do not overwrite this directory with a floating upstream release or
add an independently updated public Homepage container.

## Build and runtime

The root Docker build verifies the pinned pnpm package integrity, installs the
frozen native lockfile and produces the standalone native runtime. CI's required
`native-checks` job checks redirect security, audits production dependencies and
runs full native lint and tests.
The final image contains that runtime, static/public assets, the controller,
shared native environment/YAML helpers, all relevant licenses and notices.
Workers use the same build revision as the controller and identify the baseline
upstream commit through the native health handshake.

The public controller publishes port 3000. It starts native workers on private
loopback ports for selected dashboards. A worker receives its immutable dashboard
ID, base path and configuration directory. The controller and workers run as
UID/GID 1000. Native authentication and MCP configuration writes are disabled in
this runtime; Studio's own journaled controller owns configuration writes.

## Corresponding source and licenses

The one `studio-source.tar.gz` archive is a deterministic Git archive of the
exact candidate commit. It includes both controller and native source, all
build definitions, root AGPL and native GPL licenses, historical grants,
dependency notices and bundled font files/notices. No separately reconstructed
native source archive is needed.

The prebuild source guard inspects every local Docker COPY input. Tracked changes
or ignored/untracked source in a copied subtree prevent qualification. Actual
Docker-excluded generated dependencies/build outputs are allowed locally but do
not enter the Git source archive. Native runtime `config/`, `node_modules/`,
`.next/`, generated `next-env.d.ts` and TypeScript build info remain untracked.
The configuration-source directory `homepage/src/utils/config/` is tracked and
must never be hidden by an unanchored `config/` ignore rule.

Retain original copyright notices and licenses; see
[`homepage/STUDIO-FORK.md`](../homepage/STUDIO-FORK.md) and
[`third-party/NOTICE.txt`](../third-party/NOTICE.txt). Root CI and deployment
definitions own the lifecycle. Retired upstream CI, Docker, devcontainer and
development-cluster definitions are not supported Studio installation paths.
