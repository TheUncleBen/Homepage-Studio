---
title: UNRAID Reference
description: Use the controlled application deployment contract
---

The upstream Homepage community package installs the standalone upstream
product. This fork's application image, UID/GID 1000 ownership, configuration and
state volumes, worker lifecycle and health behavior are defined in the
[Studio deployment guide](../../../docs/DEPLOYMENT.md).

Use a Studio Compose or Swarm/Portainer bundle after its qualification gates pass.
Native service fields and Docker discovery are documented under
[services](../configs/services.md) and [Docker integration](../configs/docker.md).
The historical upstream UNRAID package instructions below do not configure this
fork's persistent state or independent dashboards.

Historical upstream reference: [pinned Homepage unraid.md](https://github.com/gethomepage/homepage/blob/51cc1684f9f34a7877ed462b8f94c9cc687b4dde/docs/installation/unraid.md).
