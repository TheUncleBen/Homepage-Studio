# Homepage Studio

Homepage Studio adds direct dashboard editing, independently placed native widgets, and configurable widget stacks to [Homepage](https://gethomepage.dev/). The interface uses charcoal surfaces, soft white text, and a muted eggplant accent.

**Development status: unreleased.** This branch implements the first candidate. A source commit or successful unit test is not an approved deployable release. See [VERIFICATION.md](VERIFICATION.md) for completed checks and remaining qualification gates. No official image or date tag is implied by the image names in the deployment templates.

## Dashboard experience

- Start with an empty dashboard. Add service links, individual native service widgets, information widgets, and bookmarks from the dashboard itself.
- Move and resize each panel independently. Combine compatible panels into a stack, reorder its members, or move a member back onto the dashboard.
- Use one Play/Pause control per stack. Swipe on a phone, drag horizontally with a mouse, scroll horizontally with a trackpad, or focus a stack and use Left/Right. Slide dots are passive indicators; there are no previous/next navigation buttons.
- Manual navigation while playing gives that stack a 30-second hold by default, then the next slide appears and the normal cadence resumes. Manual navigation while paused stays paused. Playback does not write configuration or create snapshots.
- Configure automatic or manual starting mode, dwell time, manual hold, looping, and horizontal, vertical, fade, or no transition. The defaults are manual mode, 10-second dwell, 30-second manual hold, horizontal animation, and 250-millisecond transitions.
- Edit common native options through forms and use the same panel's YAML editor for advanced options. Native integrations still use Homepage's own components and server-side proxy behavior.
- Keep Docker and Kubernetes discovery. Discovered definitions remain owned by their labels or annotations; Studio controls their placement, stacks, and dashboard visibility.

The native configuration editor covers `services.yaml`, `widgets.yaml`, `bookmarks.yaml`, `settings.yaml`, `docker.yaml`, `kubernetes.yaml`, `proxmox.yaml`, `custom.css`, and `custom.js`. A catalog of configuration examples is a starting point, not a complete validator for every external service. Credentials and service-specific prerequisites still need to be supplied by the deployment owner.

Configuration changes use revision checks, a recovery journal, and snapshots. The default retention is 25 snapshots and is configurable. Export and restoration include the native files and Studio's panel identities and layout.

## Deployment model

The application consists of a pinned Homepage-derived renderer and a small configuration writer. Only the writer's port is exposed. Both containers share the native configuration volume; the writer also owns a separate state volume. The supplied templates target standalone Docker Compose and Portainer with Docker Swarm. Swarm runs one instance of each component on the same selected node so that local volumes refer to the same data.

The intended installation is to choose an approved version, supply the local dashboard origin and deployment variables, and deploy the corresponding Portainer template. The first approved release will provide the exact image digests and a short installation checklist. [Deployment documentation](docs/DEPLOYMENT.md) describes the model and current source-build qualification procedure.

Homepage Studio has no added login system. Deploy it on the trusted private network or behind the access controls used for the rest of the dashboard. The exact configured origin is also used for host and write-request checks.

## Source and compatibility

The native renderer is pinned to Homepage **v2.6.0**, commit `51cc1684f9f34a7877ed462b8f94c9cc687b4dde`. `upstream.lock.json` records the upstream archive and source hashes, the build toolchain, and the narrowly scoped dependency corrections. The source preparation script verifies these inputs before applying the Studio overlay. Updating Homepage is an explicit compatibility change that requires rebuilding and running the native tests.

See [Architecture](docs/ARCHITECTURE.md) for the component boundary and [Release policy](docs/RELEASES.md) for approval and artifact handling. Official versions use `YYYY.MM.DD`. Releases happen when the exact candidate has passed engineering checks and owner acceptance; ordinary source changes do not publish images or releases.

## Development checks

```sh
npm ci
npm test
```

These commands exercise the configuration writer, safe native discovery bridge, and catalog fixtures. Native component tests and the production build run in the prepared Homepage source tree. The CI workflow additionally builds both images and runs actual browser, Compose, and Swarm checks on the required architectures. Refer to the evidence for whether those gates have run for a particular commit.

The configured dashboard and snapshots contain private data and must never be committed. Public examples and tests use synthetic hosts and values.

## License

Original Studio code is **AGPL-3.0-or-later**; see [LICENSE](LICENSE). Homepage-derived material retains its upstream GPL terms, earlier MIT grants remain valid, and dependency notices are preserved in [third-party/NOTICE.txt](third-party/NOTICE.txt). The corresponding source and build instructions must accompany distributed releases.
