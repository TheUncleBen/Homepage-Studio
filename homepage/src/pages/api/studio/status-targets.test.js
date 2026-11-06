import { describe, expect, it, vi } from "vitest";

vi.mock("utils/config/api-response", () => ({ servicesResponse: vi.fn() }));
vi.mock("utils/config/service-helpers", () => ({ getServiceItem: vi.fn() }));

import { statusTarget } from "./status-targets";

const data = {
  services: [{ name: "Media", services: [{ name: "Plex", href: "https://plex.example" }] }],
};
const panel = (check) => ({ id: "p1", kind: "service", nativeLocator: { name: "Plex", groupPath: ["Media"] }, check });

describe("card monitor targets", () => {
  it("uses the service's own siteMonitor, else its widget connection, else its link", async () => {
    expect(
      await statusTarget(panel("web"), data, async () => ({ name: "Plex", siteMonitor: "http://plex:32400" })),
    ).toEqual({ check: "web", url: "http://plex:32400", name: "Plex" });
    expect(
      await statusTarget(panel("web"), data, async () => ({
        name: "Plex",
        href: "https://plex.example",
        widget: { url: "http://10.0.0.5:32400" },
      })),
    ).toEqual({ check: "web", url: "http://10.0.0.5:32400", name: "Plex" });
    expect(
      await statusTarget(panel("web"), data, async () => ({ name: "Plex", href: "https://plex.example" })),
    ).toEqual({ check: "web", url: "https://plex.example", name: "Plex" });
  });
  it("pings the host of the address, or the service's own ping host", async () => {
    expect(
      await statusTarget(panel("ping"), data, async () => ({ name: "Plex", href: "https://plex.example:8443/web" })),
    ).toEqual({ check: "ping", host: "plex.example", name: "Plex" });
    expect(await statusTarget(panel("ping"), data, async () => ({ name: "Plex", ping: "10.0.0.5" }))).toEqual({
      check: "ping",
      host: "10.0.0.5",
      name: "Plex",
    });
  });
  it("has no target when the card has nothing to check or can't be matched", async () => {
    expect(await statusTarget(panel("web"), data, async () => ({ name: "Plex" }))).toBeNull();
    expect(
      await statusTarget(
        { ...panel("web"), nativeLocator: { name: "Gone", groupPath: ["Media"] } },
        data,
        async () => null,
      ),
    ).toBeNull();
  });
});
