import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";
import { parse } from "yaml";

import { resolveStudioConnections } from "./studio-connections.mjs";

const dir = mkdtempSync(join(tmpdir(), "studio-connections-"));
const file = join(dir, "studio-connections.json");
const ID = "0123456789ABCDEF";
writeFileSync(
  file,
  JSON.stringify({
    version: 1,
    connections: [{ id: ID, name: "Media", url: "https://media.example.org", secrets: { key: "k\"e\\y'1" } }],
  }),
);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("saved connections in widget settings", () => {
  it("fills in the address and key, escaped for the quotes around them", () => {
    const yaml = [
      "- Media:",
      "    - Radarr:",
      "        widget:",
      "          type: radarr",
      `          url: "{{STUDIO_CONNECTION_${ID}_URL}}"`,
      `          key: "{{STUDIO_CONNECTION_${ID}_KEY}}"`,
      `          password: '{{STUDIO_CONNECTION_${ID}_KEY}}'`,
    ].join("\n");
    const widget = parse(resolveStudioConnections(yaml, file))[0].Media[0].Radarr.widget;
    expect(widget.url).toBe("https://media.example.org");
    expect(widget.key).toBe("k\"e\\y'1");
    expect(widget.password).toBe("k\"e\\y'1");
  });

  it("leaves unknown connections, empty fields and other text alone", () => {
    const text = `key: "{{STUDIO_CONNECTION_FFFFFFFFFFFFFFFF_KEY}}" user: "{{STUDIO_CONNECTION_${ID}_USERNAME}}"`;
    expect(resolveStudioConnections(text, file)).toBe(text);
    expect(resolveStudioConnections("plain: text", file)).toBe("plain: text");
    expect(resolveStudioConnections(text, undefined)).toBe(text);
  });
});
