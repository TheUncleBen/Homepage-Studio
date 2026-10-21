# Release and artifact policy

Official versions use exactly `YYYY.MM.DD`, based on the approved publication date in `America/Chicago`. Readiness and owner acceptance determine when a version ships. There is no one-release-per-day scheduling rule. A date-only tag is one immutable name; if a second official release on an already-used date becomes necessary, resolve that concrete naming collision with the owner instead of overwriting a tag or inventing a date.

The public Git repository contains source and build definitions. OCI images belong in GHCR and are associated with the repository through their source labels. Intended image names are `ghcr.io/theuncleben/homepage-studio` for the writer and `ghcr.io/theuncleben/homepage-studio-renderer` for the native renderer. These names are not evidence of a published package. GitHub documents image storage, repository linkage, digest pulls and package visibility in its [Container registry guide](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry). A public repository does not automatically make a new GHCR package public.

## Three distinct stages

1. **Source qualification.** Ordinary pushes and pull requests run the read-only validation workflow. Both required architectures build and run the two-image application in disposable CI. No date tags, releases, image publication or installable image artifact uploads occur.
2. **An exact candidate for human testing.** Once engineering qualification passes, prepare the complete candidate artifact set: source commit, both architectures' immutable image identities, deployment assets, corresponding source, verification evidence, rollback instructions and the concise human test checklist. Preserve these exact bytes. The delivery location must be explicitly authorized for that candidate. There is no moving public preview image channel. This source change does not configure a private staging registry or upload images to public Actions artifacts as a substitute for one.
3. **Owner-approved official promotion.** After the owner's human testing and approval identify the exact candidate and official date, apply the date tag to those existing artifacts and publish the reviewed release assets. Do not rebuild the images after approval. The in-image version stays the immutable build/source identity; an external release manifest associates it with the approved date, including when acceptance occurs on a later day.

Candidate distribution and official promotion now have concrete, testable definitions in `release/workflows/`, outside GitHub Actions' active workflow directory. They remain dormant. [Candidate delivery](CANDIDATES.md) describes the proposed private staging, explicit first-use bootstrap, complete native qualification, exact-candidate public approval and simple Portainer handoff. No delivery choice, environment configuration, package visibility or publication is implied by adding these files.

Activate both reviewed definitions on the repository's default branch only after the delivery/setup decision is approved. GitHub requires a dispatched workflow to exist on the [default branch](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow). Creating a workflow file is not proof that required reviewers have been configured.

## The offline manifest tool

`release-manifest.example.json` is intentionally unapproved and cannot be materialized. A real manifest records:

- The full accepted source commit and pinned Homepage commit.
- Both GHCR image index digests, their build revisions and `linux/amd64` plus `linux/arm64` coverage.
- Hashes of automated verification evidence and the owner's human acceptance record.
- The exact `YYYY.MM.DD` version, owner identity, timezone-qualified approval timestamp, and a fingerprint binding the source, images, version and verification set.

`scripts/release-manifest.mjs` validates that these fields are mutually consistent. It checks the Chicago date, rejects missing approval/testing fields, tags such as `latest`, a missing architecture or changed build/image identity, and refuses to overwrite an existing release-output directory. It can then generate Portainer templates with both images pinned by digest:

```sh
node scripts/release-manifest.mjs validate path/to/accepted-release-manifest.json
node scripts/release-manifest.mjs materialize path/to/accepted-release-manifest.json release-dist/YYYY.MM.DD
```

This is an offline consistency check. A JSON field saying “owner-approved” is not authenticated authorization, an image digest is not proof it was tested, and a generated template is not a publication. The release operator must verify the actual approval record, image identities, complete test evidence, architecture manifests, corresponding source and license notices before executing a separately authorized promotion. No publishing commands or credentials are present in the manifest tool.

## Controlled official promotion

`release/workflows/promote-approved.yml` takes the exact candidate manifest, owner-accepted release manifest and original `verification.json` as dispatch data. JSON is passed through environment variables and parsed as data; it is never interpolated into shell commands. The read-only review job prints a statement binding the candidate fingerprint, release fingerprint and official date.

The `official-release` environment must have `TheUncleBen` as a required reviewer with self-review permitted. The owner approves using that exact statement. `scripts/release-guard.mjs` then reads GitHub's actual repository, run, environment and [review history](https://docs.github.com/en/rest/actions/workflow-runs#get-the-review-history-for-a-workflow-run). It verifies the initiating and approving owner, fresh manual run, reviewed default-branch workflow, configured reviewer and exact approval comment. Bypassing the environment, supplying a JSON approval field, rerunning an old approval or substituting another candidate does not pass.

The promotion script verifies both public image indexes, runtime architecture manifests, configuration digests and source/build labels against the accepted candidate. It verifies source archives, engineering report, Git commit/tree and rendered deployment assets. The report must identify the exact candidate workflow run; a live API read must show that owner's manual first attempt completed successfully for the accepted source and reviewed candidate workflow. The pinned artifact download action retrieves `candidate-<source-commit>-<run-id>` from that exact run and rejects a download digest mismatch. The accepted candidate manifest, report, both original source archives and both rendered templates must match the downloaded bundle byte for byte. A passing run alone cannot authenticate a replacement hand-written report or different image set. Missing/expired artifacts and mismatches stop promotion. Original source archives are reused without reconstruction, and neither image is rebuilt.

Only after those checks does it reserve a new Git date tag, copy each existing image index to its unused date tag, create a draft release and upload the complete asset set. A [single existing index source](https://docs.docker.com/reference/cli/docker/buildx/imagetools/create/) is copied without rebuilding, annotations or platform filtering; raw registry readback must retain its exact digest. Every uploaded asset must return the expected size and SHA-256. The script rechecks live approval, the Chicago publication date and source tag before publishing the draft, then verifies all assets and the final Git ref. It does not update a `latest` image tag or mark the release latest automatically.

The official asset set is the candidate and release manifests, digest-pinned Compose and Swarm templates, environment example, writer and native corresponding-source archives, original engineering report and `SHA256SUMS`. Both images and architectures remain one accepted set.

The workflow serializes official publication and rejects existing Git tags, image date tags and release names. It never deletes, replaces or automatically retries a partially published set. A failure after reservation leaves the concrete tag/image/draft state for owner review; it is not an approved reason to overwrite a date. GitHub's optional immutable-release feature can add protection, but this implementation does not invent an administration credential or treat that feature as the authorization gate.

GitHub may require additional workflow-write authorization when tagging source whose workflow tree differs from the current default branch. The publisher checks this before writing and stops rather than assuming a broader token. Reviewing and activating the candidate and promotion definitions together before freezing the first candidate avoids an unnecessary workflow-tree difference. No credential expansion is automatic.

## Required promotion checks

Before enabling or executing an official promotion:

- Verify the owner approved this source commit, exact image/asset set and official date. Ensure the test candidate and promoted bytes are identical.
- Confirm the candidate delivery location and permissions were approved. Check GHCR package/repository linkage and desired public visibility explicitly.
- Confirm both real architecture builds and deployment acceptance results, native browser/device results, recovery/restore checks, and the owner's target-host testing. Unrun gates must remain visible.
- Inspect the actual image indexes and child manifests. Verify their digests, architectures, source labels and native protocol/build identities against the manifest.
- Preserve the complete corresponding source and build scripts, upstream GPL license, original Studio AGPL-3.0-or-later license, prior applicable grants and dependency notices in the release artifact set.
- Confirm the date tag and release do not already exist. Never move an official Git tag, replace an existing release artifact, or reuse a GHCR date tag for new content. Keep installation templates pinned by digest because package tags are not a substitute for immutable content identity.
- Use a manually initiated, reviewed publication operation with the least required permissions. Do not add automatic publication to the validation workflow. Record successful registry digests, release assets and approval evidence in the project handoff.

Ordinary validation remains nonpublishing. Only the separately approved manual candidate and official operations may write images or release assets; their dormant definitions do not authorize activation or execution.
