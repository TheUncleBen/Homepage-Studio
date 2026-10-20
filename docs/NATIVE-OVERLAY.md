# Homepage Studio native overlay

## Integration and ownership

This overlay implements the approved dashboard on Homepage's main `/` route. It is built over Homepage v2.6.0, commit `51cc1684f9f34a7877ed462b8f94c9cc687b4dde`. Copy `overlay/` to the repository root as `overlay/`, and copy `scripts/apply-homepage-overlay.mjs` into the repository's `scripts/` directory. Packaging owns the pinned source download, dependency lock, image construction and source manifest. The companion owns canonical configuration, identity, board validation, transactions, snapshots and release controls.

Preparation must run the patcher with `--verify-baseline` **before** copying any overlay files, copy the overlay, then run the patcher normally. Both operations fail on an unexpected baseline. The first operation verifies the exact original main page and its obsolete composition test file; the second verifies the exact original `_app.jsx` and native error boundary before applying the small integration changes. The normal operation is idempotent and records original and output hashes in `studio-overlay.json`.

The replacement page test retains native sanitized SSR data, provider privacy, native error fallback, locale handling, allowed-host enforcement and native refresh behavior. It adds the single main board, Quick Launch and healthy-host preservation checks. Stock assertions about the removed grouped layout/header/hash-triggered reload are replaced rather than skipped. Existing native authentication, widget and proxy suites remain enabled.

| Original native file | SHA-256 |
| --- | --- |
| `src/pages/index.jsx` | `a2a194699b5abbcaa50c4316964f0a8c3bdff973ca4196167e6b789280fd314f` |
| `src/__tests__/pages/index.test.jsx` | `18c2807f52639d2cd72e5d1db78c4fe3a36049763cf625919b735359d303dd14` |
| `src/pages/_app.jsx` | `128c5afe51aaa7d54d74dff363fe479c3267d659cb2cebe85d77d95c017d7bf4` |
| `src/components/errorboundry.jsx` | `c33fceeed7ae2bd34bb2286eae3533b0d52de165c454b63f6003cb40539120e1` |

The separately reviewed packaging patch changes only the direct `follow-redirects` dependency from 1.16.0 to 1.16.1, with a fixed lockfile. Native tests/build must use that patched dependency graph. This overlay does not replace Homepage's integration engine.

## Main dashboard behavior

The charcoal/gray interface uses muted eggplant accents and begins empty. The board supports direct add/edit/delete, selection, pointer and keyboard move/resize, explicit numeric positioning, groups, and Save/Done or Cancel for an arrangement draft. Native configurations are edited in dialogs on the same dashboard. Clock, weather, search, resource information, service links/status, bookmarks and individual service widgets all use independent panel hosts.

The catalog uses the companion's reviewed metadata. It supplies typed controls, explicit omission/native-default behavior, native documentation links, help text and allowed field lists. Typed unions preserve strings, booleans and complex values. Advanced YAML edits the same draft, retaining unknown native keys and template/secret references. Every native file can be edited through the advanced configuration dialog: services, widgets, bookmarks, settings, Docker, Kubernetes, Proxmox, custom CSS and custom JavaScript. Current export and pre-save snapshot downloads are labeled separately. Imports and serialized mutation requests respect the companion's 2 MiB limit. Saving custom JavaScript gives an explicit reload action because an already-loaded script cannot safely be replayed in place.

Source mutations refresh native render data and adopt the companion's returned canonical board. Raw editor state is fetched only when an editor is opened. Arrangement edits and slide movement never request or persist raw credentials.

### Layout constraints

The canonical board has twelve columns and 72-pixel rows separated by 16-pixel gaps. Responsive rendering projects it into eight or four columns; mobile panels span the available width without rewriting canonical geometry. Collision handling pushes neighboring panels downward deterministically. All native overflow stays scrollable; text is never scaled down to disguise a poor fit.

Minimums are enforced by the same geometry operation used by pointer, keyboard and numeric edits. Existing smaller geometry is projected to a usable size without an unsolicited save.

| Content class | Minimum columns × rows |
| --- | --- |
| Service link/status and bookmark | 3 × 2 |
| Information widget | 3 × 2 |
| Information search | 4 × 2 |
| Information resources/Kubernetes/Longhorn | 4 × 3 |
| Ordinary native service widget | 4 × 3 |
| Glances or Custom API | 4 × 4 |
| iFrame or MJPEG | 4 × 5 |
| Calendar | 6 × 5 |
| Stack | Maximum member minimum width; maximum member minimum height plus one row, at least three rows |

These protect the container and its controls; they are not proof that every possible integration layout is visually ideal. Representative native chart/calendar/list/embed/browser checks remain release gates. A selected set with different required dimensions opens an explicit shared-size review before creating a stack. Direct drag-to-stack requires the same displayed/canonical size and sufficient space for the stack controls.

## Stack interaction and lifecycle

Every native panel remains a keyed child of one `PanelLayer`; it never becomes a child of a changing stack container. Geometry changes update CSS. Panel DOM sibling order is independent of geometry because moving an existing iframe DOM node can reload its document even when a React key survives. Stack shells, backgrounds and controls are separate layers. Inactive content remains mounted, is `inert`, and is excluded from accessibility focus with `aria-hidden`.

Stacks have a shared visible rectangle. Their only visible playback button is Play/Pause; passive dots show position. Manual navigation works through finger-follow horizontal swiping, desktop horizontal drag, horizontal trackpad gestures, and Left/Right on a focused stack. Interactive native controls, SVG/canvas, links and embedded documents do not have their gestures intercepted. The header remains an external navigation area for cross-origin embeds. Hold or right-click selects the stack for editing. Selection/order/move-out are available inside the stack editor.

The shared playback module is copied byte-for-byte from the reviewed controller. Default mode is `manual`, dwell 10 seconds, manual hold 30 seconds, horizontal transition of 250 milliseconds, looping enabled. A successful manual change while playing waits `max(intervalMs, manualHoldMs)` before the next automatic advance, then resumes normal cadence. Manual changes while paused leave playback paused. Repeated interaction extends the hold. Playback never writes configuration or snapshots.

Editing, an open dialog, document hiding, offscreen state, active navigation gestures and focus inside native interactive content temporarily freeze the remaining timer. Returning does not cause catch-up bursts. Root/Play-button focus and hover do not pause it. Reduced motion disables automatic startup and removes animation; explicit Play still works. A native error boundary retries a **failed** subtree only after the native configuration fingerprint changes. Healthy subtrees are not keyed or remounted on every save.

CSS-hidden native widgets may continue their own refresh requests. The implementation preserves native polling semantics rather than promising universal suspension. Search/calendar/iframe state preservation is tested through actual host lifecycles and iframe document identity in jsdom; real browser and phone behavior still require their separate acceptance gates.

## Native bridge and private routing

`GET /api/studio/health` reports protocol version 1, the exact upstream commit and `STUDIO_BUILD_REVISION`. `GET /api/studio/data` returns native sanitized services, bookmarks and information widgets plus settings with providers removed. Its SHA-256 configuration fingerprint covers the nine native files and exposes no file contents. Both use Homepage's existing auth/host wrapper. The companion's ordinary board endpoint contains safe identities and geometry; raw configuration remains in the editor-only endpoint.

The service host strips all embedded widget properties. Each service-widget panel uses the actual native `ServiceWidget` component, and each information/bookmark panel uses its native component. No DOM cloning, reparenting or parallel integration engine is used.

The native renderer combines `widgets[]` first and appends singular `widget`. Its private proxy selects an array entry for a nonnegative index, but selects singular `widget` with index -1. Studio retains both render and private-proxy indices in a safe locator and overrides only the native widget's index at the adapter boundary. A fixture exercises real `cleanServiceGroups`, `servicesFromConfig` and `getServiceWidget` to prove both mixed-form members select their correct private options without sending keys in render data.

Native private proxy resolution uses the final group name and service name. The adapter fails closed if that route is ambiguous, even when a source id/full nested path looks unique. Bookmark resolution uses exact group/name rather than a raw group index, because native layout settings can reorder groups. Native behavior rendering only the first bookmark options mapping is preserved.

### Native discovery

`GET /api/studio/sources` invokes the existing native configured-service/Docker/Kubernetes helpers and emits bounded safe descriptors only. Its versioned manifest contains no URLs, passwords, API keys or raw definitions. The writer validates, retains and caches this metadata; outage/ambiguity never silently removes dashboard layout or stack identity. A descriptor marked `available:false` cannot render a coincidentally matching native object.

Discovered definitions remain owned by Docker labels or Kubernetes annotations. The dashboard supports position/size/stacking and Hide from dashboard; the Add picker restores hidden discovered panels. It never rewrites external discovery sources. IDs hash origin/provenance/name/group without returning private configuration. An external rename or group change creates a new identity. Different-type widget reorders retain identity; repeated same-type external widget reordering has an explicit positional identity warning because the native source has no stable per-widget identifier.

## Validation and remaining gates

### Cold server-rendering regression corrected after container CI

The first AMD64 and ARM64 container runs exposed a missing native SWR fallback boundary in the replacement page. The bridge's `fallbackData` covered only `/api/studio/data`; native Quick Launch still reads `/api/widgets` directly. Its first server render therefore received `undefined`, and the dashboard returned HTTP 500. This affected cold empty and populated configurations alike. The existing page composition tests mocked Quick Launch/SWR and did not exercise this provider boundary.

The page now restores Homepage's sanitized `SWRConfig` fallback around all page hooks and native children. The native Quick Launch component remains unchanged. `studio-empty-ssr.test.jsx` reads real isolated nine-file configurations and server-renders the actual App, page, SWR and Quick Launch with a fresh cache. It verifies empty startup without sample insertion, persisted native search/greeting/service/bookmark data, and provider/service-secret redaction. These tests reproduce the original exception before the fix. `scripts/check-native-ssr.py` also exercises the actual production standalone server over loopback with isolated empty and populated configurations, checks `GET /`, native render data, SSR fallback and unchanged source files, and stops the process afterward. Run it after the prepared native build with `--native-source <prepared-source-directory>`; it does not need Docker or access to real services.

Run the unchanged native `pnpm test` command, and `pnpm build` (`next build --webpack`) against the prepared source. The final native output contains targeted fixtures for geometry, mixed proxy routing, lifecycle/iframe document retention, gestures, timers/StrictMode, reduced motion, typed field unions, main-page SSR/privacy, request limits, bridge privacy and discovery. The playback controller's separate fake-clock suite is retained by the sibling implementation.

The implementation was tested with Node 24.19.0 and pnpm 10.34.7. Final logs, exact overlay file hashes and validation results are supplied alongside this handoff. Native-only tests that open loopback HTTP fixture servers require loopback permission in a restricted execution environment; they must not be skipped in container CI.

The following are still explicit release gates: real Chromium/native UI tests, clean Compose/Swarm images and volumes, persistence/restart/restore under containers, every advertised architecture, real phone touch behavior and owner acceptance. The local official Chromium download attempts returned truncated archives, so no local browser qualification is claimed. Live external service integrations were not accessed and are not represented as tested. Native configuration requiring mounts, environment variables, secret files, sockets, account permissions or a restart still needs those deployment prerequisites.
