// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "test-utils/render-with-providers";
import { CollectContext } from "utils/studio/collect-context";

const { useWidgetAPI } = vi.hoisted(() => ({ useWidgetAPI: vi.fn() }));
vi.mock("utils/proxy/use-widget-api", () => ({ default: useWidgetAPI }));

import CustomApi from "./customapi/component";
import Nextcloud from "./nextcloud/component";
import Pfsense from "./pfsense/component";
import Prometheusmetric from "./prometheusmetric/component";
import Technitium from "./technitium/component";

// Owner request, 4 Nov 2026: inside a Studio card every value a widget is set
// to show is shown, with no four-value limit. Chart history reads a widget the
// same way (CollectContext), so the values it hands over are what a card shows.
function shownIn(Component, widget, { card = true } = {}) {
  let labels = [];
  const collect = (_error, children) => {
    labels = children.filter(Boolean).map((child) => child.props.label);
  };
  const element = <Component service={{ widget }} />;
  const { container } = renderWithProviders(
    card ? <CollectContext.Provider value={collect}>{element}</CollectContext.Provider> : element,
    { settings: { hideErrors: false } },
  );
  return card ? labels : [...container.querySelectorAll(".service-block")].map((block) => block.textContent);
}

describe("widgets in Studio cards show every chosen value", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWidgetAPI.mockReturnValue({ data: undefined, error: undefined });
  });

  it("pfSense shows all six values when all six are chosen, and four outside a card", () => {
    const fields = ["load", "memory", "temp", "wanStatus", "wanIP", "disk"];
    expect(shownIn(Pfsense, { type: "pfsense", fields })).toEqual(fields.map((field) => `pfsense.${field}`));
    expect(shownIn(Pfsense, { type: "pfsense", fields }, { card: false })).toHaveLength(4);
  });

  it("a widget using the shared field helper keeps more than four chosen values", () => {
    const fields = ["totalQueries", "totalNoError", "totalServerFailure", "totalNxDomain", "totalRefused"];
    expect(shownIn(Technitium, { type: "technitium", fields })).toHaveLength(5);
    expect(shownIn(Technitium, { type: "technitium", fields }, { card: false })).toHaveLength(4);
  });

  it("the shared helper's own defaults still apply when nothing is chosen", () => {
    expect(shownIn(Technitium, { type: "technitium" }).sort()).toEqual([
      "technitium.totalAuthoritative",
      "technitium.totalCached",
      "technitium.totalQueries",
      "technitium.totalServerFailure",
    ]);
  });

  it("Nextcloud shows every chosen value, the older CPU and memory values included", () => {
    const fields = ["cpuload", "memoryusage", "freespace", "activeusers", "numfiles", "numshares"];
    expect(shownIn(Nextcloud, { type: "nextcloud", fields })).toHaveLength(6);
  });

  it("Custom API and Prometheus metrics show more than four mappings", () => {
    const mappings = ["a", "b", "c", "d", "e"].map((label) => ({ label, field: label }));
    expect(shownIn(CustomApi, { type: "customapi", mappings })).toHaveLength(5);
    const metrics = ["a", "b", "c", "d", "e"].map((label) => ({ label, query: label }));
    expect(shownIn(Prometheusmetric, { type: "prometheusmetric", metrics })).toHaveLength(5);
  });
});
