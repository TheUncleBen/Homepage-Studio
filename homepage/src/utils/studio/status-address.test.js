import { describe, expect, it } from "vitest";

import { statusFallback } from "./status-address";

describe("status check fallback address (owner T8/T35, 65f724c)", () => {
  it("uses the widget's Connection address first, then the link", () => {
    expect(statusFallback({ href: "https://link.example.org", widget: { url: "https://api.example.org" } })).toBe(
      "https://api.example.org",
    );
    expect(statusFallback({ widgets: [{ type: "x" }, { url: "http://10.0.0.1:81" }] })).toBe("http://10.0.0.1:81");
    expect(statusFallback({ href: "https://link.example.org", widget: { type: "x" } })).toBe(
      "https://link.example.org",
    );
  });

  it("never uses something that isn't a web address", () => {
    expect(statusFallback({ href: "javascript:alert(1)", widget: { url: "file:///etc/passwd" } })).toBeUndefined();
    expect(statusFallback(null)).toBeUndefined();
  });
});
