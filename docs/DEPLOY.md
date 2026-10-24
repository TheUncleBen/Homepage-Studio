# Deploying on Docker Swarm (with or without Portainer)

This gets you one Swarm stack with one service, `studio`, running one replica
on a node you choose, with its data in two named volumes on that node (or in
host directories you choose). Nothing is built on
your machines: the stack pulls an image that CI has already built and tested.

Not running a Swarm? [DEPLOY-COMPOSE.md](DEPLOY-COMPOSE.md) does the same on
one machine with Docker Compose. How the pieces fit together is in
[ARCHITECTURE.md](ARCHITECTURE.md).

The steps use Portainer, because that's the setup the project is tested with
(CI deploys both templates through a real Portainer CE 2.45.2). Portainer
isn't required: every step has a command-line equivalent under [Without
Portainer](#without-portainer).

Placeholders used below:

| Placeholder | Means |
| --- | --- |
| `homepage.example.test` | the dashboard's public hostname |
| `node-1` | the Swarm node that will hold the data |
| `homepage` | the stack name (the volumes become `homepage_config` and `homepage_state`) |

## 1. Get the bundle

Download a candidate bundle or an official release and check it, as in
[VERSIONS.md](VERSIONS.md#checking-a-bundle). From the bundle you need:

- `portainer-swarm.yml`, which you use **unchanged**. Its `image:` line is
  already the exact digest, for example
  `ghcr.io/theuncleben/homepage-studio@sha256:...`;
- `portainer.env.example`, for the values in step 3.

If `delivery-receipt.json` says `package-access-pending`, the image can't be
pulled anonymously yet; see [VERSIONS.md](VERSIONS.md#checking-a-bundle).

Don't use `portainer-swarm.yml` from the repository itself: it has no image
in it, only `STUDIO_IMAGE` for CI to fill in.

## 2. Pick the node and the storage

Studio keeps its data in two directories: `/app/config` (the dashboards) and
`/app/state` (snapshot history, accounts, sessions and the activity log). By
default they're two Docker named volumes, and named volumes live on one node.
The stack therefore pins the service to one node by hostname.

```bash
docker node ls          # the HOSTNAME column; pick one, e.g. node-1
```

- Use a node with local disk for Docker's volumes.
- The service runs as UID/GID 1000. New named volumes take that ownership from
  the image, so there's nothing to `chown`.
- Moving to another node later means moving both volumes yourself
  ([OPERATIONS.md](OPERATIONS.md#moving-to-another-node)). Don't scale the
  service above one replica: there must only ever be one writer.

### Host directories instead of named volumes

Set `STUDIO_CONFIG_PATH` and `STUDIO_STATE_PATH` to absolute paths on the host
and the template bind mounts those directories instead. Use both or neither,
so the two halves of the data stay together. Create them first: Swarm refuses
to start the task if a bind path doesn't exist, and nothing in the container
can fix ownership, so:

```bash
sudo mkdir -p /srv/homepage-studio/config /srv/homepage-studio/state
sudo chown 1000:1000 /srv/homepage-studio/config /srv/homepage-studio/state
sudo chmod 750 /srv/homepage-studio/config
sudo chmod 700 /srv/homepage-studio/state
```

If UID 1000 can't write either directory, Studio doesn't become healthy and
reports that application storage is unavailable or not writable.

### Shared storage (CephFS)

The two directories can live on a CephFS mount that every node sees. Studio
writes each file to a temporary name, flushes it with `fsync`, renames it into
place and flushes the directory. Those are ordinary POSIX operations that
CephFS provides, and Studio uses no database or SQLite file. CI doesn't test
on CephFS, so treat it as supported by design rather than by test.

What Studio doesn't have is a lock that works across hosts: it serializes
writes inside its one process. Two copies of Studio on the same directories
would each overwrite the other's changes (for example a revoked session coming
back, or a dashboard edit disappearing). Hence:

- **Keep the node pin.** With shared storage, moving Studio is just changing
  `STUDIO_NODE` and updating the stack; there's nothing to copy. Updates are
  safe as they are: `stop-first` stops the old task before the new one starts.
- **Don't remove the pin for automatic failover.** If a node loses contact
  with the managers but keeps running, Swarm starts a replacement elsewhere
  while the old container may still be writing, and Swarm has no way to stop
  it. Only remove the pin if you accept that risk, and never set more than one
  replica.
- Make sure the CephFS mount is up before Docker starts on each node, or
  Studio will write into the empty mount point on the local disk.

## 3. Values

| Variable | Required | What to put | Default |
| --- | --- | --- | --- |
| `STUDIO_PUBLIC_ORIGIN` | Yes | The exact address people type, scheme and host, plus the port if it isn't 80/443, with no path and no trailing dashboard: `https://homepage.example.test` | |
| `STUDIO_NODE` | Yes | The node's hostname from step 2, exactly as `docker node ls` shows it | |
| `STUDIO_PORT` | No | The port published on that node | `3000` |
| `STUDIO_BACKUP_RETENTION` | No | Snapshots kept per dashboard | `25` |
| `STUDIO_RENDERER_MAX_WORKERS` | No | Dashboards that can have a running worker at once, 1 to 64 | `8` |
| `STUDIO_RENDERER_IDLE_SECONDS` | No | Seconds before an idle dashboard's worker stops | `600` |
| `STUDIO_RENDERER_STARTUP_SECONDS` | No | Seconds a worker may take to start, up to 120 | `30` |
| `STUDIO_FRAME_ANCESTORS` | No | Other sites allowed to show the dashboard in a frame ([REVERSE-PROXY.md](REVERSE-PROXY.md#framing)) | empty: same origin only |
| `STUDIO_AUTH` | No | `on` for Studio sign-in, `off` only if your proxy already controls access ([AUTHENTICATION.md](AUTHENTICATION.md)) | `on` |
| `STUDIO_CONFIG_PATH`, `STUDIO_STATE_PATH` | No | Absolute host directories to bind mount instead of the named volumes ([step 2](#host-directories-instead-of-named-volumes)) | the named volumes `config` and `state` |
| `STUDIO_AUTH_KEY` (or `STUDIO_AUTH_KEY_FILE`), `STUDIO_TRUSTED_PROXIES` | No | Encryption key and reverse proxy addresses ([AUTHENTICATION.md](AUTHENTICATION.md#settings-reference)) | unset |
| `STUDIO_OIDC_ISSUER`, `STUDIO_OIDC_CLIENT_ID`, `STUDIO_OIDC_CLIENT_SECRET` (or `_FILE`), `STUDIO_OIDC_NAME`, `STUDIO_OIDC_SCOPES`, `STUDIO_OIDC_GROUPS_CLAIM`, `STUDIO_OIDC_REFRESH_MINUTES`, `STUDIO_OIDC_ALLOW_HTTP` | No | Single sign-on ([AUTHENTICATION.md](AUTHENTICATION.md#single-sign-on-with-authentik-or-another-provider)) | unset |
| `STUDIO_SMTP_HOST`, `STUDIO_SMTP_PORT`, `STUDIO_SMTP_SECURE`, `STUDIO_SMTP_USER`, `STUDIO_SMTP_PASSWORD` (or `_FILE`), `STUDIO_SMTP_FROM` | No | Email ([AUTHENTICATION.md](AUTHENTICATION.md#email)) | unset |

`portainer.env.example` lists every one of these with a short comment and its
default.

`STUDIO_PUBLIC_ORIGIN` matters more than it looks. Studio answers only
requests for exactly that host and port, and the browser's address must match
it. If people reach it as `https://homepage.example.test` through your proxy,
that's the origin, and opening `http://node-1:3000` directly is refused
([TROUBLESHOOTING.md](TROUBLESHOOTING.md#the-page-doesnt-load)). Testing
without a proxy first? Sign-in needs HTTPS, so on plain `http://node-1:3000`
Studio only shows a page saying so. Either test through the proxy, or set
`STUDIO_AUTH=off` while you test on a network you trust, and turn it back on
with the `https://` origin once the proxy is in place.

The worker settings are explained in
[OPERATIONS.md](OPERATIONS.md#workers-and-limits).

## 4. Portainer stack

1. **Stacks → Add stack**. Name it, for example `homepage`.
2. **Build method: Web editor**. Paste the bundle's `portainer-swarm.yml`
   unchanged.
3. Under **Environment variables**, add `STUDIO_PUBLIC_ORIGIN` and
   `STUDIO_NODE`, and any optional line from step 3 you want to change.
   (**Advanced mode** takes them as `NAME=value` lines, so you can paste the
   bundle's `portainer.env.example` with your values filled in. There's no
   `STUDIO_IMAGE` to set: the template already has the image.)
4. **Deploy the stack**.

The first start takes up to a couple of minutes: the health check allows a
120-second start period. It's up when the `homepage_studio` service's task
is running and its container reports `healthy`.

What the stack does, so you don't have to:

| In the template | Why |
| --- | --- |
| One replica, `node.hostname == STUDIO_NODE` | One writer, on the node that holds the data |
| `order: stop-first` for updates and rollbacks, `failure_action: rollback`, 180-second monitor | The old container stops before the new one starts on the same volumes; a new version that doesn't become healthy is rolled back |
| `mode: host` for the port | The port is published on that node only. Swarm can't bind host-mode ports to one address, so limit access with a host firewall |
| `stop_grace_period: 30s` | Time to finish saves and stop workers cleanly |
| `init: true` | A small init process reaps stopped worker processes |
| `cap_drop: [ALL]` | The application needs no Linux capabilities |

`docker stack deploy` ignores `security_opt`, so the Swarm template can't set
`no-new-privileges`; the image contains no setuid or file-capability programs
instead. A read-only root filesystem isn't tested yet, so the template doesn't
set one. If you add memory or CPU limits, leave room for the number of workers
you allow.

### Updating

[UPGRADING.md](UPGRADING.md) has the steps. In short: **Stacks → homepage →
Editor**, replace the whole text with the new bundle's `portainer-swarm.yml`,
keep your environment variables, **Update the stack**.

### Without Portainer

On a Swarm manager, in the folder with the bundle:

```bash
export STUDIO_PUBLIC_ORIGIN=https://homepage.example.test
export STUDIO_NODE=node-1
# export STUDIO_PORT=3000   (and any other optional value from step 3)
docker stack deploy --compose-file portainer-swarm.yml homepage
docker service ps homepage_studio      # wait for Running
```

To update, export the same values and run the same `docker stack deploy` with
the new bundle's file.

## 5. Native integrations: secrets, sockets and variables

Homepage's own ways of keeping secrets out of the YAML work here:
`{{HOMEPAGE_VAR_NAME}}` takes the value of the container's environment
variable `HOMEPAGE_VAR_NAME`, and `{{HOMEPAGE_FILE_NAME}}` reads the file
named by `HOMEPAGE_FILE_NAME`. Use them for API keys and passwords: a value
written straight into a file stays in the snapshot history after you change
it ([OPERATIONS.md](OPERATIONS.md#snapshots-and-secrets)).

Those variables and files have to reach the **`studio` container**. Adding a
variable in Portainer's environment list only makes it available for
substitution in the stack file; also add it under the service's
`environment:` (or mount the secret file) in your copy of the template. One
container serves every dashboard, so these inputs are shared by all of them,
even though each dashboard chooses which ones it references.

The templates mount no Docker socket and assume no services. For Docker
discovery or Docker widgets, configure `docker.yaml` as in Homepage's
documentation. The container runs as UID 1000 without capabilities, so a
mounted socket must be readable by that user; a Docker socket proxy reached
over the network (the `host`/`port` form in `docker.yaml`) avoids mounting the
socket at all. Add only the mounts your integrations actually use.

## 6. Reverse proxy

Point your proxy at port `STUDIO_PORT` on the node and serve the whole
hostname. [REVERSE-PROXY.md](REVERSE-PROXY.md) lists what it must pass
through and how big a request it must allow. Set `STUDIO_TRUSTED_PROXIES` to
the proxy's address so sign-in sees real client addresses.

## 7. Check it works

```bash
curl -s https://homepage.example.test/__studio/application-ready
# {"status":"ready", ..., "buildRevision":"<the bundle's source commit>", ...}

curl -s https://homepage.example.test/__studio/ready
# {"status":"ready", ...}   the main dashboard and its native worker
```

Then open `https://homepage.example.test/` in a browser **straight away**. A
fresh deployment asks the first visitor to create the administrator
([AUTHENTICATION.md](AUTHENTICATION.md#first-start-create-the-administrator)),
then shows an empty dashboard with **Add your first widget**. With sign-in on,
`application-ready` answers anonymous callers with `{"status":"ready"}` only;
the build details appear for administrators and the container's own health
check.

If something's off, start with the log:

```bash
docker service logs --tail 100 homepage_studio
```

and [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

## Environment reference

Everything the container reads. The templates set the first group; the rest
are fixed by the image and you shouldn't need to change them.

| Variable | Default | Notes |
| --- | --- | --- |
| `STUDIO_PUBLIC_ORIGIN` | (required) | Exact `http://` or `https://` origin, with port when it isn't the default. No path, query, wildcard or credentials. The container won't start with anything else |
| `STUDIO_PORT` | `3000` | Template only: the published port. Inside the container Studio always listens on 3000 |
| `STUDIO_NODE` | (required for Swarm) | Template only: the placement constraint |
| `STUDIO_BACKUP_RETENTION` | `25` | Positive whole number |
| `STUDIO_RENDERER_MAX_WORKERS` | `8` | 1 to 64 |
| `STUDIO_RENDERER_IDLE_SECONDS` | `600` | Up to 86400 (24 hours) |
| `STUDIO_RENDERER_STARTUP_SECONDS` | `30` | Up to 120 |
| `STUDIO_FRAME_ANCESTORS` | empty | Space-separated `'self'` and exact origins; an invalid entry stops startup with a message naming the variable |
| `STUDIO_AUTH` and the other sign-in settings | `on` | [AUTHENTICATION.md](AUTHENTICATION.md#settings-reference) |
| `LOG_TARGETS` | `stdout` | Set by the templates; logs go to the container log |
| `HOMEPAGE_VAR_*`, `HOMEPAGE_FILE_*` | | Yours, for native integrations ([step 5](#5-native-integrations-secrets-sockets-and-variables)) |

The image also fixes the paths (`/app/config`, `/app/state`), the internal
port and the native runtime settings, and the entrypoint derives the allowed
host and the health check's host from `STUDIO_PUBLIC_ORIGIN`. Homepage's own
authentication and its MCP configuration writes are turned off: Studio is the
only thing that writes the configuration, and Studio sign-in decides access.
