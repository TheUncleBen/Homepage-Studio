import { describe, expect, it, vi } from "vitest";

import { collectWidget, readMarker } from "./collect";

import Pihole from "widgets/pihole/component";

// The real translation hook, so the collector's own translator is used.
vi.unmock("next-i18next/pages");

const service = {
  name: "Pi-hole",
  widget: { type: "pihole", service_name: "Pi-hole", service_group: "Network", index: -1 },
};

describe("chart history collection", () => {
  it("reads each value's number and format from the widget's own rendering", async () => {
    const asked = [];
    const result = await collectWidget(Pihole, service, async (key) => {
      asked.push(key);
      return {
        dns_queries_today: 84210,
        ads_blocked_today: 18021,
        ads_percentage_today: 21.4,
        domains_being_blocked: 1200000,
      };
    });
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatch(/^\/api\/services\/proxy\?/);
    expect(result.values).toEqual([
      { field: "pihole.queries", label: "pihole.queries", format: "number", value: 84210 },
      { field: "pihole.blocked", label: "pihole.blocked", format: "number", value: 18021 },
      { field: "pihole.gravity", label: "pihole.gravity", format: "number", value: 1200000 },
    ]);
  });

  it("reports a failed request as an error", async () => {
    const result = await collectWidget(Pihole, service, async () => {
      throw new Error("down");
    });
    expect(result).toEqual({ error: "service" });
  });

  it("reads numbers only from formatter markers", () => {
    expect(readMarker("plain text")).toBeNull();
    expect(readMarker(3)).toEqual({ format: "plain", value: 3 });
  });
});
