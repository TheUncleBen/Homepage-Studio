# Changelog

Notable changes for people who run or use Homepage Studio. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Official releases
are named by date, `YYYY.MM.DD`, and exist only once the owner has approved
an exact candidate; until then, changes are listed under **Unreleased** and a
build is identified by its source commit and image digest
([docs/VERSIONS.md](docs/VERSIONS.md)).

## [Unreleased]

### Sign-in and access control (planned for the release after the current candidate)

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
- At 8 columns (tablets, unfolded foldables, zoomed-in desktops) tiles that
  share an edge stay side by side, and a row that no longer fits wraps from
  the left in reading order (three tiles become two, then one) instead of
  stepping into a checkerboard.
- On a phone, a vertical swipe on a panel body scrolls the page again in
  current Chrome; only a panel whose content really scrolls keeps the swipe.
- Links inside panels keep the iPhone and iPad long-press link menu; other
  panel text stays unselectable on touch so a hold selects the panel.
- **Snapshots & restore** names what made each snapshot and how long ago
  ("Appearance and settings saved · 5 minutes ago"); older snapshots read
  "Saved change". Closing the dialog with a picked, unimported backup asks
  first.
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
