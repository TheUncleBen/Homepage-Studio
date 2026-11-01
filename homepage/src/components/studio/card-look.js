import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { appearanceTokens, contrastRatio } from "./appearance.mjs";
import { fitColour, inheritedBehaviour, inheritedLook, readBehaviour, readLook } from "./look.mjs";
import useSystemTheme from "./use-system-theme";

import { SettingsContext } from "utils/contexts/settings";

// How the card being rendered arranges its values. Homepage's Container and
// Block read it; outside a Studio card it is null and they render as upstream.
export const CardLookContext = createContext(null);
// One value's place inside a card: hero, below or hidden, with its label and
// number style. Set by Container for each Block.
export const ValueSlotContext = createContext(null);

// The dashboard's widget defaults: look in settings.yaml studioTheme.card,
// behaviour in studioDefaults. A widget's own sparse keys win (Rule 2).
export function dashboardLook(settings) {
  return readLook(settings?.studioTheme?.card);
}
export function dashboardBehaviour(settings) {
  return readBehaviour(settings?.studioDefaults);
}
export function resolvedLook(settings, panel) {
  return inheritedLook(dashboardLook(settings), panel?.look);
}
export function resolvedBehaviour(settings, panel) {
  return inheritedBehaviour(dashboardBehaviour(settings), panel?.behaviour);
}

// The image an icon name loads, for reading its colour. Masked icon sets
// (mdi-, si-) take the theme colour, so they have none of their own.
export function iconImageUrl(icon) {
  if (typeof icon !== "string" || !icon) return null;
  if (/^https?:\/\//i.test(icon) || icon.startsWith("/")) return icon;
  const prefix = icon.split("-")[0];
  if (prefix === "mdi" || prefix === "si") return null;
  const extension = icon.endsWith(".svg") ? "svg" : icon.endsWith(".webp") ? "webp" : "png";
  if (prefix === "sh") {
    const name = icon.replace("sh-", "").replace(/\.(svg|png|webp)$/, "");
    return `https://cdn.jsdelivr.net/gh/selfhst/icons@main/${extension}/${name}.${extension}`;
  }
  const name = icon.replace(/\.(svg|png|webp)$/, "");
  return `https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/${extension}/${name}.${extension}`;
}

const logoColours = new Map();

// The most characteristic colour of a logo: opaque pixels, weighted toward
// saturated ones, so a white or grey outline doesn't win over the brand hue.
export function dominantColour(pixels) {
  const buckets = new Map();
  for (let index = 0; index < pixels.length; index += 4) {
    const [r, g, b, a] = [pixels[index], pixels[index + 1], pixels[index + 2], pixels[index + 3]];
    if (a < 160) continue;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturation = max === 0 ? 0 : (max - min) / max;
    const key = `${r >> 5},${g >> 5},${b >> 5}`;
    const weight = 0.15 + saturation * saturation * 2;
    const bucket = buckets.get(key) || { weight: 0, r: 0, g: 0, b: 0 };
    bucket.weight += weight;
    bucket.r += r * weight;
    bucket.g += g * weight;
    bucket.b += b * weight;
    buckets.set(key, bucket);
  }
  let best = null;
  for (const bucket of buckets.values()) if (!best || bucket.weight > best.weight) best = bucket;
  if (!best) return null;
  return `#${[best.r, best.g, best.b].map((value) => Math.round(value / best.weight).toString(16).padStart(2, "0")).join("")}`;
}

function readLogoColour(url) {
  if (logoColours.has(url)) return logoColours.get(url);
  const promise = new Promise((resolve) => {
    if (typeof Image === "undefined" || typeof document === "undefined") return resolve(null);
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 32;
        canvas.height = 32;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        context.drawImage(image, 0, 0, 32, 32);
        resolve(dominantColour(context.getImageData(0, 0, 32, 32).data));
      } catch {
        // A logo served without CORS can't be read; the accent stands in.
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = url;
  });
  logoColours.set(url, promise);
  return promise;
}

export function useLogoColour(icon, wanted) {
  const url = wanted ? iconImageUrl(icon) : null;
  const [colour, setColour] = useState({ url: null, value: null });
  useEffect(() => {
    if (!url) return undefined;
    let live = true;
    readLogoColour(url).then((value) => live && setColour({ url, value }));
    return () => {
      live = false;
    };
  }, [url]);
  return colour.url === url ? colour.value : null;
}

const TINT = { soft: 0.1, medium: 0.18, strong: 0.28 };

function mixHex(first, second, amount) {
  const a = [1, 3, 5].map((i) => Number.parseInt(first.slice(i, i + 2), 16));
  const b = [1, 3, 5].map((i) => Number.parseInt(second.slice(i, i + 2), 16));
  return `#${a.map((value, i) => Math.round(value * (1 - amount) + b[i] * amount).toString(16).padStart(2, "0")).join("")}`;
}

// The theme a card is fitted against, read from the dashboard's appearance.
export function useCardTheme() {
  const settings = useContext(SettingsContext)?.settings;
  const systemDark = useSystemTheme();
  return useMemo(() => {
    const { mode, tokens } = appearanceTokens(settings || {}, systemDark);
    return { mode, accent: tokens.accent, text: tokens.text, muted: tokens.muted, surface: tokens.surface, inkDark: "#141414" };
  }, [settings, systemDark]);
}

// Colours for a card's fill. Plain, picture and pattern keep the theme's own;
// tint washes the surface with the colour; solid fits the colour itself.
export function fillColours(look, logoColour, theme) {
  if (look.fill !== "tint" && look.fill !== "solid") return null;
  const source = look.colour && look.colour !== "logo" ? look.colour : logoColour || theme.accent;
  if (look.fill === "solid") {
    const fitted = fitColour(source, theme, look.strength);
    if (!fitted) return null;
    const muted = contrastRatio(mixHex(fitted.ink, fitted.fill, 0.3), fitted.fill) >= 4.5 ? mixHex(fitted.ink, fitted.fill, 0.3) : fitted.ink;
    return { fill: fitted.fill, ink: fitted.ink, muted, source };
  }
  const tone = fitColour(source, theme, "medium");
  if (!tone) return null;
  const fill = mixHex(theme.surface, tone.fill, TINT[look.strength] ?? TINT.medium);
  const ink = contrastRatio(theme.text, fill) >= 4.5 ? theme.text : tone.ink;
  const muted = contrastRatio(theme.muted, fill) >= 4.5 ? theme.muted : ink;
  return { fill, ink, muted, source };
}
