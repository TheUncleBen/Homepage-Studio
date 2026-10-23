# Verification

This page explains how to verify a Homepage Studio build and what the automated
gates cover. It does not record individual runs. The status of a specific
candidate comes from its workflow run, verification report and delivery receipt;
see [candidate delivery](docs/CANDIDATES.md).

## Local checks

Run these from a clean checkout. Node 22 or later is supported; CI uses Node 24.

```sh
npm ci --ignore-scripts
npm audit --omit=dev
npm test                                          # controller (server/*.test.mjs)
node --test test/*.test.mjs                       # packaging, provenance and release tooling
python3 -m unittest discover -s test -p 'test_*.py'
node --test test/swarm-parser.mjs                 # real Docker CLI Swarm parser; no daemon needed
python3 scripts/pack-candidate-source.py --source . --commit "$(git rev-parse HEAD)" --check
```

Native Homepage checks run from `homepage/` with the pinned pnpm version from
`upstream.lock.json`:

```sh
node scripts/install-pinned-pnpm.mjs upstream.lock.json
pnpm --dir homepage install --frozen-lockfile
STUDIO_NATIVE_SOURCE=homepage node --test test/native-redirect-security.mjs
cd homepage
pnpm audit --prod
pnpm lint
pnpm test
pnpm run build
```

The root `Dockerfile` installs the frozen lockfile with the verified pinned pnpm,
builds and compresses. It does not repeat the audit, redirect check, lint or unit
tests, so an image build needs no registry access for an audit and is not
blocked by a newly published advisory. Those checks are required CI gates
instead (see below). Build the image with:

```sh
docker build --build-arg STUDIO_BUILD_REVISION="$(git rev-parse HEAD)" \
  --tag homepage-studio-ci:application .
```

Browser and container acceptance needs a Docker daemon:

```sh
npm ci --prefix browser --ignore-scripts
STUDIO_TEST_CONTAINERS=1 STUDIO_BROWSER_TESTS=1 \
  STUDIO_IMAGE=homepage-studio-ci:application \
  STUDIO_EXPECTED_REVISION="$(git rev-parse HEAD)" \
  node scripts/container-acceptance.mjs
STUDIO_TEST_CONTAINERS=1 STUDIO_PORTAINER_TESTS=1 \
  STUDIO_IMAGE=homepage-studio-ci:application \
  STUDIO_EXPECTED_REVISION="$(git rev-parse HEAD)" \
  node scripts/portainer-acceptance.mjs
```

## What CI checks

[`validate.yml`](.github/workflows/validate.yml) runs on pull requests and on
demand. It publishes nothing. A required **native source checks** job runs once
on linux/amd64:

- the verified pinned pnpm and frozen native install;
- the native redirect security regression check against the installed source;
- the blocking production dependency audit (`pnpm audit --prod`);
- native lint and the complete native unit test suite;
- a guard that the Firefox/WebKit selection still lists exactly the eight
  `@cross-engine` scenarios in each engine.

These checks do not depend on the CPU architecture. Both architecture jobs
(linux/amd64 and linux/arm64) need that job to pass before they start. Each then
runs natively:

- the controller dependency audit, controller, tooling and Python tests, the
  Swarm parser check and the Docker-input and corresponding-source guard;
- the complete image build (frozen install, production build, compression);
- container acceptance on that image: fresh volumes, edits, snapshots, restarts,
  container replacement, standalone Compose, a one-node Swarm, Chromium, Firefox
  and WebKit, and real hidden-document timing;
- both deployment templates through a pinned Portainer CE;
- the same image with Studio sign-in on: dashboards locked behind
  first-administrator setup, the Docker health check still healthy, the
  sign-in assets and recovery command present, and Chromium with a virtual
  passkey creating the administrator, signing out and signing back in.

The editing and browser qualification above runs with `STUDIO_AUTH=off`;
sign-in itself is covered by `server/auth/*.test.mjs` (in `npm test`), the
editor gating test in the native suite, and the sign-in phase.

[`candidate-approved.yml`](.github/workflows/candidate-approved.yml) runs the same
qualification, including the required native source checks job, on default-branch
pushes and for an explicitly requested candidate. It then keeps the tested
images under unique build tags, assembles the multi-architecture image, and
saves the digest-pinned templates, corresponding source and verification report.
[`promote-approved.yml`](.github/workflows/promote-approved.yml) promotes an
owner-approved candidate without rebuilding it. See [releases](docs/RELEASES.md).

### What the acceptance fixtures cover

Container acceptance and Portainer qualification run against the complete
image on each native architecture, through direct Compose and Swarm and a
pinned Portainer CE 2.45.2. The runtime fixture covers a fresh nine-file
configuration, adopting existing root data and snapshots from real volumes,
keeping an `/admin` address and the root redirect, independent dashboards,
layouts and stacks, duplication and divergence, rename, archive, restore and
import, rejecting another dashboard's snapshot, persistence across restart and
container replacement, the real worker UID and loopback listeners, recovery
after a worker is killed, isolation of a broken default dashboard, and exact
snapshot retention. The Portainer tests deploy the unchanged templates through
its real API and check image identity, replacement, retained data and cleanup.
Their temporary loopback registry and Docker socket belong to the disposable
test setup only and never become product mounts.

Chromium runs the full production suite, including scoped dashboards, touch
holds and swipes on panel bodies, and the intentional stack-title picker.
Firefox and WebKit run the `@cross-engine` desktop scenarios. A headed browser
checks real hidden-document timer suspension. The full suite has a 15-minute
aggregate budget and a 16-minute parent deadline, individual test and action
bounds are unchanged, and retries are zero. A cleanup failure fails
qualification. No real external integrations or owner host deployment are
implied by these fixtures.

## Image build

The root `Dockerfile` copies the controlled `homepage/` tree directly. It uses
the pinned Node image, verifies the pinned pnpm package integrity, installs
the frozen lockfile and produces a production standalone build. Eligible
immutable Next.js build assets are precompressed as Brotli/gzip when smaller;
the controller streams them with representation-specific validators and does
not compress configuration or integration responses at request time. The final
image holds the controller, the native runtime and assets, the shared
configuration helpers, and the GPL/AGPL, font and dependency notices; it
excludes controller tests and fixtures.

The source guard rejects modified tracked source and ignored or untracked
inputs within every Docker-copied subtree. Docker-excluded generated
dependencies and build outputs are allowed locally and excluded from the
corresponding source. One deterministic `studio-source.tar.gz` binds the
complete source and licenses to the exact candidate commit; see
[native source](docs/NATIVE-SOURCE.md).

### OS packages

The runtime layer refreshes the inherited `perl-base` alongside its other
packages, because the pinned Node base predates Debian's Bookworm
`5.36.0-7+deb12u4` security update. The build doesn't change distribution or
run a blanket upgrade. Confirm the installed version in each qualified image
rather than treating the Dockerfile line as proof; see
[Debian's Perl security record](https://security-tracker.debian.org/tracker/source-package/perl).

OS advisory review is separate from the npm/pnpm production audits. Record the
exact architecture child and config digests, scanner provenance, database
time, package inventory, fixed and unfixed findings, and vendor applicability
decisions in the candidate's qualification evidence. A remote image scan
inspects packages without executing that architecture; it doesn't replace
container acceptance or prove that a residual advisory is unreachable. A new
image needs its own scan.

## Current limitations

- A local process run is not container acceptance, and a YAML parse is not
  Portainer execution. Container, Swarm, Portainer, Firefox/WebKit and arm64
  results come only from the hosted workflows.
- Synthetic integrations do not cover every native widget against a live
  service. Gesture feel on physical devices, visual preference, real
  credentials and the intended host, network and storage need human review.
- The image's Debian base carries upstream OS advisories that have no fixed
  version. An OS advisory scan is separate from the npm/pnpm audits; see
  [OS packages](#os-packages).
- The templates drop all capabilities. The Compose template also sets
  `no-new-privileges`, which `docker stack deploy` does not support. A read-only
  root filesystem is not yet qualified.
- Studio sign-in decides access, enforced in the controller with default deny; see [architecture](docs/ARCHITECTURE.md#address-and-trust-model) and [AUTHENTICATION.md](docs/AUTHENTICATION.md).
