import { beforeEach, describe, expect, it, vi } from "vitest";

const { serviceProxy, resolveNativePanel } = vi.hoisted(() => ({ serviceProxy: vi.fn(), resolveNativePanel: vi.fn() }));
vi.mock("pages/api/services/proxy", () => ({ serviceProxy }));
vi.mock("components/studio/native-adapter.mjs", () => ({ resolveNativePanel }));
vi.mock("utils/config/api-response", () => ({ servicesResponse: async () => [] }));
// The real translation hook, so the collector's own translator is used.
vi.unmock("next-i18next/pages");

import handler, { collectPanels, proxied } from "pages/api/studio/collect";

function createRes() {
  const res = { statusCode: 200 };
  res.status = vi.fn((code) => {
    res.statusCode = code;
    return res;
  });
  res.json = vi.fn((body) => {
    res.body = body;
    return res;
  });
  res.end = vi.fn(() => res);
  return res;
}

const TOKEN = "c".repeat(64);
const request = (body, headers = { "x-studio-internal": TOKEN }) => ({
  method: "POST",
  headers: { host: "localhost:3000", ...headers },
  body,
  cookies: {},
});
const PIHOLE = {
  dns_queries_today: 84210,
  ads_blocked_today: 18021,
  ads_percentage_today: 21.4,
  domains_being_blocked: 1,
};

beforeEach(() => {
  vi.stubEnv("STUDIO_INTERNAL_TOKEN", TOKEN);
  serviceProxy.mockReset();
  resolveNativePanel.mockReset();
});

describe("chart history collection endpoint", () => {
  it("answers only the Studio controller, with a list of panels", async () => {
    let res = createRes();
    await handler(request({ panels: [] }, {}), res);
    expect(res.statusCode).toBe(404);
    res = createRes();
    await handler(request({ panels: [{ id: 1 }] }), res);
    expect(res.statusCode).toBe(400);
    res = createRes();
    await handler(
      request({ panels: Array.from({ length: 201 }, (_, i) => ({ id: `p${i}`, nativeLocator: {} })) }),
      res,
    );
    expect(res.statusCode).toBe(400);
    res = createRes();
    await handler(request({ panels: [] }), res);
    expect(res.body).toEqual({ results: {} });
  });

  it("collects a widget's values through the normal proxy and skips the rest", async () => {
    resolveNativePanel.mockImplementation((panel) =>
      panel.id === "pihole"
        ? {
            service: { name: "Pi-hole" },
            widget: { type: "pihole", service_name: "Pi-hole", service_group: "Network" },
          }
        : panel.id === "odd"
          ? { service: {}, widget: { type: "not-a-widget" } }
          : null,
    );
    serviceProxy.mockImplementation(async (req, res) => res.status(200).json(PIHOLE));
    const results = await collectPanels(
      [
        { id: "pihole", kind: "serviceWidget", nativeLocator: {} },
        { id: "odd", kind: "serviceWidget", nativeLocator: {} },
        { id: "link", kind: "service", nativeLocator: {} },
      ],
      { services: [] },
    );
    expect(results.pihole.values.map((value) => [value.field, value.value])).toEqual([
      ["pihole.queries", 84210],
      ["pihole.blocked", 18021],
      ["pihole.gravity", 1],
    ]);
    expect(serviceProxy.mock.calls[0][0].query).toMatchObject({ service: "Pi-hole", group: "Network" });
    expect(results.odd).toEqual({ error: "unavailable" });
    expect(results.link).toEqual({ error: "unavailable" });
  });

  it("runs only proxy requests, with or without the dashboard's path, and treats errors as failures", async () => {
    serviceProxy.mockImplementation(async (req, res) => res.status(200).send(Buffer.from('{"ok":1}')));
    await expect(proxied("/home/api/services/proxy?service=a&group=b")).resolves.toEqual({ ok: 1 });
    await expect(proxied("/api/services/proxy?service=a&group=b")).resolves.toEqual({ ok: 1 });
    await expect(proxied("/api/studio/state")).rejects.toThrow(/Only proxied/);
    serviceProxy.mockImplementation(async (req, res) => res.status(500).json({ error: "x" }));
    await expect(proxied("/api/services/proxy?service=a&group=b")).rejects.toThrow();
  });
});
