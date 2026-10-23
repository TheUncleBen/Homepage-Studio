import { beforeEach, describe, expect, it, vi } from "vitest";

import createMockRes from "test-utils/create-mock-res";

function encodeLine(line) {
  const buf = Buffer.alloc(2 + line.length);
  buf.writeUInt16BE(line.length, 0);
  buf.write(line, 2, "ascii");
  return buf;
}

const { getServiceWidget, logger, behavior } = vi.hoisted(() => ({
  getServiceWidget: vi.fn(),
  logger: { debug: vi.fn(), error: vi.fn() },
  behavior: { mode: "ok" },
}));

vi.mock("utils/config/service-helpers", () => ({
  default: getServiceWidget,
}));
vi.mock("utils/logger", () => ({
  default: () => logger,
}));

vi.mock("node:net", () => {
  class FakeSocket {
    constructor() {
      this._handlers = new Map();
    }
    setTimeout() {}
    connect() {
      if (behavior.mode === "error") {
        const error = Object.assign(new Error("connect ECONNREFUSED 192.168.50.7:3551"), { code: "ECONNREFUSED" });
        queueMicrotask(() => this._emit("error", error));
        return;
      }
      if (behavior.mode === "timeout") {
        queueMicrotask(() => this._emit("timeout"));
        return;
      }
      queueMicrotask(() => this._emit("connect"));
    }
    on(event, cb) {
      const set = this._handlers.get(event) ?? new Set();
      set.add(cb);
      this._handlers.set(event, set);
    }
    write() {
      const response = Buffer.concat([
        encodeLine("STATUS : ONLINE"),
        encodeLine("LOADPCT : 10.0"),
        encodeLine("BCHARGE : 99.0"),
        encodeLine("TIMELEFT : 12.3"),
        encodeLine("END APC"),
        Buffer.from([0x00, 0x00]),
      ]);
      queueMicrotask(() => this._emit("data", response));
    }
    end() {}
    destroy() {}
    _emit(event, payload) {
      const set = this._handlers.get(event);
      if (!set) return;
      set.forEach((cb) => cb(payload));
    }
  }

  return {
    default: {
      Socket: FakeSocket,
    },
  };
});

import apcupsProxyHandler from "./proxy";

describe("widgets/apcups/proxy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    behavior.mode = "ok";
  });

  it.each([
    ["error", "ECONNREFUSED", "Connection refused"],
    ["timeout", "APCUPS_TIMEOUT", "APC UPS status request timed out"],
  ])("returns a sanitized diagnostic for a socket %s", async (mode, code, message) => {
    behavior.mode = mode;
    getServiceWidget.mockResolvedValue({ url: "http://192.168.50.7:3551" });

    const res = createMockRes();
    await apcupsProxyHandler({ query: { group: "g", service: "svc", index: "0" } }, res);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: { message, rawError: { code, message } } });
    expect(JSON.stringify(res.body)).not.toContain("192.168.50.7");
  });

  it("parses the APCUPSD status response into JSON", async () => {
    getServiceWidget.mockResolvedValue({ url: "http://127.0.0.1:3551" });

    const req = { query: { group: "g", service: "svc", index: "0" } };
    const res = createMockRes();

    await apcupsProxyHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      status: "ONLINE",
      load: "10.0",
      bcharge: "99.0",
      timeleft: "12.3",
    });
  });
});
