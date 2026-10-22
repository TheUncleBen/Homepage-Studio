import { once } from "node:events";
import http from "node:http";
import { deflateSync, gzipSync } from "node:zlib";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { logger } = vi.hoisted(() => ({ logger: { debug: vi.fn(), error: vi.fn() } }));
vi.mock("utils/logger", () => ({ default: () => logger }));

const RESPONSE_LIMIT = 32 * 1024 * 1024;
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

async function serve(handler) {
  const server = http.createServer(handler);
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${server.address().port}`;
}

function observeClose() {
  let finish;
  const closed = new Promise((resolve) => {
    finish = resolve;
  });
  return {
    watch: (req) => req.socket.once("close", finish),
    wait: async () => {
      let timer;
      try {
        await Promise.race([
          closed,
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error("upstream socket did not close")), 1500);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

describe("native HTTP proxy resource bounds", () => {
  it("ends a stalled request within its total deadline and closes the upstream socket", async () => {
    const peer = observeClose();
    const origin = await serve((req) => {
      peer.watch(req);
    });
    const { httpProxy } = await import("./http");
    const [status, , data] = await httpProxy(origin, { timeout: 100 });
    expect(status).toBe(500);
    expect(data.error.rawError.code).toBe("ETIMEDOUT");
    await peer.wait();
  });

  it("keeps an absolute deadline through redirects and continually arriving response chunks", async () => {
    const peer = observeClose();
    let redirects = 0;
    let chunks = 0;
    const origin = await serve((req, res) => {
      if (req.url === "/start") {
        redirects++;
        res.writeHead(302, { location: "/stream" });
        res.end();
        return;
      }
      peer.watch(req);
      res.writeHead(200, { "content-type": "application/json" });
      const interval = setInterval(() => {
        chunks++;
        res.write(" ");
      }, 10);
      res.once("close", () => clearInterval(interval));
    });
    const { httpProxy } = await import("./http");
    const started = Date.now();
    const [status, , data] = await httpProxy(`${origin}/start`, { timeout: 150 });
    expect(status).toBe(500);
    expect(data.error.rawError.code).toBe("ETIMEDOUT");
    expect(redirects).toBe(1);
    expect(chunks).toBeGreaterThan(1);
    expect(Date.now() - started).toBeLessThan(1500);
    await peer.wait();
  });

  it("bounds chunked wire responses even without a content-length", async () => {
    const peer = observeClose();
    const chunk = Buffer.alloc(64 * 1024);
    const origin = await serve((req, res) => {
      peer.watch(req);
      res.writeHead(200, { "content-type": "application/octet-stream" });
      const write = () => {
        while (!res.destroyed) {
          if (!res.write(chunk)) {
            res.once("drain", write);
            return;
          }
        }
      };
      write();
    });
    const { httpProxy } = await import("./http");
    const [status, , data] = await httpProxy(origin);
    expect(status).toBe(500);
    expect(data.error.rawError.code).toBe("ERR_RESPONSE_WIRE_TOO_LARGE");
    await peer.wait();
  });

  it("rejects an oversized declared response before waiting for its body", async () => {
    const peer = observeClose();
    const origin = await serve((req, res) => {
      peer.watch(req);
      res.writeHead(200, { "content-length": RESPONSE_LIMIT + 1 });
      res.flushHeaders();
    });
    const { httpProxy } = await import("./http");
    const [status, , data] = await httpProxy(origin);
    expect(status).toBe(500);
    expect(data.error.rawError.code).toBe("ERR_RESPONSE_WIRE_TOO_LARGE");
    await peer.wait();
  });

  it("bounds decoded gzip bytes independently of the small wire representation", async () => {
    const peer = observeClose();
    const compressed = gzipSync(Buffer.alloc(RESPONSE_LIMIT + 1, "a"));
    expect(compressed.length).toBeLessThan(64 * 1024);
    const origin = await serve((req, res) => {
      peer.watch(req);
      res.writeHead(200, { "content-type": "application/json", "content-encoding": "gzip" });
      res.write(compressed);
    });
    const { httpProxy } = await import("./http");
    const [status, , data] = await httpProxy(origin);
    expect(status).toBe(500);
    expect(data.error.rawError.code).toBe("ERR_RESPONSE_DECODED_TOO_LARGE");
    await peer.wait();
  });

  it("fails invalid compressed content deterministically and closes its sender", async () => {
    const peer = observeClose();
    const origin = await serve((req, res) => {
      peer.watch(req);
      res.writeHead(200, { "content-encoding": "gzip" });
      res.write("invalid compressed response");
    });
    const { httpProxy } = await import("./http");
    const [status, , data] = await httpProxy(origin);
    expect(status).toBe(500);
    expect(data.error.rawError.code).toBe("ERR_INVALID_RESPONSE_ENCODING");
    await peer.wait();
  });

  it("settles an aborted upstream response rather than retaining a partial buffer", async () => {
    const origin = await serve((req, res) => {
      res.writeHead(200, { "content-length": "1024" });
      res.write("partial");
      setImmediate(() => req.socket.destroy());
    });
    const { httpProxy } = await import("./http");
    const [status, , data] = await httpProxy(origin);
    expect(status).toBe(500);
    expect(data.error.rawError.code).toBe("ECONNRESET");
  });

  it("honors caller cancellation without exposing its arbitrary reason", async () => {
    const peer = observeClose();
    const controller = new AbortController();
    const origin = await serve((req, res) => {
      peer.watch(req);
      res.writeHead(200);
      res.write("partial");
      controller.abort(new Error("PRIVATE_ABORT_REASON"));
    });
    const { httpProxy } = await import("./http");
    const [status, , data] = await httpProxy(origin, { signal: controller.signal });
    expect(status).toBe(500);
    expect(data.error.rawError.code).toBe("ABORT_ERR");
    expect(JSON.stringify(data)).not.toContain("PRIVATE_");
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("PRIVATE_");
    await peer.wait();
  });

  it.each(["identity", "gzip", "deflate"])("preserves a normal %s binary response", async (encoding) => {
    const body = Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 256));
    const origin = await serve((_req, res) => {
      res.writeHead(200, { "content-type": "application/octet-stream", "content-encoding": encoding });
      res.end(encoding === "gzip" ? gzipSync(body) : encoding === "deflate" ? deflateSync(body) : body);
    });
    const { httpProxy } = await import("./http");
    const [status, contentType, data] = await httpProxy(origin);
    expect(status).toBe(200);
    expect(contentType).toBe("application/octet-stream");
    expect(data).toEqual(body);
  });
});
