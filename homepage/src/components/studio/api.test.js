import { afterEach, describe, expect, it, vi } from "vitest";

import { deploymentRequest, studioRequest } from "./api.mjs";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("Studio request boundary", () => {
  it("scopes configuration calls to the rendered dashboard while registry calls stay at the deployment root", async () => {
    vi.stubEnv("STUDIO_DASHBOARD_BASE_PATH", "/family");
    const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ revision: "test" }) }));
    vi.stubGlobal("fetch", fetch);
    await studioRequest("/__studio/api/state");
    await studioRequest("/api/revalidate");
    await deploymentRequest("/__studio/api/dashboards");
    expect(fetch.mock.calls.map(([path]) => path)).toEqual([
      "/family/__studio/api/state",
      "/family/api/revalidate",
      "/__studio/api/dashboards",
    ]);
  });
  it("revalidates the native catalog while state and configuration requests bypass the cache", async () => {
    const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetch);
    await studioRequest("/__studio/catalog.json");
    await studioRequest("/__studio/api/state");
    await studioRequest("/__studio/api/board", { revision: "r", board: {} });
    expect(fetch.mock.calls.map(([, options]) => options.cache)).toEqual(["no-cache", "no-store", "no-store"]);
  });
  it("never converts non-finite configuration numbers to null in a save request", async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ revision: "saved" }),
    }));
    vi.stubGlobal("fetch", fetch);
    for (const number of [Infinity, -Infinity, NaN]) {
      const body = { patch: { native: [number] } };
      await expect(studioRequest("/__studio/api/settings", body)).rejects.toMatchObject({ status: 422 });
      expect(Object.is(body.patch.native[0], number)).toBe(true);
    }
    expect(fetch).not.toHaveBeenCalled();
    const body = { patch: { finite: 3.5, unset: null, text: ".inf" } };
    await studioRequest("/__studio/api/settings", body);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(body);
  });
  it("allows full archive JSON overhead only for the bounded dashboard import", async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ revision: "imported" }),
    }));
    vi.stubGlobal("fetch", fetch);
    const body = {
      revision: "target",
      archive: { files: { "custom.css": "\t".repeat(1500000) } },
    };
    await expect(studioRequest("/__studio/api/import", body)).resolves.toEqual({
      revision: "imported",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(studioRequest("/__studio/api/save", body)).rejects.toMatchObject({ status: 413 });
    await expect(
      studioRequest("/__studio/api/import", {
        archive: "x".repeat(40 * 1024 * 1024),
      }),
    ).rejects.toMatchObject({ status: 413 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("rejects oversized UTF-8 saves before sending and retains server conflict details", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(studioRequest("/__studio/api/save", { customCss: "界".repeat(700000) })).rejects.toMatchObject({
      status: 413,
    });
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: "Another editor saved", revision: "new" }),
    });
    await expect(studioRequest("/__studio/api/board", { revision: "old", board: {} })).rejects.toMatchObject({
      status: 409,
      details: { revision: "new" },
    });
    expect(fetch.mock.calls[0][1]).toMatchObject({
      credentials: "same-origin",
      cache: "no-store",
      method: "POST",
      headers: { "x-studio-request": "1" },
    });
  });
  it("reports unreadable responses without pretending a save succeeded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("HTML");
        },
      })),
    );
    await expect(studioRequest("/__studio/api/state")).rejects.toThrow(/unreadable response/);
  });
});
