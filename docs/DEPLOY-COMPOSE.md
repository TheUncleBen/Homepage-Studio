# Deploying with Docker Compose (one machine)

This runs Homepage Studio as one Compose service, `studio`, with two named
volumes, on one machine. Portainer's standalone (non-Swarm) stacks use the
same file. For a Swarm, see [DEPLOY.md](DEPLOY.md).

Placeholders used below:

| Placeholder | Means |
| --- | --- |
| `homepage.example.test` | the dashboard's public hostname |
| `homepage` | the Compose project or Portainer stack name (the volumes become `homepage_config` and `homepage_state`) |

## What you need

- Docker with the Compose plugin (`docker compose version`), or Portainer
  managing a standalone Docker host.
- A free port on the machine (3000 by default).
- Ideally a reverse proxy for HTTPS and access control
  ([REVERSE-PROXY.md](REVERSE-PROXY.md)).

## 1. Get the bundle

Download a candidate bundle or an official release and check it
([VERSIONS.md](VERSIONS.md#checking-a-bundle)). You need
`portainer-compose.yml`, used **unchanged** (its `image:` line is already the
exact digest), and `portainer.env.example`.

## 2. Values

Copy the example to `.env` next to the Compose file and fill it in:

```bash
cp portainer.env.example .env
```

| Variable | Required | What to put | Default |
| --- | --- | --- | --- |
| `STUDIO_PUBLIC_ORIGIN` | Yes | The exact address people type: `https://homepage.example.test`. Sign-in needs HTTPS; to test on `http://<machine>:3000` without a proxy, also set `STUDIO_AUTH=off` for the test | |
| `STUDIO_PORT` | No | The port published on the machine | `3000` |
| `STUDIO_BACKUP_RETENTION`, `STUDIO_RENDERER_*`, `STUDIO_FRAME_ANCESTORS` | No | As in [DEPLOY.md](DEPLOY.md#3-values) | |
| `STUDIO_AUTH`, `STUDIO_AUTH_KEY`, `STUDIO_TRUSTED_PROXIES`, `STUDIO_OIDC_*`, `STUDIO_SMTP_*` | No | Sign-in ([AUTHENTICATION.md](AUTHENTICATION.md#settings-reference)) | `STUDIO_AUTH=on` |

`STUDIO_NODE` is for Swarm only; Compose ignores it. Studio answers only
requests for the exact host and port in `STUDIO_PUBLIC_ORIGIN`, so set it to
the address your browser will use.

## 3. Start it

```bash
docker compose --project-name homepage --file portainer-compose.yml up -d
docker compose --project-name homepage --file portainer-compose.yml ps    # wait for "healthy"
```

In Portainer: **Stacks → Add stack**, **Web editor**, paste the bundle's
`portainer-compose.yml`, add the values under **Environment variables**, and
**Deploy the stack**.

If `STUDIO_PUBLIC_ORIGIN` is missing, Compose stops with `Set the exact
dashboard URL origin`.

### Hardening already in the Compose file

| Setting | What it does |
| --- | --- |
| `cap_drop: [ALL]` | No Linux capabilities. The image needs none: `ping` uses unprivileged ICMP sockets |
| `security_opt: [no-new-privileges:true]` | Nothing in the container can gain privileges |
| `init: true` | A small init process reaps stopped worker processes |
| `restart: unless-stopped` | Comes back after a crash or reboot |
| `stop_grace_period: 30s` | Time to finish saves and stop workers |

Inside, everything runs as UID/GID 1000, the application files are owned by
root and read-only, and only `/app/config` and `/app/state` are writable. A
read-only root filesystem isn't tested yet, so it isn't set.

The port is published on every interface of the machine. To listen on one
address only, for example when the proxy runs on the same machine, add
`host_ip: 127.0.0.1` to the port entry (the template has a comment where it
goes).

### Adding it to an existing stack

You can paste the `studio` service and its two volumes into a stack you
already run. Keep the service and volume names unique in that stack and pick
an unused published port.

## 4. Integrations, proxy and check

These are the same as on Swarm:

- secrets for native integrations, sockets and `HOMEPAGE_VAR_*` /
  `HOMEPAGE_FILE_*`: [DEPLOY.md step 5](DEPLOY.md#5-native-integrations-secrets-sockets-and-variables);
- the reverse proxy: [REVERSE-PROXY.md](REVERSE-PROXY.md);
- creating the administrator straight after the first start: [AUTHENTICATION.md](AUTHENTICATION.md#first-start-create-the-administrator);
- checking it works: [DEPLOY.md step 7](DEPLOY.md#7-check-it-works). The log
  is `docker compose --project-name homepage --file portainer-compose.yml logs --tail 100 studio`.

## Updating

Replace `portainer-compose.yml` with the new bundle's file, keep your `.env`,
and run the same `up -d`. The old container stops and the new one starts on
the same volumes. [UPGRADING.md](UPGRADING.md) has the backup and rollback
steps.

## Moving to Swarm later

Deploy the Swarm stack ([DEPLOY.md](DEPLOY.md)) with the same values, after
copying both volumes to the node you pick
([OPERATIONS.md](OPERATIONS.md#moving-to-another-node)). Stop the Compose
service first: only one Studio may use a set of volumes at a time.
