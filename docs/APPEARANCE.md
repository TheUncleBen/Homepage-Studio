# Appearance and independent dashboards

Open **Dashboard settings → Appearance** to choose Dark, Light, or Follow device, then choose an accent or enter a hex color. The default is the original muted eggplant accent on charcoal and gray surfaces. Eggplant, Graphite, Ocean, and Sage are convenient starting points; any three- or six-digit hex color is accepted. The preview changes with the draft. **Save settings** applies it to this dashboard and creates the usual recovery snapshot.

Each dashboard stores its appearance in its own `settings.yaml`. A dashboard can look completely different from another without changing the image or building another application. Studio manages separate immutable-ID configuration and state directories inside the same two deployment volumes, as described in [Where the data lives](OPERATIONS.md#where-the-data-lives). Opening settings does not insert defaults into an existing file.

## Native settings and Studio appearance

The appearance section writes a small, optional namespace in the native settings file:

```yaml
studioTheme:
  mode: dark
  accent: "#b299be"
```

`mode` accepts `dark`, `light`, or `system`. A fixed mode also updates Homepage's native `theme` setting. Follow device removes that fixed native setting and keeps the native widget theme synchronized with the browser's color-scheme preference. Changing the device preference does not save files or create snapshots. Without a Studio mode, an existing native `theme: light` remains light; other configurations use Studio's dark default.

The chosen accent is used to derive text, controls, focus rings, borders, and soft selection backgrounds. Studio adjusts its derived foreground colors for readability against the light or dark neutral surfaces. The exact chosen hex stays in the file. Native status colors and integration-specific chart colors keep Homepage's behavior; the native `color` palette remains independently configurable below Appearance.

Background images and their native blur, brightness, saturation, and opacity settings remain available through the Background field and Advanced YAML. Widget dimensions and stack layout remain direct dashboard edits. There is no separate theme profile database or browser-only appearance setting to synchronize.

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

Use **Configuration files → Export saved dashboard** to download all nine native files plus the saved panel identities, layout, and stacks. On the destination, use **Snapshots & restore → Choose dashboard backup**. File selection only stages the import. The final **Import dashboard** button replaces the destination after validation and creates a recovery snapshot of its previous configuration.

The imported appearance and CSS belong to the destination's own files. Environment variables, mounted secret files, external services, and other deployment prerequisites still need to be present there. See [Configuration and recovery](ARCHITECTURE.md#configuration-and-recovery) for transaction and size limits.
