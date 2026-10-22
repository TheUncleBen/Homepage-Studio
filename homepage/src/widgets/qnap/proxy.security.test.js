import { once } from "node:events";
import http from "node:http";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import createMockRes from "test-utils/create-mock-res";

const { logger, getServiceWidget } = vi.hoisted(() => ({
  logger: { debug: vi.fn(), error: vi.fn() },
  getServiceWidget: vi.fn(),
}));
vi.mock("utils/logger", () => ({ default: () => logger }));
vi.mock("utils/config/service-helpers", () => ({ default: getServiceWidget }));

let server;
beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});
afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

describe("QNAP production proxy secret handling", () => {
  it("retains useful error status without logging session URLs or upstream response bodies", async () => {
    const seen = [];
    server = http.createServer(async (req, res) => {
      for await (const _chunk of req) {
        /* consume the synthetic login body */
      }
      seen.push(req.url);
      if (req.url === "/cgi-bin/authLogin.cgi") {
        res.writeHead(200, { "content-type": "application/xml" });
        res.end("<QDocRoot><authSid><![CDATA[PRIVATE_QNAP_SESSION_CANARY]]></authSid></QDocRoot>");
      } else {
        res.writeHead(502, { "content-type": "text/plain" });
        res.end("PRIVATE_UPSTREAM_BODY_CANARY");
      }
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    getServiceWidget.mockResolvedValue({
      url: `http://127.0.0.1:${server.address().port}`,
      username: "fixture",
      password: "PRIVATE_PASSWORD_CANARY",
    });
    const { default: handler } = await import("./proxy");
    const res = createMockRes();
    await handler({ query: { group: "Fixture", service: "NAS", index: "0" } }, res);
    expect(seen.some((url) => url.includes("sid=PRIVATE_QNAP_SESSION_CANARY"))).toBe(true);
    expect(res.statusCode).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain("PRIVATE_");
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("PRIVATE_");
    expect(JSON.stringify(logger.error.mock.calls)).toContain(`http://127.0.0.1:${server.address().port}`);
    expect(JSON.stringify(logger.error.mock.calls)).toContain("502");
  });
});
