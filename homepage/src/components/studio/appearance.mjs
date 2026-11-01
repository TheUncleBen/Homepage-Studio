// Only bounded color values reach the generated stylesheet. The native files
// remain the source of truth; no browser-local theme or separate theme store.
// Owner decision (1 Nov 2026): new dashboards start on the Graphite base with
// the eggplant accent. Every other base and accent stays selectable.
export const DEFAULT_ACCENT = "#b299be";
export const DEFAULT_BASE = "graphite";
export const ACCENT_PRESETS = Object.freeze([
  { name: "Eggplant", color: DEFAULT_ACCENT },
  { name: "Teal", color: "#5fb3a1" },
  { name: "Ocean", color: "#81a8c8" },
  { name: "Sage", color: "#91b09e" },
  { name: "Amber", color: "#d9a35b" },
  { name: "Rose", color: "#d48a96" },
]);

const DANGER = {
  dark: { "danger-text": "#f2b8b0", "danger-bg": "#33201e", "danger-line": "#a86c66", "danger-solid": "#7a3a33", "danger-contrast": "#fff3f1" },
  light: { "danger-text": "#8a2a20", "danger-bg": "#fbebe8", "danger-line": "#a85a50", "danger-solid": "#9a3b30", "danger-contrast": "#fff7f5" },
};
const family = (name, dark, light) => ({
  name,
  dark: { bg: dark[0], surface: dark[1], raised: dark[2], input: dark[3], text: dark[4], muted: dark[5], line: dark[6], "line-strong": dark[7], ...DANGER.dark },
  light: { bg: light[0], surface: light[1], raised: light[2], input: light[3], text: light[4], muted: light[5], line: light[6], "line-strong": light[7], ...DANGER.light },
});
// Each base sets the page, cards and lines in both a dark and a light
// version. Greys carry a slight tint of their own hue; none is purple unless
// Eggplant is chosen. All text and muted colours reach 4.5:1 on their cards.
export const BASES = Object.freeze({
  graphite: family(
    "Graphite",
    ["#121314", "#1a1b1d", "#202124", "#0f1011", "#ececea", "#a3a6aa", "#2b2d30", "#6e7175"],
    ["#f3f1ec", "#ffffff", "#f7f6f2", "#fbfaf7", "#1d1c1a", "#5f5c56", "#e2dfd8", "#8f8b84"],
  ),
  slate: family(
    "Slate",
    ["#11151b", "#192029", "#1f2731", "#0e1217", "#eef1f5", "#a3adba", "#2a3440", "#6b7685"],
    ["#eef1f5", "#ffffff", "#f5f7fa", "#fafbfc", "#18202a", "#56606d", "#d9dfe6", "#8691a0"],
  ),
  midnight: family(
    "Midnight",
    ["#0e1117", "#151a23", "#1b212c", "#0b0e13", "#eceff4", "#a0a8b6", "#262d3a", "#666f80"],
    ["#eceff4", "#ffffff", "#f4f6f9", "#fafbfc", "#161b24", "#545c6b", "#d6dbe4", "#848c9c"],
  ),
  forest: family(
    "Forest",
    ["#101512", "#18201b", "#1e2721", "#0d110e", "#eff2ec", "#a3ada4", "#29332c", "#6a766d"],
    ["#eff2ec", "#ffffff", "#f6f8f4", "#fafbf8", "#18201a", "#56605a", "#d9dfd5", "#88928a"],
  ),
  sand: family(
    "Sand",
    ["#161411", "#1f1c18", "#26221d", "#12100e", "#f5f1e8", "#b0a899", "#332e27", "#7a7266"],
    ["#f5f1e8", "#fffdf8", "#f9f6ef", "#fdfbf6", "#221e17", "#625b4f", "#e5ded0", "#968d7e"],
  ),
  eggplant: family(
    "Eggplant",
    ["#111115", "#1b1a20", "#242129", "#141217", "#eeecf1", "#b4aebc", "#34303b", "#766a7e"],
    ["#f4f3f6", "#ffffff", "#eeebf1", "#fbfafc", "#242029", "#655c6c", "#d7d0dd", "#8d8196"],
  ),
});

export function hexColor(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (/^#[\da-f]{6}$/i.test(text)) return text.toLowerCase();
  if (/^#[\da-f]{3}$/i.test(text))
    return `#${[...text.slice(1)].map((part) => part + part).join("")}`.toLowerCase();
  return null;
}

const rgb = (color) =>
  [1, 3, 5].map((start) => Number.parseInt(color.slice(start, start + 2), 16));
const colorHex = (channels) =>
  `#${channels.map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;
function mix(first, second, amount) {
  const other = rgb(second);
  return colorHex(
    rgb(first).map(
      (channel, index) => channel * (1 - amount) + other[index] * amount,
    ),
  );
}
function luminance(color) {
  const channels = rgb(color).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
export function contrastRatio(first, second) {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}
function readable(color, backgrounds, minimum = 4.5) {
  if (
    backgrounds.every(
      (background) => contrastRatio(color, background) >= minimum,
    )
  )
    return color;
  const target = ["#000000", "#ffffff"].sort(
    (a, b) =>
      Math.min(
        ...backgrounds.map((background) => contrastRatio(b, background)),
      ) -
      Math.min(
        ...backgrounds.map((background) => contrastRatio(a, background)),
      ),
  )[0];
  for (let step = 1; step <= 100; step += 1) {
    const adjusted = mix(color, target, step / 100);
    if (
      backgrounds.every(
        (background) => contrastRatio(adjusted, background) >= minimum,
      )
    )
      return adjusted;
  }
  return target;
}

export function appearanceConfig(settings = {}) {
  const raw = settings.studioTheme;
  const custom =
    raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const mode = ["dark", "light", "system"].includes(custom.mode)
    ? custom.mode
    : settings.theme === "light"
      ? "light"
      : "dark";
  const base = Object.hasOwn(BASES, custom.base) ? custom.base : DEFAULT_BASE;
  return { mode, accent: hexColor(custom.accent) || DEFAULT_ACCENT, base };
}

export function appearanceTokens(settings = {}, systemDark = true) {
  const appearance = appearanceConfig(settings);
  const dark =
    appearance.mode === "system" ? systemDark : appearance.mode !== "light";
  const base = BASES[appearance.base][dark ? "dark" : "light"];
  const soft = mix(base.surface, appearance.accent, dark ? 0.15 : 0.12);
  const backgrounds = [base.bg, base.surface, base.raised, base.input, soft];
  const accent = readable(appearance.accent, backgrounds);
  const solid = mix(appearance.accent, "#17111c", dark ? 0.48 : 0.39);
  const hover = mix(solid, dark ? "#ffffff" : "#000000", 0.1);
  const tokens = {
    ...base,
    // A light accent-soft can sit close to muted text; keep both readable.
    text: readable(base.text, backgrounds),
    muted: readable(base.muted, backgrounds),
    accent,
    "accent-solid": solid,
    "accent-hover": hover,
    "accent-contrast": readable("#ffffff", [solid, hover]),
    "accent-soft": soft,
    "accent-line": readable(
      mix(base.surface, appearance.accent, 0.6),
      backgrounds,
      3,
    ),
    focus: readable(appearance.accent, backgrounds, 3),
  };
  return { mode: dark ? "dark" : "light", tokens };
}

function declarations(settings, systemDark) {
  const { mode, tokens } = appearanceTokens(settings, systemDark);
  return `color-scheme:${mode};${Object.entries(tokens)
    .map(([name, value]) => `--studio-${name}:${value};`)
    .join("")}`;
}

// The CSS contains only fixed selectors/property names and normalized hex values.
// It is server rendered, so the shell is themed before hydration. Zero-specificity
// defaults let ordinary :root custom CSS win even when Next updates head order.
export function appearanceStyles(settings = {}) {
  const base = `:where(:root){${declarations(settings, true)}}`;
  return appearanceConfig(settings).mode === "system"
    ? `${base}@media(prefers-color-scheme:light){:where(:root){${declarations(settings, false)}}}`
    : base;
}

// A dashboard follows each platform default (Administration → Appearance)
// until its own settings.yaml sets it: display mode (studioTheme.mode, or
// the native theme), accent colour (studioTheme.accent) and background.
export function ownAppearance(settings = {}) {
  const raw = settings.studioTheme;
  const own = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return {
    mode: ["dark", "light", "system"].includes(own.mode) || ["dark", "light"].includes(settings.theme),
    accent: Boolean(hexColor(own.accent)),
    base: Object.hasOwn(BASES, own.base),
    background: settings.background !== undefined,
  };
}

export function applyPlatformDefaults(settings = {}, platform = null) {
  if (!platform) return settings;
  const raw = settings.studioTheme;
  const studioTheme = raw && typeof raw === "object" && !Array.isArray(raw) ? { ...raw } : {};
  const own = ownAppearance(settings);
  const effective = { ...settings, studioTheme };
  if (!own.mode && ["dark", "light", "system"].includes(platform.mode)) {
    studioTheme.mode = platform.mode;
    if (platform.mode === "system") delete effective.theme;
    else effective.theme = platform.mode;
  }
  if (!own.accent && hexColor(platform.accent)) studioTheme.accent = hexColor(platform.accent);
  if (!own.base && Object.hasOwn(BASES, platform.base)) studioTheme.base = platform.base;
  if (!own.background && platform.background) effective.background = platform.background;
  return effective;
}
