# Container deployment

This branch is an unreleased implementation. No image digest or official release is supplied by the example environment file. Installable release assets are produced only for an accepted artifact set after the required container and human checks. The proposed [candidate delivery process](CANDIDATES.md) prepares an exact, engineering-qualified image pair for human testing before official acceptance. Its separate publication and setup decisions remain explicit, and its workflow definitions are dormant.

## The release installation path

An approved release will include two prebuilt images and separate Portainer templates for Swarm and standalone Docker. The configuration service is the dashboard's entry point; it serves Studio's editing API and forwards native Homepage requests to the renderer. Both images must come from the same accepted build. The native renderer is a pinned Homepage derivative containing the Studio board.

For an approved release, installation is intended to take these steps:

1. In Portainer, create a stack using that release's `portainer-swarm.yml` or `portainer-compose.yml`.
2. Set `STUDIO_PUBLIC_ORIGIN` to the exact address used in the browser, including a nondefault port. Set `STUDIO_PORT` if the default published port of `3000` is unsuitable. For Swarm, set `STUDIO_NODE` to the unique hostname of the node selected to hold the data.
3. Deploy, wait for both services to become healthy, and open the configured address. The first dashboard is empty. Configure native widgets through Studio using the endpoints and credentials required by the widgets you select.

Release templates contain exact image digests. There is no build step in Portainer. The source-tree templates use `STUDIO_IMAGE` and `HOMEPAGE_IMAGE` placeholders so CI can qualify images before publication; they are not a claim that a pullable release already exists.

The application relies on the deployment's existing private network/access arrangement. The templates expose only the configuration service, do not add a login layer, and do not mount a Docker socket. Native integrations that need credentials, secret files, host paths or Docker API access still require their documented configuration.

## Storage, startup and updates

| Item | Behavior |
| --- | --- |
| `config` named volume | All nine native configuration files. The writer mounts it read/write; the renderer mounts it read-only. |
| `state` named volume | Studio's panel state, transaction recovery data and snapshots. Only the writer mounts it. |
| Default process identity | UID `1000`, GID `1000` in both images. Image mount directories are created with that ownership for new named volumes. |
| First start | Only missing configuration files are created, with empty lists/maps or empty CSS/JavaScript. Existing regular files are preserved. |
| Interrupted save | A pending transaction prevents entrypoint seeding. The writer recovers it before completing configuration initialization. |
| Startup coordination | Writer container health checks local configuration readiness. The renderer waits for that live configuration endpoint before starting. The external `/__studio/ready` endpoint additionally verifies the native protocol, source pin and matching build revision. |
| Snapshot default | The newest `25` snapshots, configurable through `STUDIO_BACKUP_RETENTION`. |
| Runtime logs | Native Homepage logs to stdout. The read-only configuration mount is not used for log files. |

Keep the stack/project name and both named volumes when updating. Change both image references to the approved release's digests and redeploy. Retain the previous release manifest and a configuration/state backup so a rollback has both its images and its data. Restoring a configuration snapshot and reverting an application image are separate actions.

The default Swarm template keeps one writer and one renderer on the same selected node. Both update and rollback use `stop-first`; brief downtime during an update is expected. The configured hostname must identify exactly one node. A local named volume is local to its Docker host, so this template does not promise automatic data failover to another node. Moving the application requires an explicit migration of both volumes. Docker documents the placement and local-volume behavior in its [Swarm service guide](https://docs.docker.com/engine/swarm/services/).

Standalone Docker uses the same two images and volumes with an ordinary Compose network. Swarm publishes the selected port in host mode on the selected node. The published port, browser origin, and any existing reverse proxy must agree. `HOMEPAGE_ALLOWED_HOSTS` is derived from that origin by the entrypoints, including its nondefault port; wildcard defaults are rejected. See [Homepage's Docker configuration](https://gethomepage.dev/installation/docker/) for its hostname requirement and integration-specific mounts.

Writer container health must not depend on the renderer. Swarm enables service routing after a container becomes healthy, as shown in the [Docker 28.0.4 executor](https://github.com/moby/moby/blob/v28.0.4/daemon/cluster/executor/container/controller.go). Depending on renderer readiness there would prevent the renderer from reaching its own writer prerequisite. Container health uses `/__studio/config-ready`; complete application monitoring should use `/__studio/ready`, which continues to reject an absent or mismatched renderer.

Existing bind-mounted configurations are an advanced migration path. Their directories must already be writable by UID/GID `1000:1000` for the writer. Startup does not recursively change ownership of an existing host directory, follow configuration symlinks, or replace existing files with sample content.

## How the images are built

`upstream.lock.json` identifies the Homepage commit, the downloaded archive hash, original and prepared package/lockfile hashes, the Node base-image digest and the pnpm version. `scripts/prepare-homepage.py` verifies the archive before extracting it, rejects unsafe archive entries, removes the upstream unlocked `npx only-allow` package-manager guard, applies only the recorded dependency correction, creates empty build-time config and applies the reviewed overlay/transform. Before replacing the original page and its composition tests, it invokes the overlay's read-only baseline check against their recorded source hashes. Its output is `.build/homepage/`. The prepared dependency files are checked again after the overlay, and `studio-source.json` records their hashes and advisory provenance.

The reviewed dependency correction pins `follow-redirects` from upstream's `1.16.0` to `1.16.1` without resolving or updating other dependencies. It addresses the maintainer's [array-header redirect advisory](https://github.com/follow-redirects/follow-redirects/security/advisories/GHSA-q3jh-wrc6-jgq8) and [sensitive-header escaping advisory](https://github.com/follow-redirects/follow-redirects/security/advisories/GHSA-8r9p-f939-6h3c). Dedicated real HTTP fixtures verify object/array credential stripping across origins, exact matching of custom header names and retained same-origin credentials. The original source hashes remain recorded separately from the patched runtime hashes.

`Dockerfile.homepage` requires a manifest confirming the Studio overlay, runs the complete native `pnpm test` suite, the redirect-security regressions and the production dependency audit, and builds the native standalone Next.js server from this prepared source. Builder and runtime use the same pinned Debian Node image, avoiding a glibc/musl runtime mismatch. Native configuration files and logs are kept out of the image's persistent application state. `Dockerfile` builds the writer from its locked npm dependencies. Both images carry the same immutable `STUDIO_BUILD_REVISION` and the repository source label.

For a local development build with Docker already available:

```sh
npm ci --ignore-scripts
npm test
node --test test/*.test.mjs
python3 -m unittest discover -s test -p 'test_*.py'
python3 scripts/prepare-homepage.py
export STUDIO_BUILD_REVISION="$(git rev-parse HEAD)"
docker build --build-arg STUDIO_BUILD_REVISION --tag homepage-studio:local --file Dockerfile .
docker build --build-arg STUDIO_BUILD_REVISION --tag homepage-studio-renderer:local --file Dockerfile.homepage .
```

Source preparation refuses to overwrite an existing build directory. Review or remove an obsolete disposable `.build/homepage` before preparing a new tree. Do not replace the pinned upstream with a moving tag or mix the writer with the unmodified upstream container: the versioned health protocol will correctly reject that pairing.

## What validation establishes

The automatic workflow has read-only repository permissions and no registry credentials. On native `amd64` and `arm64` GitHub-hosted runners it runs unit/fixture tests, prepares the pinned source, builds both images into the runner's local Docker daemon, and exercises fresh Compose and one-node Swarm deployments. The integration suite checks empty first-run configuration, native protocol identity, nonroot processes, read-only renderer configuration, edits, snapshots, restart/replacement persistence and restore. It refuses an existing Swarm and is restricted to explicitly enabled disposable GitHub-hosted runners.

The lifecycle test first starts only the writer, requires its actual Docker health to succeed, and verifies that aggregate application readiness remains HTTP 503. It then starts the renderer and runs the full application checks. This prevents a renderer-dependent container healthcheck from silently reintroducing the Swarm startup cycle. Failure diagnostics are bounded and omit environment/configuration values; service replacement retains the production stability monitor.

Cleanup waits for running and stopped Swarm task containers to disappear before removing fixture volumes. It attempts all cleanup steps even after an error. A cleanup error fails an otherwise successful run; if qualification already failed, that original error remains the primary result.

Before image builds, `node --test test/swarm-parser.mjs` invokes the actual Docker CLI's daemon-free `stack config` parser. It verifies both image values, origin, node placement and defaults, and rejects unset/empty required values. Keep required-variable help messages free of hyphens: the legacy parser in the tested Docker 28.0.4 client checks default operators before required operators and misreads hyphens in that message text. The production Swarm template retains its `:?` guards. Docker documents that [stack deployment uses the legacy Compose v3 format](https://docs.docker.com/engine/swarm/stack-deploy/); the exact interpolation behavior is in its [versioned parser source](https://github.com/docker/cli/blob/v28.0.4/cli/compose/template/template.go).

`browser/` has a separate development-only lockfile for Playwright. CI installs Chromium, Firefox and WebKit with their required system libraries in the disposable runner using the [official Playwright CI procedure](https://playwright.dev/docs/ci). Chromium exercises the actual two-image deployment: empty first run, native content creation, guided editing, deletion, independent sizing/movement, mixed stacks, persistence across reload, Play/Pause, keyboard/mouse/trackpad controls, manual holds, inactive accessibility state, settings and all-nine-file transactions, revision conflicts, snapshot restoration, embedded content and dense native widgets. Touch input uses Chromium's input protocol; deterministic timer assertions use Playwright's browser clock. The same pointer and native-search persistence scenarios also run in Firefox and WebKit. A separate headed Chromium check uses actual tab activation and elapsed time to verify hidden-document suspension and resumption without fake visibility or focus emulation. These are browser integration checks, separate from unit/jsdom checks. They do not emulate Samsung firmware or prove physical-device gesture feel.

After direct Docker qualification, `scripts/portainer-acceptance.mjs` runs both unchanged templates through pinned Portainer CE 2.45.2 in the disposable hosted runner. It verifies stored template/environment values, asynchronous deployment completion, exact image/source identities, nonroot execution, edits and snapshots, real container replacement, persistence, restore and resource cleanup. Initial Swarm image resolution uses a temporary registry bound to loopback, holding only the already-built test images. The product does not receive a Docker socket or registry credentials. The fixture retains the production Swarm update monitors and fails on cleanup errors. Its local API-contract tests are separate from actual hosted Portainer execution.

The automatic workflow does not publish images to a public registry, upload installable image artifacts, create tags or releases, or deploy to an owner's host. Its temporary loopback registry exists only for Portainer qualification and is removed afterward. Push validation is limited to the default branch, `implementation/native-dashboard`; pull-request updates run the complete two-architecture qualification once. Manual dispatch is retained. The concurrency group cancels superseded source, while the branch filter prevents duplicate push/PR runs for the same update. GitHub documents [event and branch filters](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow) and [concurrency behavior](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).

GitHub's [hosted-runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) lists native Linux runners for both required architectures. Docker's [test-before-push guide](https://docs.docker.com/build/ci/github-actions/test-before-push/) documents loading an image locally for testing; this project's automatic workflow intentionally ends before publication.

A passing automated run does not establish Samsung device gesture quality, every native widget's live credentials/API behavior, or compatibility with an uninspected Portainer host. Browser/device acceptance and the concrete target installation remain required before an official release. See [RELEASES.md](RELEASES.md) for artifact identity and approval gates.
