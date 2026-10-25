// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import StudioTopBar from "./top-bar";

afterEach(() => vi.unstubAllGlobals());

describe("top bar", () => {
  it("shows the dashboard's logo and name, and the name switches between addressed dashboards", async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        dashboards: [
          { id: "default", name: "Home", path: "/dashboard", archived: false },
          { id: "b", name: "Kitchen", path: "/kitchen", archived: false },
          { id: "c", name: "Old", path: "/old", archived: true },
          { id: "d", name: "Unaddressed", path: null, archived: false },
        ],
      }),
    }));
    vi.stubGlobal("fetch", fetch);
    const { container } = render(
      <StudioTopBar title="Home" dashboardId="default" logo="/dashboard/studio/logo?v=1" access={{ authEnabled: false, level: "admin" }} />,
    );
    expect(container.querySelector(".studio-brand-logo").getAttribute("src")).toBe("/dashboard/studio/logo?v=1");
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Home. Switch dashboard" }));
    expect(screen.getByRole("menuitem", { name: "All dashboards" })).toHaveAttribute("href", "/studio/dashboards");
    expect(await screen.findByRole("menuitem", { name: "Kitchen" })).toHaveAttribute("href", "/kitchen");
    expect(screen.getByRole("menuitem", { name: "Home" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("menuitem", { name: "Old" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Unaddressed" })).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    // Sign-in off: everyone is an administrator and there is no account menu.
    expect(screen.getByRole("link", { name: "Administration" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Account:/ })).not.toBeInTheDocument();
  });

  it("says when the list can't load and hides Administration from members", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    render(
      <StudioTopBar
        title="Kitchen"
        dashboardId="b"
        access={{ authEnabled: true, level: "view", user: { displayName: "Sam", role: "member" } }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Kitchen. Switch dashboard" }));
    expect(await screen.findByText("The list could not load. Use All dashboards.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Administration" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Account: Sam" })).toBeInTheDocument();
  });
});
