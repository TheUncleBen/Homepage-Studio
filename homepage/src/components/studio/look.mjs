// How a widget looks and behaves, shared by the controller (validation) and
// the dashboard (resolution and rendering).
//
// Rule 2 (owner direction, 1 Nov 2026): the dashboard sets defaults and a
// widget wins. A widget stores a key only while it differs from the value it
// would otherwise get; choosing the default again removes the key, so the
// widget follows later changes to the dashboard. There is no reset or
// inherit control anywhere.

import { BASES, hexColor } from "./appearance.mjs";
import { SPACING } from "./geometry.mjs";

export const LOOK_OPTIONS = Object.freeze({
  layout: ["hero", "quiet"],
  fill: ["plain", "tint", "solid", "picture", "pattern"],
  strength: ["soft", "medium", "strong"],
  edge: ["line", "shadow", "both", "none"],
  corners: ["square", "default", "round"],
  numbers: ["sans", "mono"],
  header: ["logo-name", "logo", "name", "hidden"],
  heroSize: ["s", "m", "l", "xl"],
  trend: ["off", "hour", "day", "week"],
  description: ["show", "hide"],
  status: ["dot", "updown", "time"],
  align: ["left", "centre"],
  // Colour fit (board 7): a custom colour is fitted to the theme unless the
  // widget asks for its exact colour; text contrast is still chosen for it.
  colourFit: ["fitted", "exact"],
});

export const BEHAVIOUR_OPTIONS = Object.freeze({
  target: ["same", "new", "none"],
  phones: ["show", "hide"],
  refresh: ["auto", "10s", "30s", "1m", "5m"],
  errors: ["link", "hide"],
  status: ["web", "ping", "off"],
});

// Dashboard-wide status colours (Dashboard settings › Widget defaults). Only
// a colour that differs from these is stored, in studioDefaults.statusColours.
export const STATUS_COLOURS = Object.freeze({ good: "#3fb27f", problem: "#e5604f" });
export function statusColours(settings) {
  const raw = settings?.studioDefaults?.statusColours;
  const out = {};
  if (!plain(raw)) return out;
  for (const key of Object.keys(STATUS_COLOURS)) {
    const colour = hexColor(raw[key]);
    if (colour && colour !== STATUS_COLOURS[key]) out[key] = colour;
  }
  return out;
}
// Background updates: widgets pause while the tab is hidden unless the
// dashboard says to keep updating.
export const keepsUpdatingHidden = (settings) => settings?.studioDefaults?.updates === "keep";

export const REFRESH_MS = Object.freeze({ "10s": 10000, "30s": 30000, "1m": 60000, "5m": 300000 });

// What a widget gets when neither the dashboard nor the default look says otherwise.
export const BUILT_IN_LOOK = Object.freeze({
  layout: "hero",
  fill: "plain",
  colour: "logo",
  strength: "medium",
  edge: "line",
  corners: "default",
  numbers: "sans",
  header: "logo-name",
  heroSize: "m",
  trend: "off",
  description: "show",
  status: "dot",
  align: "left",
  colourFit: "fitted",
});

export const BUILT_IN_BEHAVIOUR = Object.freeze({
  target: "new",
  phones: "show",
  refresh: "auto",
  errors: "link",
  status: "web",
});

export const BACKGROUND_FIT = ["fill", "fit", "tile"];
export const BACKGROUND_SHADE = ["auto", "light", "medium", "strong"];
export const VALUE_SLOTS = ["hero", "below", "hidden"];
export const NUMBER_STYLES = ["full", "short", "compact"];
export const MAX_VALUES = 24;
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const FIELD = /^[A-Za-z0-9_.:-]{1,80}$/;

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const plain = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

export class LookError extends Error {}
const fail = (message) => {
  throw new LookError(message);
};

function text(value, max, label) {
  if (typeof value !== "string") fail(`${label} must be text.`);
  const trimmed = value.trim();
  if (trimmed.length > max) fail(`${label} can be at most ${max} characters.`);
  // Control characters never belong in a label shown on a card.

  if (/[\u0000-\u001f\u007f]/.test(trimmed)) fail(`${label} contains characters that cannot be shown.`);
  return trimmed;
}

function background(value) {
  if (!plain(value)) fail("A widget background must be an object.");
  const out = {};
  // "none" lets a page turn off the dashboard's page background.
  if (value.source === "none") {
    if (Object.keys(value).length !== 1) fail("A background set to none takes no other settings.");
    return { source: "none" };
  }
  if (!["builtin", "library"].includes(value.source)) fail("A widget background needs a source.");
  out.source = value.source;
  if (typeof value.id !== "string" || !ID.test(value.id))
    fail("A widget background names an image that does not exist.");
  out.id = value.id;
  if (own(value, "lightId")) {
    if (typeof value.lightId !== "string" || !ID.test(value.lightId)) fail("The light-mode image is not valid.");
    out.lightId = value.lightId;
  }
  if (own(value, "fit")) {
    if (!BACKGROUND_FIT.includes(value.fit)) fail("Background fit must be fill, fit or tile.");
    out.fit = value.fit;
  }
  if (own(value, "focus")) {
    const focus = value.focus;
    if (!Array.isArray(focus) || focus.length !== 2 || !focus.every((n) => Number.isFinite(n) && n >= 0 && n <= 100))
      fail("The background focus point must be two percentages.");
    out.focus = focus.map((n) => Math.round(n));
  }
  if (own(value, "shade")) {
    if (!BACKGROUND_SHADE.includes(value.shade)) fail("Background shade is not valid.");
    out.shade = value.shade;
  }
  if (own(value, "blur")) {
    if (!Number.isInteger(value.blur) || value.blur < 0 || value.blur > 20) fail("Background blur must be 0 to 20.");
    out.blur = value.blur;
  }
  if (own(value, "matchTheme")) {
    if (typeof value.matchTheme !== "boolean") fail("Match theme must be on or off.");
    out.matchTheme = value.matchTheme;
  }
  return out;
}

function values(list) {
  if (!Array.isArray(list) || list.length > MAX_VALUES) fail(`A widget can arrange at most ${MAX_VALUES} values.`);
  const seen = new Set();
  let heroes = 0;
  return list.map((entry) => {
    if (!plain(entry) || typeof entry.field !== "string" || !FIELD.test(entry.field) || seen.has(entry.field))
      fail("Each arranged value needs a unique field.");
    seen.add(entry.field);
    const out = { field: entry.field };
    if (own(entry, "slot")) {
      if (!VALUE_SLOTS.includes(entry.slot)) fail("A value can be the hero, below or hidden.");
      out.slot = entry.slot;
      if (entry.slot === "hero") heroes += 1;
    }
    if (own(entry, "label")) out.label = text(entry.label, 40, "A value name");
    if (own(entry, "format")) {
      if (!NUMBER_STYLES.includes(entry.format)) fail("A number style must be full, short or compact.");
      out.format = entry.format;
    }
    if (heroes > 1) fail("Only one value can be the hero.");
    return out;
  });
}

// Strict validation for a stored override object. Unknown keys are refused so
// nothing outside this list can reach the generated card styles.
export function validateLook(value) {
  if (value === undefined) return undefined;
  if (!plain(value)) fail("A widget look must be an object.");
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (LOOK_OPTIONS[key]) {
      if (!LOOK_OPTIONS[key].includes(entry)) fail(`The widget ${key} value is not one of the offered choices.`);
      out[key] = entry;
    } else if (key === "colour") {
      if (entry !== "logo" && !hexColor(entry)) fail("A widget colour must be a hex colour or the logo's colour.");
      out.colour = entry === "logo" ? "logo" : hexColor(entry);
    } else if (key === "background") out.background = background(entry);
    else if (key === "values") out.values = values(entry);
    else fail(`Unknown widget look setting: ${key}.`);
  }
  return Object.keys(out).length ? out : undefined;
}

// settings.yaml studioTheme, as people who may arrange a dashboard write it
// (POST /studio/api/appearance). Only the keys Studio writes, each with its
// own choices, so no free text can reach settings.yaml (and the renderer's
// {{...}} substitution) through this route.
export function validateStudioTheme(value) {
  if (value === null || value === undefined) return value;
  if (!plain(value)) fail("The Studio appearance must be an object.");
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "mode") {
      if (!["dark", "light", "system"].includes(entry)) fail("Mode must be dark, light or system.");
      out.mode = entry;
    } else if (key === "accent") {
      if (!hexColor(entry)) fail("The accent must be a hex colour.");
      out.accent = hexColor(entry);
    } else if (key === "base") {
      if (typeof entry !== "string" || !Object.hasOwn(BASES, entry))
        fail("That base is not one of the offered choices.");
      out.base = entry;
    } else if (key === "spacing") {
      if (typeof entry !== "string" || !Object.hasOwn(SPACING, entry))
        fail("Spacing must be compact, default or roomy.");
      out.spacing = entry;
    } else if (key === "card") {
      const look = validateLook(entry);
      if (look?.values) fail("The dashboard's card look has no widget values.");
      if (look) out.card = look;
    } else if (key === "pageBackground") out.pageBackground = background(entry);
    else if (key === "glass") {
      if (entry !== true) fail("Glass cards are on or left out.");
      out.glass = true;
    } else if (key === "platformCss") {
      if (entry !== false) fail("The platform CSS is off or left out.");
      out.platformCss = false;
    } else fail(`Unknown appearance setting: ${key}.`);
  }
  return out;
}

export function validateBehaviour(value) {
  if (value === undefined) return undefined;
  if (!plain(value)) fail("Widget behaviour must be an object.");
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!BEHAVIOUR_OPTIONS[key]) fail(`Unknown widget behaviour setting: ${key}.`);
    if (!BEHAVIOUR_OPTIONS[key].includes(entry)) fail(`The widget ${key} value is not one of the offered choices.`);
    out[key] = entry;
  }
  return Object.keys(out).length ? out : undefined;
}

// Tolerant reading for rendering: anything invalid is ignored, never thrown.
export function readLook(value) {
  if (!plain(value)) return {};
  const out = {};
  for (const key of Object.keys(value)) {
    try {
      const one = validateLook({ [key]: value[key] });
      if (one) Object.assign(out, one);
    } catch {
      // Ignore a value this build does not understand.
    }
  }
  return out;
}

export function readBehaviour(value) {
  if (!plain(value)) return {};
  const out = {};
  for (const key of Object.keys(value)) {
    try {
      const one = validateBehaviour({ [key]: value[key] });
      if (one) Object.assign(out, one);
    } catch {
      // Ignore a value this build does not understand.
    }
  }
  return out;
}

// The value a widget gets from everything above it: built-in default, then
// the platform default look, then the dashboard.
export function inheritedLook(...layers) {
  return Object.assign({}, BUILT_IN_LOOK, ...layers.map(readLook));
}

export function inheritedBehaviour(...layers) {
  return Object.assign({}, BUILT_IN_BEHAVIOUR, ...layers.map(readBehaviour));
}

// Rule 2 in one place: set a key on a sparse override. A value equal to what
// the widget would inherit removes the key instead of storing it.
export function setOverride(override = {}, key, value, inherited = {}) {
  const next = { ...(plain(override) ? override : {}) };
  const same = JSON.stringify(value) === JSON.stringify(inherited[key]);
  if (value === undefined || same) delete next[key];
  else next[key] = value;
  return Object.keys(next).length ? next : undefined;
}

// ---------- Colour fit (RESEARCH §7): any colour, fitted to the theme ----------
const hexRgb = (hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const delin = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function toOklch(hex) {
  const [r, g, b] = hexRgb(hex).map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), ((((Math.atan2(B, A) * 180) / Math.PI) % 360) + 360) % 360];
}

function oklchRaw(L, C, H) {
  const a = C * Math.cos((H * Math.PI) / 180);
  const b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export function fromOklch(L, C, H) {
  let chroma = C;
  const inGamut = (c) => oklchRaw(L, c, H).every((v) => v >= -1e-4 && v <= 1 + 1e-4);
  while (chroma > 0 && !inGamut(chroma)) chroma -= 0.002;
  const rgb = oklchRaw(L, Math.max(chroma, 0), H).map((v) =>
    Math.min(1, Math.max(0, delin(Math.min(1, Math.max(0, v))))),
  );
  return `#${rgb
    .map((v) =>
      Math.round(v * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function luminance(hex) {
  const [r, g, b] = hexRgb(hex).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => p - q);
  return (y + 0.05) / (x + 0.05);
}

// (lightness min, lightness max, chroma cap) per display mode and strength.
const BANDS = {
  dark: { soft: [0.26, 0.32, 0.05], medium: [0.36, 0.48, 0.09], strong: [0.7, 0.86, 0.15] },
  light: { soft: [0.94, 0.97, 0.035], medium: [0.85, 0.92, 0.07], strong: [0.45, 0.58, 0.14] },
};

// Material's harmonize moves a hue up to 15° toward the source; Studio moves
// half the distance, capped at 5°, so a brand colour stays recognisable.
function harmonize(hue, anchor) {
  const d = ((((anchor - hue + 180) % 360) + 360) % 360) - 180;
  return (hue + Math.sign(d) * Math.min(Math.abs(d) * 0.5, 5) + 360) % 360;
}

// Returns {fill, ink, contrast}. Ink is the theme text when it reaches 4.5:1,
// otherwise the better of near-black and white; the fill's lightness is
// nudged until some ink reaches 4.5:1.
// A colour used as it is: only the text colour is picked for it.
export function exactColour(hex, { text = "#ececea", inkDark = "#141414" } = {}) {
  const fill = hexColor(hex);
  if (!fill) return null;
  const ink = [text, inkDark, "#ffffff"].reduce((best, candidate) =>
    contrast(candidate, fill) > contrast(best, fill) ? candidate : best,
  );
  // Rounded down, so a colour just under 4.5:1 never reads as passing.
  return { fill, ink, contrast: Math.floor(contrast(ink, fill) * 10) / 10 };
}

export function fitColour(
  hex,
  { mode = "dark", accent = "#5fb3a1", text = "#ececea", inkDark = "#141414" } = {},
  strength = "medium",
) {
  const colour = hexColor(hex);
  if (!colour) return null;
  const [L, C, H] = toOklch(colour);
  const [lo, hi, cap] = BANDS[mode === "light" ? "light" : "dark"][strength] || BANDS.dark.medium;
  let tL = Math.min(hi, Math.max(lo, L));
  const anchor = toOklch(hexColor(accent) || "#5fb3a1")[2];
  const hue = C > 0.02 ? harmonize(H, anchor) : H;
  const chroma = C > 0.02 ? Math.min(C, cap) : Math.min(C, 0.01);
  let fill = fromOklch(tL, chroma, hue);
  const pickInk = (f) =>
    contrast(text, f) >= 4.5 ? text : contrast(inkDark, f) >= contrast("#ffffff", f) ? inkDark : "#ffffff";
  let ink = pickInk(fill);
  const step = luminance(ink) < 0.2 ? 0.01 : -0.01;
  while (contrast(ink, fill) < 4.5 && tL > 0.05 && tL < 0.98) {
    tL += step;
    fill = fromOklch(tL, chroma, hue);
  }
  ink = pickInk(fill);
  return { fill, ink, contrast: Math.round(contrast(ink, fill) * 10) / 10 };
}
