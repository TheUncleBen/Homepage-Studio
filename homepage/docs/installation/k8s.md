---
title: Kubernetes Reference
description: Separate native discovery from application deployment
---

Homepage Studio provides Compose and same-node Swarm/Portainer definitions,
which are subject to the current candidate qualification gates. The [deployment guide](../../../docs/DEPLOYMENT.md)
is the operational contract for the controlled single image, persistent volumes,
UID/GID 1000 and health/lifecycle settings.

Native Kubernetes discovery and widget configuration remain supported and are
documented under [Kubernetes integration](../configs/kubernetes.md). Discovery
settings do not require deploying this application on Kubernetes. The inherited
standalone Homepage manifests are retained only through the historical source
link below; they are not a qualified deployment template for this fork.

Historical upstream reference: [pinned Homepage k8s.md](https://github.com/gethomepage/homepage/blob/51cc1684f9f34a7877ed462b8f94c9cc687b4dde/docs/installation/k8s.md).
