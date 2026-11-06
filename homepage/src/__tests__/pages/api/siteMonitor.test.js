import { beforeEach, describe, expect, it, vi } from "vitest";

import createMockRes from "test-utils/create-mock-res";

const { getServiceItem, httpProxy, perf, logger } = vi.hoisted(() => ({
  getServiceItem: vi.fn(),
  httpProxy: vi.fn(),
  perf: { now: vi.fn() },
  logger: { debug: vi.fn() },
}));

vi.mock("perf_hooks", () => ({
  performance: perf,
}));

vi.mock("utils/config/service-helpers", () => ({
  getServiceItem,
}));

vi.mock("utils/proxy/http", () => ({
  httpProxy,
}));

vi.mock("utils/logger", () => ({
  default: () => logger,
}));

import handler from "pages/api/siteMonitor";

describe("pages/api/siteMonitor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when the service item is missing", async () => {
    getServiceItem.mockResolvedValueOnce(null);

    const req = { query: { groupName: "g", serviceName: "s" } };
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain("Unable to find service");
  });

  it("returns 400 when the monitor URL is missing", async () => {
    getServiceItem.mockResolvedValueOnce({ siteMonitor: "" });

    const req = { query: { groupName: "g", serviceName: "s" } };
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe("No http monitor URL given");
  });

  it("checks the service's own address only when Studio asks for the fallback", async () => {
    getServiceItem.mockResolvedValue({ siteMonitor: "", href: "https://app.example.com" });
    perf.now.mockReturnValueOnce(1).mockReturnValueOnce(6);
    httpProxy.mockResolvedValueOnce([200]);
    const res = createMockRes();
    await handler({ query: { groupName: "g", serviceName: "s", fallback: "1" } }, res);
    expect(httpProxy).toHaveBeenCalledWith("https://app.example.com", { method: "HEAD", cookieJar: false });
    expect(res.statusCode).toBe(200);

    const plain = createMockRes();
    await handler({ query: { groupName: "g", serviceName: "s" } }, plain);
    expect(plain.statusCode).toBe(400);

    getServiceItem.mockResolvedValue({ href: "javascript:alert(1)" });
    const unsafe = createMockRes();
    await handler({ query: { groupName: "g", serviceName: "s", fallback: "1" } }, unsafe);
    expect(unsafe.statusCode).toBe(400);
  });

  it("uses HEAD and returns status + latency when the response is OK", async () => {
    getServiceItem.mockResolvedValueOnce({ siteMonitor: "http://example.com" });
    perf.now.mockReturnValueOnce(1).mockReturnValueOnce(11);
    httpProxy.mockResolvedValueOnce([200]);

    const req = { query: { groupName: "g", serviceName: "s" } };
    const res = createMockRes();

    await handler(req, res);

    expect(httpProxy).toHaveBeenCalledWith("http://example.com", { method: "HEAD", cookieJar: false });
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe(200);
    expect(res.body.latency).toBe(10);
  });

  it("falls back to GET when HEAD is rejected", async () => {
    getServiceItem.mockResolvedValueOnce({ siteMonitor: "http://example.com" });
    perf.now.mockReturnValueOnce(1).mockReturnValueOnce(2).mockReturnValueOnce(5).mockReturnValueOnce(15);
    httpProxy.mockResolvedValueOnce([500]).mockResolvedValueOnce([200]);

    const req = { query: { groupName: "g", serviceName: "s" } };
    const res = createMockRes();

    await handler(req, res);

    expect(httpProxy).toHaveBeenNthCalledWith(1, "http://example.com", { method: "HEAD", cookieJar: false });
    expect(httpProxy).toHaveBeenNthCalledWith(2, "http://example.com", { cookieJar: false });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ status: 200, latency: 10 });
  });

  it("says nothing answered when the proxy could not reach the address", async () => {
    getServiceItem.mockResolvedValueOnce({ siteMonitor: "http://example.com" });
    perf.now.mockReturnValueOnce(1).mockReturnValueOnce(2).mockReturnValueOnce(5).mockReturnValueOnce(15);
    const unreachable = [500, "application/json", { error: { message: "getaddrinfo ENOTFOUND" } }, null];
    httpProxy.mockResolvedValueOnce(unreachable).mockResolvedValueOnce(unreachable);

    const res = createMockRes();
    await handler({ query: { groupName: "g", serviceName: "s" } }, res);

    expect(res.body).toEqual({ status: 500, latency: 10, reachable: false });
  });

  it("returns 400 when httpProxy throws", async () => {
    getServiceItem.mockResolvedValueOnce({ siteMonitor: "http://example.com" });
    httpProxy.mockRejectedValueOnce(new Error("nope"));

    const req = { query: { groupName: "g", serviceName: "s" } };
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain("Error attempting http monitor");
  });
});
