import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  source: "fictional-private-config",
  files: [],
}));
vi.mock("utils/auth", () => ({ withAuth: (handler) => handler }));
vi.mock("utils/config/config", () => ({
  CONF_DIR: "/fixture",
  getSettings: () => ({
    title: "Studio",
    providers: { secret: "fictional-provider-secret" },
  }),
}));
vi.mock("utils/config/api-response", () => ({
  servicesResponse: async () => [],
  bookmarksResponse: async () => [],
  widgetsResponse: async () => [
    { type: "greeting", options: { index: 0, text: "Hello" } },
  ],
}));
vi.mock("fs/promises", () => ({
  readFile: async (path) => {
    state.files.push(path);
    return Buffer.from(state.source);
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
});
describe("Native Studio bridge endpoints", () => {
  it("uses sanitized native data, omits provider credentials and fingerprints all nine configuration files without exposing them", async () => {
    const res = response();
    await dataHandler({ method: "GET" }, res);
    expect(res.statusCode).toBe(200);
    expect(res.payload.settings).toEqual({ title: "Studio" });
    expect(res.payload.widgets[0].type).toBe("greeting");
    expect(res.headers["Cache-Control"]).toBe("private, no-store");
    expect(res.payload.configurationRevision).toMatch(/^[a-f0-9]{64}$/);
    expect(state.files).toHaveLength(9);
    expect(state.files).toContain("/fixture/custom.js");
    expect(JSON.stringify(res.payload)).not.toContain("fictional-");
    state.source = "changed-private-config";
    const next = response();
    await dataHandler({ method: "GET" }, next);
    expect(next.payload.configurationRevision).not.toBe(
      res.payload.configurationRevision,
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
