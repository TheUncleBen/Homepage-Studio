# Homepage Studio

**[Overview](#overview) · [Quick start](#quick-start) · [Documentation](#documentation) · [Features](#features) · [How it works](#how-it-works) · [Security](#security-model) · [Repository](#repository-layout) · [Development](#development) · [License](#license)**

A self-hosted dashboard you arrange by hand. Homepage Studio is built on
[Homepage](https://gethomepage.dev/) and keeps its native service widgets,
information widgets, bookmarks and Docker/Kubernetes discovery, but you edit
the dashboard on the page itself: add a widget, hold it, drag it where you
want it, resize it, and stack widgets that belong together into a slideshow.
One container serves as many independent dashboards as you like, each at its
own address on the same host (`/family`, `/admin`, ...).

## Contents

- [Overview](#overview)
- [Quick start](#quick-start)
  - [Running it](#running-it)
  - [Using it](#using-it)
- [Documentation](#documentation)
- [Features](#features)
  - [Status](#status)
- [How it works](#how-it-works)
- [Security model](#security-model)
- [Repository layout](#repository-layout)
- [Development](#development)
- [License](#license)

## Overview

- **Who uses it.**
  - The **operator** deploys the container and puts it behind a reverse proxy.
  - **Editors** sign in and view or arrange the dashboards shared with them.
    Administrators manage people, sharing and settings (see
    [Security model](#security-model) and
    [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md)).
- **What it runs on:** one Docker container for `linux/amd64` or
  `linux/arm64`, with two named volumes. Only port 3000 is published.
  - **Deploy with** a Portainer Docker Swarm stack (one replica on one node)
    or plain Docker Compose on one machine. The same image serves both.
  - Every build is tested in CI on both architectures, as a Compose service,
    as a one-node Swarm stack and through a real Portainer, in Chromium,
    Firefox and WebKit ([VERIFICATION.md](VERIFICATION.md)).
- **What it looks like:** charcoal and gray surfaces, soft white text and a
  muted eggplant accent by default. Each dashboard can switch to light or
  follow the device, pick its own accent and carry its own custom CSS
  ([docs/APPEARANCE.md](docs/APPEARANCE.md)).
- **On a phone or tablet:** the board reflows to 8 columns on medium widths
  and 4 on narrow ones. Press and hold to edit, swipe a stack to change
  slides, and the page still scrolls normally.
- **What it talks to:** whatever services you configure, through Homepage's
  own server-side widget proxies. Nothing leaves the container on its own.

## Quick start

### Running it

The main guide assumes a Docker Swarm managed with Portainer, Nginx Proxy
Manager in front for HTTPS, and Docker secrets for every key and password.
Studio's own sign-in is built in; single sign-on through any OpenID Connect identity provider is optional. Every
piece can be swapped, and the guide links to the alternatives.

1. Get a **candidate bundle** or an **official release** and check it
   ([docs/VERSIONS.md](docs/VERSIONS.md)). It contains the deployment
   templates with the image already pinned by digest. There is no `latest`
   tag to pull.
2. Work through [docs/DEPLOY.md](docs/DEPLOY.md) top to bottom: the shared
   proxy network, storage, the optional identity provider, three Docker
   secrets, the environment file, the Portainer stack, the reverse proxy and
   the first sign-in.
   - One machine without Swarm: [docs/DEPLOY-COMPOSE.md](docs/DEPLOY-COMPOSE.md).
   - Another proxy (Caddy, Traefik, nginx): [docs/REVERSE-PROXY.md](docs/REVERSE-PROXY.md).
   - Another identity provider: [docs/IDP-OTHERS.md](docs/IDP-OTHERS.md).
3. Invite people and share dashboards: [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md).
4. Keep [docs/OPERATIONS.md](docs/OPERATIONS.md) handy for backups, health
   checks and limits, and [docs/UPGRADING.md](docs/UPGRADING.md) for the next
   version.

### Using it

1. Open your dashboard's address. A new deployment first asks you to create
   the administrator account, then shows an empty dashboard and an **Add your
   first widget** button.
2. [docs/USING.md](docs/USING.md) walks through adding content, arranging it,
   stacks and slideshows, configuration, snapshots and extra dashboards.

## Documentation

| Guide | For | What's in it |
| --- | --- | --- |
| [USING.md](docs/USING.md) | Editors | Adding and arranging panels, touch and keyboard, stacks and slideshows, the title picker, configuration files, snapshots, import/export, multiple dashboards |
| [APPEARANCE.md](docs/APPEARANCE.md) | Editors | Dark, light or device mode, accent colors, custom CSS variables, copying a design to another deployment |
| [DEPLOY.md](docs/DEPLOY.md) | Operators | The main guide, top to bottom: Docker Swarm with Portainer (or `docker stack deploy`), Docker secrets, a reverse proxy, an optional identity provider (Authentik and Nginx Proxy Manager as worked examples), plus every environment variable |
| [DEPLOY-COMPOSE.md](docs/DEPLOY-COMPOSE.md) | Operators | The same on one machine with Docker Compose |
| [IDP-AUTHENTIK.md](docs/IDP-AUTHENTIK.md) | Operators | Worked example: single sign-on with Authentik, every provider field, the Studio settings, troubleshooting |
| [IDP-OTHERS.md](docs/IDP-OTHERS.md) | Operators | Single sign-on with Keycloak, Authelia and other OpenID Connect providers |
| [AUTHENTICATION.md](docs/AUTHENTICATION.md) | Operators, administrators | Sign-in, the first administrator, inviting people, sharing dashboards, session policies, single sign-on with any OpenID Connect provider, email, recovery |
| [REVERSE-PROXY.md](docs/REVERSE-PROXY.md) | Operators | What any proxy must pass through, Caddy, Traefik and nginx examples, a published port instead of the network, request limits, framing |
| [OPERATIONS.md](docs/OPERATIONS.md) | Operators | Logs and health, backups and restore, snapshots and secrets, worker limits, integration secrets |
| [UPGRADING.md](docs/UPGRADING.md) | Operators | Moving to a new version and going back |
| [VERSIONS.md](docs/VERSIONS.md) | Operators | Candidates and official `YYYY.MM.DD` releases, what a bundle contains, how to check it |
| [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Operators | Symptoms and fixes, from a container that won't start to a page that says the dashboard isn't available |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Everyone | How the controller, native workers, storage and health checks fit together, and the trust model |
| [CHANGELOG.md](CHANGELOG.md) | Everyone | Notable changes for people who run or use Studio |
| [FEATURE-ACCEPTANCE.md](docs/FEATURE-ACCEPTANCE.md) | Contributors | Every required behavior and the tests that cover it |
| [VERIFICATION.md](VERIFICATION.md) | Contributors | How to verify a build locally and what CI checks |
| [CANDIDATES.md](docs/CANDIDATES.md), [RELEASES.md](docs/RELEASES.md) | Maintainers | How the CI produces a candidate and how an approved candidate is promoted |
| [NATIVE-SOURCE.md](docs/NATIVE-SOURCE.md) | Contributors | The Homepage fork in `homepage/`, its provenance, dependency corrections and corresponding source |

## Features

- **A Dashboards page and clean live dashboards.** The Dashboards page lists
  what each person can open, with **Open**, **Edit** and **Settings**. A live
  dashboard shows widgets only; arranging happens in its editor
  (`/<slug>/studio/edit`) and settings in `/<slug>/studio/settings`. The
  bare address opens your default dashboard, your group's, or the Dashboards
  page. One top bar is the same on every page.
- **Arrange in the editor.** Move panels by their handle, resize from the
  corner or use the keyboard. The board snaps to a 12-column grid and never
  lets panels overlap. **Done** saves the arrangement and goes back to
  Dashboards; **Cancel** asks before it throws away unsaved moves.
- **Four kinds of panel, each placed on its own.** Service tiles, single
  service widgets (one integration of a service, apart from the rest),
  information widgets (clock, weather, search, resources, ...) and bookmarks.
  Information widgets get readable titles ("Date & Time", "Date & Time 2").
- **Stacks.** Put panels of the same size on top of each other, or select
  several and **Create stack**. A stack shows one member at a time with:
  - one **Play/Pause** button and passive dots (no previous/next buttons);
  - swipe on the header or the widget body, drag horizontally with a mouse,
    scroll sideways on a trackpad, or focus it and press Left/Right;
  - a quiet title picker that opens only on a deliberate tap, click or key
    press, never from a swipe, drag or long press;
  - automatic or manual start, seconds per widget (10 by default), a manual
    navigation delay (30 seconds by default), looping, and horizontal,
    vertical, fade or no animation (250 ms by default).
- **Native configuration.** Each panel has an **Options** form and an
  **Advanced YAML** tab. **Configuration files** edits all nine native files
  (`services.yaml`, `widgets.yaml`, `bookmarks.yaml`, `settings.yaml`,
  `docker.yaml`, `kubernetes.yaml`, `proxmox.yaml`, `custom.css`,
  `custom.js`). Unknown options, comments and `{{HOMEPAGE_VAR_...}}` /
  `{{HOMEPAGE_FILE_...}}` references are kept. A YAML mistake is reported with
  its line and column.
- **Safe saves.** Every save checks that nobody else changed the files in the
  meantime, writes through a recovery journal and keeps a snapshot of what was
  there before. The newest 25 snapshots per dashboard are kept (configurable).
  A failed save keeps your draft.
- **Export and import.** Download one dashboard (all nine files plus layout and
  stacks) and import it into another dashboard or deployment, after an
  explicit confirmation.
- **Multiple dashboards.** Create, duplicate, rename, move to another address,
  archive and restore dashboards from the **Dashboards** page. Each has its own widgets, layout, stacks, appearance, CSS,
  JavaScript and snapshot history. An archived or unknown address shows a
  plain "This dashboard isn't available" page with a link to the
  Dashboards page.
- **Discovery.** Docker labels and Kubernetes annotations still define
  discovered services; Studio only decides where they go and whether they show.
- **Appearance.** Dark, light or follow device, any accent color, native
  background options and custom CSS, per dashboard.

### Status

There is no official release yet. Builds are delivered as candidates
identified by their source commit and image digest; an official `YYYY.MM.DD`
release is made only after the owner has tested and approved an exact
candidate ([docs/VERSIONS.md](docs/VERSIONS.md)).

| Area | State |
| --- | --- |
| Editing, stacks, playback, title picker, configuration, snapshots, import/export, multiple dashboards | Built. Covered by controller and native unit tests and a Chromium browser suite against the real image in CI; eight core scenarios also run in Firefox and WebKit |
| Deployment as Compose, one-node Swarm and through Portainer, on amd64 and arm64 | Built. Every candidate is deployed, restarted, replaced and cleaned up in CI on both architectures |
| Touch feel on real phones and tablets, readability on your own displays | Covered by emulated touch in Chromium only. Needs a person on a real device |
| Native integrations against real services | Synthetic test services only. The native widget code is Homepage's own; your services, credentials and network are yours to check |

## How it works

The full picture is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). In short:

```
browser ──HTTPS──▶ your reverse proxy ──▶ studio container :3000
                                            ├─ Node controller: host/origin checks, dashboard registry,
                                            │    editor API, snapshots and journal, shared static assets
                                            ├─ native Homepage worker per active dashboard
                                            │    (started on demand, loopback only, stopped when idle)
                                            └─ volumes: /app/config (native files, registry)
                                                        /app/state  (layout, journal, snapshots)
```

- **One image, one lifecycle.** The controller and the complete Homepage fork
  in [`homepage/`](homepage/) are built into one image. There is no separate
  Homepage container to keep in step.
- **One worker per dashboard.** Each dashboard you open gets its own native
  process with its own configuration, caches and cookies. Up to 8 run at once
  by default; idle ones stop after 10 minutes.
- **One origin.** You set the exact address people type
  (`STUDIO_PUBLIC_ORIGIN`). Dashboards live at single path segments under it.

## Security model

- **Sign-in is on by default.** People need an account; each dashboard is
  shared with chosen people or groups to view or to arrange, and only
  administrators change widget settings, configuration files, custom code,
  people and sharing. Passkeys, authenticator apps, backup codes, optional
  email codes and single sign-on through any OpenID Connect identity
  provider are supported ([docs/AUTHENTICATION.md](docs/AUTHENTICATION.md)).
  Sign-in needs an `https://` address.
- **With `STUDIO_AUTH=off`** there is no login: anyone who can reach the page
  can view and edit every dashboard, read the configuration (including any
  secrets written into the files) and manage the other dashboards. Then put
  access control in your reverse proxy ([docs/REVERSE-PROXY.md](docs/REVERSE-PROXY.md)).
- **Dashboard addresses are not access control.** `/admin` and `/family` are
  just addresses; what decides access is who a dashboard is shared with.
- **What Studio does check.** Requests must use the exact configured host.
  Editor and widget API requests from another site are refused (Origin and
  Fetch Metadata checks), so a page elsewhere can't make your browser change
  the dashboard. Pages can be framed only by the same origin unless you allow
  others with `STUDIO_FRAME_ANCESTORS`.
- **Inside the container** every process runs as UID/GID 1000 with all Linux
  capabilities dropped; the application files are read-only to that user and
  only the two volumes are writable. Native widget workers listen on loopback
  only.
- **Integrations.** Homepage's shared HTTPS client does not verify server
  certificates (inherited, for self-signed home services). Details and the
  other integration limits are in
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#native-integration-transport).

## Repository layout

| Path | What's there |
| --- | --- |
| `server/` | The Node controller and its tests |
| `homepage/` | The complete controlled Homepage fork; Studio's editor lives in `homepage/src/components/studio/` ([homepage/STUDIO-FORK.md](homepage/STUDIO-FORK.md)) |
| `Dockerfile`, `docker/` | The application image and its entrypoint |
| `portainer-swarm.yml`, `portainer-compose.yml`, `portainer.env.example` | The deployment templates and example values. A candidate or release carries copies with the image pinned by digest |
| `browser/` | Playwright browser acceptance specs, run against the real image |
| `scripts/`, `test/` | Build, acceptance, candidate and release tooling and its tests |
| `.github/workflows/` | Validation on pull requests, candidate qualification and delivery, and owner-approved promotion |
| `third-party/` | Dependency and font notices |
| `docs/` | The guides listed under [Documentation](#documentation) |

## Development

```sh
npm ci
npm test                       # controller (server/*.test.mjs), Node 22 or later
node --test test/*.test.mjs    # packaging, provenance and release tooling
```

Native lint and tests run from `homepage/` with the pinned pnpm; the browser
and container acceptance suites need a Docker daemon.
[VERIFICATION.md](VERIFICATION.md) has every command and what CI runs.

The configured dashboard and its snapshots hold private data and must never be
committed. Examples and tests use synthetic hosts such as
`homepage.example.test`. Notable changes are in the [CHANGELOG](CHANGELOG.md).

## License

Original Studio code is **AGPL-3.0-or-later** ([LICENSE](LICENSE)).
Homepage-derived material in `homepage/` keeps its upstream GPL terms
([homepage/LICENSE](homepage/LICENSE)), earlier MIT grants remain valid, and
dependency and font notices are in
[third-party/NOTICE.txt](third-party/NOTICE.txt). Every candidate and release
carries the complete corresponding source (`studio-source.tar.gz`) for the
exact image, and the dashboard's settings dialog links to the source and
license.
