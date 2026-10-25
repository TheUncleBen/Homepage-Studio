import { readFileSync } from "fs";

import { applyPlatformDefaults } from "components/studio/appearance.mjs";

export { applyPlatformDefaults };

// The platform default look from Administration → Appearance
// (server/platform.mjs), merged into each dashboard's settings where the
// dashboard hasn't set its own value.
export function readPlatformDefaults(file = process.env.STUDIO_PLATFORM_FILE) {
  if (!file) return null;
  try {
    const value = JSON.parse(readFileSync(file, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
