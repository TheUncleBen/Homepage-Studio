# Troubleshooting

Start with the log. It says why almost everything fails.

```bash
docker service logs --tail 100 homepage_studio                                          # Swarm, stack named homepage
docker compose --project-name homepage --file portainer-compose.yml logs --tail 100 studio  # Compose
```

Then find the symptom below. What the health endpoints mean is in
[OPERATIONS.md](OPERATIONS.md#logs-and-health).

## The container doesn't start

| What you see | Cause and fix |
| --- | --- |
| Compose or Portainer refuses the stack: `Set the exact dashboard URL origin` | `STUDIO_PUBLIC_ORIGIN` is missing. Add it |
| Swarm refuses the stack: `Set the exact Swarm node hostname that owns the persistent volumes` | `STUDIO_NODE` is missing. Add it, exactly as `docker node ls` shows the hostname |
| Refused with `Set STUDIO_IMAGE to the qualified application image digest` | You're using the repository's template, which has no image. Use the one from a bundle ([VERSIONS.md](VERSIONS.md)) |
| Log: `STUDIO_PUBLIC_ORIGIN must be the exact HTTP(S) dashboard origin.` and the container exits | The origin has a path, query, credentials or another scheme. Use only `https://host` or `http://host:port` |
| Log: `STUDIO_FRAME_ANCESTORS entry "..." is not 'self' or an exact http(s) origin ...` | Fix the entry: space-separated, `'self'` or exact origins without paths or wildcards, the whole value in double quotes in a `.env` file ([REVERSE-PROXY.md](REVERSE-PROXY.md#framing)) |
| Log: `STUDIO_RENDERER_MAX_WORKERS must be an integer between 1 and 64.`, or the same for *Renderer idle duration* or *Renderer startup duration* (shown in milliseconds) | The value is out of range or not a whole number ([OPERATIONS.md](OPERATIONS.md#workers-and-limits)) |
| Swarm: the task stays `pending` with `no suitable node` | `STUDIO_NODE` doesn't match a node's hostname |
| The deploy fails with `network "homepage-studio" is declared as external, but could not be found` | Create the shared proxy network first ([DEPLOY.md step 2](DEPLOY.md#2-shared-proxy-network-once)), or set `STUDIO_NETWORK_NAME` to your network's exact name (names are case-sensitive). On a Swarm it must be an overlay network |
| Swarm: the deploy or the task fails saying a secret such as `studio_auth_key` is not found | Create all four secrets before deploying, with exactly these names ([DEPLOY.md step 5](DEPLOY.md#5-docker-secrets)). One you don't use holds the word `off` |
| Compose refuses the stack: `Set STUDIO_SECRETS_DIR to the absolute folder that holds the four secret files` | Set `STUDIO_SECRETS_DIR` ([DEPLOY-COMPOSE.md](DEPLOY-COMPOSE.md#3-secret-files)) |
| Log: `STUDIO_AUTH_KEY_FILE (/run/secrets/studio_auth_key) is empty or says off.` | The encryption key secret can't be `off`. Recreate it with long random text ([DEPLOY.md step 5](DEPLOY.md#5-docker-secrets)); if Studio ran with a key before, use that same key |
| Log: `STUDIO_OIDC_CLIENT_SECRET_FILE ... is empty or says off` | Single sign-on is configured but its secret says `off`. Put the client secret in it ([DEPLOY.md step 5](DEPLOY.md#5-docker-secrets)), or remove `STUDIO_OIDC_ISSUER` and `STUDIO_OIDC_CLIENT_ID` |
| Log: `... _FILE could not be read. Check the secret mount.` | Compose: a file is missing from `STUDIO_SECRETS_DIR`, or UID 1000 can't read it (`chown 1000:1000` the folder and files) |
| `no basic auth credentials`, `denied` or `unauthorized` pulling from `ghcr.io` | The package isn't public yet: the bundle's `delivery-receipt.json` says `package-access-pending` ([VERSIONS.md](VERSIONS.md#checking-a-bundle)) |
| The health check stays `unhealthy` (on Swarm the task keeps being replaced) | `/__studio/application-ready` fails: the dashboard registry is damaged or missing after initialization, a volume isn't writable by UID 1000, or the volumes don't match. The endpoint's JSON answer names the problem. Restore the volumes from a backup if the registry is gone ([OPERATIONS.md](OPERATIONS.md#restoring-the-volumes)) |
| Permission errors on `/app/config` or `/app/state` | You replaced a named volume with a bind mount that UID 1000 can't write. `chown -R 1000:1000` that folder; Studio doesn't run as root to fix it |

## Sign-in

| What you see | Cause and fix |
| --- | --- |
| A page saying **Studio needs HTTPS before anyone can sign in** (`503`) | Sign-in is on but `STUDIO_PUBLIC_ORIGIN` is `http://` on an address other than localhost. Put Studio behind an HTTPS proxy and use the `https://` origin, or set `STUDIO_AUTH=off` if your proxy already controls access ([AUTHENTICATION.md](AUTHENTICATION.md)) |
| Every address goes to **Create the administrator** | No account exists yet. Create it now; until then every dashboard is locked |
| `503` with `Sign-in storage is unavailable` | `/app/state/auth` can't be read or holds damaged data. Check the state volume's permissions (UID 1000) and the log. Studio stays closed rather than open; restore the volume from a backup if the files are damaged |
| A member sees **No dashboards have been shared with you yet** | Nothing is shared with them or their groups. **Administration → Dashboard access** |
| A dashboard says it isn't available for one person but works for another | It isn't shared with that person; unshared dashboards look like missing ones on purpose |
| **Confirm it's you** keeps appearing | Security changes need a sign-in within the policy's confirmation window (15 minutes by default) |
| Passkey prompt fails with a security error | The browser's address isn't exactly `STUDIO_PUBLIC_ORIGIN`. Passkeys are bound to that host name |
| Single sign-on says it can't reach the provider | Studio couldn't load `<issuer>/.well-known/openid-configuration`. Check `STUDIO_OIDC_ISSUER` (for example, with Authentik: `https://<authentik>/application/o/<slug>/`) and that the container can reach it |
| Nobody can sign in at all | Use [command-line recovery](AUTHENTICATION.md#lost-access-command-line-recovery) |
| Sign-in throttling or the activity log shows only the proxy's address | Set `STUDIO_TRUSTED_PROXIES` to the shared network's subnet ([REVERSE-PROXY.md](REVERSE-PROXY.md#how-the-proxy-reaches-studio)) |

## The page doesn't load

| What you see | Cause and fix |
| --- | --- |
| `403` with `This dashboard address is not in HOMEPAGE_ALLOWED_HOSTS.` | The browser (or proxy) used a different host or port than `STUDIO_PUBLIC_ORIGIN`. Open the exact origin; make the proxy pass the original `Host`; or change the origin and redeploy. Only one host name is accepted |
| `502` or `504` from the proxy | The proxy can't reach Studio: it isn't on the shared network (exact name, and redeployed after you added it), the forward host isn't `homepage_studio` port `3000` (your stack name, underscore, `studio`), or the container isn't healthy yet (first start can take up to two minutes). [DEPLOY.md step 8](DEPLOY.md#8-reverse-proxy) has a command to test from the proxy |
| The page loads but has no styles or icons | The proxy isn't routing the whole host to Studio, or it rewrites paths. `/_next/static/` and the root icon files must reach it ([REVERSE-PROXY.md](REVERSE-PROXY.md)) |
| A page that says **This dashboard isn't available** (`404`) | Nothing is at that address: the dashboard was renamed, archived or never existed. **Open Dashboards** and pick it there. An administrator can restore an archived one under **Archived** on that page |
| The bare host name jumps to `/something` | The main dashboard has an address of its own; that redirect is expected |
| Studio refuses to appear inside another site's frame | Framing is same-origin only by default. Set `STUDIO_FRAME_ANCESTORS` ([REVERSE-PROXY.md](REVERSE-PROXY.md#framing)) |
| Studio is under a path (`https://host/studio/`) and nothing works | Not supported. Give it its own host name |

## Editing and saving

| What you see | Cause and fix |
| --- | --- |
| `403` *Open the editor from your dashboard.* or *Open this request from your dashboard.* | An editor or widget request came from another site, or with an `Origin` that isn't `STUDIO_PUBLIC_ORIGIN`. Use the dashboard at its exact origin. A proxy that rewrites the scheme (`http` vs `https`) causes this too |
| `413` *This request exceeds the 2 MiB configuration limit.* | One file or request is over 2 MiB. Split large content, or keep it out of the YAML |
| `413` on **Import dashboard**, often from the proxy itself | The proxy's body limit is below 40 MiB, or the backup really is larger ([REVERSE-PROXY.md](REVERSE-PROXY.md#request-limits)) |
| `413` or `408` from a widget action | The body sent to a native route was over 1 MiB, or took over 30 seconds to arrive |
| `503` *Studio is receiving too many dashboard requests at once.* | Many widget actions were uploading at the same moment (over 32 MiB in total). Retry after the `Retry-After` seconds |
| A save is refused because the dashboard changed | Someone else saved first. Your draft stays on screen; reload to see their change and redo yours |
| *... contains invalid YAML at line N, column M.* | Fix the YAML at that spot. Also refused, with their own message: infinity-like values (`.inf`, `.nan`) and self-referencing aliases aren't accepted; quote them if they're meant as text |
| *All dashboard renderers are busy ...* | More dashboards in use at once than `STUDIO_RENDERER_MAX_WORKERS`. Retry, or raise the limit ([OPERATIONS.md](OPERATIONS.md#workers-and-limits)) |
| `config-ready` or `ready` answers `503` saying older snapshots could not be removed | Snapshot cleanup can't delete files: check the state volume's permissions and free space. Saves still work |
| One dashboard answers with an error while the others work | Its own files are broken, for example an invalid `settings.yaml` edited outside Studio. `/<dashboard>/__studio/config-ready` returns the error. Fix that file in the config volume, or restore a volume backup. The other dashboards and the container's health aren't affected |

## Gestures

| What you see | Cause and fix |
| --- | --- |
| A hold on a widget doesn't pick it up | The touch started on something the widget handles itself (a link, button, field, chart, embedded page or a sideways-scrolling area). Hold on a plain part of the panel, or on its title bar |
| A swipe on a widget scrolls its content instead of changing slides | Same reason: the swipe started inside content that scrolls sideways. Swipe on the stack's title bar |
| The page scrolls instead of picking a panel up | You moved before the hold completed (about half a second). Hold still first |
| The title list doesn't open | It opens only on a short tap or click on the title, and not in edit mode. A swipe, drag or long press is deliberately ignored |
| A slideshow doesn't play by itself | Its start behavior is *Manual* (the default), or the device asks for reduced motion. Press **Play** |

Still stuck? The log line for the failing request usually names the cause;
include it when you report a problem.
