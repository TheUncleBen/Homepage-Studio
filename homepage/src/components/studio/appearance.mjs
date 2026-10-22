// Only bounded color values reach the generated stylesheet. The native files
// remain the source of truth; no browser-local theme or separate theme store.
export const DEFAULT_ACCENT = "#b299be";
export const ACCENT_PRESETS = Object.freeze([
  { name: "Eggplant", color: DEFAULT_ACCENT },
  { name: "Graphite", color: "#a5a5aa" },
  { name: "Ocean", color: "#81a8c8" },
  { name: "Sage", color: "#91b09e" },
]);

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
  return { mode, accent: hexColor(custom.accent) || DEFAULT_ACCENT };
}

export function appearanceTokens(settings = {}, systemDark = true) {
  const appearance = appearanceConfig(settings);
  const dark =
    appearance.mode === "system" ? systemDark : appearance.mode !== "light";
  const base = dark
    ? {
        bg: "#111115",
        surface: "#1b1a20",
        raised: "#242129",
        input: "#141217",
        text: "#eeecf1",
        muted: "#b4aebc",
        line: "#34303b",
        "line-strong": "#766a7e",
        "danger-text": "#f0b8ce",
        "danger-bg": "#33202a",
        "danger-line": "#a86c85",
        "danger-solid": "#713b53",
        "danger-contrast": "#fff1f6",
      }
    : {
        bg: "#f4f3f6",
        surface: "#ffffff",
        raised: "#eeebf1",
        input: "#fbfafc",
        text: "#242029",
        muted: "#655c6c",
        line: "#d7d0dd",
        "line-strong": "#8d8196",
        "danger-text": "#842848",
        "danger-bg": "#fbeaf0",
        "danger-line": "#a85572",
        "danger-solid": "#913951",
        "danger-contrast": "#fff6f9",
      };
  const soft = mix(base.surface, appearance.accent, dark ? 0.15 : 0.12);
  const backgrounds = [base.bg, base.surface, base.raised, base.input, soft];
  const accent = readable(appearance.accent, backgrounds);
  const solid = mix(appearance.accent, "#17111c", dark ? 0.48 : 0.39);
  const hover = mix(solid, dark ? "#ffffff" : "#000000", 0.1);
  const tokens = {
    ...base,
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
