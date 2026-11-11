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

**Dashboards** (`/studio/dashboards`) lists every dashboard you can open, one
row each, all the same size. A row shows a preview of the dashboard, its
name and address, when it last changed and, for administrators, who can open
it. The preview is a drawing of the dashboard's saved layout in its own
colours, with each tile's name and icon; it shows no live data and doesn't
start the dashboard. Icons Homepage loads from its icon CDN appear there too;
icons given as a full address or a file of the dashboard show as the name
only. **Open** is on every row, and **Edit** and **Settings** when you may
arrange it. The row's **⋯** menu has **Make my default** and, for
administrators, **Rename or change address**, **Duplicate**, **Who can open
it** and **Archive**. Administrators also get **New dashboard** and the
archived list.

Previews are drawn as their rows come near the screen, and can't be
clicked or typed into. Administrators and members see the same page, filtered
to what each can open.

The bare address (`https://homepage.example.test/`) opens:

- your own **default dashboard**, if you chose one (**My account → Default
  dashboard**, or **Make my default** in its row’s **⋯** menu);
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
- The name opens Studio's menu: **All dashboards**, **Administration** for
  administrators, **Operations** (monitors, incidents and logs) for
  administrators and anyone given Monitoring or Logs on a dashboard, then
  every dashboard you can open, to jump straight to one. With Monitoring or
  Logs on a dashboard you can also right-click or long-press a widget and
  choose **Investigate** ([MONITORING.md](MONITORING.md),
  [LOGS.md](LOGS.md)).
- **Search** on a dashboard: the centred *Start typing…* bar (it narrows
  before your page tabs fold into *more*; an icon on phones, with **Cancel**
  to close it), <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>K</kbd>, or just start
  typing. It finds every widget, service and bookmark on every page, says
  which page each is on, and offers a web search with your own search engine
  (Google unless you choose another in **My account → Search**). A result
  opens in this tab unless you choose **New tab** under **My account →
  Search**. It replaces Homepage's Quick Launch.
- Your account menu: **My account** and **Sign out**.

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
until it's saved. You can change it later with **⋯ → Rename or change address** in its row.

A new dashboard is empty. In the editor it shows a short note, *A clean
slate*, and an **Add your first widget** button. To split a dashboard into
sections, add pages (below).

The board is a grid of rows and columns: 24 columns on a desktop, 16 on a
tablet and 8 on a phone. Rows scale with the columns, so a widget keeps its
shape on a wider or narrower screen instead of only getting wider: a row is
36 px when the board is as wide as on a 1440 px desktop, 820 px tablet or
390 px phone screen, and between 18 and 45 px otherwise. Each size has its
own layout, made from the desktop one:

- Until you move or resize a widget on a tablet or phone, that size follows
  desktop, in desktop's reading order. On a tablet a widget up to half the
  desktop width takes half the width and a wider one the full width, and
  widgets rise to close any gap above them; on a phone small widgets pair up
  at half width (link tiles with link tiles, widget cards with widget cards)
  and the rest take the full width. A half-width card shows its status as a
  dot, lets its name take two lines (on the narrowest screens without its
  logo), and puts a donut's legend under it.
- Once you move or resize a widget on that size, the size keeps your
  arrangement, position and size, for every widget on it. Desktop never moves
  because of a tablet or phone change.
- A widget is still one widget with one set of settings on every size. Its
  position and size belong to the layout, not to the widget.

The editing bar's **Desktop**, **Tablet** and **Phone** switch shows the board
at that size's real width, with small pictures of the other sizes beside it
(select one to switch to it). Under the bar a tablet or phone says whether it
*Follows desktop until you move or resize a widget here* or is *your
arrangement*, with **Follow desktop again** to go back to following desktop.
A widget added later goes at the end of a size you arranged.

### Pages

A dashboard can have up to 20 pages, shown as tabs under the top bar. Each
widget and stack belongs to one page. In the editor, **Add page** adds one,
and a page's **⋯** menu renames, reorders, duplicates (with copies of every
widget on it) or deletes it. Keys <kbd>1</kbd> to <kbd>9</kbd> go to a page,
and <kbd>[</kbd> and <kbd>]</kbd> to the previous or next one.

A page's **⋯** menu also chooses its grid: **Even grid, 24 columns** or
**Centred grid, 25 columns**, which has a middle column so a widget can sit
exactly in the centre. While you drag, a centre line shows and widgets snap
to it, and a widget's menu has **Centre in row**. **Dashboard
settings → Widget defaults** says whether the dashboard opens on its first
page or the one you last looked at.

## Adding content

In the editor, **Widgets** opens *Add to your dashboard*. Search, or pick a tab:

| Tab | What you get |
| --- | --- |
| **All** | Everything below, in one list |
| **Integrations** | One native service widget (Sonarr, Proxmox, AdGuard, ...), each with a line on what the app is and the values it shows |
| **Information** | An information widget: date and time, greeting, weather, search, resources, stocks and the rest of Homepage's list, plus [Studio's fillers](#headings-notes-pictures-and-spacers) |
| **Links** | A service tile (a link to an app, with Homepage's status check) or a bookmark (a compact link) |
| **Saved** | Your [saved widgets](#saved-widgets) |

Pick one, fill in its options, and save. **Back** in the dialog returns to
the list with your search and tab as they were. The form lists what the native
widget accepts, with an info button on any setting that needs explaining and
**Setting up …** underneath: what the service needs, from Homepage's
documentation. The [widget reference](widgets/README.md) has the same for
every widget, in one place. The panel appears in the
first free spot on the board, and the save makes a snapshot you can go back to.

Studio's own copies of the [Dashboard Icons](https://github.com/homarr-labs/dashboard-icons)
logos ship with it, so built-in logos show without internet access.

Every widget is its own entry. Adding the same integration twice makes two
independent widgets (*pfSense*, *pfSense 2*), and **Duplicate** makes an
independent copy; there is no group or service to choose, and a widget's
name, link and status check are edited with it.

Information widgets are titled by their native name, numbered when you have
more than one of a kind in configuration order: *Date & Time*, *Date & Time 2*.
Adding a widget further down the list never renames the ones above it.

### Headings, notes, pictures and spacers

Four information widgets are Studio's own, for filling and grouping a board
where Homepage has nothing. They need no app and fetch nothing.

| Widget | What it does |
| --- | --- |
| **Heading** | A title for a row of widgets. It starts one row tall with no fill and no edge, so it stands on the page without a card (its **Look** can add them); **Align** centres it. In a one-row card the text shrinks to fit. |
| **Note** | Text you write yourself, on several lines: the guest Wi-Fi, on-call numbers, a reminder. Web addresses (`https://…`) become links that open in a new tab. It is plain text: nothing in it is read as HTML. Everyone who can see the dashboard can read it, so keep passwords and keys out of it. |
| **Picture** | One picture from this dashboard's uploaded backgrounds, filling the card or shown whole, with a description for screen readers. Removing the picture from the library asks first while the widget uses it. An empty note or picture says what to do only in the editor; on the dashboard it is left out, as empty space. |
| **Spacer** | Empty space that keeps the widgets around it in place. It is invisible on the dashboard and dashed while you edit. With **Behaviour › Show on** it can hold space in one layout only. |

## Arranging the board

Arranging happens in the editor (**Edit** on the Dashboards page, or
`/<slug>/studio/edit`). The live dashboard never turns into edit mode, so a
hold, right-click or drag there only does what the widget itself does.

### Touch

- So that controls don't cover what your widgets show, a widget shows its
  select box (top left), **move handle** and **edit** button (top right) and
  **resize corner** only after you tap it. Tapping another widget moves them there; tapping empty space
  hides them.
- **Hold** a widget to open its menu (Edit, Duplicate, look, Move to page,
  Delete and more).
- Move a widget by its move handle and resize it from its corner handle.

A touch that **starts on something the widget handles itself** is left to the
widget. That covers links, buttons and form fields, embedded frames, video and
audio, charts drawn on a canvas or in SVG, and anything that scrolls sideways
inside the panel. A second finger, or a dialog opening, cancels a drag and
puts the panel back.

### Mouse and keyboard

- A widget shows its select box (top left), **move handle** and **edit**
  button (top right) and **resize corner** while the pointer is on it, while
  it has keyboard focus, or while it's selected. A selected widget has an
  accent edge and a filled box. Drag the move handle or the corner. **Right-click** a widget
  for its menu. Each stack has the same checkbox (**Select stack**).
- <kbd>Shift</kbd>-click or <kbd>Ctrl</kbd>/<kbd>⌘</kbd>-click widgets, drag a
  box on empty space, or press <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>A</kbd> to
  select several. The selection bar then offers **Look**, **Size**, **Page**,
  **Stack**, **Duplicate** and **Delete**, each only when it applies.
  <kbd>Escape</kbd> clears the selection.
- With the move handle focused, the **arrow keys** move the panel one cell and
  **Shift + arrows** resize it. With the resize corner focused, the arrows
  resize. **Escape** cancels a drag in progress.
- **Size** (with one panel selected) sets **Column**, **Row**, **Width** and
  **Height** as numbers. A value that's out of range is flagged and **Apply**
  stays off until it's fixed.
- The keyboard button in the editing bar lists every shortcut (on devices with
  a keyboard).

Panels snap to the grid and can't overlap. Resizing moves only the widget
you resize: if it no longer fits where it is, it moves to the nearest free
space and the others stay put.

A widget always shows everything its settings ask for; nothing folds away
behind *+N more* and values never scroll inside a card. So the resize corner
stops at the smallest size the widget's settings can be read at (dragged
smaller both ways, it slides along that limit). If the widget's settings are
open beside the board, they say where it stopped and offer one-tap changes
that would let it go smaller (see [How a widget looks](#how-a-widget-looks)).
A widget that needs more room than its size gives (on a narrower window, a
phone or tablet layout, or after you add blocks) is drawn taller and what is
below it moves down, never cut off; its stored size doesn't change. Widgets
that draw their own content (a calendar, an embedded page) have a fixed
minimum instead and scroll inside their card.

### Saving, undo and redo

The editing bar along the top holds **Widgets** (add one), **Tidy up**,
**Undo**, **Redo** and the size switch on the left, and **Done** on the right.
On a phone the left-hand buttons show icons only.

- Every move, resize, page change and look change **saves by itself** a
  moment later. Beside **Done** the bar says *Saving…*, *Saved*, or *Not saved
  yet, retrying* while Studio can't be reached; your changes stay in the tab
  and save when it can.
- **Undo** and **Redo** (<kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Z</kbd>,
  <kbd>Ctrl</kbd> + <kbd>Y</kbd> or <kbd>Ctrl</kbd>/<kbd>⌘</kbd> +
  <kbd>Shift</kbd> + <kbd>Z</kbd>) step back and forward through everything
  done since you opened the editor, widget changes and deletes included.
- Deleting one widget happens at once, with **Undo** in the message.
- **Done** waits for the last save and goes back to the Dashboards page.

If someone else changes the same dashboard while you're arranging it, both
changes are kept: a widget they removed drops out of your arrangement and one
they added keeps its place, or moves to free space.

## Stacks and slideshows

A stack shows several panels in one place, one at a time.

To make one:

- **Drag a panel onto another panel of the same size** and hold it there for a
  moment. The target is highlighted; drop to stack them.
- Or **select two or more panels** with their checkboxes and press **Create
  stack**. If they're different sizes, you first see how they'll fit and can
  cancel.

Stacks are one level deep: a stack can't hold another stack. To take a panel
back out, open the stack's edit button and use the **×** (Move out) next to it.
Taking one of two panels out turns the other back into an ordinary panel.

### Changing slides

| On | Do this |
| --- | --- |
| A phone or tablet | Swipe sideways on the widget |
| A mouse | Drag sideways |
| A trackpad | Scroll sideways |
| A keyboard | Focus the stack and press <kbd>Left</kbd> or <kbd>Right</kbd> |

The same rule as holding applies to swipes: one that starts on a link, a form
field, a chart, an embedded page or a sideways-scrolling area belongs to that
content. Vertical swipes always scroll the page.

A stack draws as the widget it is showing, at full size, with only a row of
page dots and a small **Play/Pause** button along its bottom edge. The dots
show where you are, and each one is a button that shows that widget. There
are no previous/next arrows.

- **While playing**, changing the slide yourself holds that widget for the
  *manual navigation delay* (30 seconds by default), then the slideshow moves
  on and continues at its normal pace.
- **While paused**, changing the slide keeps it paused.
- Playing pauses by itself while you edit, while a dialog or search is
  open, while you're using something inside the widget (an embedded page, for
  example), while the stack is scrolled off screen and while the tab is in the
  background, and picks up where it left off.
- With your device set to reduce motion, slideshows don't start on their own
  and don't animate; **Play** still works.

None of this is saved: playing, pausing and the slide you're on are yours in
this browser tab only.

### Choosing a widget

Tap or click a page dot (or focus it and press <kbd>Enter</kbd>) to show that
widget; each dot is named after its widget for screen readers. It counts as
changing the slide yourself, so the manual navigation delay applies.

In the editor a stack has the same controls as any widget, in the same
places: its select box at the top left, **Move** and **Edit** at the top
right and the resize corner. A stack needs one grid row more than its largest
widget, for the dots.

### Slideshow settings

In the editor, the stack's edit button opens **Edit widget stack**. Under
**Widgets** you move members earlier or later (the arrows), configure one (the
pencil), take one out (**×**) or **Add an existing widget**. **Size and position**
sets the stack's place on the 24-column layout, and **Unstack all** at the
bottom turns every member back into an ordinary widget. **Slideshow** has the
timing for that stack:

| Setting | Default | Range |
| --- | --- | --- |
| **Start behavior** | Manual (Play starts it) | or Automatic |
| **Seconds per widget** | 10 | 1 to 3600 |
| **Manual navigation delay (seconds)** | 30 | 1 to 3600 |
| **Transition** | Horizontal | Vertical, Fade, None |
| **Animation duration (ms)** | 250 | 0 to 2000 |
| **Loop after the last widget** | On | |

If the delay is shorter than the seconds per widget, the longer of the two is
used after a manual change.

## Changing what a panel shows

In the editor, a panel's **edit** button opens its dialog. On a screen at
least 1400 px wide the dialog opens as a panel down the right, beside the
board: the board keeps its layout, the widget's own card shows your changes
as you make them, and you resize it on the board as usual. The board stays
usable: **edit** on another widget switches the panel to it (asking first
if you have unsaved changes), and Esc closes the panel. On narrower
screens the dialog opens over the board with the widget drawn at the top at
its real desktop size, on the board's own grid; drag its corner (or focus
the corner and use the arrow keys) to change that size, never below the
smallest the widget's settings allow. A widget in a stack keeps the stack's
size. On a narrow screen the preview grows taller rather than cut anything
off.

A widget on the board has four tabs (the arrow keys move between them), and
a **⋯** button beside them with **Duplicate**, **Save as a saved widget** and
**Delete**:

| Tab | What it holds |
| --- | --- |
| **Data** | The **Name**, the connection and settings below (it says *Needs a fix* when one is wrong) and **Setting up …**: what the service needs, from Homepage's documentation, with each secret's exact Docker secret name, variable and `{{HOMEPAGE_FILE_...}}` reference and **Copy** buttons |
| **Show** | The widget's blocks: what it shows and how ([How a widget looks](#how-a-widget-looks)) |
| **Look** | Header, text, background, colour, edge, corners and [saved looks](#saved-looks) |
| **Behaviour** | The link, the status check, refresh, what a click does, which layouts show it (Show on: Desktop, Tablet, Phone) and the page it's on |

Tap or click any part of the widget while its settings are open to go to
the setting for that part. While adding a widget, the dialog keeps its
sections (settings, **Link**, **Setting up …**).

The settings have two tabs:

- **Options**: the connection (address, key, version) and the common native
  options. Once a widget has shown its values, which ones it shows is
  chosen with the blocks on the **Show** tab; before that (while adding one), **Values it
  includes** starts with one switch, **Its usual set**, turned on. Turn it off
  to pick the widget's fields and their order. **Version**, on widgets
  that speak to more than one release of their app, is a choice between the
  releases Homepage documents, such as *Before 2025.8.0* and *2025.8.0 or
  later*; leaving it as it is keeps Homepage's default.
- **YAML**: the same panel as YAML, for everything else the widget
  supports.

Both edit one draft. Options you don't touch, including ones Studio doesn't
know about, `null` values and `{{HOMEPAGE_VAR_...}}` or
`{{HOMEPAGE_FILE_...}}` references, are left exactly as they were.

If the YAML has a mistake, the editor says where: *Invalid YAML at line 4,
column 9: ...* in the **YAML** view, and *services.yaml contains invalid YAML at
line 12, column 3.* when a save is refused. The message never repeats the text
of the line, so a secret on that line doesn't end up on screen or in a log. A
draft with a mistake stays open for you to fix; the saved file isn't touched.

**Delete**, in the **⋯** menu, closes the dialog and deletes the widget at
once, as **Delete** in its menu does, with **Undo** in the message that
follows.

### Saved connections and Test connection

An integration's address and key can be typed into the widget, or saved once
as a **saved connection** and picked on any widget (**Saved connection**
instead of **Enter here**). Changing a saved connection changes every widget
that uses it. Keys are never shown again once saved; leave the key empty to
keep it. Saved connections are listed in **Dashboard settings → Saved
connections**, and a connection saved *Just me* follows you to any dashboard
you edit. Only administrators can see or change them.

**Test connection**, under the connection, sends the widget's first request
now and says in plain words whether it worked, for example *Connected in
42 ms.*, *The service refused the key or login. Check them.* or *The
address's certificate isn't trusted by Studio. Add its authority in
Administration › Trusted certificates, or turn off Check its certificate
below.* (People who aren't administrators are told to ask one to add it.)
A key kept as a Docker secret or variable (`{{HOMEPAGE_FILE_...}}`,
`{{HOMEPAGE_VAR_...}}`) is only filled in for the address the saved widget
already uses, so a test never sends it anywhere new; to test a new address,
save it first or type the key in.

### How a widget looks

The widget on the board (or at the top of the dialog) is a live preview of
every change.

**Show** composes the widget from **blocks**, up to 12, each with its own
values and options. The same value can sit in more than one block.

| Block | Shows |
| --- | --- |
| **Big number** | One value large, with its name; **Largest size** S to XL and an optional **Trend** (against an hour ago, yesterday or last week) |
| **Numbers** | Values in boxes; **Arrangement** Auto, Grid, List or Row and **Columns** Auto or 1 to 4 |
| **Quiet** | Values as small text |
| **Pie** | A donut or pie of numbers written the same way, with its **Legend** Auto, beside, below or off |
| **Bars** | Numbers written the same way as bars |
| **Chart** | A line, area or bar chart over a **Time range** |
| **Gauge** | One percentage |
| **Response time**, **Status history** | The status check's answer times and up/down bars over a range |
| **Logs** | The widget's latest log lines (only for people allowed to see this dashboard's logs, and never with sign-in off) |

Each block card has its type, its values (**+ Value** adds one, **×** takes
one out, drag or use the arrow keys to reorder) and its options; move a block
up or down or remove it. **Add a block** offers only what the widget's
numbers suit: a pie needs two numbers written the same way, a gauge a
percentage. A plain service tile has only status, response time and logs
blocks, and can have none (just its header). **Blocks sit** places them side
by side, stacked or in a grid. Asking for a value the widget doesn't fetch
yet adds it to the widget's own `fields` list.

Wherever a choice says **Auto**, it also says what Auto picked at the
widget's current size (for example *Auto · Row*). Text scales with the widget
down to the smallest size you set.

**Settings for** at the top of **Show** and **Look** chooses **All sizes** or
one kind of size (**Small**, **Wide**, **Tall**, **Regular**, **Large**; the
one the widget is at says *now*). A size's own settings win at that size, are
marked with a dot, and **Use All sizes here** removes them.

When the widget can't go smaller, or its text is drawn below your smallest
size, a note above the tabs says why and offers one-tap changes for the size
being set up, such as **Hide labels**, **Allow smaller text**, **Numbers:
Auto**, **Pie legend: Auto** or **Numbers as quiet**.

**More: each value's name, number style, colour and rules**, under **Show**,
renames a value, changes how its number reads, picks its colour in charts and
sets **Rules**: a **Warning from** and **Problem from** level (**Lower is
worse** turns them round); past a level the value takes that colour and the
card shows its alert edge. Inside a Studio card Homepage's limit of four
values doesn't apply, and a pie never uses a total as a slice.

**Look** sets the header (logo, name, logo position, whether it sits on top
or beside the blocks, description), the text (**Scales** with the widget or
**Fixed**, its smallest or fixed size, how values line up, the numbers font)
and the style, which is the same at every size: saved looks, background,
colour, edge and corners. An integration's **Logo** and **Description** are
set here too.

**Behaviour** has **Status**: the check (web address, ping or off) and how it
shows. Its **Address** starts from the widget's Connection address (or its
link), shown greyed as *From the Connection*; type another to check that
instead. **Check now** runs the check before you save and says, for example,
*Up · 42 ms*. With the check off, Studio warns if a status or response time
block would have nothing to show. **Check its certificate** (on unless you
turn it off) makes Studio check the address's `https://` certificate for the
widget's data, tests and status check. It sits under the widget's
connection, below **Test connection** (for a plain tile, under **Status**
once the check is a web address); turn it off only for a service whose
self-signed certificate can't be added in **Administration › Trusted
certificates** ([DEPLOY.md](DEPLOY.md#trusted-certificates)). When a card
says its certificate isn't trusted, **Fix** opens the connection with the
switch. An integration's **Docker server** and **Docker container** are
under **Status** as well; with both set, the card shows whether the container
is running. **Behaviour** also sets refresh, what a click does, **Show on**
(the layouts the widget appears on; while you edit a layout, widgets it
leaves out are shown faded with "Not shown on this layout") and the page.
A choice that matches the dashboard's default is not stored, so changing the
default in **Dashboard settings → Widget defaults** changes every widget that
didn't choose otherwise.

Studio keeps the numbers charts, trends and rules need once a minute, only
for widgets that use them, for 7, 30 or 90 days (**Dashboard settings →
Widget defaults → Chart history**, 30 by default). A new chart gets its first
numbers within seconds of being saved. Select a line, area or bar chart to
open it full size, with other time ranges and the exact values under your
pointer.

### Saved looks

**Look** lists saved looks under a button that names the look in use (or
*None picked*); choose one to apply it. With more than four there is a search.
It is there even before the first look is saved; **Save this look…** is
available once the widget's look differs from the default and isn't saved
yet. It asks for a name and **Who can use it**: **Just me** (you,
on every dashboard you edit) or **This dashboard** (everyone who edits it).
**Manage saved looks** renames, **Update**s (to this widget's look) or deletes
them. After an update, if other widgets on the dashboard use that look,
Studio asks whether to update them too (**Leave them** or **Update them**).

### Saved widgets

**⋯ → Save as a saved widget** keeps a widget's configuration to
place again: its type, settings, values, look, link, status check and any
saved connection it uses. Never its size or place, which belong to each
layout. **Who can use it** is **Just me**, **This dashboard** or **Everyone**
(the whole Studio). Only administrators save, rename or delete saved
widgets, because a widget's settings can hold keys. Anyone who can arrange
the dashboard can place them: for someone with **Can arrange**, **Saved widgets** in the editing bar
opens *Add a saved widget*, which lists the saved widgets by name and type
only. They never see the settings or keys, but what the widget shows (an
app's numbers, for example) becomes visible to everyone who can open that
dashboard. A widget saved for **Everyone** can be placed by anyone who can
arrange any dashboard, and placing it copies its saved connections, keys
included, to that dashboard, so save one for Everyone only when its data is
fine for any dashboard's viewers.

Saved widgets are listed under **Saved** in *Add to your dashboard*, with their
type and who can use them; choosing one adds it as a new, independent
widget, bringing the saved connections it uses. **Manage saved widgets**
there renames or deletes them. Their settings and keys stay on the server;
the browser only gets their names and types. A dashboard's own saved widgets
are copied when it is duplicated, and travel with its export.

### Your saved items and everyone's

**My account → Saved** lists everything you keep for yourself (**Just me**):
saved widgets, looks, connections, logos and backgrounds. Each row says what
it is and, for a connection or an image, the dashboards that use a copy of
it. Open one to rename or delete it. Deleting yours never breaks a
dashboard: a connection or image used there was copied to it. Keys are never
shown.

Administrators also have **Administration → Saved items**: every person's
own items with their owner, each dashboard's and Everyone's, with who saved
them. Widgets and looks can be renamed or deleted there. A dashboard's own
connections and images are listed without actions: change them in that
dashboard's settings, which checks what uses them first.

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
| Discovered widget hidden / shown | hid or brought back a discovered widget |
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
  snapshot (up to 100 MiB). Nothing changes until you press **Import
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
| **⋯ → Rename or change address** | Its widgets, layout and snapshots stay with it |
| **⋯ → Duplicate** | Makes an independent copy of everything, logo included, at the next suggested address; changing one never changes the other. **Share it with the same people** copies who can open it |
| **⋯ → Who can open it** | Opens **Administration → Dashboard access** |
| **⋯ → Archive** | Takes it off line after you confirm. Its files and snapshots are kept and its address stays reserved |
| **Restore** (under *Archived*) | Brings an archived dashboard back as it was |
| **Delete** (under *Archived*) | Deletes it for good, with its files, snapshots and sharing, once you type its name. Its address becomes free |

An archived dashboard is deleted automatically 30 days after it was archived.
Under *Archived*, administrators choose **7 days**, **30 days**, **90 days** or
**Never**; each archived row says when it will go (*Archived 2 Nov · deleted
automatically on 2 Dec*) or that it's kept until you delete it. Studio checks
once an hour. If a shorter time makes archives due at once, Studio names them
and asks first. Deleting for good and changing the time ask you to confirm it's
you if you signed in a while ago. If some of a deleted dashboard's files
can't be removed right away, Studio says so and tries again every hour.

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
| *This request exceeds the 2 MiB configuration limit* | A single file or request is too big. Imports have a 100 MiB limit, but each file in them is still limited to 2 MiB |
| **This dashboard isn't available** | The address changed or the dashboard was archived; see [More than one dashboard](#more-than-one-dashboard) |

More fixes are in [TROUBLESHOOTING.md](TROUBLESHOOTING.md).
