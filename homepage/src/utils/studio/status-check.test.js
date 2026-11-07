import { describe, expect, it } from "vitest";

import { statusFrom } from "./status-check";

describe("status check answers", () => {
  it("keeps a sub-millisecond ping instead of rounding it to 0 (owner T8, 65f724c)", () => {
    expect(statusFrom("ping", { alive: true, time: 0.312 })).toEqual({ state: "up", ms: 0.3 });
    expect(statusFrom("ping", { alive: true, time: "unknown" })).toEqual({ state: "up", ms: undefined });
    expect(statusFrom("siteMonitor", { status: 200, latency: 45.26 })).toEqual({ state: "up", ms: 45.3 });
    expect(statusFrom("siteMonitor", { status: 502, latency: 3 })).toEqual({ state: "down", code: 502 });
  });
  it("names a certificate problem instead of no answer", () => {
    expect(statusFrom("siteMonitor", { status: 500, reachable: false, certificate: "tls-expired" })).toEqual({
      state: "down",
      text: "The certificate has expired",
    });
    expect(statusFrom("siteMonitor", { status: 500, reachable: false, certificate: "bogus" })).toEqual({
      state: "down",
    });
  });
});
