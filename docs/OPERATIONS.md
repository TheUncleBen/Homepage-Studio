# Running Homepage Studio

Day-to-day running of a deployment: logs and health checks, backups and
restores, snapshots and secrets, worker limits, and moving to another node.
Updating to a new version is in [UPGRADING.md](UPGRADING.md).

The examples assume a stack (or Compose project) named `homepage`, so the
service is `homepage_studio` on Swarm and the volumes are `homepage_config`
and `homepage_state`.

## Contents

- [Logs and health](#logs-and-health)
- [Where the data lives](#where-the-data-lives)
- [Backups](#backups)
  - [Backups in the app](#backups-in-the-app)
  - [Backups from the command line](#backups-from-the-command-line)
  - [Backing up the volumes](#backing-up-the-volumes)
  - [Restoring the volumes](#restoring-the-volumes)
  - [Per-dashboard exports](#per-dashboard-exports)
- [Snapshots and secrets](#snapshots-and-secrets)
- [Workers and limits](#workers-and-limits)
- [Moving to another node](#moving-to-another-node)
- [Search engines](#search-engines)
- [Integrations and trust](#integrations-and-trust)

## Logs and health

```bash
docker service logs --tail 100 homepage_studio                                          # Swarm
docker compose --project-name homepage --file portainer-compose.yml logs --tail 100 studio  # Compose
```

Studio logs to the container's standard output.

Health endpoints, all `GET`, all answered with JSON. Call them on the exact
public origin (Studio refuses any other host):

| Endpoint | Checks | Starts a worker? |
| --- | --- | --- |
| `/studio/application-ready` | The dashboard registry, that both volumes are writable, and that the packaged native runtime is complete. Returns `version`, `buildRevision` (the source commit) and `upstreamCommit`. **This is the container's Docker health check** | No |
| `/studio/live`, `/studio/health` | Only that the controller answers | No |
| `/<dashboard>/studio/config-ready` | That dashboard's files, journal and storage. `/studio/config-ready` is the main dashboard | No |
| `/<dashboard>/studio/ready` | The same, plus that dashboard's native worker answers and matches this build. `/studio/ready` is the main dashboard | Yes |

A problem in one dashboard, even the main one, doesn't fail the Docker health
check, doesn't restart the container and doesn't stop the other dashboards
from working. Only a problem shared by all of them (the registry, storage,
or the packaged runtime) does. A dashboard's worker that crashes is started
again on the next request to it.

The Docker health check runs every 15 seconds with a 120-second start period
and three retries.

## Where the data lives

| Volume path | Holds |
| --- | --- |
| `/app/config` | The main dashboard's nine native files, and the dashboard registry (`studio-dashboards.json`) with its initialization marker |
| `/app/state` | The main dashboard's layout and stacks, its journal and its snapshots (`backups/`); sign-in settings, people and sessions (`auth/`); Studio backups (`studio-backups/`) |
| `/app/config/dashboards/<id>/` | Each other dashboard's nine native files |
| `/app/state/dashboards/<id>/` | Each other dashboard's layout, discovery state, journal and snapshots |

`<id>` is the dashboard's permanent identity, a UUID. Renaming a dashboard or
changing its address never moves its files.

Back up the two volumes **together**. The registry, its marker and both trees
belong to each other: once a deployment has been initialized, a missing or
damaged registry stops it with an error rather than quietly starting over
with an empty list.

## Backups

There are three kinds, and they do different jobs:

| Kind | Covers | Use it for |
| --- | --- | --- |
| **Administration → Backups** in the app | All of Studio: every dashboard, the dashboard list, the default look, people, groups, access and sign-in settings | Everyday backups, rollback after a change or an upgrade, moving to another node |
| A copy of both volumes | The same, plus logs and everyone's current sign-ins | When Studio won't start, or a backup made outside Studio |
| **Export dashboard** in the app | One dashboard: its nine files, panels, layout and stacks | Copying a design elsewhere, a personal backup of one dashboard |

None of them includes environment variables, Docker secrets, mounted secret
files or sockets: keep your stack's environment file with your own records,
and the `studio_auth_key` value in your password manager. Swarm can't show a
secret's value again once it's created, and restored sign-in settings need the
same key for authenticator apps and single sign-on to keep working.

### Backups in the app

**Administration → Backups** (administrators only) lists the backups Studio
holds. **Create backup** makes one now; select a backup to download it,
restore it or delete it; **Upload** adds a backup file you downloaded
earlier, from this deployment or another one. Everything except looking at
the list asks you to confirm it's you if you haven't signed in recently.

Backups are kept in the state volume, in `studio-backups/`, one
`studio-backup-<date>-<time>.json.gz` file each, readable only by Studio. They
aren't copied anywhere else, so a backup that only lives there is lost with
the volume: download the ones you want to keep and store them off the node.
Studio doesn't delete old backups itself. A backup leaves out logs, everyone's
current sign-ins, any unused recovery link and the backups folder itself.

**Restoring** replaces everything in Studio with the backup. Studio restarts
and, as it starts, saves what's there now as a backup marked *Before restore*,
applies the backup, and everyone signs in again. The restart relies on the
stack's restart policy (`restart: unless-stopped` in
`portainer-compose.yml`, `restart_policy: condition: any` in
`portainer-swarm.yml`); keep it if you change the stack. If the backup turns
out to be missing or damaged, Studio changes nothing, logs *was not restored*
with the reason and starts normally. If writing it fails part-way, Studio
logs *could not be written* and puts the *Before restore* backup back. If
what's there now can't be saved first, Studio changes nothing and logs *was
not restored* with the reason. Restored files are always readable and
writable only by Studio, whatever the backup recorded.

A backup in the app can be at most 256 MiB, for creating, uploading and
restoring alike. When Studio's files are larger than that, **Create backup**
says so and nothing is saved; back up the volumes instead
([Backing up the volumes](#backing-up-the-volumes)).

A backup holds everything in the dashboards' files, including any password
or API key written straight into them, and the sign-in settings. Store a
downloaded backup like a secret.

### Backups from the command line

The same backups are available from a shell on the node, for example when
nobody can sign in. Run the commands inside Studio's container:

```bash
# Studio's container on this node. With Compose you can also use
# docker compose exec studio node server/backups.mjs ...
STUDIO=$(docker ps --quiet --filter name=homepage_studio)

docker exec "$STUDIO" node server/backups.mjs list
docker exec "$STUDIO" node server/backups.mjs create
docker cp "$STUDIO":/app/state/studio-backups/studio-backup-YYYYMMDD-HHMMSS.json.gz .

# Restore: checks the backup, then applies it when Studio next starts.
docker exec "$STUDIO" node server/backups.mjs restore studio-backup-YYYYMMDD-HHMMSS.json.gz
docker service update --force homepage_studio      # Compose: docker compose restart studio
```

To restore a backup file that isn't on the node yet, copy it into
`/app/state/studio-backups/` first (`docker cp`, then make sure UID 1000 can
read it), or use **Upload** in the app.

### Backing up the volumes

A copy of the volumes works even when Studio won't start. Stop Studio first so nothing writes while you copy, then copy, then start it
again. On the node that holds the volumes:

```bash
# Swarm (Compose: docker compose --project-name homepage --file portainer-compose.yml stop studio)
docker service scale homepage_studio=0

docker run --rm \
  -v homepage_config:/from/config:ro -v homepage_state:/from/state:ro \
  -v "$PWD":/backup alpine \
  tar czf /backup/homepage-studio-$(date +%Y%m%d).tar.gz -C /from config state

# Swarm (Compose: ... start studio)
docker service scale homepage_studio=1
```

With host directories (`STUDIO_CONFIG_PATH` and `STUDIO_STATE_PATH`), use
the same steps with `-v /srv/homepage-studio/config:/from/config:ro` and so on
in place of the volume names.

Any small image with `tar` works in place of `alpine`. Keep the archive
somewhere other than that node, and keep a note of which image digest it was
taken with: a backup and the image that wrote it go together
([UPGRADING.md](UPGRADING.md#going-back)).

The archive holds everything in the dashboards' files, including any password
or API key written straight into them. Store it like a secret.

### Restoring the volumes

This replaces everything in both volumes.

```bash
docker service scale homepage_studio=0       # or: compose stop studio

docker run --rm \
  -v homepage_config:/to/config -v homepage_state:/to/state \
  -v "$PWD":/backup:ro alpine \
  sh -c 'rm -rf /to/config/* /to/config/.[!.]* /to/state/* /to/state/.[!.]* 2>/dev/null;
         tar xzf /backup/homepage-studio-YYYYMMDD.tar.gz -C /to --numeric-owner'

docker service scale homepage_studio=1       # or: compose start studio
```

Extracting as root with `--numeric-owner` keeps the files owned by UID/GID
1000, which is what Studio runs as. If you restore into a bind mount or copy
files by other means, make sure UID 1000 can write them: Studio doesn't
change ownership itself and doesn't run as root.

### Per-dashboard exports

**Dashboard settings → Configuration files → Export dashboard**
downloads one dashboard; **Snapshots & restore → Choose a backup file →
Import dashboard** puts it back, on the same or another deployment
([USING.md](USING.md#snapshots-export-and-import)). An import keeps a
snapshot of what it replaces.

## Snapshots and secrets

Every save keeps a snapshot of each dashboard's files as they were before the
save. The newest `STUDIO_BACKUP_RETENTION` (25 by default) are kept per
dashboard; older ones are removed when a new one is made. Snapshots belong to
their dashboard: a snapshot from one can't be restored into another (an
explicit import is the way to move one).

**A secret written straight into a file stays in the snapshots after you
change it.** Snapshots are earlier copies of the files, so an old API key is
still readable in up to 25 of them, in snapshot downloads and in volume
backups. Studio has no button to delete a snapshot; an old one disappears
once enough newer saves have pushed it past the limit. So:

- **Prefer references.** Put the secret in the container's environment or a
  mounted file and write `{{HOMEPAGE_VAR_NAME}}` or `{{HOMEPAGE_FILE_NAME}}`
  in the YAML ([DEPLOY.md](DEPLOY.md#widget-api-keys-as-docker-secrets)).
  The snapshots then hold only the reference, and rotating the secret never
  touches them.
- **After rotating a secret that was written inline,** treat the old one as
  exposed to anyone who can reach the dashboard or its backups until it has
  aged out. If you need it gone sooner, the snapshot files are the
  `backup-*.json` files in `backups/` under the dashboard's state folder
  ([Where the data lives](#where-the-data-lives)); remove the ones you no
  longer want while Studio is stopped.

If old snapshots can't be removed (permissions or a full disk), saves still
succeed, and that dashboard's `config-ready` and `ready` checks answer `503`
with *Configuration remains available, but older snapshots could not be
removed. Check backup storage permissions and available space.* until it's
fixed.

## Workers and limits

Each dashboard that's in use gets its own native Homepage process inside the
container, started on first request and stopped when idle.

| Setting | Default | Range | Effect |
| --- | --- | --- | --- |
| `STUDIO_RENDERER_MAX_WORKERS` | 8 | 1 to 64 | How many dashboards can have a running worker at once |
| `STUDIO_RENDERER_IDLE_SECONDS` | 600 | up to 86400 | How long an unused dashboard's worker stays up |
| `STUDIO_RENDERER_STARTUP_SECONDS` | 30 | up to 120 | How long a worker may take to start before the request fails |

- When every worker is busy serving a request, a request for another
  dashboard gets *All dashboard renderers are busy. Retry shortly, or increase
  STUDIO_RENDERER_MAX_WORKERS for this deployment.* Workers that are merely
  idle are stopped to make room; one that's serving a request isn't.
- Renaming, moving or archiving a dashboard stops its old worker.
- Each worker is a full Homepage server process. If you set memory limits on
  the container, leave room for the number of workers you allow.
- A deployment holds up to **64 dashboards**, archived ones included. This is
  separate from the worker limit: you can have more dashboards than workers.

These limits share one container's resources between dashboards. They aren't
a security boundary between them: every dashboard is equally reachable by
anyone who can reach the host.

## Moving to another node

With host directories on storage every node shares, such as CephFS
([DEPLOY.md](DEPLOY.md#shared-storage-cephfs)), there's nothing to copy: scale
the service to 0, change `STUDIO_NODE` to the new node's hostname and update
the stack.

Named volumes stay on the node they were created on. To move:

1. [Back up the volumes](#backing-up-the-volumes) on the old node. Leave the
   service scaled to 0.
2. On the new node, create the volumes with the same names
   (`docker volume create homepage_config`, `docker volume create
   homepage_state`) and [restore](#restoring-the-volumes) into them.
3. Change `STUDIO_NODE` to the new node's hostname and update the stack.
4. Once it's running and healthy on the new node, remove the old node's
   volumes when you're sure you don't need them.

Never let two Studio containers use copies of the same data at once and then
merge them; there's only ever one writer.

## Search engines

`/robots.txt` is generated from each dashboard's native `disableIndexing`
setting in `settings.yaml`. Editor and health paths are always disallowed,
archived dashboards are left out, and a dashboard whose settings can't be read
is treated as not indexable. It lists every active dashboard's address. It's a
request to well-behaved crawlers, not access control.

## Integrations and trust

Native widgets reach your services through Homepage's own server-side proxies,
from inside the container. A few inherited behaviors matter when you decide
which networks it may reach:

- **Certificates aren't verified** by Homepage's shared HTTPS client or the
  TrueNAS WebSocket connection, so self-signed home services work. Traffic is
  encrypted, but an impostor on the network wouldn't be detected. There's no
  setting to turn verification on; `NODE_EXTRA_CA_CERTS` doesn't change it.
- **Redirects to another host drop credentials.** A redirect to a different
  scheme, host or port loses authorization headers, URL credentials and
  cookies for the rest of that request; a request body isn't re-sent. Use each
  service's canonical URL in its widget.
- **Each outgoing request is bounded:** 45 seconds in total, redirects
  included, and 32 MiB for the response body. A widget that needs more fails
  with an error instead of hanging.
- **Cookies are per dashboard,** not per service or port: services on the same
  host name share them within one dashboard.
- **Exports carry inline secrets.** See [Snapshots and
  secrets](#snapshots-and-secrets).

More detail is in [ARCHITECTURE.md](ARCHITECTURE.md#native-integration-transport).
