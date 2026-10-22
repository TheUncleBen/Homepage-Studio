# Feature acceptance contract

This is the public engineering acceptance map for the controlled single-container
revision. It defines required behavior and gates; an entry here is not a claim
that the current candidate has passed. Consult [verification](../VERIFICATION.md)
for observed results and [implementation plan](IMPLEMENTATION-PLAN.md) for work
remaining. The owner's private requirements record preserves the complete
historical conversation and project decisions.

| Feature area | Required behavior | Engineering evidence required |
| --- | --- | --- |
| Controlled lifecycle | Complete native source in `homepage/`; one image/controller port; no fetched overlay or companion container | Clean-source guard, native frozen install/audit/lint/full tests/build, both architecture image qualification |
| Independent dashboards | One accepted origin with configurable single-segment slugs; immutable IDs; create/duplicate/rename/archive/restore | Registry/path/concurrency/recovery tests and actual lifecycle fixture |
| Dashboard configuration | All nine native files, theme/colors/CSS/JS, identities, layout/stacks, history and discovery state are independent | Nine-file duplication/divergence/import tests, real scoped page/proxy/assets and cookie/cache tests |
| Initial and existing data | Empty first dashboard; preserve existing root files; refuse missing registry after initialization; archived data retained | Startup, broken/default/shared-storage, marker and archive/restore tests |
| Panel coverage | Service links, individual service widgets, information widgets and bookmarks can be placed/resized/stacked independently | Native component/identity tests and real board/browser creation/manipulation |
| Placement and fit | Coherent snapping, content minima, collision prevention and valid unstack geometry; deliberate same-footprint stack preview/drop; explicit cancellable fit review for different sizes | Geometry/stack validation, mixed-size editor and real mouse/touch placement scenarios |
| Direct and alternative input | Hold empty space/panels to edit; ordinary scrolling before hold; continue a deliberate drag with the same finger; local context actions plus position/size and stack editors for non-drag operation | Gesture tests, desktop pointer/cancellation, mobile hold/scroll/drag and keyboard/focus cases |
| Native organization | Preserve service/bookmark groups and board filters; retain native tabs/columns/collapse/equal-height values in YAML with a clear explanation that the Studio board controls layout | Native option preservation and actual settings explanation/form/board cases |
| Stable native content | Preserve mounted inputs, iframes and interactive state while moving, resizing, navigating or unstacking | Component lifecycle and production native-state/browser fixtures |
| Stack transport | One Play/Pause button, passive dots, touch swipe, horizontal desktop drag/trackpad, focused arrow keys | Gesture/controller/component tests and real browser/device input |
| Intentional title picker | Quiet short click/tap/keyboard open; direct member selection; no swipe, drag, long-press, context-menu, cancelled-pointer or multi-touch activation; safe membership-change closure | Gesture exclusion including cross-target multi-touch, focus/Escape/outside dismissal, membership change and touch/browser scenarios |
| Playback | Defaults manual, 10s dwell, 30s manual hold, horizontal 250ms animation; paused stays paused; independent timing; blockers suspend remaining time | Deterministic clocks, configured manual-hold browser case, actual hidden-document timing |
| Exact playback semantics | Manual navigation while playing advances next after max(interval, hold), then normal cadence; repeated successful navigation restarts hold; paused remains paused; current-item selection is a no-op | Controller boundary assertions and actual configured manual-hold/title-selection cases |
| Suspension and alternatives | Editing/dialogs/native focus/navigation, hidden document and offscreen state freeze remaining time without catch-up; normal hover/shell focus needs no restart; reduced motion prevents automatic startup/animation but allows explicit Play | Clock/component focus/reduced-motion tests, real offscreen/dialog/iframe and hidden-document scenarios |
| Appearance and dense content | Independent dark/light/device mode, custom hex accent, native background and preserved status colors; CSS precedence; reachable calendar/chart/process/embed content at narrow widths and enlarged text | Appearance/editor tests, real CSS/native-state checks, 200% text, narrow geometry/scroll and screenshot review |
| Native configuration | Guided fields plus YAML; preserve unknown fields, comments, nulls and literal native references; reject cyclic/nonfinite transport values | Catalog/source provenance, parser and form tests, raw nine-file browser flow |
| Save/draft safety | Current revision required; dirty/pending dismissal and departure protection; failed save retains draft; committed save refresh failure never repeats write | Controller transactions, component conflict/draft tests and production browser errors/recovery |
| Recovery and snapshots | Validate before snapshot/write; bounded journal recovery; exact newest retention; own-dashboard snapshots; complete export/import confirmation | Interrupted transactions, clocks/restart, real-volume retention, foreign snapshot rejection and import lifecycle |
| Discovery | Native Docker/Kubernetes definitions remain external; selected dashboard controls layout/hide/restore; safe descriptors retain identity during outages | Native bridge, fixed-worker source, malformed/unavailable source and runtime discovery tests |
| Native credentials and context | Render metadata is sanitized; selected proxy/cache/cookies/preferences do not reuse another dashboard's credentials or state | Native request/security tests and actual two-dashboard synthetic integration/browser fixtures |
| Worker supervision | UID 1000, loopback only, bounded count/idle/startup, context drainage, crash restart, shutdown cleanup | Pool tests plus actual `/proc` UID/listener checks and child-kill runtime recovery |
| Health separation | Global registry/storage/runtime health is independent from selected dashboard readiness; broken default cannot block healthy dashboards or assets | Actual health command, corrupt-default fixture, shared asset and named-page checks |
| Deployment | One Compose service or one same-node Swarm replica; persistent config/state; stop-first 180s monitors; 30s stop grace; explicit proxy/body-limit and container environment/mount guidance | Actual Docker legacy parser, real existing-root adoption and default `/admin`/307 checks, complete direct/Portainer deployment, restart, replacement and cleanup |
| Delivery | Exact tested image on both native architectures; complete single source archive/licenses; anonymous verified layer bytes; no rebuild on promotion | OCI/config/source hashes, native receipts, stream verification and protected release guards |

## Human acceptance after engineering qualification

The owner reviews physical phone touch/scroll feel, intentional title-picker
behavior during natural use, Samsung-style stack expectations, appearance and
readability on their displays, actual external integrations/credentials, and
their reverse-proxy/network/Portainer storage environment. Engineering should
finish feasible tests and supply a usable digest-pinned bundle first. Aesthetic
preference and physical-device feel cannot be substituted with unit tests.

Same-origin dashboard slugs do not create user authorization. The application
does not add authentication, reverse-proxy configuration, DNS management or TLS
termination. Those are explicit external responsibilities, not unfinished product
features. Native catalog coverage is configuration support; it does not claim
live validation of every external service.
