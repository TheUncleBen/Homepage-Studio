# Homepage Studio

Homepage Studio is a controlled [Homepage](https://gethomepage.dev/) application with direct dashboard editing, independently placed native widgets, configurable widget stacks, and independent dashboard pages in one deployment. The default combines charcoal surfaces, soft white text, and a muted eggplant accent. Each dashboard has its own widgets, layout, theme, colors and native CSS/JavaScript.

**Deployment readiness is tied to an exact source commit and image digest.** Use the [candidate workflow](https://github.com/TheUncleBen/Homepage-Studio/actions/workflows/candidate-approved.yml), its verification report, and its delivery receipt to establish a candidate's status. Follow [candidate delivery](docs/CANDIDATES.md) to identify and verify that bundle. [VERIFICATION.md](VERIFICATION.md) and the [implementation plan](docs/IMPLEMENTATION-PLAN.md) preserve dated source checkpoints. The earlier companion-container candidate is historical and does not qualify this architecture. An official date release requires later owner acceptance of the exact candidate.

## Dashboard experience

- Start with an empty dashboard. Add service links, individual native service widgets, information widgets, and bookmarks from the dashboard itself.
- Move and resize each panel independently. Combine compatible panels into a stack, reorder its members, or move a member back onto the dashboard.
- Use one Play/Pause control per stack. Swipe on a phone, drag horizontally with a mouse, scroll horizontally with a trackpad, or focus a stack and use Left/Right. Slide dots are passive indicators; there are no previous/next navigation buttons.
- Open a quiet title picker with an intentional short click/tap or keyboard action to choose a stack member directly. Swipes, drag gestures, long presses and context menus must not open it.
- Manual navigation while playing gives that stack a 30-second hold by default, then the next slide appears and the normal cadence resumes. Manual navigation while paused stays paused. Playback does not write configuration or create snapshots.
- Configure automatic or manual starting mode, dwell time, manual hold, looping, and horizontal, vertical, fade, or no transition. The defaults are manual mode, 10-second dwell, 30-second manual hold, horizontal animation, and 250-millisecond transitions.
- Edit common native options through forms and use the same panel's YAML editor for advanced options. Native integrations still use Homepage's own components and server-side proxy behavior.
- Choose dark, light, or device-following appearance and an accent color. Keep native background options and edit custom CSS directly in the configuration dialog. Each dashboard stores its own design in its own files; see [Appearance](docs/APPEARANCE.md).
- Keep Docker and Kubernetes discovery. Discovered definitions remain owned by their labels or annotations; Studio controls their placement, stacks, and dashboard visibility.

The native configuration editor covers `services.yaml`, `widgets.yaml`, `bookmarks.yaml`, `settings.yaml`, `docker.yaml`, `kubernetes.yaml`, `proxmox.yaml`, `custom.css`, and `custom.js`. A catalog of configuration examples is a starting point, not a complete validator for every external service. Credentials and service-specific prerequisites still need to be supplied by the deployment owner.

Configuration changes use revision checks, a recovery journal, and snapshots. The default retention is 25 snapshots and is configurable. Export, confirmed dashboard import, and restoration include the native files and Studio's panel identities and layout. A failed save retains the local draft; a committed save followed by a failed widget refresh offers a refresh without submitting the write again.

## Deployment model

One Studio image contains the public Node controller and the complete controlled Homepage runtime. Only controller port 3000 is published. Native workers start on demand, bind to internal loopback addresses, and render one dashboard each with independent configuration and caches. All processes run as UID/GID 1000 with every Linux capability dropped; application code is root-owned and read-only to that user, which owns only the persistent configuration and state volumes. Pages may be framed only by the same origin unless `STUDIO_FRAME_ANCESTORS` allows others.

Configure pages such as `/admin`, `/family` or `/dashboard-1` on the same host. Create an empty dashboard or duplicate an existing one, then edit it independently. Names and slugs can change without moving its immutable identity or history. Archive and restore retain files and snapshots. The original dashboard remains in its existing volume paths. Dashboards share the application lifecycle and deployment resources; they do not share their configuration, layout or state.

Deploy a delivered candidate or approved release bundle containing one multiarchitecture image digest and the Compose or Swarm template. Supply the exact host origin and, for Swarm, the node holding the persistent volumes. No build is required in Portainer. Swarm uses one application replica with stop-first updates on that node. [Deployment](docs/DEPLOYMENT.md) covers configuration and [candidate delivery](docs/CANDIDATES.md) covers the complete qualification and artifact gates.

Homepage Studio does not manage login, DNS, TLS or reverse-proxy configuration. These remain deployment concerns outside the application. Dashboard paths are organizational addresses, not authorization boundaries. Trusted editor users on the same origin can manage dashboards. The exact configured origin also drives host and write-request checks.

## Source and compatibility

The complete native fork lives in [`homepage/`](homepage/README.md). Its original baseline is Homepage **v2.6.0**, commit `51cc1684f9f34a7877ed462b8f94c9cc687b4dde`. `upstream.lock.json` records that provenance and the pinned build toolchain. The current Studio Git commit and tree identify the source actually built. Docker copies it directly; there is no fetched upstream source, generated overlay, or independently updated Homepage image. Upstream updates are reviewed and merged deliberately under this project's lifecycle. See [native source](docs/NATIVE-SOURCE.md).

See [Architecture](docs/ARCHITECTURE.md) for the component boundary and [Release policy](docs/RELEASES.md) for approval and artifact handling. Official versions use `YYYY.MM.DD`. Official releases happen when the exact candidate has passed engineering checks and owner acceptance. Ordinary source changes validate without image publication; an explicit candidate request retains tested images under unique build tags without creating an official release.

## Development checks

```sh
npm ci
npm test
```

These commands exercise the controller and safe native discovery bridge. `node --test test/*.test.mjs` and `python3 -m unittest discover -s test -p 'test_*.py'` cover packaging, provenance and release tooling. Native lint, all native tests and production compilation run from `homepage/` with the locked pnpm toolchain and are mandatory stages of the root Docker build. CI tests that same complete image in Chromium, Firefox, WebKit, direct Compose/Swarm and actual pinned Portainer on both native architectures. [Feature acceptance](docs/FEATURE-ACCEPTANCE.md) distinguishes implemented behavior, executable gates and human-only review.

The configured dashboard and snapshots contain private data and must never be committed. Public examples and tests use synthetic hosts and values.

## License

Original Studio code is **AGPL-3.0-or-later**; see [LICENSE](LICENSE). Homepage-derived material retains its upstream GPL terms, earlier MIT grants remain valid, and dependency notices are preserved in [third-party/NOTICE.txt](third-party/NOTICE.txt). The corresponding source and build instructions must accompany distributed releases.
