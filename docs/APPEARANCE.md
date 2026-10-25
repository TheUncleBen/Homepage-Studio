# Appearance

An administrator sets a **default look** for every dashboard in
**Administration → Appearance**. Each dashboard follows each part of it until
it sets that part for itself in its own **Settings**, so one dashboard can
keep the platform accent and choose its own display mode, for example.

## The platform default look

**Administration → Appearance** has:

| Setting | What it does |
| --- | --- |
| **Mode** | Dark, Light or Auto (follows the device). Default: Dark |
| **Accent** | A swatch (Eggplant, Graphite, Ocean, Sage) or **Custom**, which opens a colour picker and shows a **Hex** field. Default: Eggplant, `#b299be` |
| **Background** | Optional. An image address used by every dashboard without a background of its own |
| **Platform CSS** | Optional. Loaded on every dashboard before that dashboard's own `custom.css`, which can override it |

**Save default look** takes effect straight away: dashboards open in the same
browser update at once, and Studio's own pages follow the new look too. Other
devices pick it up the next time their dashboard refreshes its data or
reloads; nobody needs to clear a cache. If another administrator saved a
change while you were editing, Studio says so and keeps your draft; saving
again replaces their change.

## A dashboard's own look

Open the dashboard's **Settings** (on the **Dashboards** page, or
`/<slug>/studio/settings`) and find **Appearance**:

- **Mode**: **Default** follows the platform; Dark, Light or Auto sets this
  dashboard's own.
- **Accent**: the first swatch, **Default**, follows the platform accent; the
  others set this dashboard's own, and **Custom** takes any three- or
  six-digit hex color.
- **Platform CSS → Load the platform CSS**: on by default. Administrators can
  switch it off for one dashboard.

The preview changes with the draft. **Save settings** applies it to this
dashboard and creates the usual recovery snapshot. Each dashboard stores its
own choices in its own `settings.yaml`; anything it doesn't set comes from the
platform when the dashboard loads, so a later platform change reaches it.
Studio manages separate immutable-ID configuration and state directories inside
the same two deployment volumes, as described in
[Where the data lives](OPERATIONS.md#where-the-data-lives). Opening settings
does not insert defaults into an existing file.

## Logo

Anyone who may arrange a dashboard can give it its own logo in its
**Settings → Appearance → Logo**: **Upload logo** (PNG, JPEG, WebP or SVG, up
to 256 KiB; a square image works best). It saves straight away, and shows next
to the dashboard's name in the top bar and as its browser tab icon. **Use the
Studio logo** goes back to the default. A duplicate keeps its source's logo.
SVG files with scripts, embedded pages, event handlers or external references
are refused. Homepage's own `favicon` setting, when set, still decides the
tab icon.

## Native settings and Studio appearance

The appearance section writes a small, optional namespace in the native settings file:

```yaml
studioTheme:
  mode: dark
  accent: "#b299be"
```

`mode` accepts `dark`, `light`, or `system`; without `mode` or `accent` the dashboard follows the platform for that part, and `platformCss: false` stops the platform CSS loading on it. A fixed mode also updates Homepage's native `theme` setting. Follow device removes that fixed native setting and keeps the native widget theme synchronized with the browser's color-scheme preference. Changing the device preference does not save files or create snapshots. A native `theme: dark` or `theme: light` without a Studio mode also counts as the dashboard's own mode. 

The chosen accent is used to derive text, controls, focus rings, borders, and soft selection backgrounds. Studio adjusts its derived foreground colors for readability against the light or dark neutral surfaces. The exact chosen hex stays in the file. Native status colors and integration-specific chart colors keep Homepage's behavior; the native `color` palette remains independently configurable below Appearance.

Background images and their native blur, brightness, saturation, and opacity settings remain available through the Background field and the YAML view; a dashboard without one uses the platform background image, if any. Widget dimensions and stack layout remain direct dashboard edits. There is no separate theme profile database or browser-only appearance setting to synchronize.

## Custom CSS

For finer control, open **Dashboard settings → Configuration files**, select `custom.css`, edit it, and save. The native custom stylesheet is refreshed after the save without reloading healthy widgets. Studio's generated defaults have zero CSS specificity, so normal `:root` overrides keep precedence even after settings updates reorder Next.js head elements.

The most useful semantic variables are:

| Variable | Purpose |
| --- | --- |
| `--studio-bg` | Page background |
| `--studio-surface` | Panels and dialogs |
| `--studio-raised` | Raised surfaces and hover backgrounds |
| `--studio-input` | Form and code editor background |
| `--studio-text`, `--studio-muted` | Main and secondary text |
| `--studio-line`, `--studio-line-strong` | Dividers and interactive borders |
| `--studio-accent`, `--studio-accent-soft` | Accent text and soft selection backgrounds |
| `--studio-accent-solid`, `--studio-accent-hover`, `--studio-accent-contrast` | Filled accent controls, hover state, and their text |
| `--studio-accent-line`, `--studio-focus` | Accent borders and keyboard focus |
| `--studio-danger-text`, `--studio-danger-bg`, `--studio-danger-line` | Error and deletion messages |
| `--studio-danger-solid`, `--studio-danger-contrast` | Destructive action buttons |

For example, this changes the neutral surfaces of a dark dashboard while retaining the selected accent:

```css
:root {
  --studio-bg: #121214;
  --studio-surface: #1c1c20;
  --studio-raised: #27272d;
  --studio-input: #17171a;
}
```

Custom CSS takes precedence over the generated palette. When overriding foreground and background pairs, choose readable combinations; the automatic palette adjustments cannot evaluate arbitrary user CSS or every native integration's rendered content.

The same native file editor also retains `custom.js`. Changing or restoring that file offers **Reload dashboard**, because re-executing an already loaded arbitrary script in place cannot reliably undo its earlier effects.

## Copying a design to another deployment

Use **Configuration files → Export dashboard** to download all nine native files plus the saved panel identities, layout, and stacks. On the destination, use **Snapshots & restore → Choose a backup file**. File selection only stages the import. The final **Import dashboard** button replaces the destination after validation and creates a recovery snapshot of its previous configuration.

The imported appearance and CSS belong to the destination's own files. Environment variables, mounted secret files, external services, and other deployment prerequisites still need to be present there. See [Configuration and recovery](ARCHITECTURE.md#configuration-and-recovery) for transaction and size limits.
