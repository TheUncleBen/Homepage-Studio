// @vitest-environment node

import { readFileSync } from "fs";
import { join } from "path";

import { describe, expect, it } from "vitest";

// The chart collector's loaders must cover exactly the widgets the dashboard
// shows, each loading the same component file.
const entries = (file, pattern) =>
  Object.fromEntries([...readFileSync(join(__dirname, file), "utf8").matchAll(pattern)].map((m) => [m[1], m[2]]));

describe("widgets/loaders", () => {
  it("lists the same widgets and component files as components.js", () => {
    const shown = entries("components.js", /^\s*"?([\w-]+)"?: dynamic\(\(\) => import\("([^"]+)"\)\)/gm);
    const loaded = entries("loaders.js", /^\s*"?([\w-]+)"?: \(\) => import\("([^"]+)"\)/gm);
    expect(Object.keys(shown).length).toBeGreaterThan(100);
    expect(loaded).toEqual(shown);
  });
});
