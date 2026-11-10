# Updating Homepage Studio

An update is the same deployment with a new bundle's template: the image line
changes to the new digest, your values and volumes stay. Studio never updates
itself, and since there's no `latest` tag, nothing changes until you deploy a
new template.

**What stays as it is:** both volumes (every dashboard, layout and snapshot),
your environment values, your Docker secrets and network, your proxy. **What you take new each time:** the
bundle's `portainer-swarm.yml` or `portainer-compose.yml`, used unchanged.

Any candidate or release updates an existing deployment in place, keeping
all its data; you don't need to reinstall.

## What happens at the first start

Studio records the version of its stored data in the state volume
(`studio-data.json`). When a new image starts on older data:

1. it saves everything (both volumes, without monitoring history) as a backup
   named `studio-backup-…-before-upgrade.json.gz`, listed in
   **Administration → Backups**. The newest three are kept;
2. it converts what has changed, step by step, and records each step;
3. then it starts as usual. The log says what was done
   (`Studio upgrade: data version 0 → 1 …`).

If a step fails, Studio puts the backup back, writes the reason to the log
and stops; on Swarm the update then rolls back to the previous image, which
finds its data as it left it. Monitoring history is kept and brought up to
date the same way.

The new version counts as settled once it has kept running for four minutes
(past Swarm's 180-second update monitor). If it converts the data and then
fails its health checks before that, Swarm rolls back to the previous image,
and that image puts the `…-before-upgrade` backup back by itself and starts.
Changes made in those few minutes are lost with it. (This needs the previous
image to have this upgrade support: candidates after 1c3b5bd.) Once settled,
an image older than the data refuses to start and says so in the log (see
Going back), so an old version never misreads newer data.

The backup before an upgrade has the same limit as any backup made in the app
(256 MiB of files, monitoring history not counted). If the volumes are larger,
or the state volume is full, the new version doesn't start and the log says
so; nothing is changed. Free space, or remove large images you no longer use,
and start it again; or go back to the previous image.

## Before you update

1. Get the new bundle and check it ([VERSIONS.md](VERSIONS.md#checking-a-bundle)).
   Read its section in the [CHANGELOG](../CHANGELOG.md) for anything you need
   to do.
2. Note the image digest you're running now (the `image:` line of your current
   stack) and keep your current template. That's what you go back to.
3. Optional: Studio makes its own backup before converting anything, but a
   [backup of the volumes](OPERATIONS.md#backing-up-the-volumes) is still good
   practice before any change.

## Update steps

### Portainer (Swarm or standalone)

1. **Stacks → homepage → Editor.**
2. Replace the whole text with the new bundle's template, unchanged. Leave the
   environment variables as they are, unless the changelog says to add one.
3. **Update the stack.**

On Swarm the template updates `stop-first`: the old container stops, then the
new one starts on the same volumes, so the dashboard is briefly unavailable.
If the new task fails during the 180-second monitor window, the template's
`failure_action: rollback` makes Swarm switch the service back to the previous
image by itself.

### Swarm without Portainer

```bash
set -a; . ./homepage.env; set +a                                  # your values (DEPLOY.md, Without Portainer)
docker stack deploy --compose-file portainer-swarm.yml homepage   # the new bundle's file
```

### Docker Compose

Put the new bundle's `portainer-compose.yml` in place of the old one, next to
your `.env` (your secrets folder stays), and:

```bash
docker compose --project-name homepage --file portainer-compose.yml up -d
```

## After updating

```bash
curl -s https://homepage.example.test/studio/application-ready
# "buildRevision" is the new bundle's source commit
curl -s https://homepage.example.test/studio/ready
```

Then open each dashboard you use. The settings dialog shows the build it's
running (*Studio build* and the start of the source commit).

## Going back

If the update converted data (the log says `Studio upgrade: data version …`),
an older image refuses to start on it, so the older image goes back together
with the backup made at the update:

1. Stage that backup for the next start, from a shell on the Swarm node (or
   the Compose host):

   ```bash
   docker exec $(docker ps -q -f name=homepage_studio) node server/backups.mjs list
   docker exec $(docker ps -q -f name=homepage_studio) node server/backups.mjs restore <the …-before-upgrade name>
   ```

   (Restoring it in Administration → Backups instead restarts the current
   image, which simply converts it again.)
2. Deploy your previous digest, as in the update steps. It puts the backup
   back before it reads anything, then starts on the data as it was.

Images from before data versioning (candidate 1c3b5bd and earlier) don't
know these backups; going back to one of them isn't supported.

Changes made after the update are lost with that restore, so export any
dashboard you changed first ([USING.md](USING.md#snapshots-export-and-import)).
If the log shows no conversion, the data didn't change and the previous
digest can simply be deployed again.

Swarm's automatic rollback during an update only switches the image back.
After a failed conversion the data has already been put back; after a
conversion followed by failed health checks the previous image puts the
backup back itself (What happens at the first start, above).

## Never mix versions

Studio's controller and its Homepage fork are built into one image and must
come from the same build. Don't run a separate or independently updated
Homepage image against Studio's volumes, and never point two Studio
containers at the same volumes.
