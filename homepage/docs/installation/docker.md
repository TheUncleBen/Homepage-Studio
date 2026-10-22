---
title: Docker Installation
description: Deploy the controlled Homepage Studio image
---

Use the single-application Compose or Swarm definitions and instructions in the
[Studio deployment guide](../../../docs/DEPLOYMENT.md). They define the image
identity, exact public origin, UID/GID 1000, persistent configuration/state
volumes, worker limits, health checks and bounded shutdown/replacement behavior.

Native `HOMEPAGE_VAR_*` and `HOMEPAGE_FILE_*` references remain supported. Pass
those variables and any corresponding read-only secret mounts explicitly to the
`studio` container, as described in the deployment guide. Native Docker discovery
configuration is documented separately under [Docker integration](../configs/docker.md).

Historical upstream reference: [pinned Homepage docker.md](https://github.com/gethomepage/homepage/blob/51cc1684f9f34a7877ed462b8f94c9cc687b4dde/docs/installation/docker.md).
