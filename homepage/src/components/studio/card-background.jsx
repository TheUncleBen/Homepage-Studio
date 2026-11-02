import { useEffect, useId, useState } from "react";

import { contrastRatio } from "./appearance.mjs";
import { builtInFamily, scenePath, themedSvg, tiles } from "./backgrounds.mjs";
import { dashboardPath } from "./dashboard-path.mjs";

const FIXED_SHADE = { light: 0.35, medium: 0.55, strong: 0.75 };
const MINIMUM_SHADE = 0.2;

// Where a background's image comes from, or null when it can't be shown
// (an unknown built-in, or a library image that is gone).
export function backgroundSource(background, tokens) {
  if (!background?.id) return null;
  if (background.source === "builtin") {
    const family = builtInFamily(background.id);
    if (family === "scene") return { url: dashboardPath(scenePath(background.id)), raster: true, family };
    if (family) return { url: themedSvg(background.id, tokens), raster: false, family };
    return null;
  }
  if (background.source === "library")
    return {
      url: dashboardPath(`/studio/api/images/${encodeURIComponent(background.id)}`),
      raster: true,
      family: "upload",
    };
  return null;
}

const toHex = (r, g, b) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
const lightOrDark = new Map();

// The most demanding pixel for the theme's muted text: the brightest one on
// a dark theme, the darkest on a light one (95th percentile, so one stray
// pixel doesn't decide).
function readExtremes(url) {
  if (lightOrDark.has(url)) return lightOrDark.get(url);
  const promise = new Promise((resolve) => {
    if (typeof Image === "undefined" || typeof document === "undefined") return resolve(null);
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 48;
        canvas.height = 30;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        context.drawImage(image, 0, 0, 48, 30);
        const data = context.getImageData(0, 0, 48, 30).data;
        const pixels = [];
        for (let i = 0; i < data.length; i += 4) pixels.push([data[i], data[i + 1], data[i + 2]]);
        const light = (p) => p[0] * 0.2126 + p[1] * 0.7152 + p[2] * 0.0722;
        pixels.sort((a, b) => light(a) - light(b));
        const low = pixels[Math.floor(pixels.length * 0.05)];
        const high = pixels[Math.floor(pixels.length * 0.95)];
        resolve({ darkest: toHex(...low), brightest: toHex(...high) });
      } catch {
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = url;
  });
  lightOrDark.set(url, promise);
  return promise;
}

function blend(top, bottom, amount) {
  const a = [1, 3, 5].map((i) => Number.parseInt(top.slice(i, i + 2), 16));
  const b = [1, 3, 5].map((i) => Number.parseInt(bottom.slice(i, i + 2), 16));
  return toHex(...a.map((value, i) => Math.round(value * amount + b[i] * (1 - amount))));
}

// The least shade that keeps the theme's muted text at 4.5:1 over the most
// demanding part of the picture. Unknown pictures get a strong shade.
export function autoShade(extremes, tokens) {
  if (!extremes) return 0.7;
  const worst = tokens.mode === "light" ? extremes.darkest : extremes.brightest;
  for (let amount = 0; amount <= 0.95; amount += 0.05)
    if (contrastRatio(tokens.muted, blend(tokens.surface, worst, amount)) >= 4.5)
      return Math.max(amount, MINIMUM_SHADE);
  return 0.95;
}

function useExtremes(url, wanted) {
  const [state, setState] = useState({ url: null, value: null });
  useEffect(() => {
    if (!url || !wanted) return undefined;
    let live = true;
    readExtremes(url).then((value) => live && setState({ url, value }));
    return () => {
      live = false;
    };
  }, [url, wanted]);
  return state.url === url ? state.value : undefined;
}

// The duotone that "Match theme" paints a picture with: its darks become the
// page colour and its lights the accent (or the reverse on a light theme).
function Duotone({ id, tokens }) {
  const dark = tokens.mode === "light" ? tokens.accent : tokens.bg;
  const light = tokens.mode === "light" ? tokens.bg : tokens.accent;
  const channel = (hex, i) => Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: "absolute" }}>
      <filter id={id} colorInterpolationFilters="sRGB">
        <feColorMatrix
          type="matrix"
          values=".2126 .7152 .0722 0 0  .2126 .7152 .0722 0 0  .2126 .7152 .0722 0 0  0 0 0 1 0"
        />
        <feComponentTransfer>
          <feFuncR type="table" tableValues={`${channel(dark, 0)} ${channel(light, 0)}`} />
          <feFuncG type="table" tableValues={`${channel(dark, 1)} ${channel(light, 1)}`} />
          <feFuncB type="table" tableValues={`${channel(dark, 2)} ${channel(light, 2)}`} />
        </feComponentTransfer>
      </filter>
    </svg>
  );
}

// The picture or pattern behind a card or a page, with its shade.
export default function CardBackground({ background, tokens, className = "studio-card-bg" }) {
  const filterId = `studio-duotone-${useId().replace(/[^a-zA-Z0-9-]/g, "")}`;
  const source = backgroundSource(background, tokens);
  const shadeChoice = background?.shade || "auto";
  const extremes = useExtremes(source?.raster ? source.url : null, shadeChoice === "auto" && Boolean(source?.raster));
  if (!source?.url) return null;
  const tiled = (background.fit ?? (tiles(background.id) ? "tile" : "fill")) === "tile";
  const fit = background.fit === "fit" ? "contain" : tiled ? "auto" : "cover";
  const blur = Math.min(20, background.blur || 0);
  const match = Boolean(background.matchTheme) && source.raster;
  const shade =
    shadeChoice === "auto"
      ? source.raster
        ? extremes === undefined
          ? 0.7
          : autoShade(extremes, tokens)
        : source.family === "abstract"
          ? 0.5
          : 0.12
      : Math.max(FIXED_SHADE[shadeChoice] ?? 0.55, MINIMUM_SHADE);
  const filters = [match ? `url(#${filterId})` : "", blur ? `blur(${blur}px)` : ""].filter(Boolean).join(" ");
  return (
    <div className={className} aria-hidden="true" data-background-family={source.family}>
      {match && <Duotone id={filterId} tokens={tokens} />}
      <div
        className="studio-bg-image"
        style={{
          backgroundImage: `url("${source.url.replace(/"/g, "%22")}")`,
          backgroundSize: fit,
          backgroundRepeat: tiled ? "repeat" : "no-repeat",
          backgroundPosition: background.focus ? `${background.focus[0]}% ${background.focus[1]}%` : "center",
          filter: filters || undefined,
          inset: blur ? `-${blur * 2}px` : 0,
        }}
      />
      <div className="studio-bg-shade" style={{ background: tokens.surface, opacity: shade }} />
    </div>
  );
}
