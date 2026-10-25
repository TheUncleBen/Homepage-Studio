# Versions: candidates and official releases

Homepage Studio has two kinds of build you can deploy, and no moving tag.
There is no `latest` image and no "always the newest" channel: you always
deploy one exact image, pinned by its digest, from a bundle that says what it
is.

| What | Named by | Where you get it | Who decides it exists |
| --- | --- | --- | --- |
| **Candidate** | Its source commit and image digest | A bundle attached to a run of the **Validate and prepare deployment candidate** workflow, under **Actions** on GitHub | The CI, when a candidate is requested and every check passes |
| **Official release** | A date, `YYYY.MM.DD` (for example `2026.11.02`) | **Releases** on GitHub, with the same files as assets | The owner, after testing that exact candidate |

An official release is a candidate that the owner has tested and approved,
published under a date. Its image bytes are the candidate's, unchanged: it is
never rebuilt. There are no official releases yet; until the first one, every
deployment is of a candidate.

## What's in a bundle

A candidate bundle (`candidate-<commit>-<run>`, downloaded as a zip from the
workflow run's **Artifacts**) contains:

| File | What it is |
| --- | --- |
| `portainer-swarm.yml` | The Swarm stack, with the image already pinned as `ghcr.io/theuncleben/homepage-studio@sha256:...` |
| `portainer-compose.yml` | The same for standalone Docker Compose |
| `portainer.env.example` | The values you set: origin, port, Swarm node and the optional limits |
| `READ-ME-FIRST.txt` | The source commit, the artifact set fingerprint, and a short handoff and rollback note |
| `delivery-receipt.json` | Whether the image can be pulled without signing in (`status`, see below) |
| `candidate-manifest.json` | The exact image digests for `linux/amd64` and `linux/arm64`, the source commit and file hashes |
| `verification.json` | The automated test report for this build, check by check, for both architectures |
| `studio-source.tar.gz` | The complete corresponding source for this image, with its licenses |
| `SHA256SUMS` | Checksums of every file above |

An official release has the same templates, environment example, source,
report and manifests as release assets, plus `release-manifest.json` (the
approved date, who approved it and when, and the hashes it binds together) and its own `SHA256SUMS`. The image is
also tagged `ghcr.io/theuncleben/homepage-studio:YYYY.MM.DD`, but the
templates still pin the digest, and that is what you should deploy.

## Checking a bundle

In the folder you unzipped:

```bash
sha256sum -c SHA256SUMS                       # every line should say OK
grep -h 'image:' portainer-*.yml              # the same digest in both templates
grep '"status"' delivery-receipt.json         # "public-ready" or "package-access-pending"
```

| `status` | Means |
| --- | --- |
| `public-ready` | Anyone can pull the image without signing in. Every image layer was downloaded and checked anonymously, on both architectures |
| `package-access-pending` | The image is built, tested and stored, but the GitHub package isn't public yet. Pulls need a GitHub sign-in until the package owner makes it public once; the digest doesn't change when they do |

To see that the digest covers both architectures:

```bash
docker buildx imagetools inspect ghcr.io/theuncleben/homepage-studio@sha256:<digest>
# lists linux/amd64 and linux/arm64
```

`verification.json` lists each automated check for each architecture:
controller and packaging tests, the native build, lint, tests and dependency
audit, the Chromium suite, the Firefox and WebKit scenarios, the hidden-tab
timing check, and the Compose, Swarm and both Portainer deployments. What the
automated checks can't cover (your phone in your hand, your services, your
network) is listed in [FEATURE-ACCEPTANCE.md](FEATURE-ACCEPTANCE.md#human-acceptance-after-engineering-qualification).

## Which one to run

- Run an **official release** when there is one and you want what the owner
  has approved.
- Run a **candidate** to test a build before it becomes a release. Treat it as
  a test deployment: keep the previous image digest and a backup so you can go
  back ([UPGRADING.md](UPGRADING.md)).

The version a running container reports is its build: the settings dialog
shows *Studio build* and the first eight characters of the source commit, and
`/studio/application-ready` returns the full `buildRevision`
([OPERATIONS.md](OPERATIONS.md#logs-and-health)).

## How builds are made

For the people who maintain the project:

- Pull requests and ordinary pushes to the default branch run the full
  two-architecture qualification and publish nothing.
- A push whose head commit message contains `[deliver-candidate]`, or a manual
  run of the candidate workflow, keeps the tested image and produces the
  bundle. Details: [CANDIDATES.md](CANDIDATES.md).
- An owner-approved candidate is promoted to `YYYY.MM.DD` by a separate
  workflow that needs the owner's approval in GitHub and never rebuilds the
  image. Details: [RELEASES.md](RELEASES.md).
