---
title: Source Builds
description: Build the controlled Homepage Studio source
---

The authoritative native source is tracked under `homepage/` in this repository.
The root Dockerfile installs the pinned toolchain, validates frozen dependency
locks, audits dependencies, runs native lint/tests and builds the application.
Follow [native source and build provenance](../../../docs/NATIVE-SOURCE.md) and
the repository [README](../../../README.md).

The controller owns first-run initialization, dashboard routing and native
worker lifecycles. Fresh installations start empty; do not seed the upstream
sample skeleton or start the native renderer as an independent production
service. Qualification and corresponding-source requirements are recorded in
[VERIFICATION.md](../../../VERIFICATION.md) and [docs/RELEASES.md](../../../docs/RELEASES.md).

Historical upstream reference: [pinned Homepage source.md](https://github.com/gethomepage/homepage/blob/2e5f10134ae3961bb936d3e7c441f9a1f4a4bf4f/docs/installation/source.md).
