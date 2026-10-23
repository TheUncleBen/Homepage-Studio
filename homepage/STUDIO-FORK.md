# Controlled Homepage fork

This directory is maintained as source in Homepage Studio. Root `Dockerfile`
builds the application directly; deployment uses one Studio image/container.
The public Node controller and native Next.js workers share that image and
lifecycle. Each active dashboard has an isolated native process and configuration
directory. There is no separately updated public Homepage container.

## Provenance and license

The upstream baseline is [gethomepage/homepage](https://github.com/gethomepage/homepage)
v2.6.0, commit
[`51cc1684f9f34a7877ed462b8f94c9cc687b4dde`](https://github.com/gethomepage/homepage/tree/51cc1684f9f34a7877ed462b8f94c9cc687b4dde).
`../upstream.lock.json` retains its exact archive hash, original dependency input
hashes and pinned build toolchain. `LICENSE` retains Homepage's GPL terms.
Original Studio additions use the root AGPL-3.0-or-later license; root
`third-party/` retains attribution, prior grants and source notices. Upstream
names, copyright notices and relevant dependency licenses remain intact.

The initial controlled tree incorporates the previously reviewed Studio board,
native bridges, appearance and compatibility repairs. These include the
follow-redirects 1.16.1 security update, current-request Kubernetes configuration,
sanitized native data with configuration-revision checks, and preserved native
widget hosts. Independent-dashboard routes/storage, worker context and Studio
management are maintained directly in this source.

Dependency and security corrections made since then:

- `next` `^16.4.2` (locked 16.4.2, from 16.3.8) for GHSA-2464-fhr4-w9xw,
  GHSA-673q-mjm6-r5xr and GHSA-p3m5-59mp-jv5r.
- An `ip-address` `^10.7.4` override in `pnpm-workspace.yaml` (locked 10.7.4)
  for GHSA-rxp7-6hxx-x8q5, reached through `@kubernetes/client-node` > `socks`.
- `allowBuilds` in `pnpm-workspace.yaml` is the only build-script policy and
  keeps the `protobufjs` install script disabled.
- The TrueNAS and APC UPS proxies sanitize connection and RPC errors to a fixed
  set of codes and messages; the TrueNAS WebSocket limits messages to 32 MiB.

Upstream CI and standalone Docker/development-cluster deployment definitions
are excluded from the active fork to avoid competing application lifecycles.
The root project owns build, verification, packaging and deployment. Native
source, public assets, tests, documentation, dependency locks and notices remain
available as corresponding source. Runtime configuration, dependencies and
generated build trees are not committed.

## Curated update process

1. Start from the exact accepted Studio commit and record the proposed upstream
   commit/release. Read its source and release/security changes.
2. Review and merge applicable native changes into this directory. Preserve
   Studio routing, stable native hosts, native proxy semantics, configuration
   sanitization/revision pairing and independently configured workers.
3. Update lockfiles and provenance when dependency or baseline inputs change.
   Do not apply floating package upgrades or overwrite Studio customizations
   with an unreviewed upstream tree.
4. Run the complete native/controller/tooling tests, lint and dependency checks,
   production browser and isolation cases, and both architecture/container
   qualification gates specified by the root project.
5. Publish a unique engineering candidate with exact corresponding source and
   image digests. Official dated promotion requires acceptance of those exact
   bytes; promoting an accepted candidate never rebuilds it.

Historical `upstream.lock.json` baseline hashes describe the source from which
this fork began. The current Git commit/tree and committed lockfile are the
authority for the source that is built and distributed.

## Divergence from upstream

The fork's divergence from the baseline is the Git difference between upstream
commit `51cc1684f9f34a7877ed462b8f94c9cc687b4dde` and this directory; it is
not recorded in a separate manifest. The earlier overlay manifests
(`studio-overlay.json`, `studio-source.json`) described a generated overlay
applied to a downloaded upstream archive. Nothing read them once the fork
became tracked source, so they were removed rather than kept as a second,
unverified record. Review upstream changes against the Git history instead.
