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

## Dashboard identity and isolation

The versioned registry `studio-dashboards.json` lives in the configuration root.
The original dashboard has ID `default` and retains existing configuration and
state paths. New dashboards have immutable UUIDs; configuration lives under
`config/dashboards/<id>/` and state/history under `state/dashboards/<id>/`.
Changing a name or slug changes routing without moving identity or files.
Archiving retains data and reserves the address. Restoration reuses that identity.
The default dashboard remains present and may be renamed or assigned a slug.

Registry writes are serialized, revision checked, validated and atomically
replaced. The initialization marker prevents a missing registry from silently
recreating an empty list over existing dashboards. Creates prepare the complete
dashboard before publication; a failed preparation never exposes a partial page.
Duplicates copy all nine files and layout identities, then diverge independently.
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

Global `/__studio/application-ready` checks a valid registry, writable shared
storage and packaged standalone runtime files/assets without launching a worker.
It is the Docker health command. Selected `/[slug]/__studio/config-ready` checks
that dashboard's files and journal; `/[slug]/__studio/ready` adds its native
build/protocol handshake. Root diagnostic paths select the original dashboard.
A damaged default settings file can make that selected dashboard unavailable
without restarting the container or blocking healthy named dashboards, shared
assets or deployment management. Shared registry/storage/runtime failures make
the global application unavailable and must fail clearly.

## Persistent model

State version 2 has a 12-column board, independently identified panels, and one-level stacks. Rectangles use integer x/y/w/h coordinates. Each native service, individual service widget, information widget, and bookmark has a stable identity. Stacks refer to panel IDs and have their own rectangle and playback preferences. Two visible units may not overlap. Removing a member from a two-member stack collapses the surviving member into an independent panel.

Native locators are derived on the server. Browser board submissions can change geometry, grouping, and playback preferences, but cannot replace native source identities or supply new credential-bearing locators. When a service has both `widgets` and `widget`, the adapter retains the original source key and native proxy index: array indices are nonnegative and the singular widget uses -1.

A raw YAML type edit in an existing source slot preserves its panel identity after unchanged entries have reserved their identities. Structured rename/move/edit operations preserve identity explicitly. Snapshot restoration restores the source identities and board alongside configuration.

Structured editor patches contain changed keys only, preserving untouched null values, unknown native options, comments, and literal references. Service parents created solely for a standalone widget receive explicit Studio provenance. Removing their last widget may clean up that synthetic parent; ordinary or ambiguous legacy services are retained.

The renderer keeps native panel hosts in a stable keyed list. Position and visibility change without making a slide a newly mounted widget. Hidden stack members are inert. Playback state, active slide, elapsed time, and finger-following offsets are temporary client state and do not change the persisted revision.

## Native discovery

A bounded, metadata-only native endpoint describes Docker/Kubernetes discovered services and individual widgets. The controller accepts only the safe descriptor schema from the selected dashboard worker; it never accepts a client-selected discovery URL. Discovery refresh happens during dashboard operations, not configuration initialization or readiness.

Persisted and cached source descriptors retain panel geometry and stack membership when a discovery source is temporarily absent. Missing or ambiguous native content is displayed as unavailable instead of silently selecting a different service. Hiding a discovered panel is a Studio preference; it does not alter container labels or Kubernetes annotations. The add interface can restore hidden sources.

The controlled source directly implements the reviewed correction to native
Kubernetes lookups: each uses the selected worker's current file configuration
when invoked. Upstream merges must preserve this behavior and its tests.


## Configuration and recovery

Managed native files are services.yaml, widgets.yaml, bookmarks.yaml, settings.yaml, docker.yaml, kubernetes.yaml, proxmox.yaml, custom.css, and custom.js. YAML edits use an AST, bounded aliases, and the patched parser pinned in package-lock.json. Custom CSS and JavaScript are preserved as opaque text. The per-file limit is 2 MiB; ordinary requests also have a 2 MiB JSON limit, including JSON escaping overhead. Only a complete dashboard import has a larger 40 MiB serialized request limit; every imported native file and state.json still has a 2 MiB limit.

YAML values must remain representable in the editor's JSON transport. Cyclic aliases and non-finite numbers such as `.inf`, `.nan`, or an overflowing numeric literal are rejected before snapshots or writes. Ordinary aliases and merges, finite numbers, nulls, booleans, comments, unknown options, quoted text, and native environment/file references remain supported. Quote an infinity-like value when it is intentionally text. Invalid drafts remain available for correction; existing invalid files are not rewritten automatically.

Every mutation validates the candidate content and generated state before creating a snapshot. A revision hashes the exact managed bytes. A single serialized writer, revision checks before and during writes, atomic replacement per file, and a durable journal protect against concurrent changes and interrupted saves. The files are not a filesystem-wide atomic transaction: recovery restores the previous coherent snapshot before native requests continue. If unrelated external edits make recovery ambiguous, the writer refuses to overwrite them and retains the recovery data.

Snapshots default to 25, with configurable retention. Their ordering uses a logical timestamp greater than the last retained snapshot, so saves in the same millisecond, a backward wall-clock change, and process restart do not prune a newer save as if it were older. The displayed creation time remains the actual clock time. A live journal's snapshot is never pruned. Read/export operations and playback do not create snapshots. Legacy four-file recovery material can be restored without erasing newer optional native files.

Complete exports and downloaded full snapshots can be imported into another Studio instance. Import requires all nine files plus state.json, validates the complete archive before any snapshot or write, uses the destination's current revision, and follows the same journaled replacement path. It creates a recovery snapshot of the destination first. Unknown filenames and incomplete archives are rejected. Discovery cache entries from the old destination are discarded; imported external sources remain unavailable until rediscovery. Environment variables, mounted secrets, sockets, and external service prerequisites are deployment inputs and are not included in the archive.

Appearance is an optional studioTheme namespace in settings.yaml. Dark, light, or device-following mode stays synchronized with native widget theme context. Accent-derived tokens use bounded hex values and readable foreground/background pairs. Generated CSS uses zero-specificity selectors, allowing ordinary custom.css overrides to keep precedence when Next.js updates the document head. Device preference changes do not mutate files. See [Appearance](APPEARANCE.md).

## API boundaries

GET `/__studio/api/board` provides safe panel metadata and geometry. GET `/__studio/api/state` is the trusted editor's full native configuration response and can contain secrets already present in the local files. POST endpoints for board, service, service-widget, info-widget, bookmark, settings, save, restore, import, and discovery-visibility require the current revision and the editor request header. Export and snapshot endpoints remain behind the same private deployment boundary.

Native `/api/studio/data` supplies sanitized rendering data. The writer and renderer expose the same nine-file configuration fingerprint, excluding layout-only state. The renderer verifies file bytes and local file identities before and after its native reads, returning a retryable private error if a write or rollback crosses that read. The file identity stamps stay server-local. The client renders only a matched board/native-data pair, preserving hidden, inert healthy hosts while refreshed data is unavailable. A saved response is adopted before refreshing widgets; Retry refresh never repeats a committed write. An arrangement draft retains the revision and source data it was created against, so an external edit reaches the existing conflict path instead of silently reinterpreting stale locators.

`/api/studio/sources` supplies safe discovery descriptors. Native integration requests continue through Homepage's own proxy rules. Do not add credentials to panel descriptors, public catalog data, logs, exception messages, or build artifacts. Native MCP configuration writes bypass this journal/revision model and are disabled explicitly in both container entrypoint and every worker. Sharing the UID inside one container does not create a separate filesystem security boundary; controller ownership is enforced by supported write paths and tests.

## Supported deployment targets and qualification

The source targets linux/amd64 and linux/arm64, standalone Compose, and one application replica on the selected Swarm storage node. These are qualification requirements; actual results are recorded in VERIFICATION.md. The software is not a replicated distributed writer. Move data intentionally when changing the selected Swarm node.

## Address and trust model

`STUDIO_PUBLIC_ORIGIN` is the shared HTTP(S) origin without a dashboard suffix.
The entrypoint derives the exact accepted host from it. A slug is a single
validated path segment, such as `/admin`; it is not another DNS resolver host.
Studio does not configure DNS, reverse proxies, TLS or login. Trusted editor
users on this origin can administer the registry and other dashboards. External
access controls remain outside the application, and dashboard slugs must not be
presented as authorization boundaries. Robots/indexing policy is likewise a
presentation directive, not an access-control mechanism.
