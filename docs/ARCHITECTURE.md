# Architecture

## One application lifecycle

The complete controlled Homepage source is tracked under `homepage/`. One Docker
image contains the public Node controller and the compiled native Next.js
runtime. The controller publishes port 3000; native child workers bind only
loopback. Every process runs as UID/GID 1000. No companion image, upstream source
fetch or generated overlay participates in deployment. The Git commit/tree and
locked dependencies identify the complete build; the baseline Homepage commit
remains recorded as provenance. See [native source](NATIVE-SOURCE.md).

The native runtime retains Homepage's widget components, status behavior,
bookmarks and integration proxies. Studio owns page composition and editing.
The controller handles host/origin validation, the global registry, selected
configuration APIs and routing into each worker. A shared environment/YAML
implementation keeps application-wide indexing policy consistent with native
configuration semantics.

## Immutable build assets

The native build precompresses eligible text assets under `.next/static` into
Brotli and gzip sidecars only when they save bytes. Regeneration removes obsolete
sidecars, including when a source becomes too small to compress. The controller
streams the accepted representation directly, with `Vary: Accept-Encoding`,
representation-specific validators, correct HEAD/304 behavior, and the immutable
cache policy of these build-addressed assets. File resolution remains confined
to regular files inside the packaged asset tree. Configuration, integration
responses and per-dashboard custom CSS/JavaScript are outside this compression
step; it adds no request-time compression or worker startup dependency.

## Dashboard identity and isolation

The versioned registry `studio-dashboards.json` lives in the configuration root.
The original dashboard has ID `default` and uses the root configuration and
state paths. It has no slug until the first administrator (or, with sign-in
off, the first visitor) chooses one; until then only Studio's own pages open. New dashboards have immutable UUIDs; configuration lives under
`config/dashboards/<id>/` and state/history under `state/dashboards/<id>/`.
Changing a name or slug changes routing without moving identity or files.
Archiving retains data and reserves the address. Restoration reuses that identity.
The default dashboard remains present and may be renamed or given another slug,
but not left without one once chosen.

Registry writes are serialized, revision checked, validated and atomically
replaced. The initialization marker prevents a missing registry from silently
recreating an empty list over existing dashboards. Creates prepare the complete
dashboard before publication; a failed preparation never exposes a partial page.
Duplicates copy all nine files, layout identities and the dashboard logo, then diverge independently.
Snapshots and recovery journals belong to their dashboard; a snapshot ID from
another dashboard cannot be restored through the selected endpoint.

Each dashboard receives a separate native process, configuration directory,
module cache and request context. Native URLs, proxy/cache keys, cookies and
browser preferences are scoped to that context. Native secrets remain server-side;
only sanitized render metadata crosses the rendering bridge. Custom CSS and
JavaScript are selected per page. Public build assets are shared application
resources and remain available when one dashboard is invalid.

The worker pool defaults to 8 processes, a 600-second idle lifetime and a
30-second startup deadline. Requests lease the matching immutable ID and base
path; changed contexts drain old workers. Idle workers can be reclaimed, active
requests are not evicted merely to make room, capacity failures remain bounded,
and a crashed child is restarted on a subsequent request. Shutdown drains
requests and terminates the managed children within the container stop grace.
These are independent dashboard configurations within one lifecycle and resource
pool, not separate security principals or fully isolated operating systems.

## Health boundaries

Global `/studio/application-ready` checks a valid registry, writable shared
storage and packaged standalone runtime files/assets without launching a worker.
It is the Docker health command. Selected `/[slug]/studio/config-ready` checks
that dashboard's files and journal; `/[slug]/studio/ready` adds its native
build/protocol handshake. Root diagnostic paths select the original dashboard.
A damaged default settings file can make that selected dashboard unavailable
without restarting the container or blocking healthy named dashboards, shared
assets or deployment management. Shared registry/storage/runtime failures make
the global application unavailable and must fail clearly.

## Persistent model

Board version 3 has 24 columns and rows that scale with the column width (36 px at each layout's reference width, clamped to 18–64 px; `geometry.mjs` `rowHeight`), one to 20 pages, independently identified panels, and one-level stacks. Every panel and stack belongs to one page (`pageId`). Rectangles use integer x/y/w/h coordinates. Each native service, individual service widget, information widget, and bookmark has a stable identity. Stacks refer to panel IDs on their own page and have their own rectangle and playback preferences. Two visible units on the same page may not overlap. Removing a member from a two-member stack collapses the surviving member into an independent panel.

Board version 3 is not read from older state: the server refuses any other
version (`Unsupported board schema.`). Until version 1.0.0, a deployment that
held an earlier board is set up again from new (persistent data deleted);
there is no migration path.

Newly reconciled panels use the same first-free row-major placement as the
original allocator. A sparse 24-column occupancy index and cursors per rectangle
size avoid repeatedly scanning every prior rectangle. Persisted positions,
stack collapse, identity and geometry limits are
unchanged. The index is built only when a new placement is needed; it does not
allocate a dense grid up to every distant stored coordinate. The existing
4,096-panel ceiling remains a validation bound, not a device performance promise.

Panel titles are display text derived on the server. Information widgets use
the native display name from the shipped catalog ("Date & Time"), or a
title-cased type for an unknown one, and duplicates are numbered in
configuration order ("Date & Time 2"). Appending a widget never renames an
earlier one, and titles never change panel identities or the stored board.

Native locators are derived on the server. Browser board submissions can change geometry, grouping, and playback preferences, but cannot replace native source identities or supply new credential-bearing locators. When a service has both `widgets` and `widget`, the adapter retains the original source key and native proxy index: array indices are nonnegative and the singular widget uses -1.

A raw YAML type edit in an existing source slot preserves its panel identity after unchanged entries have reserved their identities. Structured rename/move/edit operations preserve identity explicitly. Snapshot restoration restores the source identities and board alongside configuration.

Structured editor patches contain changed keys only, preserving untouched null values, unknown native options, comments, and literal references. Service parents created solely for a standalone widget receive explicit Studio provenance. Removing their last widget may clean up that synthetic parent; ordinary or ambiguous legacy services are retained.

The renderer keeps native panel hosts in a stable keyed list. Position and visibility change without making a slide a newly mounted widget. Hidden stack members are inert. Playback state, active slide, elapsed time, and finger-following offsets are temporary client state and do not change the persisted revision.

The board is projected onto 24 columns at a board width of 940 px or more,
16 columns from 560 px (each tile becomes half or full width) and 8 columns
below that (every tile full width), rounding both edges of a tile with one
rule so tiles sharing a canonical edge stay adjacent.
Responsive editing must map projected rows back to the one canonical board,
including keyboard movement, while preserving the intended visible order across
adjacent or multi-row movement and mixed panel sizes. It does not introduce a
separate mobile layout. Unchanged snapped positions retain board/panel object
identities and do not resubmit the same arrangement. Releasing a pending hold
ends it even outside its header. Cancellation, blur, visibility loss, another
pointer or a modal opening cancels the applicable pending hold/drag. Search
(which replaces Homepage's Quick Launch) freezes playback and cancels pending
holds or active arrangement; closing it resumes only the remaining playback
time. Loop-wrap direction and rapid reversal
use transient navigation direction while native hosts stay mounted.

## Studio data beside the board

Each dashboard keeps these in its own state directory (the main dashboard in
the state root, others in `dashboards/<id>/`):

| What | Where | Notes |
| --- | --- | --- |
| Image library | `images/` and `images/images.json` | Logos (PNG, JPEG, WebP or SVG, up to 256 KiB each) and backgrounds (up to 3 MiB each); at most 200 images and 60 MiB per library. SVG goes through the same checks as dashboard logos (`server/dashboard-logo.mjs`). An image in use asks before it is deleted. |
| Saved connections | `studio-connections.json` (mode 0600) | Up to 100 named service addresses with an optional key, username and password. See *Saved connections* below. |
| Chart history | `history/<hash>.json` | One file per widget shown as a chart; see *Chart history*. Removed when the widget leaves the board. |
| Saved widgets | `studio-library.json` (mode 0600) | Up to 100 widgets saved for *This dashboard*; see *Saved widgets* below. This dashboard's saved looks stay in the board. |

Each signed-in person has `people/<user id>/` under the state root: images,
connections, saved widgets and up to 30 saved looks kept *Just me*
(`studio-library.json`), and their preferences. Widgets saved for *Everyone*
are in `studio-shared-library.json` in the state root. It is removed with the
account. Using a personal image or connection on a dashboard copies it into
that dashboard, so a dashboard never depends on an account.

### Saved connections

A widget refers to a saved connection with placeholders such as
`{{STUDIO_CONNECTION_<ID>_URL}}` and `{{STUDIO_CONNECTION_<ID>_KEY}}`. The
dashboard's renderer fills them in when it reads its configuration, so
changing a connection changes every widget that uses it. Keys, usernames and
passwords are write-only: the API reports only whether one is set, and an
empty field keeps the saved one. Only administrators can list, add or change
them.

Keys are stored in plain text in `studio-connections.json`, readable only by
the user Studio runs as. Whole-deployment backups (**Administration →
Backups**, `node server/backups.mjs`) copy the state volume, so they contain
the keys in plain text too, as does any copy of the volume: keep backups as
safe as the keys themselves. A dashboard's export lists each connection's name
and address but never its keys; importing it asks for the keys again.

### Saved widgets

A saved widget is a widget's configuration only: its kind and type, its
settings, name, link and status check, look and behaviour. Never its size or
place, which belong to each dashboard's layout for each size. The server reads
it from the widget on the board, so keys typed into a widget never pass
through the browser, and the API gives a browser only a saved widget's name
and type. One saved for *Just me* or *Everyone* also carries the saved
connections it uses, keys included, because those are kept per dashboard;
placing it on another dashboard copies them there (a connection with the same
name already there is refused rather than replaced). Saved widgets have the
same plain-text storage as saved connections. Saving, listing and placing
them is administrator-only; anyone who may arrange a dashboard can keep saved
looks *Just me*. A dashboard's export carries its saved widgets without any
connection keys.

### Test connection

In the widget dialog, **Test connection** sends the draft widget's first
request through the dashboard's renderer, exactly as the widget would, and
answers in plain words (for example, the address could not be reached, the
key was refused, or the certificate is not trusted). It needs the
administrator level, takes at most 20 seconds, and never returns the
service's response or the key.

### Chart history

Widgets shown as a chart (line, area, bar, donut, pie or gauge), or with a
trend under their hero value or colour rules on a value, need past numbers.
Widgets shown as **Status history** need past status checks instead: for
those the renderer runs the card's own check (site monitor or ping, with the
service's address as fallback) and keeps whether it was up (1 or 0) and the
response time.
The controller asks each dashboard's renderer for them once a minute
(`/api/studio/collect`, which only the controller can call: it checks the
internal token from `STUDIO_INTERNAL_TOKEN`, and the controller removes every
`x-studio-*` header a browser sends). The renderer renders the widget's own
component on the server, runs its requests through the normal service proxy
and reads each number and its format from the formatter the widget uses. Only
numbers, their names and formats are kept; text and secrets are not.

The last 48 hours keep every sample. Older samples become 15-minute averages
(whole numbers stay whole) and are kept until the dashboard's retention ends:
7, 30 or 90 days, 30 by default (**Dashboard settings → Widget defaults →
Chart history**, shown only while a chart exists). People who can view the
dashboard read history with `GET /studio/api/history?panel=<id>&range=<range>`;
the widget dialog asks which chart formats fit with
`POST /studio/api/history/probe`, which needs the arrange level.

The collector keeps each dashboard with such widgets awake: its renderer
worker answers once a minute and never goes idle. Past the worker limit
(`STUDIO_RENDERER_MAX_WORKERS`, 8 by default) workers would be swapped in and out
every minute, so keep charts and status history to fewer dashboards than
that. The probe has no rate limit of its own; it needs the arrange level, and
each call renders one widget once.

### Status checks

A service's status dot uses its own `siteMonitor` or `ping` when it has one.
When it has none, Studio checks the service's own address instead. A
widget's **Status** can be set to web address, ping or off.

Each card with a status check has a card monitor (`card:<dashboard>:<panel>`)
in the observability engine. The controller's collector asks the
dashboard's renderer which address each card checks
(`/api/studio/status-targets`, internal token only, resolved exactly like
`siteMonitor` and `ping` with `fallback=1`) and keeps the card monitors in
step. Cards read `/<dashboard>/studio/api/panel-status`, which answers each
panel's state, timing and an error-class sentence (never a raw error), so
every browser shows the same status. When the engine is not available, or
a panel has no monitor yet, the card checks for itself as before.

## Monitoring and logs

Native monitoring, metrics and logs ([MONITORING.md](MONITORING.md),
[LOGS.md](LOGS.md)) run inside the application image; no external platform
is a runtime dependency.

- `server/observability/controller.mjs` is the controller side: the
  `/studio/api/ops/*` API, push heartbeats (`/studio/push/<token>`), HTTPS log
  intake (`/studio/ingest/logs`), card-monitor sync, redaction secrets and the
  pipes from the controller's console, worker output and sign-in audit.
- `engine.mjs` runs in a worker thread (restarted with backoff by `host.mjs`):
  the check scheduler (`checks.mjs`, `monitors.mjs`), incidents, notifications
  (`notify.mjs`), metrics, Docker reads (`docker.mjs`), syslog (`syslog.mjs`)
  and the log writer (`ingest.mjs`, `storage.mjs`). Definitions, secrets and
  trusted CAs are replayed to a restarted engine.
- `query-worker.mjs` answers log searches in another worker thread with
  read-only connections and a time budget, so a long search never delays
  checks or writes.
- Storage is `node:sqlite` under `/app/state/observability/`: `main.db`
  (monitor state, check results and rollups, incidents, metrics, segment
  index, personal details) and day-sized log segments with FTS5 in `logs/`
  and `audit/`. Retention drops whole segments; a disk budget removes the
  oldest first. The folder is outside backups and restores.

Access is per dashboard. A grant in Dashboard access may carry `monitoring`
and `logs`; `principal.operations(id)` answers them and administrators have
both everywhere. Every query is limited to the caller's scopes in the
controller, and `security` and `audit` events (restricted) are for
administrators only. With sign-in off, `/studio/operations`, the ops API,
intake and client error reports answer 404; card monitors and push URLs keep
working. Redaction runs before an event reaches storage.

### Built-in logos

Studio ships small offline copies (128 px WebP) of the
[Dashboard Icons](https://github.com/homarr-labs/dashboard-icons) logos
(Apache-2.0, see `NOTICE`) under `/studio-icons/webp/`, about 14 MB, so
built-in logos show without internet access. A logo newer than the bundled
set falls back to the project's CDN.

### Starter templates

**New dashboard** can start from a template (Homelab, Media or Family): link
tiles for common apps at placeholder `https://<app>.home.arpa` addresses
(`home.arpa` is reserved for home networks, so nothing outside is contacted),
plus a clock and a weather widget. The tiles' status checks start off, so
nothing shows an error until you change an address.

## Input handling

Pointer, touch and keyboard input share one arrangement model. Arranging
happens only on the editor page (`/<slug>/studio/edit`, served by the
dashboard's worker as `/studio-edit`); the live dashboard has no hold,
context-menu or long-press path into editing, and the settings page
(`/<slug>/studio/settings`, `/studio-settings`) opens the settings dialog
over the live board. Both pages need the arrange level; below it the
controller sends the visitor back to the live dashboard. Panel bodies use
`touch-action: pan-y`, so vertical page and content scrolling stay native,
while horizontal movement reaches the stack swipe. A touch or pen press that starts on native interactive content
is left to that content: links, buttons, form controls, labels, editable
content, iframes, embeds and objects, media, canvas and SVG charts, and
anything inside a horizontally scrolling element. In the editor, panels and stacks move by their move handle and resize
by their corner handle. The stack title keeps its own swipe handling; its picker opens only from
a click-gated short activation or the keyboard, never from a body gesture,
drag, long press, context menu or multi-touch, and not in edit mode.

Leaving the editor with a changed arrangement asks for confirmation before the
draft is discarded; a clean board leaves immediately.

While editing, a widget's select, move, edit and resize controls do not cover
every widget. With a mouse they show on the widget under the pointer, the one
with keyboard focus and selected ones. On a touch screen (`hover: none`) they
show only on the widget last tapped, a selected one or a focused one; a tap
on empty space hides them and a hold still opens the widget menu.

## Native discovery

A bounded, metadata-only native endpoint describes Docker/Kubernetes discovered
services and individual widgets. The controller accepts only the safe descriptor
schema from the selected dashboard worker; it never accepts a client-selected
URL or follows discovery redirects. The metadata request has a five-second
absolute timeout after worker acquisition, a 1 MiB response limit and a
4,096-source limit, including the retained/fresh union.

Concurrent refreshes for one dashboard share one in-flight provider read. The
store captures validated context under its serialized configuration queue, then
releases that queue before provider I/O or cold-worker startup. It applies the
result under the queue only if the nine-file native revision and private file
identity stamps still match. This detects a replacement followed by rollback to
identical bytes; a layout-only edit does not invalidate native membership.
Provider failure, an oversized union, or a changed configuration preserves safe
retained descriptors and reports unavailability. Refresh itself creates no
snapshot or background persistent write.

The following paths are relative to the selected dashboard's
`/studio/api/` prefix. Freshness is explicit, without a timer or TTL that writes
configuration in the background:

| Operation | Discovery policy |
| --- | --- |
| GET `state`, `board`, `export` | Await a coalesced fresh provider attempt. |
| POST `board`; POST `save` with its own `board` property | Await a fresh attempt before validating complete membership; a newly discovered identity can invalidate a submitted board even when file bytes are unchanged. |
| POST `save` without `board`; `service`, `service-widget`, `info-widget`, `bookmark`, `settings` | Use revision-checked local files and validated retained identities without waiting for a provider. |
| POST `discovery-visibility`, `restore` | Use known retained source identities or the validated snapshot and target revision; no provider wait. Unknown identities still reject. |
| POST `import` | Validate and commit the archive without discovery, then reset the destination cache. |
| Initialization, recovery, native forwarding, readiness | Do not start or wait on discovery. Recovery/writes still use the configuration queue. |

A failed fresh attempt can retain unavailable known sources; it is not a claim
that an unreachable provider's current inventory has been observed. An explicit
client refresh after a committed save may still wait for discovery. The client
must preserve that committed outcome rather than retrying the write.

Persisted and cached source descriptors retain panel geometry and stack membership when a discovery source is temporarily absent. Missing or ambiguous native content is displayed as unavailable instead of silently selecting a different service. Hiding a discovered panel is a Studio preference; it does not alter container labels or Kubernetes annotations. The add interface can restore hidden sources.

The controlled source directly implements the reviewed correction to native
Kubernetes lookups: each uses the selected worker's current file configuration
when invoked. Upstream merges must preserve this behavior and its tests.


## Configuration and recovery

Managed native files are services.yaml, widgets.yaml, bookmarks.yaml, settings.yaml, docker.yaml, kubernetes.yaml, proxmox.yaml, custom.css, and custom.js. YAML edits use an AST, bounded aliases, and the patched parser pinned in package-lock.json. Custom CSS and JavaScript are preserved as opaque text. The per-file limit is 2 MiB; ordinary requests also have a 2 MiB JSON limit, including JSON escaping overhead. Only a complete dashboard import has a larger 100 MiB serialized request limit; every imported native file and state.json still has a 2 MiB limit.

YAML values must remain representable in the editor's JSON transport. Cyclic aliases and non-finite numbers such as `.inf`, `.nan`, or an overflowing numeric literal are rejected before snapshots or writes. Ordinary aliases and merges, finite numbers, nulls, booleans, comments, unknown options, quoted text, and native environment/file references remain supported. Quote an infinity-like value when it is intentionally text. Invalid drafts remain available for correction; existing invalid files are not rewritten automatically.

A YAML parse failure reports the one-based line and column in the owner's
original text (mapped back through environment-placeholder masking) and an
error code. Neither the API nor the editor echoes source text, so an inline
secret on the failing line is not repeated in a message or log.

Every mutation validates the candidate content and generated state before creating a snapshot. A revision hashes the exact managed bytes. A single serialized writer, revision checks before and during writes, atomic replacement per file, and a durable journal protect against concurrent changes and interrupted saves. The files are not a filesystem-wide atomic transaction: recovery restores the previous coherent snapshot before native requests continue. If unrelated external edits make recovery ambiguous, the writer refuses to overwrite them and retains the recovery data.

Each snapshot file is JSON with `version` 1, `createdAt`, `revision`, `changedFiles`, `before` (the managed files' previous bytes) and `afterHashes`. Snapshots written since this field was added also carry `action`: a fixed code chosen by the server for the endpoint that made the change (`arrangement-saved`, `settings-saved`, `files-saved`, `snapshot-restored`, `dashboard-imported`, `discovered-panel-hidden`/`-shown`, and `service-`, `service-widget-`, `info-widget-` or `bookmark-` followed by `added`, `edited` or `deleted`). It never contains request text. Older files without it still list (with `action: null`), restore, export and import; the editor shows them as "Saved change". Listing and export drop an unrecognized stored value. Import accepts an optional `action` that is a short lowercase code and ignores it; any other value is rejected as unsupported metadata.

Snapshots default to 25, with configurable retention. Their ordering uses a logical timestamp greater than the last retained snapshot, so saves in the same millisecond, a backward wall-clock change, and process restart do not prune a newer save as if it were older. The displayed creation time remains the actual clock time. A live journal's snapshot is never pruned. Read/export operations and playback do not create snapshots.

Complete exports and downloaded full snapshots can be imported into another Studio instance. Import requires all nine files plus state.json, validates the complete archive before any snapshot or write, uses the destination's current revision, and follows the same journaled replacement path. It creates a recovery snapshot of the destination first. Unknown filenames and incomplete archives are rejected. Discovery cache entries from the old destination are discarded; imported external sources remain unavailable until rediscovery. Environment variables, mounted secrets, sockets, and external service prerequisites are deployment inputs and are not included in the archive.

Appearance is an optional studioTheme namespace in settings.yaml. Dark, light, or device-following mode stays synchronized with native widget theme context. Accent-derived tokens use bounded hex values and readable foreground/background pairs. Generated CSS uses zero-specificity selectors, allowing ordinary custom.css overrides to keep precedence when Next.js updates the document head. Device preference changes do not mutate files. See [Appearance](APPEARANCE.md).

## API boundaries

The controller adds `Content-Security-Policy: frame-ancestors 'self'` (plus the
`STUDIO_FRAME_ANCESTORS` origins) with `X-Frame-Options: SAMEORIGIN` for the
default, `X-Content-Type-Options: nosniff` and `Referrer-Policy: same-origin`
to every response; a native response cannot replace them. Request bodies for
native routes are received in full by the controller, bounded to 1 MiB (the
native routes' own limit) and 30 seconds, before a dashboard worker is leased,
so a slow body cannot hold a worker. All native bodies in flight share a
32 MiB budget; past it a request gets `503` with `Retry-After`. A declared
length over 1 MiB is refused at once, and `Expect: 100-continue` is answered
only for an acceptable upload. WebSocket upgrade requests are refused with
`404` before routing: no browser-facing route uses one, so an upgrade never
waits for or holds a worker. Browser navigations (`GET`/`HEAD` accepting `text/html`) to an
unknown, renamed-away or archived dashboard address receive a small static
`404` page with no script and no reflected request text; API and fetch callers
keep the JSON error.

Exact Host checks apply to requests. Both Studio `/studio/` and native `/api/`
routes, after selecting the dashboard, reject browser Fetch Metadata contexts of
`cross-site` or `same-site`; an Origin header must match the configured public
origin and accepted host. Native actions retain same-origin and direct
non-browser use without requiring the Studio-only write header. A direct client
without Origin is not authenticated by these checks.

GET `/studio/api/board` provides safe panel metadata and geometry. GET `/studio/api/state` is the trusted editor's full native configuration response and can contain secrets already present in the local files. POST endpoints for board, service, service-widget, info-widget, bookmark, settings, save, restore, import, and discovery-visibility require the current revision and the editor request header. Export and snapshot endpoints remain behind the same private deployment boundary.

Native `/api/studio/data` supplies sanitized rendering data. The writer and renderer expose the same nine-file configuration fingerprint, excluding layout-only state. The renderer verifies file bytes and local file identities before and after its native reads, returning a retryable private error if a write or rollback crosses that read. The file identity stamps stay server-local. The client renders only a matched board/native-data pair, preserving hidden, inert healthy hosts while refreshed data is unavailable. A saved response is adopted before refreshing widgets; Retry refresh never repeats a committed write. An arrangement draft retains the revision and source data it was created against, so an external edit reaches the existing conflict path instead of silently reinterpreting stale locators.

`/api/studio/sources` supplies safe discovery descriptors. Native MCP
configuration writes bypass this journal/revision model and are disabled
explicitly in both container entrypoint and every worker. Sharing the UID inside
one container does not create a separate filesystem security boundary;
controller ownership is enforced by supported write paths and tests.

## Native integration transport

The shared native HTTP helper retains credentials on same-origin redirects. On
an exact-origin change, including a different port, it forwards only public HTTP
metadata, removes URL authentication and refuses a request body that the redirect
would preserve. A library rewrite to GET may continue after discarding the
body. For the rest of that redirect chain, the helper neither reads nor writes
the cookie jar, so later same-origin hops at the destination cannot resurrect
source credentials or overwrite the source session. Allowed cookies are
attributed to their issuing URL and respect path, deletion and shorter expiry;
invalid cookies are ignored and retention is capped at one hour.

Each shared-helper outbound request enforces a 45-second total deadline across
connection, the full redirect chain and response chunks. Its final response body
has separate 32 MiB wire and decoded limits; these are not a byte budget summed
across redirect responses. Smaller internal caller timeouts may shorten the
deadline; larger ones cannot extend it. Oversized declarations, chunked overflow,
decompression failure, upstream abortion, deadline and a supplied AbortSignal
settle the request and release sockets/decoder/buffers. These are finite API,
image and feed reads, not open-ended streams. They are per-request bounds:
concatenation can temporarily retain both chunks and a final buffer, and a
multi-step adapter or concurrent requests have separate budgets. They are not a
process memory ceiling or an aggregate endpoint deadline, and separate adapter
or WebSocket paths do not automatically inherit them.

Shared transport diagnostics expose an allowlisted error code/message and only
the network origin of a URL, omitting userinfo, path, query and fragment. The
reviewed cache/QNAP/generic/credentialed/Jellyfin diagnostic paths do not log
credential URLs or arbitrary response bodies. Do not add credentials to panel
descriptors, catalogs, logs, exception messages or build artifacts. This bounded
review does not guarantee that every custom native adapter's error payload or
legacy debug log is sanitized.

Inherited compatibility remains explicit: the shared HTTPS agent and TrueNAS
WebSocket path use `rejectUnauthorized: false`, encrypting traffic without
rejecting an untrusted server certificate. There is no exposed native
configuration switch enabling verification for the shared helper;
`NODE_EXTRA_CA_CERTS` does not override its explicit false setting. The
per-dashboard jar uses normal cookie domain/path rules for direct requests; it
is not separated by integration or port. Configure canonical service endpoints
when authentication is required rather than relying on authenticated
cross-origin redirects. See [integrations and trust](OPERATIONS.md#integrations-and-trust)
for the operational trust boundary. These retained behaviors are not fixed by the redirect guard.

## Supported deployment targets and qualification

The source targets linux/amd64 and linux/arm64, standalone Compose, and one application replica on the selected Swarm storage node. These are qualification requirements; [VERIFICATION.md](../VERIFICATION.md) lists the gates, and each candidate's workflow run and verification report record actual results. The software is not a replicated distributed writer. Move data intentionally when changing the selected Swarm node.

## Address and trust model

`STUDIO_PUBLIC_ORIGIN` is the shared HTTP(S) origin without a dashboard suffix.
The entrypoint derives the exact accepted host from it. A slug is a single
validated path segment, such as `/admin`; it is not another DNS resolver host.
Studio does not configure DNS, reverse proxies or TLS. Access is decided by
Studio sign-in ([AUTHENTICATION.md](AUTHENTICATION.md)), enforced in the
controller in front of every worker: an anonymous request reaches only the
sign-in pages and immutable build assets; a member reaches only dashboards
shared with them, at view or arrange level; everything else under
`/studio/` needs an administrator (default deny), and raw file saves,
imports, exports, restores and snapshot reads also need a recent sign-in. The
session cookie is stripped before requests reach a worker, Homepage's own
authentication stays off, and its MCP endpoint is refused. With
`STUDIO_AUTH=off`, trusted editor users on this origin can administer the
registry and other dashboards, and external access control belongs in the
reverse proxy ([reverse proxy](REVERSE-PROXY.md)). Either way, dashboard
slugs must not be presented as authorization boundaries. Robots/indexing policy is likewise a
presentation directive, not an access-control mechanism.
