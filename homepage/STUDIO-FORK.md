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
