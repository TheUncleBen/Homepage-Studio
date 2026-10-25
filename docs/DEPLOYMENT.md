# Deployment

The deployment guide is split by task. Start with the one that matches how you
run Docker:

| You want to | Read |
| --- | --- |
| Deploy on Docker Swarm, with Portainer or `docker stack deploy`, behind a reverse proxy, with Docker secrets (the main guide) | [DEPLOY.md](DEPLOY.md) |
| Deploy on one machine with Docker Compose | [DEPLOY-COMPOSE.md](DEPLOY-COMPOSE.md) |
| Get and check the bundle with the digest-pinned templates | [VERSIONS.md](VERSIONS.md) |
| Use Caddy, Traefik, plain nginx or a published port as the reverse proxy | [REVERSE-PROXY.md](REVERSE-PROXY.md) |
| Add single sign-on with any OpenID Connect identity provider | [IDP-OTHERS.md](IDP-OTHERS.md) |
| Follow a worked single sign-on example with Authentik | [IDP-AUTHENTIK.md](IDP-AUTHENTIK.md) |
| Give widgets API keys from Docker secrets (`HOMEPAGE_FILE_*`, `HOMEPAGE_VAR_*`) | [DEPLOY.md](DEPLOY.md#widget-api-keys-as-docker-secrets) |
| Every environment variable and its default | [DEPLOY.md](DEPLOY.md#environment-reference) |
| Health checks, volumes, backups, snapshots and worker limits | [OPERATIONS.md](OPERATIONS.md) |
| Update to a new version, or go back | [UPGRADING.md](UPGRADING.md) |
| Fix something that doesn't work | [TROUBLESHOOTING.md](TROUBLESHOOTING.md) |
