import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("utils/auth", () => ({ withAuth: (handler) => handler }));

import handler from "pages/api/studio/health";

function response() {
  return { setHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
}

afterEach(() => vi.unstubAllEnvs());

describe("controlled native renderer readiness identity", () => {
  it("reports the immutable worker identity and rejects forged request routing hints", () => {
    const id = "10d16ad0-34be-4cb8-a459-7365f2aaab71";
    vi.stubEnv("STUDIO_DASHBOARD_ID", id);
    vi.stubEnv("STUDIO_DASHBOARD_BASE_PATH", "/family");
    vi.stubEnv("STUDIO_RENDERER_INSTANCE", "fixture-worker-instance");
    vi.stubEnv("STUDIO_BUILD_REVISION", "fixture-revision");
    const res = response();
    handler(
      {
        method: "GET",
        headers: {
          "x-studio-dashboard-id": "default",
          "x-forwarded-prefix": "/other",
          referer: "https://home.test/other",
        },
      },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
    expect(res.json).toHaveBeenCalledWith({
      protocolVersion: 1,
      upstreamCommit: "51cc1684f9f34a7877ed462b8f94c9cc687b4dde",
      buildRevision: "fixture-revision",
      dashboardId: id,
      dashboardBasePath: "/family",
      rendererInstance: "fixture-worker-instance",
    });
  });

  it("rejects writes while allowing HEAD readiness probes", () => {
    const rejected = response();
    handler({ method: "POST" }, rejected);
    expect(rejected.status).toHaveBeenCalledWith(405);
    expect(rejected.setHeader).toHaveBeenCalledWith("Allow", "GET, HEAD");
    const head = response();
    handler({ method: "HEAD" }, head);
    expect(head.status).toHaveBeenCalledWith(200);
  });
});
