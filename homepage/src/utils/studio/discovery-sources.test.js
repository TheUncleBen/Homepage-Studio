import { describe, expect, it, vi } from "vitest";

import {
  buildDiscoveredSources,
  discoverySourcesResponse,
} from "./discovery-sources";

const helpers = vi.hoisted(() => ({
  servicesFromConfig: vi.fn(async () => []),
  servicesFromDocker: vi.fn(async () => []),
  servicesFromKubernetes: vi.fn(async () => []),
}));
vi.mock("utils/config/service-helpers", () => helpers);
const group = (services, name = "Media") => [{ name, services, groups: [] }];
const service = () => ({
  name: "Library",
  container: "library-container",
  server: "local",
  href: "http://private.invalid",
  widgets: [
    {
      type: "sonarr",
      key: "private-array-token",
      url: "http://private-array.invalid",
    },
  ],
  widget: {
    type: "radarr",
    key: "private-singular-token",
    url: "http://private-singular.invalid",
  },
});

describe("Native discovery metadata bridge", () => {
  it("emits only bounded safe identities and correctly separates native render/proxy indices", () => {
    const manifest = buildDiscoveredSources({ docker: group([service()]) });
    expect(manifest.protocolVersion).toBe(1);
    expect(manifest.sources).toHaveLength(3);
    const [parent, plural, singular] = manifest.sources;
    expect(parent.id).toMatch(/^discovered-service-[a-f0-9]{32}$/);
    expect(plural.id).toMatch(/^discovered-widget-[a-f0-9]{32}$/);
    expect(plural.nativeLocator).toMatchObject({
      sourceKey: "widgets",
      sourceIndex: 0,
      proxyIndex: 0,
      widgetIndex: 0,
      serviceId: parent.id,
      origin: "docker",
    });
    expect(singular.nativeLocator).toMatchObject({
      sourceKey: "widget",
      sourceIndex: 0,
      proxyIndex: -1,
      widgetIndex: 1,
      type: "radarr",
    });
    expect(JSON.stringify(manifest)).not.toMatch(
      /private-|library-container|\.invalid|"url"|"key"|"href"/,
    );
  });
  it("keeps widget identity across a reorder of different native types, while updating routing indices", () => {
    const first = service();
    first.widgets.push({ type: "jellyfin" });
    const before = buildDiscoveredSources({ docker: group([first]) });
    const after = buildDiscoveredSources({
      docker: group([{ ...first, widgets: [...first.widgets].reverse() }]),
    });
    const pick = (manifest) =>
      manifest.sources.find((entry) => entry.nativeLocator.type === "sonarr");
    expect(pick(after).id).toBe(pick(before).id);
    expect(pick(after).nativeLocator.proxyIndex).toBe(1);
  });
  it("suppresses all ambiguous native group/name routes including static shadows and nested paths", () => {
    expect(
      buildDiscoveredSources({
        docker: group([service()]),
        configured: [
          {
            name: "Root",
            services: [],
            groups: group([{ name: "Library", id: "static" }]),
          },
        ],
      }),
    ).toMatchObject({
      sources: [],
      warnings: [{ code: "AMBIGUOUS_NATIVE_SOURCE", count: 1 }],
    });
    expect(
      buildDiscoveredSources({
        docker: group([service()]),
        kubernetes: group([{ name: "Library", id: "a-different-id" }]),
      }),
    ).toMatchObject({
      sources: [],
      warnings: [{ code: "AMBIGUOUS_NATIVE_SOURCE", count: 2 }],
    });
  });
  it("gives repeated types separate identities and reports the positional identity limitation", () => {
    const repeated = service();
    repeated.widgets.push({ type: "sonarr" });
    const manifest = buildDiscoveredSources({ docker: group([repeated]) });
    expect(new Set(manifest.sources.map((entry) => entry.id)).size).toBe(4);
    expect(manifest.warnings).toEqual([
      { code: "POSITIONAL_WIDGET_IDENTITY", count: 1 },
    ]);
  });
  it("rejects control characters and invalid names and caps warning counts safely", () => {
    const bad = Array.from({ length: 5000 }, () => ({ name: "\u007f" }));
    expect(buildDiscoveredSources({ docker: group(bad) })).toMatchObject({
      sources: [],
      warnings: [{ code: "INVALID_NATIVE_SOURCE", count: 4096 }],
    });
    const long = { name: "S".repeat(256), widget: { type: "T".repeat(256) } };
    expect(
      buildDiscoveredSources({ docker: group([long]) }).sources[1].title.length,
    ).toBe(512);
  });
  it("uses the existing native discovery helpers and propagates outages instead of silently emptying sources", async () => {
    helpers.servicesFromDocker.mockResolvedValueOnce(group([service()]));
    expect((await discoverySourcesResponse()).sources).toHaveLength(3);
    helpers.servicesFromKubernetes.mockRejectedValueOnce(
      new Error("fixture offline"),
    );
    await expect(discoverySourcesResponse()).rejects.toThrow("fixture offline");
  });
});
