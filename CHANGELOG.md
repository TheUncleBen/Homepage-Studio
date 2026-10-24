# Changelog

Notable changes for people who run or use Homepage Studio. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Official releases
are named by date, `YYYY.MM.DD`, and exist only once the owner has approved
an exact candidate; until then, changes are listed under **Unreleased** and a
build is identified by its source commit and image digest
([docs/VERSIONS.md](docs/VERSIONS.md)).

## [Unreleased]

### Linking local and Authentik accounts, a prepared administrator, groups set ahead

- **Prepared administrator.** `STUDIO_ADMIN_USERNAME` (and optionally
  `STUDIO_ADMIN_EMAIL`) with the new `studio_admin_password` Docker secret
  create the first administrator once, on the first start. The first sign-in
  must add a passkey or authenticator app, and the open setup page is off.
  Studio ignores the seed as soon as any account exists. Put `off` in the
  secret to keep creating the administrator in the browser. **All stacks need
  the fourth secret** (`off` for an existing deployment).
- **Groups from the deployment.** `STUDIO_OIDC_ADMIN_GROUPS` and
  `STUDIO_OIDC_ALLOWED_GROUPS` set the administrator and allowed groups;
  while set they're read-only in Studio.
- **Sharing before the first sign-in.** Groups named in those lists appear
  under **Groups** at once, and any other provider group can be added by its
  exact name, so dashboards can be shared with it before anyone in it signs in.
- **Linking.** A person links their own local and Authentik accounts from
  either side: a local sign-in (or a claim of the local account) within
  5 minutes, then a fresh Authentik sign-in, then a confirmation page. A
  separate Authentik account Studio made earlier is merged into the local one.
  The local email follows the Authentik email and is read-only while linked;
  the password never changes. Alerts go to the old and the new address.
- **Verified emails only.** Studio uses a provider's email only when
  `email_verified` is `true`. Authentik 2025.10 and later sends `false` by
  default; [docs/IDP-AUTHENTIK.md](docs/IDP-AUTHENTIK.md#email-addresses)
  shows the mapping, and **Sign-in settings** warns when an unverified email
  arrives.

### Docker secrets, a shared proxy network and a rewritten deployment guide

Existing stacks need one-time steps before taking this template:
[docs/UPGRADING.md](docs/UPGRADING.md#updating-to-the-version-with-docker-secrets-and-no-published-port).
Keep your current `STUDIO_AUTH_KEY` value for the new secret.

- The templates read the encryption key, the single sign-on client secret and
  the mail password only from Docker secrets (`studio_auth_key`,
  `studio_oidc_client_secret`, `studio_smtp_password`; on Compose, files in
  `STUDIO_SECRETS_DIR`). They no longer pass `STUDIO_AUTH_KEY`,
  `STUDIO_OIDC_CLIENT_SECRET` or `STUDIO_SMTP_PASSWORD` as variables, and
  `portainer.env.example` holds no secrets.
- A secret you don't use holds the word `off`. Studio now treats an empty or
  `off` client secret or mail password file as unset, refuses to start with an
  empty or `off` encryption key file, and names the secret when single sign-on
  is configured but its secret says `off`.
- The templates publish no port. Studio joins an existing network shared with
  the reverse proxy (`STUDIO_NETWORK_NAME`, default `homepage-studio`) and the
  proxy forwards to `homepage_studio:3000`. `STUDIO_PORT` is gone;
  REVERSE-PROXY.md shows how to add a port back for a proxy outside Docker.
- DEPLOY.md is rewritten as one top-to-bottom guide for Docker Swarm with
  Portainer, Nginx Proxy Manager and optional Authentik. New
  [IDP-AUTHENTIK.md](docs/IDP-AUTHENTIK.md) covers every Authentik field and
  the Studio settings that finish single sign-on, and
  [IDP-OTHERS.md](docs/IDP-OTHERS.md) covers other providers.
  REVERSE-PROXY.md adds Caddy, Traefik and nginx examples, and
  DEPLOY-COMPOSE.md follows the same secrets-and-network setup.

### Deployment settings and storage

- `portainer.env.example` now lists every setting the templates pass, each
  with a short comment and its default, and the bundle's copy is generated
  from it (it used to be a shorter hard-coded list). The templates now also
  pass `STUDIO_OIDC_SCOPES`, `STUDIO_OIDC_GROUPS_CLAIM`,
  `STUDIO_OIDC_REFRESH_MINUTES`, `STUDIO_OIDC_ALLOW_HTTP`,
  `STUDIO_SMTP_SECURE` and the `_FILE` forms of the three secrets.
- New `STUDIO_CONFIG_PATH` and `STUDIO_STATE_PATH` bind mount host directories
  (owned by UID/GID 1000) instead of the named volumes. DEPLOY.md explains
  using them on shared storage such as CephFS, and why the node pin stays.
- REVERSE-PROXY.md explains running without a published port when the proxy
  reaches Studio over a Docker network, including `STUDIO_TRUSTED_PROXIES`.

### Sign-in and access control

Owner direction, 23 October 2026. Full guide:
[docs/AUTHENTICATION.md](docs/AUTHENTICATION.md).

- **Upgrade notes.** Sign-in is **on by default** and needs an `https://`
  `STUDIO_PUBLIC_ORIGIN` (`http://localhost` works for testing). On plain HTTP
  elsewhere, Studio starts but shows only a page explaining the fix; set
  `STUDIO_AUTH=off` to keep proxy-based access control instead. After
  updating, open Studio straight away: every dashboard stays locked until the
  first visitor creates the administrator
  ([docs/UPGRADING.md](docs/UPGRADING.md)).
- Local accounts with passkeys, authenticator apps, backup codes and an
  optional emailed code; a password alone never signs in.
- Single sign-on through Authentik or any OpenID Connect provider, with
  administrators and allowed people mapped from provider groups, local
  accounts that can be turned off, and back-channel logout. Studio requests
  `offline_access` so it can re-check groups while people are signed in;
  Authentik needs that scope mapping on the provider. New accounts are created
  at first sign-in only for people in an allowed or administrator group.
- Dashboards shared per person or group to **view** or **arrange**; widget
  settings, files, custom code, imports and sharing stay administrator-only.
  The editor hides what each person can't use.
- Invitations, password resets and security alerts by email (optional), per
  person and per group session policies, an activity log, and command-line
  recovery.

Changes since the candidate built from commit `853da108`. Touch editing works
on the whole panel now, not just its title bar, and several safety, wording
and security fixes land, including the Next.js 16.4.2 security update.

### Upgrade notes
- Replace the whole stack template with the new bundle's, as usual
  ([docs/UPGRADING.md](docs/UPGRADING.md)). The templates now add
  `init: true` and `cap_drop: [ALL]`, and the Compose template
  `no-new-privileges`.
- **Dashboards can no longer be shown in a frame on another site by
  default.** If you embed one, for example in a Home Assistant panel, set
  `STUDIO_FRAME_ANCESTORS` before you update
  ([docs/REVERSE-PROXY.md](docs/REVERSE-PROXY.md#framing)).
- No other new settings. Volumes, dashboards, layouts and snapshots carry
  over unchanged. A snapshot made by this version and exported records what
  made it; the earlier candidate refuses such a file, so import it with this
  version or newer.

### Added
- **Touch hold and swipe on the panel body.** On a phone or tablet, holding
  anywhere on a panel picks it up (a stacked widget picks up its stack), and
  swiping sideways on a stacked widget changes the slide. Vertical swipes
  still scroll the page. Touches that start on something the widget handles
  itself (links, buttons, form fields, embedded pages, media, charts, and
  anything that scrolls sideways) are left to the widget.
- **Cancel asks first.** Leaving edit mode with unsaved moves, sizes or stacks
  asks *Discard unsaved changes?*, with **Keep editing** selected.
- **Readable information-widget titles**, from Homepage's own names and
  numbered in configuration order: *Date & Time*, *Date & Time 2*, instead of
  `datetime` twice.
- **YAML errors say where**: *... contains invalid YAML at line 12, column
  3.* The message never repeats the line's text.
- **A page for dashboards that aren't there.** Opening a renamed, archived or
  unknown address shows *This dashboard isn't available* with a link to the
  main dashboard, instead of raw JSON.
- `STUDIO_FRAME_ANCESTORS`, to allow other sites to frame a dashboard.

### Changed
- **Position & size** keeps what you type while you type it, flags an
  out-of-range value, and only corrects a field when you leave it.
- On a phone, **Delete** brings its confirmation into view and focuses
  **Keep it**.
- The edit-mode selection checkbox is easier to hit (24 px, 44 px on touch
  screens).
- The dashboard settings button shows sliders instead of a sun.
- When someone else saved while you were arranging, the message now says that
  reloading discards your unsaved arrangement.
- Each **Move out** button names its widget for screen readers; Play/Pause
  no longer announces its state twice.
- At 8 columns (tablets, unfolded foldables, zoomed-in desktops) the board
  becomes two-up: a panel up to half the desktop width is half the tablet
  width and a wider one is full width, so lines fill. Panels keep their
  reading order (a row of three becomes two, then one) instead of stepping
  into a checkerboard, and Left/Right in edit mode move a panel one reading
  position.
- On a phone, a vertical swipe on a panel body scrolls the page again in
  current Chrome; only a panel whose content really scrolls keeps the swipe.
- Links inside panels keep the iPhone and iPad long-press link menu; other
  panel text stays unselectable on touch so a hold selects the panel.
- **Snapshots & restore** names what made each snapshot and how long ago
  ("Appearance and settings saved · 5 minutes ago"); older snapshots read
  "Saved change". Closing the dialog with a picked, unimported backup asks
  first and names the backup.
- In the content picker's **All** view, widgets that exist as both an
  information and an integration widget say which one they are.
- The Custom API information widget shows the same "no mappings yet" hint as
  the integration widget.
- Keyboard: Tab moves through panels and stacks in reading order; the
  **Discard unsaved changes?** prompt for an arrangement focuses **Keep
  editing**; Options/Advanced YAML and field errors are announced to screen
  readers; a selected stack is outlined like a selected panel; Studio's own
  fields show one eggplant focus ring; an invalid dashboard address explains
  what is wrong next to the field.
- In edit mode stacks have a **Select** checkbox like panels, so a selected
  stack can be deselected directly.
- The widget catalog is compressed and cached, and loaded only when you open
  a content editor.
- `robots.txt` no longer lists archived dashboards.
- Request bodies for widget actions are received before a dashboard worker is
  used: at most 1 MiB (the native routes' own limit), arriving within 30
  seconds, and 32 MiB across all uploads at once (`503` with `Retry-After`
  beyond it), so slow or many clients can't tie up workers or memory.
- WebSocket upgrade requests are refused with `404`. No dashboard page uses
  one, and an unanswered upgrade could hold a dashboard worker for a minute.

### Security
- Next.js **16.4.2** (from 16.3.8) for GHSA-2464-fhr4-w9xw,
  GHSA-673q-mjm6-r5xr and GHSA-p3m5-59mp-jv5r; `ip-address` 10.7.4 for
  GHSA-rxp7-6hxx-x8q5.
- Default `frame-ancestors 'self'` and `X-Frame-Options: SAMEORIGIN`, plus
  `X-Content-Type-Options: nosniff` and `Referrer-Policy: same-origin` on
  every response; `X-Powered-By` is gone.
- The application files in the image are owned by root and read-only to the
  user it runs as; only the two volumes are writable. The image has no setuid
  or file-capability programs.
- The TrueNAS and APC UPS widgets return fixed, sanitized error messages, and
  the TrueNAS connection limits message size.

### Removed
- Internal review and qualification history is no longer kept in the public
  repository.
- The single deployment page is replaced by task guides: deploy (Swarm and
  Compose), reverse proxy, operations, upgrading, versions and
  troubleshooting.
