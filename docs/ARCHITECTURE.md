# Architecture

## Native renderer and writer

Homepage Studio runs a pinned Homepage-derived Next.js renderer behind a Node configuration writer. The renderer uses Homepage's native information and service widget components, status behavior, bookmark rendering, and integration proxy. Studio changes the page composition and configuration experience. It does not maintain another implementation of the integration APIs.

The writer receives browser traffic, checks the configured origin/host for editor requests, serves `/__studio/api/*`, and proxies native requests. The renderer has no separately published port. The writer has read/write access to configuration and its state directory; the renderer shares the configuration needed by native Homepage. Both components identify the same upstream commit, Studio protocol, and immutable build revision.

Startup recovery and configuration seeding do not depend on the renderer. `/__studio/config-ready` checks the managed files and storage. Renderer startup waits for that endpoint. `/__studio/ready` adds the native health handshake after configuration is ready, avoiding a circular readiness dependency.

## Persistent model

State version 2 has a 12-column board, independently identified panels, and one-level stacks. Rectangles use integer x/y/w/h coordinates. Each native service, individual service widget, information widget, and bookmark has a stable identity. Stacks refer to panel IDs and have their own rectangle and playback preferences. Two visible units may not overlap. Removing a member from a two-member stack collapses the surviving member into an independent panel.

Native locators are derived on the server. Browser board submissions can change geometry, grouping, and playback preferences, but cannot replace native source identities or supply new credential-bearing locators. When a service has both `widgets` and `widget`, the adapter retains the original source key and native proxy index: array indices are nonnegative and the singular widget uses -1.

A raw YAML type edit in an existing source slot preserves its panel identity after unchanged entries have reserved their identities. Structured rename/move/edit operations preserve identity explicitly. Snapshot restoration restores the source identities and board alongside configuration.

The renderer keeps native panel hosts in a stable keyed list. Position and visibility change without making a slide a newly mounted widget. Hidden stack members are inert. Playback state, active slide, elapsed time, and finger-following offsets are temporary client state and do not change the persisted revision.

## Native discovery

A bounded, metadata-only native endpoint describes Docker/Kubernetes discovered services and individual widgets. The writer accepts only the safe descriptor schema from its configured renderer; it never accepts a client-selected discovery URL. Discovery refresh happens during dashboard operations, not configuration initialization or readiness.

Persisted and cached source descriptors retain panel geometry and stack membership when a discovery source is temporarily absent. Missing or ambiguous native content is displayed as unavailable instead of silently selecting a different service. Hiding a discovered panel is a Studio preference; it does not alter container labels or Kubernetes annotations. The add interface can restore hidden sources.

## Configuration and recovery

Managed native files are services.yaml, widgets.yaml, bookmarks.yaml, settings.yaml, docker.yaml, kubernetes.yaml, proxmox.yaml, custom.css, and custom.js. YAML edits use an AST, bounded aliases, and the patched parser pinned in package-lock.json. Custom CSS and JavaScript are preserved as opaque text. The per-file limit is 2 MiB; requests also have a 2 MiB JSON limit, including JSON escaping overhead.

Every mutation validates the candidate content and generated state before creating a snapshot. A revision hashes the exact managed bytes. A single serialized writer, revision checks before and during writes, atomic replacement per file, and a durable journal protect against concurrent changes and interrupted saves. The files are not a filesystem-wide atomic transaction: recovery restores the previous coherent snapshot before native requests continue. If unrelated external edits make recovery ambiguous, the writer refuses to overwrite them and retains the recovery data.

Snapshots default to 25, with configurable retention. A live journal's snapshot is never pruned. Read/export operations and playback do not create snapshots. Legacy four-file recovery material can be restored without erasing newer optional native files.

## API boundaries

GET `/__studio/api/board` provides safe panel metadata and geometry. GET `/__studio/api/state` is the trusted editor's full native configuration response and can contain secrets already present in the local files. POST endpoints for board, service, service-widget, info-widget, bookmark, settings, save, restore, and discovery-visibility require the current revision and the editor request header. Export and snapshot endpoints remain behind the same private deployment boundary.

Native `/api/studio/data` supplies sanitized rendering data. `/api/studio/sources` supplies safe discovery descriptors. Native integration requests continue through Homepage's own proxy rules. Do not add credentials to panel descriptors, public catalog data, logs, exception messages, or build artifacts.

## Supported deployment targets and qualification

The source targets linux/amd64 and linux/arm64, standalone Compose, and a single writer/renderer pair on one selected Swarm node. These are qualification requirements; actual results are recorded in VERIFICATION.md. The software is not a replicated distributed writer. Move data intentionally when changing the selected Swarm node.
