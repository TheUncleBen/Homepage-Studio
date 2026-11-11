# Changelog

Notable changes for people who run or use Homepage Studio. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Official releases
are named by date, `YYYY.MM.DD`, and exist only once the owner has approved
an exact candidate; until then, changes are listed under **Unreleased** and a
build is identified by its source commit and image digest
([docs/VERSIONS.md](docs/VERSIONS.md)).

## [Unreleased]

### Audit fixes (continuous audit of cf02529)

- **Readable configuration files.** Earlier candidates wrote every change to
  a new deployment's `services.yaml`, `settings.yaml` and the other YAML
  files as one ever-growing line. New deployments now get ordinary YAML, and
  data version 2 rewrites existing one-line files the same way at the first
  start (after the before-upgrade backup), keeping values, comments and
  `{{HOMEPAGE_VAR_…}}` references.
- **Lists of settings in the widget editor** (Custom API's Value mappings,
  Calendar integrations, Home Assistant's custom values, Prometheus metrics)
  are edited as JSON with the documented example, instead of a list of text
  the widget couldn't read. Fields with a Text/Settings switch, such as
  Request Body, show their input box.
- **No zoom on iPhone.** On touch screens no field's text is under 16px, so
  iOS no longer zooms into the page when a field is tapped.
- **Operations:** the Show menu and the monitor search match Studio's other
  controls.
- **Audit log:** saving sign-in settings or a profile without a change no
  longer records an event, and a change names only what changed.
- **Add a widget:** BookOrbit says what kind of app it is. Custom API's
  Display is a choice of Block (the default), List and Dynamic list.
- **Copy link to page** gives the page's address on the dashboard, not on
  the editor (which opened a missing page).
- **Stacks:** the "Updated … ago" note sits at the top, clear of the page
  dots and play button.
- **Editing:** on a card with no logo, the select box sits beside Move and
  Edit instead of over the first letters of the name.
- **A down card** keeps its reason and its time apart ("Name not found ·
  check the address · since 12:48").
- **Operations:** after a restart, card monitors show before every widget's
  numbers are collected.
- Selected text uses the dashboard's accent colour.

### Upgrades keep your data

- **Updating is changing the image digest** ([docs/UPGRADING.md](docs/UPGRADING.md)).
  Studio records the version of its stored data and, at the first start of
  a newer image, saves a `…-before-upgrade` backup and converts what
  changed, by itself. A failed step puts the data back and stops, so Swarm
  rolls back; an image older than the data refuses to start instead of
  misreading it. Monitoring history is kept and updated the same way rather
  than set aside.
- **Old widget looks are converted.** Data from candidates up to 53ebc3b
  could hold widget looks from before the block widgets (Hero/Quiet, Show
  as, a value's Hero/Hidden/Number). Since 4575c4c a dashboard holding one
  refused to load (`CONFIG_NOT_READY`, “Unknown widget look setting:
  layout”). The first data version turns each into the blocks that draw it
  the same way, in boards, saved looks, saved widgets, snapshots and the
  dashboard card look.
- **A dashboard that can't load says why.** Opening it in a browser shows a
  “This dashboard can't load right now” page instead of raw JSON; people who
  can arrange it (with sign-in on) also see the reason, which the log records too.
- **Chart legends wrap** onto more lines instead of running out of the card,
  so a chart of many values no longer shrinks its Big number to a sliver.
- **Appearance on a phone:** the Cards › Fill options share the width
  instead of running past the panel.
- **A rollback right after an upgrade is automatic.** Until a new version has
  run for four minutes its upgrade is unconfirmed; if Swarm rolls back in
  that time, the previous image puts the before-upgrade backup back itself.
  A restore cut off half-way is finished at the next start.
- **Older exports import.** A dashboard export, snapshot or saved widget
  from before the block widgets has its looks converted on import.

The upgrade notes in older entries below are history only.

### Rows that scale, log search as you type, missing intermediates fetched

- **Rows scale with the columns** (mock-ups v4, board 5;
  [docs/USING.md](docs/USING.md)). A row is 36 px when the board is as wide
  as on a 1440 px desktop, 820 px tablet or 390 px phone screen, and grows
  or shrinks with the column width elsewhere (18 to 45 px), so a widget keeps
  its shape on a wider or narrower screen instead of only getting wider.
  The editor, the live dashboard and the Dashboards page previews use the
  same rule. Homepage's own information widgets (Resources, Greeting, …),
  service tiles and bookmarks grow only by what their content needs where
  they would be cut, to the pixel rather than a whole row; the widgets
  beside one that grows stretch to match, so no gap opens under them.
- **Logs search as you type** ([docs/LOGS.md](docs/LOGS.md#searching)). One
  box searches as you type; Level, Source, Service and Problem are chips
  (one choice each, **Any** to clear), and the address keeps the search. A
  line in a widget's Logs block, or **Show in Logs** in Investigate, opens
  Operations › Logs showing only that widget, as a chip you can take off.
- **Missing intermediate certificates are fetched**
  ([docs/DEPLOY.md](docs/DEPLOY.md#trusted-certificates)). A server that
  sends only its own certificate now works with only your root authority
  trusted: Studio fetches the intermediate from the certificate's
  `http://` CA Issuers address (16 KB, 4 s, no redirects, remembered) and
  uses it only if it leads to a certificate already trusted. Widgets, Test
  connection, Check now, status checks and web and certificate monitors.

### Widgets you shape: blocks, any size, a note when a size can't fit

- **Show tab** ([docs/USING.md](docs/USING.md#how-a-widget-looks)). A widget
  is built from up to 12 blocks: big number, numbers, quiet numbers, pie,
  bars, chart over time, gauge, response time, status and (with logs access)
  logs. Each block has its own values and style, with a live preview.
  **Settings for** keeps one set for all sizes or a set per size (small,
  wide, tall, regular, large).
- **Any shape, never clipped.** A widget shrinks continuously down to the
  smallest size its settings allow. Text shrinks before anything is cut;
  where a layout still can't fit (on a phone, for example) the widget grows
  taller and the widgets below move down. Resizing stops at the last size
  that fits, and with the widget's settings open a note says why, with
  one-tap changes (hide labels, allow smaller text, let blocks sit
  automatically, and others) for the size being set up.
- **Stacks** have no header bar: the widget fills the stack, with page dots
  that jump to a widget and a small Play/Pause at the bottom. The stack-title
  picker is gone; the dots replace it.
- **Every dropdown** in Studio uses the themed list, with type-ahead.
- **Tabs in the widget editor**: Data, Show, Look and Behaviour, with
  Duplicate, Save as a saved widget and Delete under **⋯**.

### Fixes since candidate 53ebc3b

- **Test connection** tries each of the widget's own plain reads in turn, so
  widgets such as pfSense API v2 and Portainer no longer fail a test while
  they work.
- A certificate failure names the certificate the address sent and whether
  its issuer is trusted. A trusted certificate may end the chain, as in
  browsers.
- Status, response time and charts appear within seconds after a change,
  instead of at the next minute's round.
- `TIMEZONE` in the Portainer deployment files (passed to the container as
  `TZ`). Default retention: logs 30 days, sign-in and audit events 365 days.
- A swipe on a stack is announced to screen readers only.
- A save asks only newly charted widgets for their first numbers, instead
  of polling every integration on the dashboard again; one collection per
  dashboard runs at a time.
- In a widget's Logs block, an error reported by someone's browser says
  whose browser sent it, and a report naming a widget that isn't on the
  dashboard isn't shown as that widget's line. The log store has a new
  index for the block's search (a fresh log store on this candidate).
- With the widget editor docked, the board keeps its width and the card
  being edited scrolls into view beside the panel; the size shown is the
  real one. While resizing, the selection bar and widget tools step aside.
- A widget's name and the reason it is red wrap only between words; a
  widget never shows a word broken in the middle or a line cut off.
- A new Resources widget starts showing CPU and memory, instead of an
  empty card; with nothing chosen it says to pick what to show.
- **Duplicate** keeps every setting of the widget it copies; the copy
  was saved with only the settings changed in the dialog.
- **Widgets** pressed while a docked widget's save is still landing opens
  once it has, instead of doing nothing. Homepage's own information
  widgets (Resources, Search…) sit in the middle of their card's height.
- A block with no values (for example a one-value widget's default
  Numbers) is left out on the dashboard; while editing it still says what
  to pick.
- Charts draw from the first number, before Save, and a pie of picked
  counts draws them even when the widget's other values are percentages.
  Changing a block to a pie starts it with the largest group of values in
  one unit.
- While editing, a widget's select box takes its logo's place and Move and
  Edit take the response time's, so nothing moves or is cut when they show;
  a stack's select box sits beside its page dots.
- A widget whose header shows only its logo keeps the logo however narrow
  it gets.
- Auto picks the largest text that fits; the column choices go up to the
  number of values; the size note gives the size in pixels.

### Built-in monitoring and logs; a docked widget editor, saved items and filler widgets

- **Monitoring** ([docs/MONITORING.md](docs/MONITORING.md)). Every card with
  a status check gets its own monitor, so every browser shows the same status.
  Administrators add web, port, ping, DNS, certificate, push (heartbeat),
  Docker and group monitors, with incidents, **I'm on it**, notes,
  maintenance windows and notifications (email, webhook, ntfy, Gotify,
  Discord, Slack, Teams, Telegram, Pushover, Matrix, Home Assistant,
  Apprise). Nothing else to run beside Studio.
- **Logs** ([docs/LOGS.md](docs/LOGS.md)). One searchable log of Studio,
  each dashboard's widgets, monitors, sign-in and administration events, and
  anything your apps send over HTTPS or devices send by syslog. Secrets are
  masked before storage; administrators can export and set alerts.
- **Operations**, from the name menu, for administrators and for people an
  administrator gives **Monitoring** or **Logs** on a dashboard (Dashboard
  access). Each dashboard's monitors and logs stay separate. With sign-in off
  Operations, export and log intake are switched off.
- **Investigate**: right-click or long-press a widget (also inside a stack)
  to see its status check and latest log entries.
- **Docked widget editor** beside the board on wide screens; **Saved items**
  under My account and Administration; Studio's own heading, note, picture
  and spacer widgets; **Show on** desktop, tablet or phone per widget.
- **Search** in the top bar; results open in the same tab by default.
- Status checks use the widget's own connection address, with **Check now**;
  value boxes in a balanced grid or a chosen number of columns.
- **Trusted certificates** can be stored in Administration. Monitors use
  them for web and certificate checks; widgets don't use them yet (that
  waits on an owner decision).

### A layout per size, a sectioned widget dialog, saved widgets and looks

- **A layout for each size.** Tablet and phone layouts are made from desktop
  and follow it until you move or resize a widget on that size; from then
  that size keeps your arrangement. Desktop never moves because of a phone
  or tablet change. The editing bar has a **Desktop / Tablet / Phone** switch
  with small pictures of the other sizes and **Follow desktop again**.
- **Even or centred grid** per page (24 or 25 columns), with a centre line,
  snap and **Centre in row**.
- **Resizing moves only that widget**, to the nearest free space if it no
  longer fits. An integration card can shrink to a small square (3 × 3,
  was 6 × 4); its values fold, and **+N more** sits beside the values that
  stay when there's room.
- **The editor saves as you go.** The bar has **Done** only and says
  *Saving…*, *Saved* or *Not saved yet, retrying*. **Undo** and **Redo** step
  through the whole editing session on the server, deletes included, and a
  save that meets someone else's change keeps both instead of being refused.
- **Every widget is self-contained.** No Group or Service picker: Studio keeps
  one fixed group in `services.yaml`, and a widget's name, link and status
  check are edited with it. A service with a widget is one card.
- **Widget dialog in sections**, one open at a time and each summarised:
  Connection, Values and charts, Look, Status and behaviour, Page,
  Management (Duplicate, Save as a saved widget, Delete) and Setting up. The
  widget is drawn on top at its real desktop size; drag its corner to resize.
- **One Values list** with every value the integration provides, in your
  order, as Hero/Below, Shown, or Chart/Number, or Hidden. It keeps the
  widget's `fields` in step with what the card shows. Homepage's four-value
  limit no longer applies inside Studio cards; values that don't fit fold
  away behind **+N more** instead of scrolling. Widgets that draw their own
  content, such as an embedded page or a calendar, are not folded and scroll
  as before.
- **Saved looks** in one list with a search, saved **Just me** or for **This
  dashboard**, and **Manage saved looks** to rename, update (optionally on
  every widget using it) or delete.
- **Saved widgets**: a widget's configuration (never its size or place),
  saved **Just me**, for **This dashboard** or for **Everyone**, and placed
  from the new **Saved** tab of *Add to your dashboard*. Administrators save
  them; people who can arrange a dashboard can place them too.
  Their settings and keys stay on the server.
- **Add to your dashboard** has All, Integrations, Information, Links and
  Saved tabs, a description for every integration, and **Back** with your
  search kept.
- **Setting up** shows each secret's exact Docker secret name, variable and
  `{{HOMEPAGE_FILE_...}}` reference with **Copy** buttons.
- **Widget controls inside the card**: select box top left, Move and Edit top
  right; a selected widget gets an accent edge.
- **Archived dashboards can be deleted for good** (type the name to confirm),
  and are deleted automatically 7, 30 (default) or 90 days after archiving,
  or never.
- **Homepage v2.7.0** (adds NetBird). Settings → About shows the Homepage
  version Studio is built on.
- **Administration** no longer shows a standing *Confirm it's you* banner; a
  change that needs a fresh sign-in asks at that moment. It names a proxy
  that forwards requests Studio doesn't trust, and activity records the
  address of the person who made a change.

### Pages, widget looks, charts, saved connections and search

- **Pages.** A dashboard has up to 20 pages, shown as tabs; each widget and
  stack belongs to one. Pages can be renamed, reordered, duplicated with
  copies of their widgets, and deleted. The board is now 24 columns of 36 px
  rows (16 on tablets, 8 on phones). Board version 3 needs a new deployment.
- **Widget dialog with a live preview** and per-widget **Look**, **Status**
  and **Behaviour**, with dashboard-wide **Widget defaults**. A widget stores
  only what differs from the defaults, and offers only choices that apply.
- **Charts.** **Show as** draws a widget's numbers as numbers, a table, a
  line, area or bar chart, a donut, a pie or a gauge. Hero numbers can show a
  trend, values can have warning and problem colours, and line, area and bar
  charts open full size. Studio collects the numbers once a minute, only for
  widgets that need them, and keeps them for 7, 30 or 90 days (30 by default).
  **Status history** shows a bar for each status check and the uptime.
- **Saved connections** keep a service's address and key once for any widget,
  per dashboard or *Just me*. Keys are write-only. They are stored in plain
  text in the state volume, so whole-deployment backups contain them.
- **Test connection** in the widget dialog sends the widget's first request
  and says in plain words whether it worked.
- **Search** across every page and the web with each person's own engine
  (Google by default) replaces Homepage's Quick Launch. **My account → Search**
  and **Display** hold each person's preferences.
- **Built-in backgrounds and patterns** and an **image library** per
  dashboard (and *Just me*) for logos and backgrounds. Homepage's own
  background and colour palette settings are no longer offered; Studio's
  appearance decides.
- **Offline logos.** 128 px copies of the Dashboard Icons logos (about
  14 MB) ship with Studio, so built-in logos show without internet access.
- **Starter templates** for a new dashboard: Homelab, Media or Family link
  tiles at placeholder `home.arpa` addresses, plus a clock and weather.
- **Editing.** A widget menu (right-click or hold), multi-select with a
  selection bar, saved looks, Tidy up, snap guides and a freshness note with
  **Refresh now**. On a phone a widget's controls show only after you tap it.
  One editing bar holds Widgets, Tidy up, Undo, Redo, **Save**
  (<kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>S</kbd>, keeps editing), Cancel and Done.
- **Full view** of a chart has time and value axes with gridlines; percentages
  get their own axis on the right. A chart's time range starts where its
  collected data starts.
- **Follow device** is the default mode for new deployments.
- **Date & Time** in a card shows the time large with the date under it, and
  its options are choices (Time, Date, Text size) rather than raw settings.
- **Email** is one centred card: the logo and name at the top, the heading,
  the button and the written-out link centred, the footer inside the card.
- **Big logos are shrunk, not refused.** A PNG, JPEG or WebP logo over
  256 KiB is resized in the browser (512 px, WebP) and the message says how
  much it was shrunk. An SVG over 256 KiB is still refused.

### Polished Studio pages, backups in the app, email in Studio's look

- **Studio's pages are iOS-style grouped lists.** My account, every
  Administration section (People, Groups, Dashboard access, Session policies,
  Sign-in settings, Appearance, Backups, Activity), the widget dialog and
  dashboard settings, the widget stack editor, **Position & size** and the New
  and Duplicate dashboard dialogs. Explanations sit behind info buttons; switches replace
  checkboxes; actions are buttons, not links. Studio's own pages follow the
  platform's default look.
- **Visible fields** starts as one switch, **Use the widget's default
  fields**, turned on; turning it off shows the fields to pick and order.
- **Administration lists its sections down the left**, like macOS System
  Settings. On a phone it opens on a grouped list of the sections, like iOS
  Settings: tap one to open it, and **Administration** at the top (or the
  phone's back gesture) returns to the list.
- **Top bar.** **All dashboards** and **Administration** are in the menu
  under the name at the top left; the account menu stays on its own.
- **Dashboards page** is a list of equal rows, each with a preview drawn from
  the dashboard's saved layout, colours, tile names and icons. It shows no
  live data and never starts the dashboard, so the page stays fast with any
  number of dashboards. Studio's pages may load icons from Homepage's icon CDN
  (`cdn.jsdelivr.net`). Less common actions are in each row's **⋯**
  menu.
- **Saving the default look** shows at once in open dashboards and Studio's
  pages, with no cache clearing.
- **Backups and restore in Administration → Backups**: create, download,
  upload, restore and delete whole-deployment backups, kept in the state
  volume. A restore saves a *before restore* backup, restarts Studio and signs
  everyone out. `node server/backups.mjs` does the same from a shell
  ([docs/OPERATIONS.md](docs/OPERATIONS.md#backups-in-the-app)).
- **Widget Version field** is a choice between the releases each widget's
  documentation lists, such as *Before 2025.8.0* and *2025.8.0 or later* for
  Authentik, with Homepage's default chosen until you pick another.
- **Visible fields** in the widget dialog is a list of switches you can
  reorder, and each widget has a **Setting up …** guide. The
  [widget reference](docs/widgets/README.md) lists every widget.
- **Email** is HTML in Studio's look, with the logo, one button (the link is
  written out underneath too) and a plain-text copy. Subjects are in title
  case, and each security alert says what happened in its subject.
- **Single sign-on.** Only the administrator and allowed groups (and provider
  groups added by name) come over from the provider. A linked account takes
  the provider's name as well as its verified email. Everyone can change
  their own username in **My account**, and an administrator can change anyone's;
  either way the person gets a security alert. Confirming it's you through the
  provider needs a fresh sign-in there.
- **Backups** are refused when Studio's files are larger than the 256 MiB a
  backup in the app can hold, and restored files are always readable only by
  Studio.
- **`STUDIO_FRAME_ANCESTORS` adds origins** to `'self'` instead of replacing
  it, so pages on Studio's own address can always frame a dashboard.
- **Docs.** Authentik sign-in policy and token lifetimes
  ([docs/IDP-AUTHENTIK.md](docs/IDP-AUTHENTIK.md#sign-in-policy-and-token-lifetimes)),
  framing explained with Home Assistant as an example
  ([docs/REVERSE-PROXY.md](docs/REVERSE-PROXY.md#framing)).

### Studio at /studio, a deployment name and logo, a platform default look

- **Studio's own pages are under `/studio`**: Dashboards at
  `/studio/dashboards`, My account, Administration and sign-in. `studio` can't
  be a dashboard address.
- **The main dashboard's address is chosen at first use.** A new deployment's
  main dashboard has no address; the first administrator (with sign-in off,
  the first visitor) is asked for one, suggested `dashboard`. New and
  duplicated dashboards suggest the first free of `dashboard`, `dashboard-2`, ….
- **Dashboard cards** show who can open each dashboard (administrators) and
  when it last changed.
- **Deployment name.** `STUDIO_DEPLOYMENT_NAME` (default *Homepage Studio*),
  changeable in **Administration → Sign-in settings**, names the deployment on
  Studio's pages, the sign-in page, tab titles, email and passkey prompts.
- **Logo and favicon.** Studio has a logo, also its favicon and app icon. Anyone
  who may arrange a dashboard can upload that dashboard's own logo; it shows
  in the top bar and as the dashboard's tab icon. Duplicates keep it. An SVG
  logo with scripts, embedded HTML, event handlers or outside references
  (including stylesheet imports) is refused.
- **Tab titles.** A dashboard without its own title in `settings.yaml` shows
  its name in the browser tab.
- **Top bar.** The name opens a dashboard switcher; Dashboards,
  Administration and the account menu fold into the menu on phones.
- **Platform default look.** **Administration → Appearance** sets the display
  mode, accent, background image and platform CSS for every dashboard. Each
  dashboard follows each setting until it sets its own; platform CSS loads
  before a dashboard's `custom.css` and can be switched off per dashboard by an
  administrator. With sign-in off, Administration shows this page.
  Saving it asks for a recent sign-in, like other sensitive administration
  changes.
- **Groups** can be reordered by dragging, as well as with the buttons.
- **Environment example and stack files** list the required settings first
  and the optional ones below.
- Removed: conversions for older registries, layouts and snapshots, and the
  old `STUDIO_SMTP_FROM` setting (use `STUDIO_SMTP_FROM_ADDRESS` and
  `STUDIO_SMTP_FROM_NAME`).

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
