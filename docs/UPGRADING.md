# Updating Homepage Studio

An update is the same deployment with a new bundle's template: the image line
changes to the new digest, your values and volumes stay. Studio never updates
itself, and since there's no `latest` tag, nothing changes until you deploy a
new template.

**What stays as it is:** both volumes (every dashboard, layout and snapshot),
your environment values, your Docker secrets and network, your proxy. **What you take new each time:** the
bundle's `portainer-swarm.yml` or `portainer-compose.yml`, used unchanged.

Until version 1.0.0, each candidate is installed fresh: delete the volumes and
follow [DEPLOY.md](DEPLOY.md) from the start. From 1.0.0 on, the steps below
update an existing deployment in place.

## Before you update

1. Get the new bundle and check it ([VERSIONS.md](VERSIONS.md#checking-a-bundle)).
   Read its section in the [CHANGELOG](../CHANGELOG.md) for anything you need
   to do.
2. Note the image digest you're running now (the `image:` line of your current
   stack) and keep your current template. That's what you go back to.
3. [Back up both volumes](OPERATIONS.md#backing-up-the-volumes). A newer
   version may change how it stores the layout, and an older version isn't
   guaranteed to read that. The backup is what makes going back safe.

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

Put back the previous image **and** the backup you took before updating,
together:

1. Scale the service to 0 (or stop the Compose service).
2. [Restore the volumes](OPERATIONS.md#restoring-the-volumes) from the backup
   taken before the update.
3. Deploy your previous template (the one with the old digest), as in the
   update steps.

Going back to the old image without restoring its data can work, but isn't
something the project tests; changes you made after updating are lost when you
restore the backup, so export any dashboard you changed first
([USING.md](USING.md#snapshots-export-and-import)) and decide whether to
import it again.

Swarm's automatic rollback during an update only switches the image back; it
doesn't touch the volumes.

## Never mix versions

Studio's controller and its Homepage fork are built into one image and must
come from the same build. Don't run a separate or independently updated
Homepage image against Studio's volumes, and never point two Studio
containers at the same volumes.
