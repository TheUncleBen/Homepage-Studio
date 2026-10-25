import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  source: "fictional-private-config",
  files: [],
  events: [],
  changeDuring: null,
  rollbackDuring: null,
  identity: 0n,
  timestampOnly: false,
  changeDuringRead: false,
  failRead: false,
  failSettings: false,
}));
function readingNative(name) {
  state.events.push(name);
  if (state.changeDuring === name) state.source = "changed-private-config";
  // Atomic replacements during a failed writer transaction can restore exactly
  // the original bytes after a native helper has observed intermediate content.
  if (state.rollbackDuring === name) state.identity += 2n;
}
vi.mock("utils/auth", () => ({ withAuth: (handler) => handler }));
vi.mock("utils/config/config", () => ({
  CONF_DIR: "/fixture",
  getSettings: () => {
    readingNative("settings");
    if (state.failSettings)
      throw new Error("fictional-private-error in /fixture/settings.yaml");
    return {
      title: "Studio",
      providers: { secret: "fictional-provider-secret" },
    };
  },
}));
vi.mock("utils/config/api-response", () => ({
  servicesResponse: async () => {
    readingNative("services");
    return state.rollbackDuring === "services"
      ? [{ name: "fictional-intermediate-service" }]
      : [];
  },
  bookmarksResponse: async () => {
    readingNative("bookmarks");
    return [];
  },
  widgetsResponse: async () => {
    readingNative("widgets");
    return [{ type: "greeting", options: { index: 0, text: "Hello" } }];
  },
}));
vi.mock("fs/promises", () => ({
  stat: async (_path, options) => {
    expect(options).toEqual({ bigint: true });
    return {
      dev: 1n,
      ino: state.timestampOnly ? 10n : 10n + state.identity,
      size: BigInt(Buffer.byteLength(state.source)),
      mtimeNs: state.timestampOnly ? 100n : 100n + state.identity,
      ctimeNs: 200n + state.identity,
    };
  },
  readFile: async (path) => {
    state.files.push(path);
    state.events.push("file");
    if (state.failRead)
      throw new Error("fictional-private-error in /fixture/custom.js");
    const bytes = Buffer.from(state.source);
    if (state.changeDuringRead) {
      state.identity += 1n;
      state.changeDuringRead = false;
    }
    return bytes;
  },
}));
vi.mock("utils/studio/discovery-sources", () => ({
  discoverySourcesResponse: async () => {
    throw new Error("fictional-private-error");
  },
}));

import dataHandler from "pages/api/studio/data";
import healthHandler from "pages/api/studio/health";
import sourcesHandler from "pages/api/studio/sources";

const response = () => ({
  headers: {},
  statusCode: 0,
  payload: null,
  setHeader(key, value) {
    this.headers[key] = value;
  },
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(value) {
    this.payload = value;
    return this;
  },
});
beforeEach(() => {
  state.source = "fictional-private-config";
  state.files = [];
  state.events = [];
  state.changeDuring = null;
  state.rollbackDuring = null;
  state.identity = 0n;
  state.timestampOnly = false;
  state.changeDuringRead = false;
  state.failRead = false;
  state.failSettings = false;
});
describe("Native Studio bridge endpoints", () => {
  it("uses sanitized native data, omits provider credentials and fingerprints all nine configuration files without exposing them", async () => {
    const res = response();
    await dataHandler({ method: "GET" }, res);
    expect(res.statusCode).toBe(200);
    expect(res.payload.settings).toEqual({ title: "Studio" });
    expect(res.payload.widgets[0].type).toBe("greeting");
    expect(res.headers["Cache-Control"]).toBe("private, no-store");
    // Frozen byte-contract fixture: ordered filename + NUL + bytes + NUL.
    expect(res.payload.configurationRevision).toBe(
      "96c339027144766117a1cb08f29899c62aa630cd22044050b53839c7a1b0eb9c",
    );
    expect(state.files).toHaveLength(18);
    expect(state.events.slice(0, 9)).toEqual(Array(9).fill("file"));
    expect(state.events.slice(-9)).toEqual(Array(9).fill("file"));
    expect(state.files).toContain("/fixture/custom.js");
    expect(JSON.stringify(res.payload)).not.toContain("fictional-");
    expect(Object.keys(res.payload).sort()).toEqual([
      "bookmarks",
      "configurationRevision",
      "platformRevision",
      "protocolVersion",
      "services",
      "settings",
      "widgets",
    ]);
    state.source = "changed-private-config";
    const next = response();
    await dataHandler({ method: "GET" }, next);
    expect(next.payload.configurationRevision).not.toBe(
      res.payload.configurationRevision,
    );
  });
  it.each(["settings", "services", "bookmarks", "widgets"])(
    "rejects data when native files change during the %s read and allows a coherent retry",
    async (phase) => {
      state.changeDuring = phase;
      const changed = response();
      await dataHandler({ method: "GET" }, changed);
      expect(changed.statusCode).toBe(503);
      expect(changed.headers["Cache-Control"]).toBe("private, no-store");
      expect(changed.headers["Retry-After"]).toBe("1");
      expect(changed.payload).toEqual({
        error:
          "Native configuration changed while refreshing. Retry the refresh.",
        code: "CONFIGURATION_CHANGED",
        retryable: true,
      });
      expect(JSON.stringify(changed.payload)).not.toMatch(
        /fictional-|changed-private/,
      );
      state.changeDuring = null;
      const retried = response();
      await dataHandler({ method: "GET" }, retried);
      expect(retried.statusCode).toBe(200);
      expect(retried.payload.configurationRevision).toMatch(/^[a-f0-9]{64}$/);
    },
  );
  it("rejects an intermediate native read when a rolled-back transaction restores the original bytes", async () => {
    const original = response();
    await dataHandler({ method: "GET" }, original);
    state.rollbackDuring = "services";
    const rolledBack = response();
    await dataHandler({ method: "GET" }, rolledBack);
    expect(rolledBack.statusCode).toBe(503);
    expect(rolledBack.payload.code).toBe("CONFIGURATION_CHANGED");
    expect(rolledBack.payload.retryable).toBe(true);
    expect(rolledBack.headers["Cache-Control"]).toBe("private, no-store");
    expect(rolledBack.headers["Retry-After"]).toBe("1");
    expect(rolledBack.payload).not.toHaveProperty("services");
    state.rollbackDuring = null;
    const retried = response();
    await dataHandler({ method: "GET" }, retried);
    expect(retried.statusCode).toBe(200);
    // Private file identity changes must never alter the public byte contract.
    expect(retried.payload.configurationRevision).toBe(
      original.payload.configurationRevision,
    );
  });
  it("rejects a file changed while its fingerprint is being read even if bytes, inode and mtime are unchanged", async () => {
    state.timestampOnly = true;
    state.changeDuringRead = true;
    const changed = response();
    await dataHandler({ method: "GET" }, changed);
    expect(changed.statusCode).toBe(503);
    expect(changed.payload.code).toBe("CONFIGURATION_CHANGED");
    expect(changed.payload.retryable).toBe(true);
    expect(changed.headers["Cache-Control"]).toBe("private, no-store");
    expect(changed.headers["Retry-After"]).toBe("1");
  });
  it("returns a private retryable response when a configuration fingerprint cannot be read", async () => {
    state.failRead = true;
    const unavailable = response();
    await dataHandler({ method: "GET" }, unavailable);
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.payload.code).toBe("CONFIGURATION_CHANGED");
    expect(unavailable.payload.retryable).toBe(true);
    expect(unavailable.headers["Cache-Control"]).toBe("private, no-store");
    expect(unavailable.headers["Retry-After"]).toBe("1");
    expect(JSON.stringify(unavailable.payload)).not.toMatch(
      /fictional-|\/fixture/,
    );
  });
  it("returns a private retryable response when a native helper fails", async () => {
    state.failSettings = true;
    const unavailable = response();
    await dataHandler({ method: "GET" }, unavailable);
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.payload).toEqual({
      error:
        "Native widget data is temporarily unavailable. Retry the refresh.",
      code: "NATIVE_DATA_UNAVAILABLE",
      retryable: true,
    });
    expect(unavailable.headers["Cache-Control"]).toBe("private, no-store");
    expect(unavailable.headers["Retry-After"]).toBe("1");
    expect(JSON.stringify(unavailable.payload)).not.toMatch(
      /fictional-|\/fixture/,
    );
  });
  it("keeps the bridge read-only, reports exact upstream protocol and bounds discovery outage responses", async () => {
    const bad = response();
    await dataHandler({ method: "POST" }, bad);
    expect(bad.statusCode).toBe(405);
    expect(state.files).toHaveLength(0);
    const health = response();
    healthHandler({ method: "GET" }, health);
    expect(health.payload).toMatchObject({
      protocolVersion: 1,
      upstreamCommit: "51cc1684f9f34a7877ed462b8f94c9cc687b4dde",
    });
    const unavailable = response();
    await sourcesHandler({ method: "GET" }, unavailable);
    expect(unavailable.statusCode).toBe(503);
    expect(JSON.stringify(unavailable.payload)).not.toContain(
      "fictional-private-error",
    );
  });
});
