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
cd homepage
pnpm install --frozen-lockfile
pnpm audit --prod
pnpm lint
pnpm test
pnpm run build
```

The root `Dockerfile` repeats the native audit, lint, tests and production build
as mandatory build stages, so a successful image build includes them:

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
demand, natively on both linux/amd64 and linux/arm64. It publishes nothing. It
runs:

- the dependency audit, controller, tooling and Python tests, the Swarm parser
  check and the Docker-input and corresponding-source guard;
- the complete image build, including the native audit, lint, tests and build;
- container acceptance on that image: fresh volumes, edits, snapshots, restarts,
  container replacement, standalone Compose, a one-node Swarm, Chromium, Firefox
  and WebKit, and real hidden-document timing;
- both deployment templates through a pinned Portainer CE.

[`candidate-approved.yml`](.github/workflows/candidate-approved.yml) runs the same
qualification for an explicitly requested candidate. It then keeps the tested
images under unique build tags, assembles the multi-architecture image, and
saves the digest-pinned templates, corresponding source and verification report.
[`promote-approved.yml`](.github/workflows/promote-approved.yml) promotes an
owner-approved candidate without rebuilding it. See [releases](docs/RELEASES.md).

## Current limitations

- A local process run is not container acceptance, and a YAML parse is not
  Portainer execution. Container, Swarm, Portainer, Firefox/WebKit and arm64
  results come only from the hosted workflows.
- Synthetic integrations do not cover every native widget against a live
  service. Gesture feel on physical devices, visual preference, real
  credentials and the intended host, network and storage need human review.
- The image's Debian base carries upstream OS advisories that have no fixed
  version. An OS advisory scan is separate from the npm/pnpm audits; see
  [deployment](docs/DEPLOYMENT.md#build-and-qualification).
- The templates drop all capabilities. The Compose template also sets
  `no-new-privileges`, which `docker stack deploy` does not support. A read-only
  root filesystem is not yet qualified.
- There is no authentication by design; see [architecture](docs/ARCHITECTURE.md).
