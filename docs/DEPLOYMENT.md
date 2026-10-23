# Deployment

The deployment guide is split by task. Start with the one that matches how you
run Docker:

| You want to | Read |
| --- | --- |
| Deploy on Docker Swarm, with Portainer or `docker stack deploy` | [DEPLOY.md](DEPLOY.md) |
| Deploy on one machine with Docker Compose | [DEPLOY-COMPOSE.md](DEPLOY-COMPOSE.md) |
| Get and check the bundle with the digest-pinned templates | [VERSIONS.md](VERSIONS.md) |
| Put a reverse proxy and access control in front | [REVERSE-PROXY.md](REVERSE-PROXY.md) |
| Pass `HOMEPAGE_VAR_*`, `HOMEPAGE_FILE_*` and secret mounts to the container | [DEPLOY.md step 5](DEPLOY.md#5-native-integrations-secrets-sockets-and-variables) |
| Every environment variable and its default | [DEPLOY.md](DEPLOY.md#environment-reference) |
| Health checks, volumes, backups, snapshots and worker limits | [OPERATIONS.md](OPERATIONS.md) |
| Update to a new version, or go back | [UPGRADING.md](UPGRADING.md) |
| Fix something that doesn't work | [TROUBLESHOOTING.md](TROUBLESHOOTING.md) |
