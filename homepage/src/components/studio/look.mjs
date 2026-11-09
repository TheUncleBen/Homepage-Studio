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
  fill: ["plain", "tint", "solid", "picture", "pattern"],
  strength: ["soft", "medium", "strong"],
  edge: ["line", "shadow", "both", "none"],
  corners: ["square", "default", "round"],
  numbers: ["sans", "mono"],
  header: ["logo-name", "logo", "name", "hidden"],
  // Where the header sits: on top, beside the blocks, or Auto (beside only
  // when the card is much wider than tall). The logo sits left of the name or
  // centred above it.
  headerAt: ["auto", "top", "left"],
  logoPos: ["left", "above"],
  description: ["show", "hide"],
  status: ["dot", "updown", "time"],
  align: ["left", "centre"],
  // Colour fit (board 7): a custom colour is fitted to the theme unless the
  // widget asks for its exact colour; text contrast is still chosen for it.
  colourFit: ["fitted", "exact"],
  // How the blocks sit (mock-ups v4): side by side, stacked, a grid (three
  // or more), or Auto, which picks from the card's shape.
  arrange: ["auto", "row", "col", "grid"],
  // Text grows and shrinks with the card down to its smallest size, or stays
  // one size. The smallest size sets how small the card can be made.
  text: ["scale", "fixed"],
  textSize: ["small", "medium", "large"],
});

// Blocks (mock-ups v4, approved 9 Nov 2026): a widget is a stack of blocks the
// owner composes. Each block has its own look and its own values; the same
// value can sit in more than one block. Every old "Show as" is a block, so
// nothing was lost: numbers (hero, grid, list, row, table), charts over time,
// donut, pie, gauge and status history.
export const RANGES = ["1h", "6h", "24h", "7d", "30d"];
export const BLOCK_OPTIONS = Object.freeze({
  big: { labels: [true, false], size: ["s", "m", "l", "xl"], trend: ["off", "hour", "day", "week"] },
  numbers: { arrange: ["auto", "grid", "list", "row"], columns: ["auto", "1", "2", "3", "4"], labels: [true, false] },
  quiet: { labels: [true, false] },
  pie: { style: ["donut", "pie"], legend: ["auto", "beside", "below", "off"] },
  bars: { labels: [true, false] },
  chart: { style: ["line", "area", "bar"], range: RANGES },
  gauge: {},
  response: { range: RANGES },
  status: { range: RANGES },
  logs: {},
});
export const BLOCK_TYPES = Object.freeze(Object.keys(BLOCK_OPTIONS));
export const BLOCK_DEFAULTS = Object.freeze({
  big: { labels: true, size: "m", trend: "off" },
  numbers: { arrange: "auto", columns: "auto", labels: true },
  quiet: { labels: true },
  pie: { style: "donut", legend: "auto" },
  bars: { labels: true },
  chart: { style: "line", range: "24h" },
  gauge: {},
  response: { range: "1h" },
  status: { range: "24h" },
  logs: {},
});
// Blocks that show values the owner picks, and those that draw them from the
// numbers Studio collects (server/history.mjs), so only numbers can be picked.
export const VALUE_BLOCKS = Object.freeze(["big", "numbers", "quiet", "pie", "bars", "chart", "gauge"]);
export const COLLECTED_BLOCKS = Object.freeze(["pie", "bars", "chart", "gauge"]);
// Blocks that keep "the values no other block shows" when none are picked, so
// a widget whose fields vary (an integration update) keeps showing them all.
export const REST_BLOCKS = Object.freeze(["numbers", "quiet"]);
export const MAX_BLOCKS = 12;
// The look a widget has before anyone changes it: its first value large and
// the rest below, as Homepage Studio always drew it.
export const DEFAULT_BLOCKS = Object.freeze([
  { id: "b1", type: "big", first: true },
  { id: "b2", type: "numbers" },
]);
// The kinds of size a card can be (classOf), each of which can have its own
// layout; anything a size doesn't set comes from All sizes.
export const SIZE_CLASSES = Object.freeze(["small", "wide", "tall", "regular", "large"]);
export const SIZE_KEYS = Object.freeze([
  "blocks",
  "arrange",
  "header",
  "headerAt",
  "logoPos",
  "text",
  "textSize",
  "align",
]);
export function classOf(width, height) {
  const ratio = width / height;
  if (ratio >= 2.2) return "wide";
  if (ratio <= 0.75) return "tall";
  if (Math.max(width, height) < 260) return "small";
  if (Math.min(width, height) >= 300) return "large";
  return "regular";
}
// The look in force at one size: the size's own settings win.
export function lookAt(look, width, height) {
  const own = look?.sizes?.[classOf(width, height)];
  return own && Object.keys(own).length ? { ...look, ...own } : look;
}
export const blocksOf = (look) => (Array.isArray(look?.blocks) ? look.blocks : DEFAULT_BLOCKS);

// Status history: a bar for each status check, from the widget's own check.
export const STATUS_SHOW = "status";
// The history a widget needs collected: charts, a trend, colour rules (which
// read the latest collected value), response time or status history, at any size.
export const allBlocks = (look) => [
  ...blocksOf(look),
  ...SIZE_CLASSES.flatMap((key) => (Array.isArray(look?.sizes?.[key]?.blocks) ? look.sizes[key].blocks : [])),
];
export function needsHistory(look) {
  return (
    allBlocks(look).some(
      (block) =>
        COLLECTED_BLOCKS.includes(block.type) ||
        block.type === "response" ||
        block.type === "status" ||
        (block.type === "big" && block.trend && block.trend !== "off"),
    ) ||
    (Array.isArray(look?.values) && look.values.some((value) => value.rules))
  );
}

// Which layouts show a widget (Show on: Desktop, Tablet, Phone). Stored as
// the sizes joined by "+", always in this order, never empty.
export const LAYOUT_SIZES = Object.freeze(["desktop", "tablet", "phone"]);
const SHOW_ON = LAYOUT_SIZES.reduce((sets, size) => [...sets, ...sets.map((set) => [...set, size])], [[]])
  .filter((set) => set.length)
  .map((set) => set.join("+"));
export function showsOn(value, size) {
  return typeof value !== "string" || !SHOW_ON.includes(value) || value.split("+").includes(size);
}

export const BEHAVIOUR_OPTIONS = Object.freeze({
  target: ["same", "new", "none"],
  showOn: SHOW_ON,
  refresh: ["auto", "10s", "30s", "1m", "5m"],
  errors: ["link", "hide"],
  status: ["web", "ping", "off"],
});

// Dashboard-wide status colours (Dashboard settings › Widget defaults). Only
// a colour that differs from these is stored, in studioDefaults.statusColours.
export const STATUS_COLOURS = Object.freeze({ good: "#3fb27f", warn: "#d9a33b", problem: "#e5604f" });
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
  fill: "plain",
  colour: "logo",
  strength: "medium",
  edge: "line",
  corners: "default",
  numbers: "sans",
  header: "logo-name",
  headerAt: "auto",
  logoPos: "left",
  description: "show",
  status: "dot",
  align: "centre",
  colourFit: "fitted",
  arrange: "auto",
  text: "scale",
  textSize: "medium",
});

export const BUILT_IN_BEHAVIOUR = Object.freeze({
  target: "new",
  showOn: "desktop+tablet+phone",
  refresh: "auto",
  errors: "link",
  status: "web",
});

export const BACKGROUND_FIT = ["fill", "fit", "tile"];
export const BACKGROUND_SHADE = ["auto", "light", "medium", "strong"];
export const NUMBER_STYLES = ["full", "short", "compact"];
export const MAX_VALUES = 24;
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const BLOCK_ID = /^[a-z0-9]{1,16}$/;
// A value's key: the widget's field name, or its label (customapi labels are
// the owner's own words, such as "Blocked today"). Kept equal to
// server/history.mjs so a chart and its arranged values use the same keys.
const FIELD = /^[^\u0000-\u001f\u007f"\\/<>`]{1,80}$/u;

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

function rules(value) {
  if (!plain(value)) fail("Colour rules must be an object.");
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "warn" || key === "problem") {
      if (!Number.isFinite(entry) || Math.abs(entry) > 1e15) fail("A colour rule needs a number.");
      out[key] = entry;
    } else if (key === "lower") {
      if (entry !== true) fail("Lower is worse is either on or left out.");
      out.lower = true;
    } else fail(`Unknown colour rule setting: ${key}.`);
  }
  if (!own(out, "warn") && !own(out, "problem")) fail("A colour rule needs a warning or a problem level.");
  if (own(out, "warn") && own(out, "problem") && (out.lower ? out.problem > out.warn : out.problem < out.warn))
    fail("The problem level must be past the warning level.");
  return out;
}

// The level a value reaches under its colour rules: problem, warn or null.
export function ruleLevel(rule, value) {
  if (!rule || !Number.isFinite(value)) return null;
  const past = (limit) => Number.isFinite(limit) && (rule.lower ? value <= limit : value >= limit);
  if (past(rule.problem)) return "problem";
  if (past(rule.warn)) return "warn";
  return null;
}

function values(list) {
  if (!Array.isArray(list) || list.length > MAX_VALUES) fail(`A widget can arrange at most ${MAX_VALUES} values.`);
  const seen = new Set();
  return list.map((entry) => {
    if (!plain(entry) || typeof entry.field !== "string" || !FIELD.test(entry.field) || seen.has(entry.field))
      fail("Each arranged value needs a unique field.");
    seen.add(entry.field);
    for (const key of Object.keys(entry))
      if (!["field", "label", "format", "colour", "rules"].includes(key)) fail(`Unknown value setting: ${key}.`);
    const out = { field: entry.field };
    if (own(entry, "label")) out.label = text(entry.label, 40, "A value name");
    if (own(entry, "format")) {
      if (!NUMBER_STYLES.includes(entry.format)) fail("A number style must be full, short or compact.");
      out.format = entry.format;
    }
    // A chart line's own colour.
    if (own(entry, "colour")) {
      const colour = hexColor(entry.colour);
      if (!colour) fail("A value colour must be a hex colour.");
      out.colour = colour;
    }
    // Colour rules: from warn the value shows the warning colour, from
    // problem the problem colour (and the card turns to its alert state).
    // lower turns them round, for values where less is worse.
    if (own(entry, "rules")) out.rules = rules(entry.rules);
    return out;
  });
}

function block(entry, ids) {
  if (!plain(entry)) fail("Each block must be an object.");
  if (typeof entry.id !== "string" || !BLOCK_ID.test(entry.id) || ids.has(entry.id))
    fail("Each block needs its own id.");
  ids.add(entry.id);
  if (!BLOCK_TYPES.includes(entry.type)) fail("A block must be one of the offered kinds.");
  const out = { id: entry.id, type: entry.type };
  const options = BLOCK_OPTIONS[entry.type];
  for (const [key, value] of Object.entries(entry)) {
    if (key === "id" || key === "type") continue;
    if (key === "values") {
      if (!VALUE_BLOCKS.includes(entry.type)) fail("Only blocks of values take values.");
      if (!Array.isArray(value) || value.length > MAX_VALUES) fail(`A block can show at most ${MAX_VALUES} values.`);
      const seen = new Set();
      for (const field of value)
        if (typeof field !== "string" || !FIELD.test(field) || seen.has(field))
          fail("A block's values must be different fields.");
        else seen.add(field);
      if (entry.type === "gauge" && value.length > 1) fail("A gauge shows one value.");
      out.values = [...value];
    } else if (key === "first") {
      // The default Big number: the widget's first value, whatever it is.
      if (value !== true || entry.type !== "big") fail("Only a Big number can follow the first value.");
      out.first = true;
    } else if (own(options, key)) {
      if (!options[key].includes(value)) fail(`The block ${key} value is not one of the offered choices.`);
      if (value !== BLOCK_DEFAULTS[entry.type][key]) out[key] = value;
    } else fail(`Unknown block setting: ${key}.`);
  }
  if (out.first && out.values) fail("A Big number either follows the first value or shows the values picked.");
  return out;
}

function blockList(value) {
  // None is allowed: a service tile can show just its header.
  if (!Array.isArray(value) || value.length > MAX_BLOCKS) fail(`A widget shows up to ${MAX_BLOCKS} blocks.`);
  const ids = new Set();
  return value.map((entry) => block(entry, ids));
}

function sizeLayouts(value) {
  if (!plain(value)) fail("Layouts for each size must be an object.");
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!SIZE_CLASSES.includes(key)) fail(`Unknown size: ${key}.`);
    if (!plain(entry)) fail("A size's layout must be an object.");
    const one = {};
    for (const [name, setting] of Object.entries(entry)) {
      if (!SIZE_KEYS.includes(name)) fail(`A size can't set ${name}.`);
      if (name === "blocks") one.blocks = blockList(setting);
      else {
        if (!LOOK_OPTIONS[name].includes(setting)) fail(`The ${key} size's ${name} is not one of the offered choices.`);
        one[name] = setting;
      }
    }
    if (Object.keys(one).length) out[key] = one;
  }
  return Object.keys(out).length ? out : undefined;
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
    else if (key === "blocks") out.blocks = blockList(entry);
    else if (key === "sizes") {
      const sizes = sizeLayouts(entry);
      if (sizes) out.sizes = sizes;
    } else fail(`Unknown widget look setting: ${key}.`);
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
      if (look?.values || look?.blocks || look?.sizes)
        fail("The dashboard's card look has no widget values, blocks or size layouts.");
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
