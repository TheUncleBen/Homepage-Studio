import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { connectionTest, connectionTestResult, TEST_GROUP } from "utils/config/connection-test.mjs";

const { serviceProxy } = vi.hoisted(() => ({ serviceProxy: vi.fn() }));
vi.mock("pages/api/services/proxy", () => ({ serviceProxy }));
const { httpProxy, probe } = vi.hoisted(() => ({ httpProxy: vi.fn(), probe: vi.fn() }));
vi.mock("utils/proxy/http", () => ({ httpProxy }));
vi.mock("ping", () => ({ promise: { probe } }));
vi.mock("widgets/widgets", () => ({
  default: {
    sonarr: {
      mappings: {
        queue: { endpoint: "queue", segments: ["id"] },
        status: { endpoint: "system/status" },
        add: { endpoint: "series", method: "POST" },
      },
    },
  },
}));

import handler, { firstEndpoint, statusCheck, withReferences } from "pages/api/studio/connection-test";
import { fromController } from "utils/studio/internal";

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

const TOKEN = "a".repeat(64);
const request = (body, headers = { "x-studio-internal": TOKEN }) => ({
  method: "POST",
  headers: { host: "localhost:3000", ...headers },
  body,
  cookies: {},
});

beforeEach(() => {
  vi.stubEnv("STUDIO_INTERNAL_TOKEN", TOKEN);
  serviceProxy.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("Test connection endpoint", () => {
  it("answers only the Studio controller", async () => {
    expect(fromController(TOKEN)).toBe(true);
    expect(fromController("b".repeat(64))).toBe(false);
    expect(fromController(undefined)).toBe(false);
    expect(fromController(TOKEN, "")).toBe(false);
    const res = createRes();
    await handler(request({ widget: { type: "sonarr" } }, {}), res);
    expect(res.statusCode).toBe(404);
    expect(serviceProxy).not.toHaveBeenCalled();
  });

  it("picks the widget's first plain read", () => {
    expect(firstEndpoint({ mappings: { a: { segments: ["x"] }, b: { endpoint: "b" } } })).toBe("b");
    expect(firstEndpoint({ mappings: { a: { method: "POST" } } })).toBeUndefined();
    expect(firstEndpoint({})).toBeUndefined();
  });

  it("runs the dialog's widget through the proxy and answers with a reason only", async () => {
    serviceProxy.mockImplementation(async (req, res) => {
      expect(req.query).toEqual({ group: TEST_GROUP, service: "Test", index: "-1", endpoint: "status" });
      expect(connectionTest.getStore().widget).toEqual({ type: "sonarr", url: "https://tv.example.org", key: "k" });
      res.status(200).send({ version: "4", secret: "never shown" });
    });
    const res = createRes();
    await handler(request({ widget: { type: "sonarr", url: "https://tv.example.org", key: "k" } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, kind: "ok", message: expect.stringMatching(/^Connected in \d+ ms\.$/) });
  });

  it("fills in Docker-secret and variable references like the real widget (owner T8, 6 Nov)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "studio-test-"));
    const secret = join(dir, "netbird_key");
    writeFileSync(secret, "s3cret-from-file\n");
    vi.stubEnv("HOMEPAGE_FILE_TEST_NETBIRD_KEY", secret);
    vi.stubEnv("HOMEPAGE_VAR_TEST_NETBIRD_HOST", "vpn.example.org");
    serviceProxy.mockImplementation(async (req, res) => {
      expect(connectionTest.getStore().widget).toEqual({
        type: "sonarr",
        url: "https://vpn.example.org",
        key: "s3cret-from-file",
        fields: ["online"],
      });
      res.status(200).send({});
    });
    const res = createRes();
    await handler(
      request({
        widget: {
          type: "sonarr",
          url: "https://{{HOMEPAGE_VAR_TEST_NETBIRD_HOST}}",
          key: "{{HOMEPAGE_FILE_TEST_NETBIRD_KEY}}",
          fields: ["online"],
        },
      }),
      res,
    );
    expect(serviceProxy).toHaveBeenCalledOnce();
    expect(res.body.ok).toBe(true);
    expect(withReferences({ plain: "no {braces}", n: 3 })).toEqual({ plain: "no {braces}", n: 3 });
  });

  it("refuses an unknown widget type", async () => {
    const res = createRes();
    await handler(request({ widget: { type: "nope" } }), res);
    expect(res.statusCode).toBe(400);
  });
});

describe("Test connection results", () => {
  const transport = (code) => ({ status: 500, body: { error: { data: { error: { rawError: { code } } } } }, ms: 5 });

  it("names what went wrong in plain words", () => {
    expect(connectionTestResult(transport("ENOTFOUND")).message).toMatch(/can't find that host/);
    expect(connectionTestResult(transport("ECONNREFUSED")).message).toMatch(/Nothing answered/);
    expect(connectionTestResult(transport("ETIMEDOUT")).message).toMatch(/in time/);
    expect(connectionTestResult(transport("DEPTH_ZERO_SELF_SIGNED_CERT")).kind).toBe("certificate");
    expect(connectionTestResult(transport("SOMETHING_ELSE")).kind).toBe("unreachable");
    expect(connectionTestResult({ status: 401, body: { error: "x" } }).kind).toBe("key");
    expect(connectionTestResult({ status: 403, body: {} }).kind).toBe("permission");
    expect(connectionTestResult({ status: 404, body: {} }).kind).toBe("address");
    expect(connectionTestResult({ status: 502, body: {} }).message).toMatch(/\(502\)/);
    // The widget's handler couldn't read the answer: not the service's fault.
    expect(connectionTestResult({ status: 500, body: { error: "Unexpected error" } }).message).toMatch(
      /answered, but not in the way this widget expects/,
    );
    expect(connectionTestResult({ status: 400, body: { error: { code: "WIDGET_NOT_SET_UP" } } }).message).toBe(
      "Add the service address first.",
    );
    expect(connectionTestResult({ status: 200, body: { ok: 1 }, ms: 0.2 }).message).toBe("Connected in 1 ms.");
  });
});

describe("Check now (status address before saving)", () => {
  beforeEach(() => {
    httpProxy.mockReset();
    probe.mockReset();
  });

  it("answers up with the time, retrying a refused HEAD as GET like the card", async () => {
    httpProxy.mockResolvedValueOnce([405, null, null, {}]).mockResolvedValueOnce([200, null, null, {}]);
    const answer = await statusCheck({ check: "web", address: "https://health.example.org/ping" });
    expect(httpProxy).toHaveBeenCalledTimes(2);
    expect(answer.ok).toBe(true);
    expect(answer.message).toMatch(/^Up · (<1|\d+) ms$/);
  });

  it("says down with the answer, or no answer", async () => {
    httpProxy.mockResolvedValue([503, null, null, {}]);
    expect((await statusCheck({ check: "web", address: "https://a.example.org" })).message).toBe("Down · answered 503");
    httpProxy.mockResolvedValue([500, null, null, null]);
    expect((await statusCheck({ check: "web", address: "https://a.example.org" })).message).toBe("Down · no answer");
  });

  it("checks the certificate unless the service opts out, and names a certificate failure (owner decision D1)", async () => {
    httpProxy.mockResolvedValue([200, null, null, {}]);
    await statusCheck({ check: "web", address: "https://a.example.org" });
    expect(httpProxy).toHaveBeenLastCalledWith("https://a.example.org/", {
      method: "HEAD",
      cookieJar: false,
      checkCertificate: true,
    });
    await statusCheck({ check: "web", address: "https://a.example.org", skipCertificateCheck: true });
    expect(httpProxy).toHaveBeenLastCalledWith("https://a.example.org/", {
      method: "HEAD",
      cookieJar: false,
      checkCertificate: false,
    });
    httpProxy.mockResolvedValue([
      500,
      null,
      { error: { message: "self-signed", rawError: { code: "DEPTH_ZERO_SELF_SIGNED_CERT" } } },
      null,
    ]);
    const answer = await statusCheck({ check: "web", address: "https://a.example.org" });
    expect(answer).toMatchObject({ ok: false, kind: "certificate" });
  });

  it("runs the widget test with the certificate check the dialog asks for", async () => {
    const seen = [];
    serviceProxy.mockImplementation(async (req, res) => {
      const { checksCertificate } = await import("utils/proxy/certificate-check.mjs");
      seen.push(checksCertificate());
      res.status(200).send({ ok: 1 });
    });
    await handler(request({ widget: { type: "sonarr", url: "https://tv.example.org", key: "k" } }), createRes());
    await handler(
      request({ widget: { type: "sonarr", url: "https://tv.example.org", key: "k" }, skipCertificateCheck: true }),
      createRes(),
    );
    expect(seen).toEqual([true, false]);
  });

  it("pings the host of an address", async () => {
    probe.mockResolvedValue({ alive: true, time: 0.3 });
    expect((await statusCheck({ check: "ping", address: "https://nas.example.org:5001" })).message).toBe("Up · <1 ms");
    expect(probe).toHaveBeenCalledWith("nas.example.org");
  });

  it("never pings a host that would read as an option", async () => {
    for (const address of ["-c999", "-f"]) expect((await statusCheck({ check: "ping", address })).kind).toBe("address");
    expect(probe).not.toHaveBeenCalled();
  });

  it("refuses addresses it shouldn't check", async () => {
    for (const address of ["ftp://x.example.org", "https://user:pw@x.example.org", "not an address"])
      expect((await statusCheck({ check: "web", address })).kind).toBe("address");
    expect((await statusCheck({ check: "web", address: "https://x.example.org/{{HOMEPAGE_FILE_KEY}}" })).kind).toBe(
      "address",
    );
    expect(httpProxy).not.toHaveBeenCalled();
  });
});
