import { afterEach, describe, expect, it, vi } from "vitest";

import { dashboardContext, dashboardFetch, dashboardPath, dashboardStorageKey } from "./dashboard-path.mjs";

const firstId = "10d16ad0-34be-4cb8-a459-7365f2aaab71";
const secondId = "20d16ad0-34be-4cb8-a459-7365f2aaab71";

function browserDashboard(id = firstId, basePath = "/family") {
  vi.stubGlobal("window", { location: new URL("https://home.test/unrelated?dashboard=someone-else") });
  vi.stubGlobal("document", {
    referrer: "https://home.test/another-dashboard",
    querySelector: (selector) => ({ content: selector.includes("studio-dashboard-id") ? id : basePath }),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("immutable dashboard request context", () => {
  it("uses explicit worker identity for SSR and early metadata for browser requests", () => {
    vi.stubEnv("STUDIO_DASHBOARD_ID", secondId);
    vi.stubEnv("STUDIO_DASHBOARD_BASE_PATH", "/work");
    expect(dashboardContext()).toEqual({ id: secondId, basePath: "/work" });
    browserDashboard();
    expect(dashboardContext()).toEqual({ id: firstId, basePath: "/family" });
    expect(dashboardPath("/api/services?group=same-label")).toBe("/family/api/services?group=same-label");
  });

  it("never infers a dashboard from window location, Referer, or an invalid identity", () => {
    browserDashboard("../../escape", "/../../other");
    expect(dashboardContext()).toEqual({ id: "default", basePath: "" });
    expect(dashboardStorageKey("theme-mode")).toBe("theme-mode");
    expect(dashboardPath("/api/services")).toBe("/api/services");
  });

  it("scopes only local paths once and preserves queries, fragments and explicit root context", () => {
    browserDashboard();
    for (const path of ["/family", "/family/", "/family?tab=one", "/family#tile", "/family/api/widgets"]) {
      expect(dashboardPath(path)).toBe(path);
    }
    expect(dashboardPath("/")).toBe("/family");
    expect(dashboardPath("/family-copy/api/widgets")).toBe("/family/family-copy/api/widgets");
    expect(dashboardPath("/api/widgets", "")).toBe("/api/widgets");
    expect(dashboardPath("/api/widgets", "/work")).toBe("/work/api/widgets");
    for (const path of ["https://outside.test/api/widgets", "//outside.test/path", "relative/path", "#section", null]) {
      expect(dashboardPath(path)).toBe(path);
    }
  });

  it("keeps the default's existing preferences and keys other dashboards by identity across renames", () => {
    expect(dashboardStorageKey("theme-mode", "default")).toBe("theme-mode");
    browserDashboard();
    const before = dashboardStorageKey("search-name");
    expect(before).toBe(`homepage-studio:${firstId}:search-name`);
    browserDashboard(firstId, "/renamed");
    expect(dashboardStorageKey("search-name")).toBe(before);
    browserDashboard(secondId, "/work");
    expect(dashboardStorageKey("search-name")).not.toBe(before);
  });

  it("scopes native fetch paths without changing arguments or external destinations", async () => {
    browserDashboard();
    const fetch = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("fetch", fetch);
    await dashboardFetch("/api/widgets");
    expect(fetch).toHaveBeenLastCalledWith("/family/api/widgets");
    const options = { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" };
    await dashboardFetch("/family/api/services/proxy?index=0", options);
    expect(fetch).toHaveBeenLastCalledWith("/family/api/services/proxy?index=0", options);
    await dashboardFetch("https://outside.test/api/data", options);
    expect(fetch).toHaveBeenLastCalledWith("https://outside.test/api/data", options);
    await dashboardFetch(new URL("https://home.test/api/widgets?x=1"));
    expect(String(fetch.mock.calls.at(-1)[0])).toBe("https://home.test/family/api/widgets?x=1");
  });

  it("preserves Request bodies, method, headers, credentials and abort behavior when scoping", async () => {
    browserDashboard();
    const fetch = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    const request = new Request("https://home.test/api/services/proxy", {
      method: "POST",
      body: "private-payload",
      headers: { "x-fixture": "preserved" },
      credentials: "include",
      signal: controller.signal,
    });
    await dashboardFetch(request);
    const scoped = fetch.mock.calls.at(-1)[0];
    expect(scoped).toBeInstanceOf(Request);
    expect(scoped.url).toBe("https://home.test/family/api/services/proxy");
    expect(scoped.method).toBe("POST");
    expect(scoped.headers.get("x-fixture")).toBe("preserved");
    expect(scoped.credentials).toBe("include");
    expect(await scoped.text()).toBe("private-payload");
    controller.abort();
    expect(scoped.signal.aborted).toBe(true);
  });
});
