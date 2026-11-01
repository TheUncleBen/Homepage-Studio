import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";
import { parse } from "yaml";

import { resolveServiceConnections, resolveWidgetConnection } from "./studio-connections.mjs";

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
  const url = `{{STUDIO_CONNECTION_${ID}_URL}}`;
  const key = `{{STUDIO_CONNECTION_${ID}_KEY}}`;

  it("fills in a widget's address and key, as loaded from services.yaml", () => {
    const yaml = [
      "- Media:",
      "    - Radarr:",
      `        description: "${key}"`,
      "        widget:",
      "          type: radarr",
      `          url: "${url}"`,
      `          key: "${key}"`,
      "    - Nested:",
      "        - Sonarr:",
      "            widgets:",
      "              - type: sonarr",
      `                key: '${key}'`,
    ].join("\n");
    const groups = resolveServiceConnections(parse(yaml), file);
    const radarr = groups[0].Media[0].Radarr;
    expect(radarr.widget.url).toBe("https://media.example.org");
    expect(radarr.widget.key).toBe("k\"e\\y'1");
    // Outside the widget, a placeholder stays as typed.
    expect(radarr.description).toBe(key);
    expect(groups[0].Media[1].Nested[0].Sonarr.widgets[0].key).toBe("k\"e\\y'1");
  });

  it("fills in only the field a placeholder belongs to, and only as its whole value", () => {
    const widget = resolveWidgetConnection(
      { type: "customapi", url: key, password: key, title: key, key: `x ${key}`, mappings: [{ label: key }] },
      file,
    );
    expect(widget).toEqual({
      type: "customapi",
      url: key,
      password: key,
      title: key,
      key: `x ${key}`,
      mappings: [{ label: key }],
    });
  });

  it("leaves unknown connections alone and does nothing without the file", () => {
    const unknown = {
      url: "{{STUDIO_CONNECTION_FFFFFFFFFFFFFFFF_URL}}",
      username: `{{STUDIO_CONNECTION_${ID}_USERNAME}}`,
    };
    expect(resolveWidgetConnection(unknown, file)).toEqual(unknown);
    expect(resolveWidgetConnection({ url }, undefined)).toEqual({ url });
  });
});
