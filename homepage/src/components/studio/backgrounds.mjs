// Studio's built-in backgrounds, all its own artwork:
// - scenes: painted landscapes shipped as WebP (scripts/backgrounds);
// - abstract designs and patterns: SVG drawn here from the theme's own
//   colours, so they match any base and accent, dark or light.
// Only fixed markup and validated hex colours reach the SVG.

import { hexColor } from "./appearance.mjs";

export const SCENES = Object.freeze([
  { id: "dawn", name: "Dawn ridge", suits: "both" },
  { id: "fog", name: "Fog valley", suits: "light" },
  { id: "night", name: "Night range", suits: "dark" },
  { id: "canyon", name: "Canyon", suits: "both" },
  { id: "dunes", name: "Dunes", suits: "light" },
  { id: "coast", name: "Coast", suits: "both" },
  { id: "forest", name: "Forest", suits: "light" },
  { id: "peaks", name: "Alpine", suits: "light" },
  { id: "hills", name: "Hills", suits: "light" },
  { id: "lake", name: "Still lake", suits: "both" },
  { id: "city", name: "City dusk", suits: "dark" },
  { id: "aurora", name: "Aurora", suits: "dark" },
  { id: "clouds", name: "Overcast", suits: "light" },
  { id: "swell", name: "Swell", suits: "both" },
]);

const svg = (body, { width = 400, height = 250, tile = false } = {}) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"${
    tile ? "" : ' preserveAspectRatio="xMidYMid slice"'
  }>${body}</svg>`;

const rect = (fill, extra = "") => `<rect width="100%" height="100%" fill="${fill}"${extra}/>`;

function mix(first, second, amount) {
  const a = [1, 3, 5].map((i) => Number.parseInt(first.slice(i, i + 2), 16));
  const b = [1, 3, 5].map((i) => Number.parseInt(second.slice(i, i + 2), 16));
  return `#${a
    .map((value, i) =>
      Math.round(value * (1 - amount) + b[i] * amount)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

// Colours an SVG may use, all validated hex values from the theme.
function palette(tokens = {}) {
  const pick = (value, fallback) => hexColor(value) || fallback;
  const surface = pick(tokens.surface, "#1a1b1d");
  const accent = pick(tokens.accent, "#b299be");
  const line = pick(tokens["line-strong"], "#6e7175");
  const bg = pick(tokens.bg, "#121314");
  return {
    surface,
    bg,
    accent,
    line,
    soft: mix(surface, accent, 0.18),
    mid: mix(surface, accent, 0.45),
    deep: mix(bg, accent, 0.3),
    faint: mix(surface, line, 0.35),
  };
}

// Bold, full-bleed designs from the accent and the base.
const ABSTRACT_DRAW = {
  bands: (c) =>
    svg(
      rect(c.bg) +
        [0, 1, 2, 3, 4]
          .map(
            (i) =>
              `<path d="M${-60 + i * 110} 260 L${60 + i * 110} -10 L${150 + i * 110} -10 L${30 + i * 110} 260Z" fill="${mix(c.bg, c.accent, 0.12 + i * 0.1)}"/>`,
          )
          .join(""),
    ),
  shapes: (c) =>
    svg(
      rect(c.soft) +
        `<circle cx="300" cy="70" r="120" fill="${c.mid}"/><circle cx="90" cy="230" r="110" fill="${c.deep}"/><rect x="170" y="120" width="150" height="150" rx="28" fill="${mix(c.surface, c.accent, 0.3)}" transform="rotate(18 245 195)"/>`,
    ),
  stripes: (c) =>
    svg(
      rect(c.deep) +
        Array.from(
          { length: 12 },
          (_, i) =>
            `<path d="M${i * 48 - 120} 250 L${i * 48 + 30} 0" stroke="${i % 2 ? c.mid : c.soft}" stroke-width="20"/>`,
        ).join(""),
    ),
  arcs: (c) =>
    svg(
      rect(c.bg) +
        Array.from(
          { length: 7 },
          (_, i) =>
            `<circle cx="400" cy="250" r="${60 + i * 52}" fill="none" stroke="${mix(c.bg, c.accent, 0.15 + i * 0.09)}" stroke-width="26"/>`,
        ).join(""),
    ),
  blocks: (c) =>
    svg(
      rect(c.bg) +
        Array.from({ length: 40 }, (_, i) => {
          const x = (i % 8) * 50;
          const y = Math.floor(i / 8) * 50;
          const amount = ((i * 37) % 11) / 22 + 0.06;
          return `<rect x="${x + 3}" y="${y + 3}" width="44" height="44" rx="6" fill="${mix(c.bg, c.accent, amount)}"/>`;
        }).join(""),
    ),
  "two-tone": (c) => svg(rect(c.soft) + `<path d="M0 250 L400 40 L400 250Z" fill="${c.mid}"/>`),
};

// Quiet tiles that sit behind numbers.
const PATTERN_DRAW = {
  topography: (c) =>
    svg(
      rect(c.surface) +
        [0, 1, 2, 3, 4, 5]
          .map(
            (i) =>
              `<path d="M${-10} ${20 + i * 26} C 40 ${4 + i * 26}, 80 ${40 + i * 26}, 120 ${20 + i * 26} S 180 ${4 + i * 26}, 210 ${22 + i * 26}" fill="none" stroke="${c.faint}" stroke-width="1.2"/>`,
          )
          .join(""),
      { width: 200, height: 160, tile: true },
    ),
  dots: (c) =>
    svg(rect(c.surface) + `<circle cx="10" cy="10" r="1.6" fill="${c.faint}"/>`, { width: 20, height: 20, tile: true }),
  blueprint: (c) =>
    svg(
      rect(c.surface) +
        `<path d="M0 .5H80M.5 0V80" stroke="${c.faint}" stroke-width="1"/><path d="M0 20.5H80M0 40.5H80M0 60.5H80M20.5 0V80M40.5 0V80M60.5 0V80" stroke="${c.faint}" stroke-width=".5" opacity=".6"/>`,
      { width: 80, height: 80, tile: true },
    ),
  "fine-lines": (c) =>
    svg(rect(c.surface) + `<path d="M0 12L12 0M-3 3L3 -3M9 15L15 9" stroke="${c.faint}" stroke-width=".8"/>`, {
      width: 12,
      height: 12,
      tile: true,
    }),
  waves: (c) =>
    svg(rect(c.surface) + `<path d="M0 12 Q 15 2 30 12 T 60 12" fill="none" stroke="${c.faint}" stroke-width="1.2"/>`, {
      width: 60,
      height: 24,
      tile: true,
    }),
  rings: (c) =>
    svg(
      rect(c.surface) +
        `<circle cx="30" cy="30" r="22" fill="none" stroke="${c.faint}" stroke-width="1"/><circle cx="30" cy="30" r="12" fill="none" stroke="${c.faint}" stroke-width="1"/>`,
      { width: 60, height: 60, tile: true },
    ),
  grain: (c) =>
    svg(
      `<filter id="g"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .12 0"/></filter>` +
        rect(c.surface) +
        `<rect width="100%" height="100%" filter="url(#g)"/>`,
      { width: 160, height: 160, tile: true },
    ),
  fade: (c) =>
    svg(
      `<defs><linearGradient id="f" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c.surface}"/><stop offset="1" stop-color="${c.soft}"/></linearGradient></defs>` +
        `<rect width="100%" height="100%" fill="url(#f)"/>`,
    ),
  hexagons: (c) =>
    svg(
      rect(c.surface) +
        `<path d="M14 0L28 8V24L14 32L0 24V8Z M14 32V48" fill="none" stroke="${c.faint}" stroke-width="1"/>`,
      { width: 28, height: 48, tile: true },
    ),
  cubes: (c) =>
    svg(
      rect(c.surface) +
        `<path d="M20 0L40 11.5L20 23L0 11.5Z" fill="${mix(c.surface, c.line, 0.12)}"/><path d="M0 11.5L20 23V46L0 34.5Z" fill="${mix(c.surface, c.line, 0.22)}"/>`,
      { width: 40, height: 46, tile: true },
    ),
  circuit: (c) =>
    svg(
      rect(c.surface) +
        `<path d="M0 20H30V50H60M30 50V80M60 10V30H80" fill="none" stroke="${c.faint}" stroke-width="1"/><circle cx="30" cy="20" r="2.5" fill="${c.faint}"/><circle cx="60" cy="50" r="2.5" fill="${c.faint}"/><circle cx="60" cy="10" r="2.5" fill="${c.faint}"/>`,
      { width: 80, height: 80, tile: true },
    ),
  plus: (c) =>
    svg(rect(c.surface) + `<path d="M15 11V19M11 15H19" stroke="${c.faint}" stroke-width="1.2"/>`, {
      width: 30,
      height: 30,
      tile: true,
    }),
  chevron: (c) =>
    svg(rect(c.surface) + `<path d="M0 14L12 4L24 14" fill="none" stroke="${c.faint}" stroke-width="1.2"/>`, {
      width: 24,
      height: 18,
      tile: true,
    }),
  terrazzo: (c) =>
    svg(
      rect(c.surface) +
        [
          [14, 18, 5, c.soft],
          [62, 40, 3, c.faint],
          [96, 14, 4, c.mid],
          [40, 86, 6, c.faint],
          [104, 92, 3, c.soft],
          [76, 70, 2.5, c.mid],
          [20, 60, 2, c.mid],
        ]
          .map(
            ([x, y, r, fill]) =>
              `<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r * 0.7}" fill="${fill}" transform="rotate(${x % 60} ${x} ${y})"/>`,
          )
          .join(""),
      { width: 120, height: 120, tile: true },
    ),
};

export const ABSTRACT = Object.freeze([
  { id: "bands", name: "Bands" },
  { id: "shapes", name: "Shapes" },
  { id: "stripes", name: "Stripes" },
  { id: "arcs", name: "Arcs" },
  { id: "blocks", name: "Blocks" },
  { id: "two-tone", name: "Two-tone" },
]);

export const PATTERNS = Object.freeze([
  { id: "topography", name: "Topography" },
  { id: "dots", name: "Dot grid" },
  { id: "blueprint", name: "Blueprint" },
  { id: "fine-lines", name: "Fine lines" },
  { id: "waves", name: "Waves" },
  { id: "rings", name: "Rings" },
  { id: "grain", name: "Grain" },
  { id: "fade", name: "Soft fade" },
  { id: "hexagons", name: "Hexagons" },
  { id: "cubes", name: "Cubes" },
  { id: "circuit", name: "Circuit" },
  { id: "plus", name: "Plus grid" },
  { id: "chevron", name: "Chevron" },
  { id: "terrazzo", name: "Terrazzo" },
]);

export const BACKGROUND_FAMILIES = Object.freeze({ scene: SCENES, abstract: ABSTRACT, pattern: PATTERNS });

// Which family a built-in id belongs to, or null when it is unknown.
export function builtInFamily(id) {
  if (SCENES.some((scene) => scene.id === id)) return "scene";
  if (ABSTRACT.some((item) => item.id === id)) return "abstract";
  if (PATTERNS.some((item) => item.id === id)) return "pattern";
  return null;
}

export const scenePath = (id, thumb = false) => `/studio-backgrounds/${id}${thumb ? "-thumb" : ""}.webp`;

// An SVG drawn in the theme's colours, as a data URL.
export function themedSvg(id, tokens) {
  const draw = ABSTRACT_DRAW[id] || PATTERN_DRAW[id];
  if (!draw) return null;
  return `data:image/svg+xml,${encodeURIComponent(draw(palette(tokens)))}`;
}

// Whether a design repeats (patterns) or covers the area (everything else).
export const tiles = (id) => Boolean(PATTERN_DRAW[id]);
