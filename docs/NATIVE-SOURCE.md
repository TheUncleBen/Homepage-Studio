# Controlled native source

`homepage/` is the authoritative, complete native source in this repository.
Edit it directly. The root Dockerfile builds it alongside the controller into
one application image. Preparation scripts, generated overlays, separate native
Dockerfiles and companion-container entrypoints are retired.

## Provenance and updates

The starting point is Homepage v2.6.0, commit
`51cc1684f9f34a7877ed462b8f94c9cc687b4dde`.
`upstream.lock.json` retains the verified original archive and dependency input
hashes and the pinned Node/pnpm toolchain. Those original hashes describe the
baseline; they are not a claim that the controlled source remains unchanged.
The current Git commit/tree and committed `homepage/pnpm-lock.yaml` identify the
source and dependency graph being built.

The controlled tree retains functional native source, widgets/proxies, assets,
configuration documentation, tests and GPL license. Studio customizations include
the native board, stable widget hosts, editing, appearance, safe rendering-data
bridge, revision matching, current-request Kubernetes configuration, independent
dashboard routing/context and cookie/cache scoping. The reviewed
`follow-redirects` 1.16.1 dependency correction remains in the lockfile.

An upstream update is a reviewed source merge. Record the proposed upstream
commit, review release/security changes, preserve Studio behavior and isolation,
update provenance and lockfiles deliberately, and qualify the resulting complete
application. Do not overwrite this directory with a floating upstream release or
add an independently updated public Homepage container.

## Build and runtime

The root Docker build verifies the pinned pnpm package integrity, installs the
frozen native lockfile, checks redirect security, audits production dependencies,
runs full native lint and tests, and produces the standalone native runtime.
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
