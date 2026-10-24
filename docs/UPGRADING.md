# Updating Homepage Studio

An update is the same deployment with a new bundle's template: the image line
changes to the new digest, your values and volumes stay. Studio never updates
itself, and since there's no `latest` tag, nothing changes until you deploy a
new template.

**What stays as it is:** both volumes (every dashboard, layout and snapshot),
your environment values, your Docker secrets and network, your proxy. **What you take new each time:** the
bundle's `portainer-swarm.yml` or `portainer-compose.yml`, used unchanged.

## Updating to the version with Docker secrets and no published port

From this version the templates read Studio's keys and passwords from Docker
secrets, publish no port, and join a network shared with your reverse proxy.
A stack deployed from an earlier bundle needs these one-time steps before you
paste the new template. Your volumes, dashboards and accounts stay.

1. **The network.** Create it and attach your proxy, as in
   [DEPLOY.md step 2](DEPLOY.md#2-shared-proxy-network-once). If your proxy
   already shares a network with other services, you can use that one: set
   `STUDIO_NETWORK_NAME` to its exact name.
2. **The secrets.** Create `studio_auth_key`, `studio_oidc_client_secret` and
   `studio_smtp_password` as in [DEPLOY.md step 5](DEPLOY.md#5-docker-secrets),
   with one difference: **if you had set `STUDIO_AUTH_KEY`, put that same
   value in `studio_auth_key`**. A new key means everyone sets up their
   authenticator app again and single sign-on sessions end. Likewise, use your
   current single sign-on client secret and mail password, or `off`.
3. **The variables.** In the stack's environment variables, remove
   `STUDIO_AUTH_KEY`, `STUDIO_AUTH_KEY_FILE`, `STUDIO_OIDC_CLIENT_SECRET`,
   `STUDIO_OIDC_CLIENT_SECRET_FILE`, `STUDIO_SMTP_PASSWORD`,
   `STUDIO_SMTP_PASSWORD_FILE` and `STUDIO_PORT`. The new template doesn't read
   them, so leaving them only leaves the values on display. Set
   `STUDIO_TRUSTED_PROXIES` to the network's subnet.
4. **The update.** Paste the new template as in the update steps below.
5. **The proxy.** Point the proxy host at `homepage_studio:3000` (your stack
   name, underscore, `studio`) instead of the node's address and port
   ([DEPLOY.md step 8](DEPLOY.md#8-nginx-proxy-manager)). Studio is
   unreachable through the proxy between steps 4 and 5.

If the new task doesn't start, `docker service ps --no-trunc homepage_studio`
names what's missing: usually a secret or the network.

## Updating to the version with sign-in

Studio sign-in is **on by default** from this version
([AUTHENTICATION.md](AUTHENTICATION.md)). Before you update:

- **It needs HTTPS.** If people reach Studio at an `http://` address other
  than localhost, either move it behind an HTTPS proxy and change
  `STUDIO_PUBLIC_ORIGIN` to the `https://` address, or add `STUDIO_AUTH=off`
  to keep the old behavior (access controlled by your proxy). On plain HTTP
  with sign-in on, Studio starts but shows only a page explaining this.
- **Open it straight after the update.** Every dashboard is locked until the
  first visitor creates the administrator account. Do that yourself before
  anyone else can.
- Set `STUDIO_TRUSTED_PROXIES` (real client addresses behind your proxy).
  The encryption key comes from the `studio_auth_key` Docker secret (above).

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
curl -s https://homepage.example.test/__studio/application-ready
# "buildRevision" is the new bundle's source commit
curl -s https://homepage.example.test/__studio/ready
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
