import { once } from "node:events";
import http from "node:http";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { logger } = vi.hoisted(() => ({ logger: { debug: vi.fn(), error: vi.fn() } }));
vi.mock("utils/logger", () => ({ default: () => logger }));

let servers;
beforeEach(() => {
  servers = [];
  vi.clearAllMocks();
  vi.resetModules();
});
afterEach(async () => {
  await Promise.all(
    servers.map(async (server) => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }),
  );
});

async function serve(handler, host = "127.0.0.1") {
  const server = http.createServer(handler);
  servers.push(server);
  server.listen(0, host);
  await once(server, "listening");
  return `http://${host}:${server.address().port}`;
}
const headersResponse = (req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(req.headers));
};

describe("native HTTP proxy credential boundaries", () => {
  it("strips configured authentication headers on a cross-origin redirect through the real helper", async () => {
    const destination = await serve(headersResponse);
    const origin = await serve((_req, res) => {
      res.writeHead(302, { location: destination });
      res.end();
    });
    const { httpProxy } = await import("./http");
    const [status, , data] = await httpProxy(origin, {
      headers: {
        Authorization: "PRIVATE_AUTH",
        Cookie: "manual=PRIVATE_COOKIE",
        "X-API-Key": "PRIVATE_API_KEY",
        "X-Auth-Token": "PRIVATE_AUTH_TOKEN",
        "PRIVATE-TOKEN": "PRIVATE_TOKEN",
        Password: "PRIVATE_PASSWORD",
        "X-Custom-Integration-Secret": "PRIVATE_CUSTOM",
        Accept: "application/json",
        "User-Agent": "homepage",
      },
    });
    expect(status).toBe(200);
    const seen = JSON.parse(data);
    for (const name of [
      "authorization",
      "cookie",
      "x-api-key",
      "x-auth-token",
      "private-token",
      "password",
      "x-custom-integration-secret",
    ])
      expect(seen[name]).toBeUndefined();
    expect(seen.accept).toBe("application/json");
    expect(seen["user-agent"]).toBe("homepage");
  });

  it("retains deliberate credentials on a same-origin redirect", async () => {
    const origin = await serve((req, res) => {
      if (req.url === "/start") {
        res.writeHead(302, { location: "/finish" });
        res.end();
      } else headersResponse(req, res);
    });
    const { httpProxy } = await import("./http");
    const [status, , data] = await httpProxy(`${origin}/start`, {
      headers: { Authorization: "PRIVATE_AUTH", "X-API-Key": "PRIVATE_KEY", Cookie: "manual=PRIVATE_COOKIE" },
    });
    expect(status).toBe(200);
    expect(JSON.parse(data)).toMatchObject({
      authorization: "PRIVATE_AUTH",
      "x-api-key": "PRIVATE_KEY",
      cookie: "manual=PRIVATE_COOKIE",
    });
  });

  it("does not carry URL userinfo authentication to another origin", async () => {
    const destination = await serve(headersResponse);
    const origin = await serve((_req, res) => {
      res.writeHead(302, { location: destination });
      res.end();
    });
    const source = new URL(origin);
    source.username = "fixture";
    source.password = "PRIVATE_PASSWORD";
    const { httpProxy } = await import("./http");
    const [status, , data] = await httpProxy(source);
    expect(status).toBe(200);
    expect(JSON.parse(data).authorization).toBeUndefined();
  });

  it("stores source cookies and accepts destination cookies only on a direct request", async () => {
    const destination = await serve((req, res) => {
      res.setHeader("set-cookie", "destination=OWN_COOKIE; Path=/");
      headersResponse(req, res);
    }, "127.0.0.2");
    const origin = await serve((req, res) => {
      if (req.url === "/start") {
        res.writeHead(302, { location: destination, "set-cookie": "source=SOURCE_ONLY; Path=/; HttpOnly" });
        res.end();
      } else headersResponse(req, res);
    });
    const { httpProxy } = await import("./http");
    const [, , redirected] = await httpProxy(`${origin}/start`);
    expect(JSON.parse(redirected).cookie).toBeUndefined();
    const [, , sourceHeaders] = await httpProxy(`${origin}/check`);
    expect(JSON.parse(sourceHeaders).cookie).toBe("source=SOURCE_ONLY");
    const [, , firstDestinationHeaders] = await httpProxy(destination);
    expect(JSON.parse(firstDestinationHeaders).cookie).toBeUndefined();
    const [, , destinationHeaders] = await httpProxy(destination);
    expect(JSON.parse(destinationHeaders).cookie).toBe("destination=OWN_COOKIE");
  });

  it("does not re-add a source cookie through the jar after a same-host port change", async () => {
    const seen = [];
    const destination = await serve((req, res) => {
      seen.push(req.headers.cookie);
      if (req.url === "/start") {
        res.writeHead(302, { location: "/finish" });
        res.end();
      } else headersResponse(req, res);
    });
    const origin = await serve((_req, res) => {
      res.writeHead(302, { location: `${destination}/start`, "set-cookie": "source=PRIVATE_SOURCE_SESSION; Path=/" });
      res.end();
    });
    const { httpProxy } = await import("./http");
    const [status] = await httpProxy(origin);
    expect(status).toBe(200);
    expect(seen).toEqual([undefined, undefined]);
  });

  it.each(["final", "intermediate"])(
    "does not accept a foreign %s response overwriting the source session",
    async (stage) => {
      const destination = await serve((req, res) => {
        if (req.url !== "/finish") res.setHeader("set-cookie", "source=FOREIGN_REPLACEMENT; Path=/");
        if (stage === "intermediate" && req.url !== "/finish") {
          res.writeHead(302, { location: "/finish" });
          res.end();
          return;
        }
        res.end("redirect completed");
      });
      const origin = await serve((req, res) => {
        if (req.url === "/start") {
          res.writeHead(302, { location: destination, "set-cookie": "source=ORIGINAL_SESSION; Path=/" });
          res.end();
        } else headersResponse(req, res);
      });
      const { httpProxy } = await import("./http");
      await httpProxy(`${origin}/start`);
      const [, , data] = await httpProxy(`${origin}/check`);
      expect(JSON.parse(data).cookie).toBe("source=ORIGINAL_SESSION");
    },
  );

  it("does not replay an origin cookie outside its path on a same-origin redirect", async () => {
    const origin = await serve((req, res) => {
      if (req.url === "/private/start") {
        res.writeHead(302, { location: "/public/finish" });
        res.end();
      } else headersResponse(req, res);
    });
    const { addCookieToJar } = await import("./cookie-jar");
    addCookieToJar(`${origin}/private/start`, { "set-cookie": "restricted=PRIVATE_COOKIE; Path=/private" });
    const { httpProxy } = await import("./http");
    const [, , data] = await httpProxy(`${origin}/private/start`);
    expect(JSON.parse(data).cookie).toBeUndefined();
  });

  it.each(["POST", "GET"])(
    "does not replay a %s request body to another origin on a preserving redirect",
    async (method) => {
      let leakedRequests = 0;
      const destination = await serve((_req, res) => {
        leakedRequests++;
        res.end("unexpected");
      });
      const origin = await serve((_req, res) => {
        res.writeHead(307, { location: destination });
        res.end();
      });
      const { httpProxy } = await import("./http");
      const [status, , data] = await httpProxy(origin, {
        method,
        body: "username=fixture&password=PRIVATE_PASSWORD",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      expect(status).toBe(500);
      expect(leakedRequests).toBe(0);
      expect(JSON.stringify(data)).not.toContain("PRIVATE_PASSWORD");
      expect(JSON.stringify(logger.error.mock.calls)).not.toContain("PRIVATE_PASSWORD");
    },
  );

  it("retains login bodies on same-origin redirects and follows cross-origin GET rewrites without them", async () => {
    const destination = await serve(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      res.end(JSON.stringify({ method: req.method, body: Buffer.concat(chunks).toString(), headers: req.headers }));
    });
    const origin = await serve(async (req, res) => {
      if (req.url === "/start") {
        res.writeHead(307, { location: "/login" });
        res.end();
      } else if (req.url === "/external") {
        res.writeHead(303, { location: destination });
        res.end();
      } else {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        res.end(JSON.stringify({ method: req.method, body: Buffer.concat(chunks).toString(), headers: req.headers }));
      }
    });
    const { httpProxy } = await import("./http");
    const [, , local] = await httpProxy(`${origin}/start`, { method: "POST", body: "password=PRIVATE_PASSWORD" });
    expect(JSON.parse(local)).toMatchObject({ method: "POST", body: "password=PRIVATE_PASSWORD" });
    const [status, , external] = await httpProxy(`${origin}/external`, {
      method: "POST",
      body: "password=PRIVATE_PASSWORD",
    });
    expect(status).toBe(200);
    expect(JSON.parse(external)).toMatchObject({ method: "GET", body: "" });
  });

  it("does not expose a malformed redirect URL from a real transport error", async () => {
    const origin = await serve((_req, res) => {
      res.writeHead(302, { location: "http://[PRIVATE_REDIRECT_TOKEN" });
      res.end();
    });
    const { httpProxy } = await import("./http");
    const [status, , data] = await httpProxy(`${origin}/endpoint?sid=PRIVATE_SESSION_TOKEN`);
    expect(status).toBe(500);
    expect(JSON.stringify(data)).not.toContain("PRIVATE_");
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("PRIVATE_");
  });

  it("does not log a credential embedded in an integration path when the connection fails", async () => {
    const origin = await serve((req) => {
      req.socket.destroy();
    });
    const { httpProxy } = await import("./http");
    const [status, , data] = await httpProxy(`${origin}/api/PRIVATE_PATH_KEY/status?key=PRIVATE_QUERY_KEY`);
    expect(status).toBe(500);
    expect(JSON.stringify(data)).not.toContain("PRIVATE_");
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("PRIVATE_");
    expect(JSON.stringify(logger.error.mock.calls)).toContain(origin);
    expect(data.error.rawError.code).toBe("ECONNRESET");
  });

  it("keeps query credentials and arbitrary response bodies out of cache parse diagnostics", async () => {
    const origin = await serve((_req, res) => {
      res.end("PRIVATE_RESPONSE_CANARY");
    });
    const { cachedRequest } = await import("./http");
    expect(await cachedRequest(`${origin}/data?key=PRIVATE_QUERY_CANARY`)).toBe("PRIVATE_RESPONSE_CANARY");
    expect(JSON.stringify(logger.debug.mock.calls)).not.toContain("PRIVATE_");
  });
});
