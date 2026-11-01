// Where icons come from, for the icon chooser and for cards.
// Built-in logos are the Dashboard Icons set (Apache-2.0); see
// scripts/icons/build-icon-index.py.
import { LIGHT_VARIANTS } from "./icon-variants.mjs";

export const BUILT_IN_ICON_BASE = "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons";

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

// A built-in logo's address. On dark themes the logo's light version is used
// where one exists.
export function builtInIconUrl(name, { dark = false, format = "webp" } = {}) {
  const chosen = (dark && LIGHT_VARIANTS[name]) || name;
  return `${BUILT_IN_ICON_BASE}/${format}/${encodeURIComponent(chosen)}.${format}`;
}

// How the chooser stores a built-in logo.
export const builtInIconValue = (name) => `${name}.webp`;
