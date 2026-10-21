# Exact candidates for Portainer testing

The candidate and release definitions in `release/workflows/` are **dormant proposals**. They do not run from this directory. No registry, protected environment, package visibility or candidate publication is configured by these files. A locally passing test of the tooling is not a successful registry delivery or a deployable candidate.

The proposed delivery is one explicitly approved GHCR candidate containing the complete writer and native renderer, each for `linux/amd64` and `linux/arm64`. Portainer templates use immutable index digests. Candidate images receive only a unique `build-<full-source-commit>-<run-id>` retention tag. There is no moving preview channel, `latest` tag, date release or claim of human acceptance.

## Decisions and setup before activation

The owner must approve the concrete delivery and first-use setup. This proposal uses these exact package names:

| Purpose | Writer | Native renderer | Visibility |
| --- | --- | --- | --- |
| Native-build staging | `ghcr.io/theuncleben/homepage-studio-candidate-staging` | `ghcr.io/theuncleben/homepage-studio-renderer-candidate-staging` | Always private |
| Intended installable images | `ghcr.io/theuncleben/homepage-studio` | `ghcr.io/theuncleben/homepage-studio-renderer` | Private during first-use preparation, then public only by owner action and exact candidate approval |

This is an explicit private staging proposal, not an assumption that an existing private registry was authorized. Public distribution of the human-test candidate is a separate decision from acceptance of an official release. If private-only delivery is selected instead, its access and Portainer credential path must be reviewed before changing this workflow.

Activation requires the following concrete setup:

1. Put the reviewed candidate and promotion definitions in `.github/workflows/` on the accepted default branch. GitHub only offers a manual workflow after it exists on that branch. Freeze and identify the full source commit after both definitions are in place.
2. Configure `candidate-publication` and `official-release` environments with `TheUncleBen` as a required reviewer. Permit the owner to approve a run they initiated. The scripts verify the actual protected environment and the authenticated approval history; an environment name alone is insufficient. The owner-only manual dispatch authorizes private staging; there is no third review step for that work. [GitHub environment controls](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments) describe these settings.
3. Verify package metadata access and repository linkage. The workflow uses its repository `GITHUB_TOKEN` for registry writes and requests package access only in the relevant jobs. Existing packages must be linked to this repository and visible to the workflow. A visibility-read failure stops the process. The package REST API's supported token behavior must be verified on the actual account; if a separate read-only metadata credential is needed, that is a setup decision, not permission to create a broad token. The optional `STUDIO_PACKAGE_METADATA_TOKEN` secret is read-only in this implementation and must identify the owner. Never put a token in dispatch inputs, source, screenshots or a candidate bundle.
4. For first use, explicitly select `bootstrap_private_packages=true` when dispatching the private build. The default is false. The workflow records the exact source, build identity and all four package names authorized by that dispatch. This authorizes creation only from the tested application images; no placeholder image or empty-package precreation is needed.

GitHub documents that [new GHCR packages start private](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry), and that repository linkage inherits [access permissions rather than visibility](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility). The code still verifies actual visibility immediately after creation. Existing staging packages must be verified private before each push. A named metadata 404 alone is insufficient: bootstrap also requires a successful complete authenticated namespace listing. Access errors are never interpreted as permission to create or as proof of privacy.

## What the manual candidate workflow does

The owner dispatches `candidate-approved.yml` from the default branch with the exact commit. A different commit, non-owner initiator, rerun attempt or other branch is rejected. Live GitHub API checks bind the authenticated dispatch to the reviewed workflow and source; the explicit bootstrap input is recorded with that build. This dispatch authorizes private engineering staging. Public delivery still requires the later exact-artifact protected review.

Two native GitHub-hosted jobs run on AMD64 and ARM64. Each installs the locked dependencies, executes source/writer/packaging checks, prepares the pinned Homepage source and builds both images locally. The images then undergo the actual production-browser, Compose, Swarm and Portainer lifecycle checks. The Portainer test exercises both unchanged templates through the real API, including replacement, persistence, restore and cleanup. Unit fixtures do not satisfy that gate.

The qualification report records the following required check keys for **each** native target:

| Keys | Actual prerequisite |
| --- | --- |
| `writer`, `packaging`, `native`, `dependencies` | Writer and release-tool tests, packaging and source checks, full native tests/build, locked production dependency audits |
| `browser` | Expanded Chromium acceptance suite, currently 17 scenarios |
| `desktopFirefox`, `desktopWebKit` | Four total desktop scenarios across the two engines |
| `hiddenDocument` | Real headed-browser document hiding and timer suspension/resume |
| `compose`, `swarm` | Direct actual two-image deployment and full lifecycle acceptance |
| `portainerCompose`, `portainerSwarm` | The successful actual Portainer API qualification step for both templates, including cleanup |

The reviewed workflow order is part of this contract. `stage` executes only after all preceding commands succeed, and the assembly job requires both native jobs to succeed. The report binds the commit, Git tree, pinned Homepage commit, run identity and each locally tested image configuration digest. A field saying `passed` outside that trusted execution is not proof of a test run.

Only the already-tested image objects are tagged and pushed to the verified private staging packages. The registry's architecture manifest and configuration bytes must match the local image ID that was tested. There is no emulated replacement for native qualification. The assembly job constructs each multiarchitecture index from those exact architecture digests, verifies the full pair and prepares corresponding source, original evidence and digest-pinned templates.

For first use, the complete qualified indexes are also copied into the two intended destination packages while they remain private. The bootstrap checks private destination history: only this candidate's index and architecture manifest digests may be present. This prevents a whole-package visibility change from unexpectedly exposing unrelated old versions. Already-public destinations receive no candidate write at this stage.

The assembly summary then displays the concrete candidate fingerprint, both exact image digests and any first-use package links. The next job waits at `candidate-publication`; no runner polls while the owner reviews it. If the owner approves public distribution, they make only the two intended destination packages public and approve the exact displayed fingerprint statement. The staging packages stay private. GitHub's visibility change applies to the entire package and cannot be changed back to private, so it is an explicit one-time owner action, never an automated side effect.

After approval, the job rechecks the authenticated owner review and actual public visibility. On first use, it verifies the existing immutable build tags without overwriting them. On subsequent candidates, it copies the approved indexes to unused unique build tags. It reads both indexes and architecture/configuration blobs anonymously, logs out of GHCR, then anonymously pulls all four image/platform combinations and verifies their image IDs. The workflow has no Git tag or GitHub release write permission.

## Handoff and official acceptance

The source/evidence bundle is available before public approval so the exact set can be reviewed. It contains no container image archives or registry credentials and is labeled pending delivery. Its existence is not a public deployment handoff.

A human-test handoff requires the completed candidate run, successful anonymous registry readback, verified bundle hashes, corresponding source and the complete engineering checks for these same bytes. At that point the owner downloads the bundle, chooses `portainer-swarm.yml` or `portainer-compose.yml`, creates a new Portainer stack and supplies the exact dashboard origin. Swarm additionally needs the storage node name. Both image digests are already filled in; no registry password is needed for the public candidate. Start with new volumes so the first evaluation opens the empty dashboard.

The remaining human review concerns the owner's real host/NetBird resolution and storage, actual service credentials and data, their phone's gesture feel, and theme/readability on their displays. Known engineering failures, missing browser gates, generic Portainer deployment or registry delivery tests are not deferred to the owner. Record results against the candidate fingerprint. Keep the old dashboard intact during the new-stack evaluation.

Keep the previous image pair and its matching configuration/state backup for rollback; restore the full pair and data together. The candidate bundle includes a concise handoff and rollback note. Only after human acceptance does [official promotion](RELEASES.md#controlled-official-promotion) bind the candidate to an approved `YYYY.MM.DD` in `America/Chicago`, preserving the same image bytes.

## Failure handling and current evidence limits

Missing approval, an incorrect reviewer, changed source or image bytes, incomplete architecture evidence, changed package visibility, unrelated private versions and existing conflicting tags all stop the operation. No failure path changes visibility, deletes a package, replaces a tag or automatically reruns a partial publication. Preserve the concrete failed-run evidence and review any partially created private package or draft release before a new operation.

Local tests cover those guards with synthetic GitHub/OCI/registry fixtures, source archive reproducibility and dormant workflow structure. They do not exercise live GHCR authorization, cross-repository copy, environment approvals or anonymous layer downloads. Those actual-account gates remain unrun until the owner approves and configures the delivery path. Ordinary nonpublishing CI continues independently and cannot supply retained candidate images because it deliberately discards them.
