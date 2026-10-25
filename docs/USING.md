# Using your dashboard

What you can do on a Homepage Studio dashboard once it's running: add
content, arrange it, build stacks, change configuration, and keep more than
one dashboard. Nothing here is about running the container; that's
[DEPLOY.md](DEPLOY.md) and friends. Colors and custom CSS have their own page,
[APPEARANCE.md](APPEARANCE.md).

You sign in to Studio first. What you can do depends on what an
administrator shared with you: **view** a dashboard, or also **arrange** it.
Administrators can change everything described here. Accounts, passkeys and
sharing are covered in [AUTHENTICATION.md](AUTHENTICATION.md).

## Contents

- [Start here](#start-here)
- [Adding content](#adding-content)
- [Arranging the board](#arranging-the-board)
  - [Touch](#touch)
  - [Mouse and keyboard](#mouse-and-keyboard)
  - [Saving or cancelling](#saving-or-cancelling)
- [Stacks and slideshows](#stacks-and-slideshows)
  - [Changing slides](#changing-slides)
  - [Choosing a widget by its title](#choosing-a-widget-by-its-title)
  - [Slideshow settings](#slideshow-settings)
- [Changing what a panel shows](#changing-what-a-panel-shows)
- [Configuration files](#configuration-files)
- [Snapshots, export and import](#snapshots-export-and-import)
- [More than one dashboard](#more-than-one-dashboard)
- [Discovered services](#discovered-services)
- [When something goes wrong on the page](#when-something-goes-wrong-on-the-page)

## Start here

### The Dashboards page

**Dashboards** (`/studio/dashboards`) lists every dashboard you can open,
each with **Open**, and **Edit** and **Settings** when you may arrange it.
Administrators and members see the same page, filtered to what each can open.
**More actions** on a card has **Make my default** and, for administrators,
**Rename or change address**, **Duplicate**, **Who can open it** and
**Archive**. Administrators also get **New dashboard** and the archived list.
Each card shows when the dashboard last changed and, for administrators, who
can open it.

The bare address (`https://homepage.example.test/`) opens:

- your own **default dashboard**, if you chose one (**My account → Default
  dashboard**, or **Make my default** on its card);
- otherwise, for a member, the default dashboard of the first of their groups
  that has one (administrators set the order under **Administration →
  Groups**);
- otherwise the Dashboards page. Administrators get the Dashboards page unless
  they choose a default of their own.

With sign-in turned off, the bare address always opens the Dashboards page.

### The top bar

Every page, dashboards and administration alike, has the same bar:

- On Studio's own pages (Dashboards, My account, Administration), the logo and
  the deployment's name. On a dashboard, that dashboard's logo and name.
- The name opens the **dashboard switcher**: **All dashboards**, then every
  dashboard you can open, to jump straight to one.
- **Quick Launch** on a dashboard (or <kbd>Ctrl</kbd>/<kbd>⌘</kbd> +
  <kbd>K</kbd>, Homepage's own search across your services and bookmarks).
- **Dashboards**, **Administration** for administrators, and your account
  menu (**My account**, **Sign out**).

On a phone, Dashboards and Administration move into the account menu.

The deployment's name is `STUDIO_DEPLOYMENT_NAME` (default *Homepage
Studio*); an administrator can change it in **Administration → Sign-in
settings → Deployment name**. It's also the sign-in page's heading, the
browser tab title, the sender name in email and the name your passkey prompt
shows. A dashboard's logo is set in its settings
([APPEARANCE.md](APPEARANCE.md#logo)); without one it shows the Studio logo.

### Live, editor and settings pages

A dashboard has three addresses:

| Address | What it is |
| --- | --- |
| `/<slug>` | The **live dashboard**: your widgets only, with no editing controls |
| `/<slug>/studio/edit` | The **editor**: add widgets, move, resize and stack them. **Done** saves and goes back to Dashboards |
| `/<slug>/studio/settings` | **Dashboard settings**: appearance, Homepage's settings, configuration files and snapshots. Closing it goes back to Dashboards |

**Edit** and **Settings** on the Dashboards page open the last two. People who
may only view a dashboard are sent back to it from either address.

On a new deployment the main dashboard has no address yet. The first time an
administrator opens Studio (with sign-in off, whoever opens it first), the
Dashboards page asks for one, suggesting `dashboard`, and nothing else opens
until it's saved. You can change it later from the dashboard's card.

A new dashboard is empty. In the editor it shows a short note, *A clean
slate*, and an **Add your first widget** button. Group buttons (**All
content** and one per native group) filter the live dashboard when it has at
least two groups.

The board is a 12-column grid. In a narrower window it shows the same layout
on 8 columns, and on a phone on 4, keeping the order you see from left to
right and top to bottom. On 8 columns (a tablet, or a zoomed-in browser)
every panel is half or full width: up to half the desktop width becomes half,
wider becomes full width. Two halves share a line, so a row of three becomes
two and then one, and each line is filled. On a phone every tile takes
the full width, one under the other. There is one layout, not one per screen
size: a move you make on a phone or in a narrow window is a move on the
desktop too.

## Adding content

In the editor, **Widgets** opens *Add to your dashboard*. Search, or pick a category:

| Category | What you get |
| --- | --- |
| **Integrations** | One native service widget (Sonarr, Proxmox, AdGuard, ...), placed on its own |
| **Information** | An information widget: date and time, greeting, weather, search, resources, stocks and the rest of Homepage's list |
| **Services** | A service tile: a link to an app, with Homepage's status and statistics |
| **Bookmarks** | A compact link |

Pick one, fill in its options (the form lists what the native widget accepts,
with a link to Homepage's documentation), and save. The panel appears in the
first free spot on the board, and the save makes a snapshot you can go back to.

Information widgets are titled by their native name, numbered when you have
more than one of a kind in configuration order: *Date & Time*, *Date & Time 2*.
Adding a widget further down the list never renames the ones above it.

## Arranging the board

Arranging happens in the editor (**Edit** on the Dashboards page, or
`/<slug>/studio/edit`). The live dashboard never turns into edit mode, so a
hold, right-click or drag there only does what the widget itself does.

### Touch

- Move a panel by its **move handle** (the grip in its title bar) and resize
  it from its **corner handle**.
- Each panel has a checkbox to select it; **Create stack** and **Position &
  size** work on the selection.

A touch that **starts on something the widget handles itself** is left to the
widget. That covers links, buttons and form fields, embedded frames, video and
audio, charts drawn on a canvas or in SVG, and anything that scrolls sideways
inside the panel. A second finger, or a dialog opening, cancels a drag and
puts the panel back.

### Mouse and keyboard

- Each panel has a checkbox to select it, a **move handle**, an **edit**
  button and a **resize corner**. Drag the move handle or the corner. Each
  stack has the same checkbox (**Select stack**), so a selected stack can be
  deselected on its own.
- With the move handle focused, the **arrow keys** move the panel one cell and
  **Shift + arrows** resize it. With the resize corner focused, the arrows
  resize. **Escape** cancels a drag in progress.
- **Position & size** (with one panel selected) sets **Column**, **Row**,
  **Width** and **Height** as numbers. A value that's out of range is flagged
  and **Apply** stays off until it's fixed.

Panels snap to the grid and can't overlap. Content has a minimum size, so a
panel won't shrink below what its widget needs.

### Saving or cancelling

While you edit, the toolbar offers **Save arrangement**, which saves and keeps
you in the editor. On wider screens the toolbar also says **Unsaved
arrangement**. In the header:

- **Done** saves and goes back to the Dashboards page.
- **Cancel** goes back to the Dashboards page. If you have moves, sizes or stacks that aren't
  saved, it first asks **Discard unsaved changes?** with **Keep editing**
  (selected, and what <kbd>Escape</kbd> does) and **Discard changes**. With
  nothing unsaved it goes straight away.

If someone else saved the same dashboard while you were arranging it, the save
is refused rather than overwriting their change. Your arrangement stays on
screen; reloading the current configuration discards it, so you'd repeat your
moves after the reload.

## Stacks and slideshows

A stack shows several panels in one place, one at a time.

To make one:

- **Drag a panel onto another panel of the same size** and hold it there for a
  moment. The target is highlighted; drop to stack them.
- Or **select two or more panels** with their checkboxes and press **Create
  stack**. If they're different sizes, you first see how they'll fit and can
  cancel.

Stacks are one level deep: a stack can't hold another stack. To take a panel
back out, open the stack's edit button and use **Move out** next to it.
Taking one of two panels out turns the other back into an ordinary panel.

### Changing slides

| On | Do this |
| --- | --- |
| A phone or tablet | Swipe sideways on the stack's header **or on the widget itself** |
| A mouse | Drag sideways |
| A trackpad | Scroll sideways |
| A keyboard | Focus the stack and press <kbd>Left</kbd> or <kbd>Right</kbd> |

The same rule as holding applies to swipes: one that starts on a link, a form
field, a chart, an embedded page or a sideways-scrolling area belongs to that
content. Vertical swipes always scroll the page.

Each stack has exactly one **Play/Pause** button. The dots under it show where
you are; they're indicators, not buttons, and there are no previous/next
arrows.

- **While playing**, changing the slide yourself holds that widget for the
  *manual navigation delay* (30 seconds by default), then the slideshow moves
  on and continues at its normal pace.
- **While paused**, changing the slide keeps it paused.
- Playing pauses by itself while you edit, while a dialog or Quick Launch is
  open, while you're using something inside the widget (an embedded page, for
  example), while the stack is scrolled off screen and while the tab is in the
  background, and picks up where it left off.
- With your device set to reduce motion, slideshows don't start on their own
  and don't animate; **Play** still works.

None of this is saved: playing, pausing and the slide you're on are yours in
this browser tab only.

### Choosing a widget by its title

Tap or click the stack's **title** (or focus it and press <kbd>Enter</kbd> or
<kbd>Space</kbd>) to open a short list of its widgets, and pick one. It counts
as changing the slide yourself, so the manual navigation delay applies.
The arrow keys move through the list. <kbd>Escape</kbd> or <kbd>Tab</kbd>
closes it and puts focus back on the title; a tap or click outside also
closes it.

The list opens only for a deliberate short tap, click or key press. Swiping
across the title, dragging, a long press, a right-click or a two-finger touch
never opens it, and neither does anything you do on the widget body. It isn't
available in the editor.

### Slideshow settings

In the editor, the stack's edit button opens **Edit widget stack**. Besides
moving members earlier or later in the stack, configuring them and **Move
out**, it has the slideshow settings for that stack:

| Setting | Default | Range |
| --- | --- | --- |
| **Start behavior** | Manual: use Play to start | or *Start automatically* |
| **Seconds per widget** | 10 | 1 to 3600 |
| **Manual navigation delay (seconds)** | 30 | 1 to 3600 |
| **Transition** | Horizontal slide | Vertical slide, Fade, No animation |
| **Animation duration (ms)** | 250 | 0 to 2000 |
| **Loop after the last widget** | On | |

If the delay is shorter than the seconds per widget, the longer of the two is
used after a manual change.

## Changing what a panel shows

In the editor, a panel's **edit** button opens it with two tabs:

- **Options**: a form for the common native options, with a link to
  Homepage's documentation for that widget.
- **Advanced YAML**: the same panel as YAML, for everything else the widget
  supports.

Both edit one draft. Options you don't touch, including ones Studio doesn't
know about, `null` values and `{{HOMEPAGE_VAR_...}}` or
`{{HOMEPAGE_FILE_...}}` references, are left exactly as they were.

If the YAML has a mistake, the editor says where: *Invalid YAML at line 4,
column 9: ...* in the YAML tab, and *services.yaml contains invalid YAML at
line 12, column 3.* when a save is refused. The message never repeats the text
of the line, so a secret on that line doesn't end up on screen or in a log. A
draft with a mistake stays open for you to fix; the saved file isn't touched.

**Delete** in the same dialog asks *Delete ...?* with **Keep it** (selected)
and **Delete permanently**. On a phone the question scrolls into view.

## Configuration files

**Dashboard settings → Configuration files** edits the nine native files of
this dashboard directly: `services.yaml`, `widgets.yaml`, `bookmarks.yaml`,
`settings.yaml`, `docker.yaml`, `kubernetes.yaml`, `proxmox.yaml`,
`custom.css` and `custom.js`.

- **Save configuration** saves every file you changed in one go, after
  checking all of them. One snapshot covers the lot.
- **Download file** downloads the file you're looking at; **Replace from a
  file** loads a file (up to 2 MiB) into the editor as a draft until you save.
  **Export dashboard** downloads a backup of the whole saved dashboard; it
  waits until your changes are saved.
- After you change or restore `custom.js`, Studio offers **Reload dashboard**,
  because a script that already ran can't be un-run in place.
- Native settings that lay out Homepage's own page (group tabs, column counts,
  collapsing, equal heights) are kept in the YAML but don't move panels on
  this board; the board is arranged by hand.

Closing the dialog, switching files or leaving the page with unsaved changes
asks first.

## Snapshots, export and import

Every save keeps a **snapshot** of what was there before. The newest 25 are
kept for each dashboard (the person running it can change that number; the
**Snapshots & restore** shortcut in **Dashboard settings** shows the current
limit).
Playing slideshows, opening dialogs and exporting never make snapshots.

| A snapshot named… | was made just before you… |
|---|---|
| Arrangement saved | moved, resized or stacked panels, or changed a stack's settings |
| Appearance and settings saved | saved **Dashboard settings** |
| Configuration files saved | saved **Configuration files** |
| Service tile / Integration widget / Information widget / Bookmark added, edited or deleted | added, edited or deleted that item |
| Discovered panel hidden / shown | hid or brought back a discovered panel |
| Snapshot restored | restored a snapshot |
| Dashboard imported | imported a dashboard backup (or created a dashboard as a copy) |

**Dashboard settings → Snapshots & restore**:

- **Saved snapshots** lists them, newest first. Each one names the change that
  made it and how long ago, for example *Appearance and settings saved · 5
  minutes ago*, with the exact time and the changed files underneath (the exact
  time also shows when you hover over the age). The age keeps updating while
  the dialog is open. Snapshots made before Studio recorded this read *Saved
  change*. **Restore selected snapshot** puts back the files, the panels and
  their layout as they were.
- **Download snapshot** downloads the selected snapshot as a file.
- **Choose a backup file** stages an exported dashboard or a downloaded
  snapshot (up to 40 MiB). Nothing changes until you press **Import
  dashboard**, which checks the whole file, keeps a snapshot of the current
  dashboard first, and then replaces it. Closing the dialog while a backup is
  staged asks first and names the file, for example **Discard the staged
  backup dashboard.json?**, with **Keep editing** selected.

**Configuration files → Export dashboard** downloads this dashboard as
it was last saved, as one file: all nine native files, the panels, the layout
and the stacks. (It's unavailable while that dialog holds unsaved changes.) Use it
to copy a dashboard to another deployment, or as a backup you keep yourself.

What an export doesn't carry: the container's environment variables, mounted
secret files, sockets, and the services themselves. Those have to exist on
the destination too. An export **does** carry any password or API key written
straight into the files, and so do snapshots; keep the files somewhere safe.

## More than one dashboard

Administrators manage dashboards from the **Dashboards** page.

| Action | What happens |
| --- | --- |
| **New dashboard** | Pick a **Name** and an **Address** (suggested: the first free of `dashboard`, `dashboard-2`, `dashboard-3`, …); it starts empty. To start from an existing dashboard, use **Duplicate** |
| **Open** | Goes to the live dashboard |
| **Edit** / **Settings** | The editor and the dashboard settings ([Start here](#live-editor-and-settings-pages)) |
| **More actions → Rename or change address** | Its widgets, layout and snapshots stay with it |
| **More actions → Duplicate** | Makes an independent copy of everything, logo included, at the next suggested address; changing one never changes the other. **Share it with the same people** copies who can open it |
| **More actions → Who can open it** | Opens **Administration → Dashboard access** |
| **More actions → Archive** | Takes it off line after you confirm. Its files and snapshots are kept and its address stays reserved |
| **Restore** (under *Archived*) | Brings an archived dashboard back as it was |

- An address is one path segment of 1 to 64 lowercase letters, numbers and
  inner hyphens: `https://homepage.example.test/family`. A few names used by
  the application itself can't be taken.
- The main dashboard can't be archived. Its address is the one chosen when
  Studio first asked for it.
- Up to 64 dashboards fit on one deployment, archived ones included.
- Each dashboard has its own widgets, layout, stacks, appearance, logo,
  custom CSS, custom JavaScript, settings and snapshot history. Anything it
  doesn't set for itself follows the platform's default look
  ([APPEARANCE.md](APPEARANCE.md#the-platform-default-look)).

An address is not a password, and it doesn't decide who may open a dashboard:
sharing does ([AUTHENTICATION.md](AUTHENTICATION.md)). With sign-in turned
off, anyone who can reach the host can open any dashboard and manage the
others.

If someone opens an address that was renamed, archived or never existed, they
get a short page, **This dashboard isn't available**, with an **Open
Dashboards** button.

## Discovered services

Services discovered from Docker labels or Kubernetes annotations (set up in
`docker.yaml` or `kubernetes.yaml`, as in Homepage) appear on the board like
any other panel. Their definition stays with the container or cluster: change
it there, not in Studio. In Studio you decide where a discovered panel sits,
which stack it's in, and whether it shows; the picker can bring a hidden one
back (**Restore to dashboard**).

If discovery can't be reached for a while, the panel keeps its place and shows
as unavailable instead of being dropped or swapped for something else.

## When something goes wrong on the page

| What you see | What it means |
| --- | --- |
| A save is refused because the dashboard changed | Someone (or another tab) saved first. Your draft stays; reload to see their change, then repeat yours |
| *The dashboard could not refresh* after a save | The save went through; only refreshing the widgets failed. Use the reload offered; the save isn't sent again |
| *All dashboard renderers are busy* | Too many dashboards are open at once for the container's limit. Try again shortly, or ask the operator ([OPERATIONS.md](OPERATIONS.md#workers-and-limits)) |
| *This request exceeds the 2 MiB configuration limit* | A single file or request is too big. Imports have a 40 MiB limit, but each file in them is still limited to 2 MiB |
| **This dashboard isn't available** | The address changed or the dashboard was archived; see [More than one dashboard](#more-than-one-dashboard) |

More fixes are in [TROUBLESHOOTING.md](TROUBLESHOOTING.md).
