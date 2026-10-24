# Candidates for Portainer testing

A candidate is one complete controller/native application image for `linux/amd64` and `linux/arm64`, with matching source, verification evidence and digest-pinned deployment templates. Candidate delivery is engineering work and requires no owner-only dispatch, candidate review environment or second approval before image publication. Official `YYYY.MM.DD` releases still require the owner's later acceptance of the exact candidate.

The active workflow is **Validate and prepare deployment candidate**, at `.github/workflows/candidate-approved.yml`. The filename is retained for workflow identity. Ordinary default-branch pushes run the complete native qualification without retaining images. An explicit `[deliver-candidate]` marker in the pushed head commit message, or a deliberate manual dispatch from the default branch, requests candidate delivery. Pull requests use the separate nonpublishing validation workflow, so a default-branch push runs one native matrix rather than duplicating that work.

## Images and access

The sole product image repository is `ghcr.io/theuncleben/homepage-studio`.
Its one multiarchitecture index contains the exact qualified AMD64 and ARM64
application builds. The former companion-renderer package is historical.

The workflow uses its normal `GITHUB_TOKEN` with package-write permission for delivery, as supported by [GitHub's container registry authentication](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry). The image source label links the application package to this repository. No supplemental package-metadata token, separate staging packages or account-wide package listing is required.

Architecture images use `build-<full-source-commit>-<run-id>-<architecture>` tags. The complete multiarchitecture images use `build-<full-source-commit>-<run-id>`. These unique build tags retain the tested images; the installable templates use immutable index digests. An existing complete-candidate index tag stops assembly; architecture tags include the fresh run identity and are never reused by a rerun. The workflow creates no moving preview channel, `latest` image tag, official date tag or GitHub release.

GitHub documents that [new GHCR packages start private](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry), and that repository linkage inherits [access permissions rather than visibility](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility). Actual anonymous access is checked after the image exists. If first-use visibility prevents anonymous access, the completed image and bundle remain available and the delivery report records that remaining setting. The package administrator changes the application package to **Public** once in its package settings, then anonymous verification can resume against the same digests without rebuilding or approving another workflow. This setting applies to every version in the package and cannot be changed back to private. It is separate from an approval gate on individual builds.

## What qualification and delivery do

The delivery guard binds the live GitHub run to this repository, the trusted default branch, the exact source and the expected workflow. It accepts the supported push or manual event, requires a fresh run, and does not require the initiating actor to be the repository owner. Forks, other branches, mismatched source and a reused run are rejected.

A required native source checks job runs first, once on AMD64: it installs the frozen native lockfile with the verified pinned pnpm, checks the redirect security fix, runs the blocking production dependency audit, native lint and the complete native unit suite, and verifies the Firefox/WebKit scenario selection. These source checks are architecture-independent. Two native GitHub-hosted jobs then run on AMD64 and ARM64; neither starts unless the source checks passed. Each installs the locked controller dependencies, executes controller audit/source/writer/packaging checks, checks the tracked controlled Homepage source and builds the complete application image locally (frozen install, production build and compression only). That image undergoes actual production-browser, Compose, Swarm and Portainer lifecycle checks. Portainer qualification exercises both unchanged templates through the real API, including replacement, persistence, restore and cleanup. Unit fixtures do not satisfy that gate.

The qualification report records the following required checks for **each** native target:

| Keys | Actual prerequisite |
| --- | --- |
| `controller`, `packaging`, `native`, `dependencies` | Controller and release-tool tests, packaging and source checks on that target; the native production build on that target; full native lint/tests and locked production dependency audits from the run's required native source checks job, which the target job needs |
| `browser` | The production Chromium acceptance suite configured in the accepted source |
| `desktopFirefox`, `desktopWebKit` | The configured desktop acceptance scenarios in each engine |
| `hiddenDocument` | Real headed-browser document hiding and timer suspension/resume |
| `compose`, `swarm` | Direct single-container deployment and full lifecycle acceptance |
| `portainerCompose`, `portainerSwarm` | Actual Portainer API qualification for both templates, including cleanup |

The workflow order is part of this contract. Each native image push occurs only after the native source checks job and that target's preceding checks succeed. Assembly requires the native source checks and both native jobs to succeed. The report binds the commit, Git tree, pinned Homepage commit, run identity and the locally tested image configuration digests. A field saying `passed` outside that execution does not prove a test ran.

Only the already-tested application image objects are pushed to the application repository. Their registry architecture manifests and configuration bytes must match the local image IDs tested on their native runners. Assembly constructs one multiarchitecture index from the exact architecture digests and verifies every manifest/configuration identity. It produces one corresponding-source archive, the original qualification report, candidate manifest, digest-pinned templates, environment example and checksums.

Corresponding-source packing requires the exact accepted commit with no tracked
changes. Its prebuild guard inspects every local Docker COPY input and rejects
untracked or ignored source within those copied trees. Actual Docker-excluded
dependencies/build outputs are allowed locally; unrelated untracked files outside
build inputs do not enter the archive. The deterministic `studio-source.tar.gz`
contains the complete controller and native fork, build instructions and license
notices. Its hash is bound into the candidate, and promotion reuses the same
bytes. The build verifies the pinned pnpm tarball before frozen installation.
See [native source](NATIVE-SOURCE.md).


The bundle's `delivery-receipt.json` keeps image integrity and anonymous availability separate. It records the build identity, artifact fingerprint, exact image references, `authenticatedPulls`, `anonymousAccess` and any pending packages. The anonymous verification method is `registry-stream-sha256`; its `layers` list records each verified repository, layer digest and size. Its status is `public-ready` or `package-access-pending`. Image/configuration mismatches, incomplete architecture receipts or failed tests stop delivery. A first-use visibility restriction leaves anonymous access pending while preserving the already-qualified images and bundle. Successful public verification reads the exact indexes and architecture/configuration bytes without credentials, then streams and SHA-256 checks every unique runtime layer within each repository for both architectures. It uses neither a Docker daemon nor cached layers.

The hosted delivery check also performs two authenticated Docker pulls, one per native architecture, using the verified platform-specific child manifest digests, then checks each expected image configuration ID, operating system and architecture. The registry index must already bind those exact children and configurations to the tested source; deployment templates continue to use immutable multiarchitecture index digests. Pulling separate children avoids binding one index digest to two local image IDs in Docker's classic store, the collision recorded in [Moby issue 43188](https://github.com/moby/moby/issues/43188). No image deletion, retagging or rebuild is part of this verification.

A successful build alone does not establish that the owner can pull the images. After a visibility change, the operator verifies the same candidate manifest and registry bytes without rebuilding; `node scripts/candidate-pipeline.mjs verify-public <candidate-manifest.json>` performs that same anonymous streaming check without Docker or credentials. The operator retains the later verification result alongside the original build receipt, whose earlier pending status remains historical. This verification is engineering work, not an installation command for the owner.

## Portainer handoff

A deployment handoff requires the complete engineering result for these bytes, the retained application image, verified bundle hashes and successful anonymous image access. The bundle contains no registry credentials or private runtime configuration. Human acceptance is still pending.

Use `portainer-swarm.yml` for Docker Swarm or `portainer-compose.yml` for standalone Docker. Both templates already contain the same immutable application image index digest, covering AMD64 and ARM64. Before deploying, create the shared proxy network and the three Docker secrets, then supply the exact dashboard origin; Swarm also requires the unique hostname of the storage node ([DEPLOY.md](DEPLOY.md)). Deploy the single `studio` service with its configuration and state volumes. No compilation or registry password is needed for the public candidate. New volumes open an empty dashboard for the first evaluation.

For an existing stack, review the single `studio` service definition, both named volumes and published port before incorporating the template. The application image contains the controller and managed native dashboard workers together. The bundle includes one matching corresponding-source archive for this complete application. [DEPLOY.md](DEPLOY.md) and [DEPLOY-COMPOSE.md](DEPLOY-COMPOSE.md) walk through deployment; [OPERATIONS.md](OPERATIONS.md) covers storage and health checks. What a person deploying a candidate needs to know is summarized in [VERSIONS.md](VERSIONS.md).

The remaining human review concerns the owner's real host/network resolution and storage, actual service credentials and data, phone gesture feel, and theme/readability on their displays. Known engineering failures, missing browser checks, generic Portainer deployment or registry delivery checks are completed before that handoff. Record human results against the candidate fingerprint.

Keep the previous application image and matching configuration/state backup for rollback; restore the application image and matching data together. The bundle includes a concise handoff and rollback note (`READ-ME-FIRST.txt`). After human acceptance, [official promotion](RELEASES.md#controlled-official-promotion) associates these same image bytes with an approved `YYYY.MM.DD` version in `America/Chicago`.

## Operating rules

Local registry and GitHub fixtures test identity and failure handling; they do not replace actual GHCR push, pull and bundle verification. See [VERIFICATION.md](../VERIFICATION.md) for the gates; executed results belong to each candidate's workflow run and verification report. Do not automatically retry a partial publication, replace an existing build tag or report a visibility-pending candidate as ready to deploy.
