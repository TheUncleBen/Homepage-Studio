# Deploying with Docker Compose (one machine)

This runs Homepage Studio as one Compose service, `studio`, on one machine.
Portainer's standalone (non-Swarm) stacks use the same file. It's the same
setup as the Swarm guide, minus Swarm: secrets stay out of the environment,
there's no published port, and your reverse proxy reaches Studio over a shared
Docker network. For a Swarm, see [DEPLOY.md](DEPLOY.md), which explains each
choice in more detail.

Placeholders used below:

| Placeholder | Means |
| --- | --- |
| `homepage.example.test` | Studio's public hostname |
| `homepage` | the Compose project or Portainer stack name (the volumes become `homepage_config` and `homepage_state`) |

## What you need

- Docker with the Compose plugin (`docker compose version`), or Portainer
  managing a standalone Docker host.
- A reverse proxy that runs in Docker on the same machine, for HTTPS. Any proxy
  works; [DEPLOY.md step 8](DEPLOY.md#8-reverse-proxy) lists what it must do,
  with Nginx Proxy Manager as the example, and
  [REVERSE-PROXY.md](REVERSE-PROXY.md) has others.

## 1. Get the bundle

Download a candidate bundle or an official release and check it
([VERSIONS.md](VERSIONS.md#checking-a-bundle)). You need
`portainer-compose.yml`, used **unchanged** (its `image:` line is already the
exact digest), and `portainer.env.example`.

## 2. Shared proxy network

Create a Docker network for Studio and your proxy, then attach the proxy to it
(as in [DEPLOY.md step 2](DEPLOY.md#2-shared-proxy-network-once), with
`external: true` in the proxy's Compose file) and restart the proxy:

```bash
docker network create homepage-studio
docker network inspect homepage-studio --format '{{range .IPAM.Config}}{{.Subnet}} {{end}}'
# for example 172.20.0.0/16  ->  STUDIO_TRUSTED_PROXIES in step 4
```

## 3. Secret files

Compose on one machine has no secret store, so the four secrets are files in
a folder only Studio's user can read. Studio reads them from `/run/secrets`
inside the container; the folder is mounted there read-only.

| File | What goes in it |
| --- | --- |
| `studio_auth_key` | Long random text that encrypts authenticator-app secrets and single sign-on tokens. **Keep a copy**: if it's lost or changed, everyone sets up their authenticator app again |
| `studio_oidc_client_secret` | Your identity provider's client secret ([IDP-OTHERS.md](IDP-OTHERS.md), or [IDP-AUTHENTIK.md](IDP-AUTHENTIK.md) for Authentik), or the word `off` |
| `studio_smtp_password` | The mail server password, or the word `off` |
| `studio_admin_password` | The first administrator's password (with `STUDIO_ADMIN_USERNAME` in step 4), or the word `off` to create the administrator in the browser. Read once, on the first start ([AUTHENTICATION.md](AUTHENTICATION.md#first-start-the-administrator)) |

```bash
sudo mkdir -p /srv/homepage-studio/secrets && cd /srv/homepage-studio/secrets
openssl rand -base64 48 | sudo tee studio_auth_key >/dev/null     # save a copy in your password manager
echo off | sudo tee studio_oidc_client_secret studio_smtp_password >/dev/null
read -rs S && printf %s "$S" | sudo tee studio_admin_password >/dev/null; unset S   # the administrator's password, or off
sudo chown -R 1000:1000 /srv/homepage-studio/secrets
sudo chmod 700 /srv/homepage-studio/secrets && sudo chmod 400 /srv/homepage-studio/secrets/*
```

To put a real value in later (for example the identity provider's client secret), write
it without echoing it to the screen, then restart Studio:

```bash
read -rs S && printf %s "$S" | sudo tee /srv/homepage-studio/secrets/studio_oidc_client_secret >/dev/null; unset S
```

## 4. Values

Copy the example to `.env` next to the Compose file (or keep it as a separate
file for Portainer) and fill it in:

```bash
cp portainer.env.example .env
```

| Variable | What to put |
| --- | --- |
| `STUDIO_PUBLIC_ORIGIN` | The address people type, `https://homepage.example.test` |
| `STUDIO_SECRETS_DIR` | The folder from step 3, `/srv/homepage-studio/secrets` |
| `STUDIO_TRUSTED_PROXIES` | Recommended: the subnet from step 2 |
| `STUDIO_NETWORK_NAME` | Only if your network isn't called `homepage-studio` |
| `STUDIO_CONFIG_PATH`, `STUDIO_STATE_PATH` | Only to use host directories instead of named volumes (below) |
| `STUDIO_ADMIN_USERNAME`, `STUDIO_ADMIN_EMAIL` | Recommended: the first administrator, whose password is the `studio_admin_password` file. Leave them unset if that file says `off` |

Single sign-on (`STUDIO_OIDC_ISSUER`, `STUDIO_OIDC_CLIENT_ID`, and the group
lists `STUDIO_OIDC_ADMIN_GROUPS` and `STUDIO_OIDC_ALLOWED_GROUPS`) and email
(`STUDIO_SMTP_…`) are as in [DEPLOY.md step 6](DEPLOY.md#6-fill-in-the-environment-file).
`STUDIO_NODE` is for Swarm only; Compose ignores it. Every other setting is in
`portainer.env.example` with a short comment.

To keep the data in host directories rather than named volumes, set both
`STUDIO_CONFIG_PATH` and `STUDIO_STATE_PATH` to absolute paths and create them
owned by UID/GID 1000 before starting
([DEPLOY.md](DEPLOY.md#host-directories-instead-of-named-volumes) has the
commands). If a path doesn't exist, Docker creates it owned by root and Studio
can't write to it. Only one Studio may use a pair of directories at a time.

## 5. Start it

```bash
docker compose --project-name homepage --file portainer-compose.yml up -d
docker compose --project-name homepage --file portainer-compose.yml ps    # wait for "healthy"
```

In Portainer: **Stacks → Add stack**, **Web editor**, paste the bundle's
`portainer-compose.yml`, load the values under **Environment variables**, and
**Deploy the stack**.

If a required value is missing, Compose stops with its message, for example
`Set the exact dashboard URL origin` or `Set STUDIO_SECRETS_DIR ...`.

### Hardening already in the Compose file

| Setting | What it does |
| --- | --- |
| No `ports:`; joins the external network | Nothing reaches Studio except through the proxy on that network |
| Secrets folder mounted read-only at `/run/secrets` | Keys and passwords never appear in the environment or `docker inspect` |
| `cap_drop: [ALL]` | No Linux capabilities. The image needs none: `ping` uses unprivileged ICMP sockets |
| `security_opt: [no-new-privileges:true]` | Nothing in the container can gain privileges |
| `init: true` | A small init process reaps stopped worker processes |
| `restart: unless-stopped` | Comes back after a crash or reboot |
| `stop_grace_period: 30s` | Time to finish saves and stop workers |

Inside, everything runs as UID/GID 1000, the application files are owned by
root and read-only, and only `/app/config` and `/app/state` are writable. A
read-only root filesystem isn't tested yet, so it isn't set.

## 6. Proxy, first sign-in and integrations

- **Proxy.** Point the proxy at `http://homepage_studio:3000`: the Compose file
  gives Studio that name on the shared network. The proxy requirements and an
  Nginx Proxy Manager example are in [DEPLOY.md step 8](DEPLOY.md#8-reverse-proxy). The Compose file sets
  that name as a fixed alias, so don't run two Studios on the same network.
- **First sign-in.** Open Studio straight away and create the administrator
  ([DEPLOY.md step 9](DEPLOY.md#9-first-sign-in-and-checks)). The log is
  `docker compose --project-name homepage --file portainer-compose.yml logs --tail 100 studio`.
- **Single sign-on.** [IDP-OTHERS.md](IDP-OTHERS.md) for any provider, with
  [IDP-AUTHENTIK.md](IDP-AUTHENTIK.md) as a worked example; the client secret
  goes in the `studio_oidc_client_secret` file.
- **Widget API keys.** Put each in its own file, mount it, and point a
  `HOMEPAGE_FILE_*` variable at it in your copy of the Compose file
  ([DEPLOY.md](DEPLOY.md#widget-api-keys-as-docker-secrets) explains the
  variables).

### No proxy in Docker?

If your proxy runs on the host or another machine, Studio needs a published
port. Add it in your copy of the Compose file, bound to the address the proxy
uses (`127.0.0.1` for a proxy on the same host):

```yaml
services:
  studio:
    ports:
      - "127.0.0.1:3000:3000"
```

Then point the proxy at that address and set `STUDIO_TRUSTED_PROXIES` to the
proxy's address. The network from step 2 must still exist, because the Compose
file joins it.

## Updating

Replace `portainer-compose.yml` with the new bundle's file, keep your `.env`
and secrets folder, and run the same `up -d`. The old container stops and the
new one starts on the same volumes. [UPGRADING.md](UPGRADING.md) has the backup
and rollback steps.

## Moving to Swarm later

Deploy the Swarm stack ([DEPLOY.md](DEPLOY.md)) with the same values, after
copying both volumes to the node you pick
([OPERATIONS.md](OPERATIONS.md#moving-to-another-node)). Create the Swarm
secrets from the same values, in particular the same `studio_auth_key`. Stop
the Compose service first: only one Studio may use a set of volumes at a time.
