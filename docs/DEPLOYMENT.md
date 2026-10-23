# Deployment

Studio deploys one complete application image. Its public Node controller and
controlled Homepage runtime share one version, image, UID and lifecycle. Native
workers are private child processes, created on demand per dashboard. The root
templates define one `studio` service and two persistent volumes; no public
Homepage or companion renderer service is required.

The single-container revision must complete the gates in
[VERIFICATION.md](../VERIFICATION.md) before a deployment-ready candidate is
claimed. The historical companion candidate is not qualification for this source.

## Installation contract

Use the digest-pinned Compose or Swarm template from a delivered candidate or
approved release bundle. The candidate image must identify both `linux/amd64`
and `linux/arm64`, its exact source commit and matching corresponding source.
Portainer pulls the existing image; it does not compile source.

| Value | Meaning | Default |
| --- | --- | --- |
| `STUDIO_IMAGE` | Exact qualified application index digest in source templates; delivered templates already pin it | Required |
| `STUDIO_PUBLIC_ORIGIN` | Exact external HTTP(S) origin, including a nonstandard port when used, without a dashboard slug | Required |
| `STUDIO_PORT` | Host port mapped to controller port 3000 | `3000` |
| `STUDIO_NODE` | Swarm node hostname holding both named volumes | Required for Swarm |
| `STUDIO_BACKUP_RETENTION` | Snapshots retained for each dashboard | `25` |
| `STUDIO_RENDERER_MAX_WORKERS` | Maximum simultaneously resident native dashboard workers | `8` |
| `STUDIO_RENDERER_IDLE_SECONDS` | Idle worker lifetime before reclamation | `600` |
| `STUDIO_RENDERER_STARTUP_SECONDS` | Native worker startup deadline | `30` |
| `STUDIO_FRAME_ANCESTORS` | Space-separated origins allowed to show the dashboard in a frame; see [framing](#response-headers-and-framing) | Empty (same origin only) |

For example, the shared origin can be `https://homepage.example.test` while
dashboard addresses are `/admin`, `/family` and `/dashboard-1`. Configure the
origin once, then manage slugs inside Studio. A slug does not require another
accepted hostname or container. HTTPS, DNS, proxy routing and external access
controls remain part of the deployment owner's network configuration.

An external proxy must preserve the full dashboard path and query, the original
accepted Host header, and supported upgrade/streaming traffic when used. It must
route the entire application origin, including shared `/_next/static/` assets and
global `/__studio/` management endpoints, to the controller. Do not strip a slug
or rely on Referer/last-selected state to choose a dashboard. Normal configuration
requests are bounded to 2 MiB of serialized JSON. Complete dashboard imports can
use up to 40 MiB of serialized JSON, while each imported file/state remains
limited to 2 MiB. An external proxy with a lower body limit can reject an otherwise
valid import before Studio sees it; configure the intended limit externally.

Native `HOMEPAGE_VAR_*` values, `HOMEPAGE_FILE_*` file references and necessary
secret mounts belong on the single `studio` container. Adding a variable to
Portainer's substitution list alone does not inject it into that container;
explicitly declare the corresponding container environment or mount in the
deployment. These infrastructure inputs are shared by the deployment even though
each dashboard chooses its own references. Use only the mounts required for the
actual native integrations; the supplied product templates mount no Docker
socket and do not presume any service inventory.

The entrypoint derives the exact native allowed host and health-check Host header
from the configured origin. Do not use a wildcard or put a path/query/fragment in
the origin. Controller port 3000 is the only product port published. Workers use
random loopback-only ports inside the container. Native authentication and MCP
configuration writes are disabled in the controlled runtime.

## Response headers and framing

The controller adds these headers to the pages and responses it serves:

- `Content-Security-Policy: frame-ancestors 'self'` with
  `X-Frame-Options: SAMEORIGIN`, so only pages on the same origin can show the
  dashboard in a frame;
- `X-Content-Type-Options: nosniff`;
- `Referrer-Policy: same-origin`.

The native runtime no longer sends `X-Powered-By`.

To embed a dashboard elsewhere, for example in a Home Assistant panel, set
`STUDIO_FRAME_ANCESTORS` to the allowed origins separated by spaces, not
commas. Each entry is `'self'` (with the quotes) or an exact `http`/`https`
origin with an optional port and no path, query, wildcard or credentials. The
list replaces the default, so include `'self'` to keep same-origin framing:

```sh
STUDIO_FRAME_ANCESTORS='self' https://ha.example.test:8123
```

When the value is set, `X-Frame-Options` is omitted because it cannot list
several origins. An unset or empty value keeps the default. An invalid entry
stops the application at startup with an error naming the variable. A framing
page can trigger native widget actions in the embedded dashboard, so allow only
origins you trust as much as the dashboard itself.

## Integration transport and trust

Studio and native API routes enforce the accepted Host, configured browser
Origin and Fetch Metadata checks after selecting the dashboard. Cross-site and
same-site browser contexts are rejected; native same-origin actions do not need
the Studio editor header. Direct API clients without an Origin remain supported.
These checks do not authenticate a caller, and a dashboard slug does not separate
trusted administrators.

Use the canonical URL for a service that requires credentials. The shared native
HTTP helper preserves same-origin behavior, but a redirect to a different
scheme, hostname or port strips credential headers and URL authentication,
refuses a preserved request body, and disables cookie-jar reads/writes for the
rest of that chain. A redirect rewritten to GET can continue without its body.
Direct requests still use the dashboard's normal domain/path cookie jar; cookies
are not isolated by integration or port. Separate dashboard workers retain
separate jars.

The shared helper enforces a 45-second total deadline for each outbound request,
including its full redirect chain, and separate 32 MiB transferred/decoded limits
on the final response body. Redirect-response bytes are not summed into that
body budget. A smaller internal caller timeout may finish earlier. Overlong,
open-ended, oversized or invalidly compressed responses fail with controlled
diagnostics and socket cleanup. A multi-step login/retry adapter may make several
separately bounded requests. These bounds are not a process memory ceiling, a
total multi-step endpoint deadline, or a limit on every separate native
WebSocket/transport implementation. No new dashboard setting changes them.

The inherited shared HTTPS agent and TrueNAS WebSocket path explicitly disable
server certificate verification. Traffic is encrypted, but those paths do not
reject an untrusted certificate or a certificate-presenting network intermediary.
No exposed configuration switch enables verified TLS for the shared helper;
adding `NODE_EXTRA_CA_CERTS` does not override `rejectUnauthorized: false`.
Docker client's separate CA/client-certificate configuration does not change
widget HTTP behavior. This self-signed/private-service compatibility is retained
and must be included in the deployment's integration-network trust decision.

Common transport diagnostics omit URL credentials, path/query/fragment and raw
transport errors. The review corrected the identified shared and selected
adapter log paths; it did not certify every adapter's upstream error payload or
legacy debug log. Editor exports can still contain inline configuration secrets
by design. Keep the whole application origin behind the owner's intended access
boundary.

## Persistence and dashboards

Both controller and workers run as UID/GID 1000. Application code in the image
is owned by root and is not writable by that user; only `/app/config` and
`/app/state` are. Named volumes created by the image use that ownership. Existing bind mounts must be writable by the same UID;
private state directories use mode 0700. The application does not chown arbitrary
host directories or run as root to repair permissions.

| Persistent location | Contents |
| --- | --- |
| `/app/config` | Original dashboard's nine native files, the dashboard registry and its initialization marker |
| `/app/state` | Original dashboard identities/layout, journal and snapshots |
| `/app/config/dashboards/<immutable-id>` | Each additional dashboard's nine native files |
| `/app/state/dashboards/<immutable-id>` | That dashboard's identities/layout, discovery state, journal and snapshots |

Each dashboard owns services, service widgets, information widgets, bookmarks,
native settings, Docker/Kubernetes/Proxmox configuration, custom CSS and custom
JavaScript. Layout, stack membership/playback preferences, theme and colors are
independent. Create an empty dashboard or duplicate a configured one, then edit
either without changing the other. Address/name changes preserve the immutable
ID. Archiving preserves files and history, reserves its slug and stops serving
the page; restore returns it with the same data.

The original dashboard remains in place when registry support is initialized.
An initialized deployment with a missing/corrupt registry fails visibly instead
of silently inventing a new empty list. Preserve the registry, marker and both
volume trees together in host backups. Slugs are organizational addresses, not
access-control boundaries; trusted users who can use the editor on this origin
can manage the deployment. Studio adds no user authentication platform.

Portable export/import includes one dashboard's nine files and Studio state.
It does not include deployment environment variables, mounted secret files,
sockets or external credentials stored outside those files.

Snapshots keep earlier versions of each file, up to the retention count
(`STUDIO_BACKUP_RETENTION`, 25 by default). A credential written inline into a
native file therefore stays readable through the snapshot history after you
rotate it. After rotating an inline secret, delete the older snapshots, or keep
secrets out of the files with `{{HOMEPAGE_VAR_...}}` or `{{HOMEPAGE_FILE_...}}`
references so that snapshots only hold the reference. A snapshot belongs
to one dashboard. Import into another dashboard is an explicit validated action
using the destination revision and a recovery snapshot.

## Compose and Swarm

`portainer-compose.yml` runs one service with `restart: unless-stopped` and a
30-second stop grace. It can be deployed as its own stack or incorporated into an
existing stack with intentionally distinct service/volume names and an unused
published port.

`portainer-swarm.yml` uses the legacy Compose v3.8 format, one replica, a single
selected storage node, host-mode publication and stop-first update/rollback.
Both production stability monitors remain 180 seconds. Local named volumes are
node-local: moving the service to another node requires deliberately moving the
complete configuration and state. Do not scale the controller to multiple writers
against these same volumes. Keep the 30-second container stop grace.

The actual Docker CLI `stack config` parser is a required gate. Required-value
messages intentionally contain no hyphens because the tested legacy parser can
misinterpret default-operator syntax inside those messages. Template guards are
retained for image, origin and Swarm node.

### Container hardening

The image runs as UID/GID 1000 with root-owned application code. It contains
no setuid, setgid or file-capability binaries; `ping` uses unprivileged ICMP
sockets, which Docker allows inside containers through its default
`net.ipv4.ping_group_range`. Both templates set `cap_drop: [ALL]`.

| Option | Compose template | Swarm template |
| --- | --- | --- |
| `cap_drop: [ALL]` | Set and applied | Set; `docker stack deploy` applies it with Docker 20.10 or later |
| `init: true` (docker-init reaps orphaned child processes) | Set | Set; kept by the Swarm stack parser (CI lifecycle runs confirm the service starts with it) |
| `security_opt: [no-new-privileges:true]` | Set and applied | Not set: `docker stack deploy` ignores `security_opt` |
| Read-only root filesystem | Not set | Not set |

A read-only root filesystem is not yet qualified. If you add your own limits
such as `mem_limit` or `deploy.resources`, leave room for the configured number
of native workers.

Port 3000 is published on every host interface. With Compose, add
`host_ip: 127.0.0.1` (or another address) to the port entry to listen on one
address only, for example behind a reverse proxy on the same host. Swarm
host-mode ports cannot bind a single address; use a host firewall instead.

## Health and worker behavior

Global `/__studio/application-ready` validates the dashboard registry, shared
storage and complete standalone runtime/assets without requiring a dashboard
worker to start. Docker health uses that endpoint. Selected
`/[slug]/__studio/config-ready` checks that dashboard's configuration/storage;
`/[slug]/__studio/ready` also requires its native build/protocol handshake.

A broken default dashboard must not restart the container or block other valid
dashboards, shared assets or deployment management. A shared registry/storage or
runtime failure makes global health fail. Native worker crashes are recovered on
a subsequent request, using the same persisted dashboard configuration. Changing
a slug or archive state drains obsolete worker contexts.

Worker limits bound resource use. Idle workers can be reclaimed; active requests
are not silently evicted when capacity is exhausted. The native process startup
deadline and global browser/test budgets are not substitutes for adequate memory
on the target host. The dashboard count and concurrently active workers are
separate limits.

The registry supports 64 dashboards including archived entries. Worker count
accepts 1–64. Idle duration is bounded to 10 ms–24 hours and startup to
50 ms–120 seconds; environment values are expressed in seconds. The documented
600/30-second defaults are the normal starting point. These are resource limits
within one container, not tenant-security guarantees.

Discovery does not occupy the configuration writer queue while waiting on a
provider or starting a cold worker. Concurrent explicit refreshes for a dashboard
coalesce. State/board/export reads and complete-board saves attempt fresh
membership; structured local edits, raw saves without a board, retained-source
visibility, restores and imports do not wait for that provider. Revision and
identity checks still apply, and a slow follow-up refresh cannot undo a committed
save. Failures retain unavailable source metadata and report the condition.
The metadata request deadline is five seconds after worker acquisition; the
startup deadline is separate. See the exact endpoint policy in
[architecture](ARCHITECTURE.md#native-discovery).

## Build and qualification

The root Dockerfile directly copies the controlled `homepage/` tree. It uses the
pinned Node image, verifies the pinned pnpm package integrity, installs frozen
dependencies and produces a production standalone build. Production dependency
audits, redirect security checks and full native lint/tests run once per workflow
in the required `native-checks` CI job; see [VERIFICATION.md](../VERIFICATION.md). It packages the
controller, native runtime, assets, shared configuration helpers, GPL/AGPL and
font/dependency notices in the final image. Eligible immutable Next build assets
are precompressed as Brotli/gzip representations when smaller. The controller
negotiates and streams those files with representation-specific cache validators;
it does not compress configuration or integration responses at request time.
An external proxy must respect `Vary: Accept-Encoding` and the response's
Content-Encoding and must not apply a second encoding to an already encoded body.

The runtime apt install explicitly refreshes inherited `perl-base` alongside its
existing runtime packages. The pinned Node base predates Debian's Bookworm
`5.36.0-7+deb12u4` security update; the build does not migrate distributions or
perform a blanket package upgrade. Confirm the resulting package version in each
qualified image instead of treating the Dockerfile edit as proof of remediation.
See [Debian's Perl security record](https://security-tracker.debian.org/tracker/source-package/perl).

OS advisory review is separate from npm/pnpm production dependency audits. Record
the exact architecture child/config digests, scanner provenance, database time,
package inventory, fixed/unfixed findings and vendor applicability decisions in
the qualification evidence. Remote image scanning inspects packages without
executing that architecture. It does not replace container acceptance, prove
application reachability, or establish that every residual advisory is harmless.
The reviewed Perl update does not promise zero remaining OS findings; a new image
needs its own scan. Actual scan results belong in the candidate's verification
report, not an inferred pass from this build description.

The source guard rejects modified tracked source and ignored/untracked inputs
within every Docker-copied subtree. Docker-excluded generated dependencies/build
outputs are allowed locally and excluded from corresponding source. One
deterministic `studio-source.tar.gz` binds the complete source and licenses to
the exact candidate commit. See [native source](NATIVE-SOURCE.md).

Both native architecture jobs must qualify the actual complete image through
direct Compose/Swarm and pinned Portainer CE 2.45.2. The runtime fixture covers
fresh nine-file configuration, real-volume adoption of existing root data and
snapshots, `/admin` address/root-redirect preservation, independent dashboards/layouts/stacks, duplication
and divergence, rename/archive/restore/import, foreign-snapshot rejection,
persistence after restart/replacement, actual UID/loopback workers, child-crash
recovery, default-dashboard failure isolation and exact snapshot retention.
Portainer tests deploy the unchanged templates and explicit environment through
its real API, verify image identity, replacement, retained data and cleanup.
Its temporary loopback registry and Docker socket belong only to the disposable
test infrastructure and never become product mounts.

Chromium runs the full production suite, including scoped dashboard behavior and
intentional stack-title selection. Firefox and WebKit run the designated desktop
gates. A headed browser checks real hidden-document timer suspension. The
expanded full suite has a 15-minute aggregate budget and a 16-minute parent
deadline; individual test/action bounds stay unchanged and retries remain zero.
Cleanup failure fails qualification. No real external integrations or owner
host deployment are implied by these fixtures.

## Upgrades and rollback

Keep the previous digest-pinned application image and a matching complete backup
of configuration and state. Stop the old application before another writer uses
those volumes. Deploy the complete new image and verify global plus selected
dashboard readiness. For rollback, restore the previous image and its matching
data set together. Do not combine the controlled controller with a public or
independently updated Homepage renderer.

An engineering candidate contains exact source, image, templates, verification
and a delivery receipt proving anonymous runtime-layer availability. Human
acceptance covers the intended physical device, network/Portainer host, real
integration credentials and visual preference after engineering gates are
complete. Official dated promotion is separate and reuses those accepted bytes;
see [candidates](CANDIDATES.md) and [release policy](RELEASES.md).
