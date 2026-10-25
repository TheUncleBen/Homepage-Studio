// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import StudioBoard from "./board";

vi.mock("./native-panel", () => ({ default: () => <output>native</output> }));
vi.mock("next/link", () => ({
  default: ({ children, ...props }) => <a {...props}>{children}</a>,
}));

const CONFIG = "a".repeat(64);
const boardState = {
  revision: "before",
  configurationRevision: CONFIG,
  board: {
    version: 2,
    columns: 12,
    panels: [
      { id: "clock", title: "Clock", group: "Information", kind: "informationWidget", rect: { x: 0, y: 0, w: 4, h: 3 } },
      {
        id: "found",
        title: "Found",
        group: "Discovered",
        kind: "service",
        rect: { x: 4, y: 0, w: 4, h: 3 },
        nativeLocator: { discovered: true },
      },
    ],
    stacks: [],
  },
  discoveredSources: [],
  hiddenDiscoveredIds: [],
};

function mount(access, mode = "live") {
  const fetch = vi.fn(async (path, options) => {
    let value = boardState;
    if (path === "/__studio/api/access") value = access;
    if (path === "/__studio/api/appearance" && !options?.method)
      value = { revision: "before", settings: { theme: "dark" } };
    return { ok: true, status: 200, json: async () => value };
  });
  vi.stubGlobal("fetch", fetch);
  const onLeave = vi.fn();
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <StudioBoard
        nativeData={{ configurationRevision: CONFIG }}
        settings={{ title: "Shared dashboard" }}
        onNativeChange={async () => ({ configurationRevision: CONFIG })}
        onSearch={vi.fn()}
        mode={mode}
        onLeave={onLeave}
      />
    </SWRConfig>,
  );
  return { fetch, onLeave };
}
const user = { displayName: "Sam", username: "sam", role: "member" };

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("dashboard controls follow the sign-in access level", () => {
  it("every level sees a live dashboard with the top bar and no editing controls", async () => {
    for (const access of [
      { authEnabled: true, level: "view", user, dashboard: { name: "Family" } },
      { authEnabled: true, level: "admin", user: { ...user, role: "admin" }, dashboard: { name: "Family" } },
    ]) {
      const view = mount(access);
      await waitFor(() => expect(screen.getByLabelText("Quick Launch")).toBeEnabled());
      expect(screen.getByText("Family", { selector: ".studio-topbar-title" })).toBeInTheDocument();
      for (const name of ["Edit dashboard", "Add widget", "Done"]) expect(screen.queryByText(name)).toBeNull();
      expect(screen.queryByLabelText("Dashboard settings")).toBeNull();
      expect(screen.queryByLabelText("Edit Found")).toBeNull();
      expect(screen.getAllByRole("link", { name: "Dashboards" })[0]).toHaveAttribute("href", "/__studio/dashboards");
      expect(Boolean(screen.queryAllByRole("link", { name: "Administration" }).length)).toBe(access.level === "admin");
      fireEvent.click(screen.getByLabelText("Account: Sam"));
      expect(screen.getByRole("menuitem", { name: "My account" })).toHaveAttribute("href", "/__studio/account");
      expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeInTheDocument();
      view.onLeave.mockClear();
      cleanup();
    }
  });

  it("a viewer who opens the editor page is sent back without seeing edit controls", async () => {
    const { onLeave } = mount({ authEnabled: true, level: "view", user }, "edit");
    await waitFor(() => expect(onLeave).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Done")).toBeNull();
  });

  it("an arranger can move panels on the editor page and change the appearance on the settings page, but not edit widgets", async () => {
    const edit = mount({ authEnabled: true, level: "arrange", user }, "edit");
    await waitFor(() => expect(screen.getByText("Done", { selector: "button" })).toBeEnabled());
    expect(screen.queryByText("Widgets", { selector: "button" })).toBeNull();
    expect(screen.queryByLabelText("Edit Clock")).toBeNull();
    expect(screen.getByLabelText("Edit Found")).toBeInTheDocument();
    expect(edit.fetch.mock.calls.some(([path]) => path === "/__studio/api/state")).toBe(false);
    cleanup();
    const settings = mount({ authEnabled: true, level: "arrange", user }, "settings");
    expect(await screen.findByText("Save appearance")).toBeInTheDocument();
    expect(settings.fetch.mock.calls.some(([path]) => path === "/__studio/api/state")).toBe(false);
  });

  it("an administrator, or a server without sign-in, gets every editor control and no account menu without sign-in", async () => {
    mount({ authEnabled: false, level: "admin", user: null }, "edit");
    await waitFor(() => expect(screen.getByText("Widgets", { selector: "button" })).toBeEnabled());
    expect(screen.getByLabelText("Edit Clock")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Account/)).toBeNull();
    expect(screen.getByText("Dashboards", { selector: ".studio-top-link" })).toHaveAttribute("href", "/__studio/dashboards");
  });
});
