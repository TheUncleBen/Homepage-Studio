import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import createMockRes from "test-utils/create-mock-res";

const { getServiceWidget, logger, sockets, behavior } = vi.hoisted(() => ({
  getServiceWidget: vi.fn(),
  logger: { debug: vi.fn(), error: vi.fn(), warn: vi.fn() },
  sockets: [],
  behavior: { mode: "ok" },
}));

vi.mock("utils/logger", () => ({
  default: () => logger,
}));
vi.mock("utils/config/service-helpers", () => ({
  default: getServiceWidget,
}));
vi.mock("utils/proxy/validate-widget-data", () => ({
  default: () => true,
}));
vi.mock("utils/proxy/handlers/credentialed", () => ({
  default: vi.fn(),
}));
vi.mock("widgets/widgets", () => ({
  default: {
    truenas: {
      wsAPI: "{url}/websocket",
      mappings: {
        stats: { endpoint: "stats", wsMethod: "system.info" },
      },
    },
  },
}));

vi.mock("ws", () => {
  class FakeWebSocket {
    static CONNECTING = 0;

    static OPEN = 1;

    static CLOSING = 2;

    static CLOSED = 3;

    constructor(url, options) {
      this.url = url;
      this.options = options;
      this.readyState = FakeWebSocket.CONNECTING;
      this.handlers = new Map();
      this.close = vi.fn(() => {
        this.readyState = FakeWebSocket.CLOSED;
      });
      this.terminate = vi.fn(() => {
        this.readyState = FakeWebSocket.CLOSED;
      });
      sockets.push(this);
      queueMicrotask(() => {
        if (behavior.mode === "hang") return;
        if (behavior.mode === "connect-error") {
          this.emit(
            "error",
            Object.assign(new Error("connect ECONNREFUSED 10.0.0.9:443 for wss://admin:hunter2@tn/websocket"), {
              code: "ECONNREFUSED",
            }),
          );
          return;
        }
        this.readyState = FakeWebSocket.OPEN;
        this.emit("open");
      });
    }

    on(event, cb) {
      const set = this.handlers.get(event) ?? new Set();
      set.add(cb);
      this.handlers.set(event, set);
    }

    off(event, cb) {
      this.handlers.get(event)?.delete(cb);
    }

    emit(event, payload) {
      [...(this.handlers.get(event) ?? [])].forEach((cb) => cb(payload));
    }

    send(payload) {
      const msg = JSON.parse(payload);
      queueMicrotask(() => {
        if (behavior.mode === "rpc-error" && msg.method === "system.info") {
          this.emit("message", JSON.stringify({ id: msg.id, error: { message: "Traceback: secret /etc/path" } }));
        } else if (behavior.mode === "oversize" && msg.method === "system.info") {
          this.emit(
            "error",
            Object.assign(new RangeError("Max payload size exceeded"), { code: "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH" }),
          );
        } else {
          this.emit(
            "message",
            JSON.stringify({ id: msg.id, result: msg.method === "system.info" ? { ok: true } : true }),
          );
        }
      });
    }
  }

  return { default: FakeWebSocket };
});

import truenasProxyHandler from "./proxy";

const widget = { type: "truenas", url: "https://admin:hunter2@tn.example.test", version: 2, key: "apikey" };
const req = { query: { group: "g", service: "svc", endpoint: "stats", index: "0" } };

describe("widgets/truenas/proxy transport limits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sockets.length = 0;
    behavior.mode = "ok";
    getServiceWidget.mockResolvedValue(widget);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("caps websocket messages at the shared 32 MiB transport limit and closes the socket", async () => {
    const res = createMockRes();
    await truenasProxyHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(sockets).toHaveLength(1);
    expect(sockets[0].options).toMatchObject({ maxPayload: 32 * 1024 * 1024 });
    expect(sockets[0].close).toHaveBeenCalledTimes(1);
  });

  it("terminates a socket whose open handshake times out", async () => {
    vi.useFakeTimers();
    behavior.mode = "hang";
    const res = createMockRes();
    const pending = truenasProxyHandler(req, res);
    await vi.advanceTimersByTimeAsync(10_000);
    await pending;

    expect(sockets[0].terminate).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(500);
    expect(res.body.error.message).toBe("TrueNAS websocket wait timed out");
    expect(res.body.error.rawError).toEqual({ code: "TRUENAS_TIMEOUT", message: "TrueNAS websocket wait timed out" });
  });

  it.each([
    ["connect-error", "ECONNREFUSED", "Connection refused"],
    ["rpc-error", "TRUENAS_RPC_ERROR", "TrueNAS rejected the request"],
    ["oversize", "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH", "TrueNAS websocket message exceeds the 32 MiB limit"],
  ])("returns only a sanitized diagnostic for %s and releases the socket", async (mode, code, message) => {
    behavior.mode = mode;
    const res = createMockRes();
    await truenasProxyHandler(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: { message, url: expect.any(String), rawError: { code, message } } });
    const serialized = JSON.stringify(res.body);
    for (const secret of ["hunter2", "admin:", "10.0.0.9", "Traceback", "/etc/path"]) {
      expect(serialized).not.toContain(secret);
    }
    const socket = sockets[0];
    expect(socket.close.mock.calls.length + socket.terminate.mock.calls.length).toBe(1);
    expect(socket.readyState).toBe(3);
    // A late socket error after cleanup must not be an unhandled 'error' event.
    expect(socket.handlers.get("error")?.size).toBeGreaterThan(0);
    for (const call of logger.error.mock.calls) expect(JSON.stringify(call)).not.toContain("hunter2");
  });
});
