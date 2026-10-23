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
| `no basic auth credentials`, `denied` or `unauthorized` pulling from `ghcr.io` | The package isn't public yet: the bundle's `delivery-receipt.json` says `package-access-pending` ([VERSIONS.md](VERSIONS.md#checking-a-bundle)) |
| The health check stays `unhealthy` (on Swarm the task keeps being replaced) | `/__studio/application-ready` fails: the dashboard registry is damaged or missing after initialization, a volume isn't writable by UID 1000, or the volumes don't match. The endpoint's JSON answer names the problem. Restore the volumes from a backup if the registry is gone ([OPERATIONS.md](OPERATIONS.md#restoring-the-volumes)) |
| Permission errors on `/app/config` or `/app/state` | You replaced a named volume with a bind mount that UID 1000 can't write. `chown -R 1000:1000` that folder; Studio doesn't run as root to fix it |

## The page doesn't load

| What you see | Cause and fix |
| --- | --- |
| `403` with `This dashboard address is not in HOMEPAGE_ALLOWED_HOSTS.` | The browser (or proxy) used a different host or port than `STUDIO_PUBLIC_ORIGIN`. Open the exact origin; make the proxy pass the original `Host`; or change the origin and redeploy. Only one host name is accepted |
| `502` or `504` from the proxy | The proxy can't reach port `STUDIO_PORT` on the node, or the container isn't healthy yet (first start can take up to two minutes) |
| The page loads but has no styles or icons | The proxy isn't routing the whole host to Studio, or it rewrites paths. `/_next/static/` and the root icon files must reach it ([REVERSE-PROXY.md](REVERSE-PROXY.md)) |
| A page that says **This dashboard isn't available** (`404`) | Nothing is at that address: the dashboard was renamed, archived or never existed. **Open the main dashboard**, then pick it from **Dashboard settings → Manage dashboards**. An archived one can be restored there |
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
