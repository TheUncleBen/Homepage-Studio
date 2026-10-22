---
title: Installation
description: Deploy Homepage Studio as one controlled application
---

Homepage Studio packages the controlled native renderer and its controller in
one application image. Use the repository's [deployment guide](../../../docs/DEPLOYMENT.md)
and matching digest-pinned Compose or Swarm bundle. The controller listens on
port 3000; native dashboard workers listen only on internal loopback ports. The
application runs as UID/GID 1000 and persists configuration and state in two
volumes.

Each dashboard has its own native configuration, board, appearance and history.
Dashboard addresses share one accepted origin. Configure the origin through
`STUDIO_PUBLIC_ORIGIN`; the entrypoint derives the exact native host allowlist.
The controlled application does not expose native authentication or MCP writes.
Authentication, TLS and reverse-proxy policy remain external deployment choices.

The native configuration and widget reference pages in this directory remain
useful for supported native fields. Installation and lifecycle instructions for
the standalone upstream product are historical references, not this fork's
operational contract. See [native source and build provenance](../../../docs/NATIVE-SOURCE.md)
and [current engineering verification](../../../VERIFICATION.md).

Historical upstream reference: [pinned Homepage index.md](https://github.com/gethomepage/homepage/blob/51cc1684f9f34a7877ed462b8f94c9cc687b4dde/docs/installation/index.md).
