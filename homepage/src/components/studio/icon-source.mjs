// Where icons come from, for the icon chooser and for cards.
// Built-in logos are the Dashboard Icons set (Apache-2.0); see
// scripts/icons/build-icon-index.py.
import { LIGHT_VARIANTS } from "./icon-variants.mjs";

// Offline copies (owner choice, 1 Nov 2026): every logo in the pinned set, as
// 128 px WebP served with the app (scripts/icons/build-icon-files.py), so
// logos show without reaching a CDN. A name outside the pinned set falls back
// to the project's CDN (resolvedicon.jsx).
export const BUILT_IN_ICON_BASE = "/studio-icons/webp";
export const BUILT_IN_ICON_CDN = "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons";

// Icon values that are not built-in logo names: icon sets with a prefix,
// addresses, and uploads.
const OTHER = /^(?:mdi-|si-|sh-|https?:|\/)/;
const BUILT_IN = /^([^/?#]{1,100}?)(?:\.(png|svg|webp))?$/;

// The logo name and format an icon value names, or null when it names
// something else.
export function builtInIcon(icon) {
  if (typeof icon !== "string" || OTHER.test(icon)) return null;
  const match = BUILT_IN.exec(icon);
  return match ? { name: match[1], format: match[2] || "png" } : null;
}

// A built-in logo's address: always the offline WebP copy, whatever format
// the value names. On dark themes the logo's light version is used where one
// exists.
export function builtInIconUrl(name, { dark = false } = {}) {
  const chosen = (dark && LIGHT_VARIANTS[name]) || name;
  return `${BUILT_IN_ICON_BASE}/${encodeURIComponent(chosen)}.webp`;
}

// The same logo from the project's CDN, for names newer than the pinned set.
export function builtInIconCdnUrl(name, { format = "webp" } = {}) {
  return `${BUILT_IN_ICON_CDN}/${format}/${encodeURIComponent(name)}.${format}`;
}

// How the chooser stores a built-in logo.
export const builtInIconValue = (name) => `${name}.webp`;

const ICON_SETS = {
  mdi: "https://cdn.jsdelivr.net/npm/@mdi/svg@latest/svg/",
  si: "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/",
};
// The address a browser tab can load for an icon value (settings.favicon):
// addresses as they are, uploads under the dashboard, logos from their set.
export function iconHref(icon, scope = (path) => path) {
  if (typeof icon !== "string" || !icon) return null;
  if (/^https?:/.test(icon)) return icon;
  if (icon.startsWith("/")) return scope(icon);
  const prefix = icon.split("-")[0];
  if (prefix === "sh") {
    const format = /\.(svg|webp)$/.exec(icon)?.[1] || "png";
    return `https://cdn.jsdelivr.net/gh/selfhst/icons@main/${format}/${encodeURIComponent(icon.slice(3).replace(/\.(svg|png|webp)$/, ""))}.${format}`;
  }
  if (ICON_SETS[prefix])
    return `${ICON_SETS[prefix]}${encodeURIComponent(icon.slice(prefix.length + 1).replace(/\.svg$/, ""))}.svg`;
  const builtIn = builtInIcon(icon);
  return builtIn ? builtInIconUrl(builtIn.name) : null;
}
