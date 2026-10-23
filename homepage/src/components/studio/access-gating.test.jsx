// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

function mount(access) {
  const fetch = vi.fn(async (path, options) => {
    let value = boardState;
    if (path === "/__studio/api/access") value = access;
    if (path === "/__studio/api/appearance" && !options?.method)
      value = { revision: "before", settings: { theme: "dark" } };
    return { ok: true, status: 200, json: async () => value };
  });
  vi.stubGlobal("fetch", fetch);
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <StudioBoard
        nativeData={{ configurationRevision: CONFIG }}
        settings={{ title: "Shared dashboard" }}
        onNativeChange={async () => ({ configurationRevision: CONFIG })}
        onSearch={vi.fn()}
      />
    </SWRConfig>,
  );
  return fetch;
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
  it("a viewer sees no editing controls, only their account", async () => {
    mount({ authEnabled: true, level: "view", user });
    await waitFor(() => expect(screen.getByLabelText("Quick Launch")).toBeEnabled());
    expect(screen.queryByText("Edit dashboard")).toBeNull();
    expect(screen.queryByText("Add widget")).toBeNull();
    expect(screen.queryByLabelText("Dashboard settings")).toBeNull();
    expect(screen.queryByLabelText("Dashboard appearance")).toBeNull();
    expect(screen.getByLabelText("Your account: Sam")).toHaveAttribute("href", "/__studio/account");
    expect(screen.queryByText("Hold a panel to make it yours")).toBeNull();
  });

  it("an arranger can move panels and change the appearance, but not edit widgets", async () => {
    const fetch = mount({ authEnabled: true, level: "arrange", user });
    await waitFor(() => expect(screen.getByText("Edit dashboard", { selector: "button" })).toBeEnabled());
    expect(screen.queryByText("Add widget")).toBeNull();
    expect(screen.queryByLabelText("Dashboard settings")).toBeNull();
    fireEvent.click(screen.getByText("Edit dashboard", { selector: "button" }));
    expect(screen.queryByText("Widgets", { selector: "button" })).toBeNull();
    expect(screen.queryByLabelText("Edit Clock")).toBeNull();
    expect(screen.getByLabelText("Edit Found")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Cancel", { selector: "button" }));
    fireEvent.click(screen.getByLabelText("Dashboard appearance"));
    expect(await screen.findByText("Save appearance")).toBeInTheDocument();
    expect(fetch.mock.calls.some(([path]) => path === "/__studio/api/state")).toBe(false);
  });

  it("an administrator, or a server without sign-in, keeps every control", async () => {
    mount({ authEnabled: false, level: "admin", user: null });
    await waitFor(() => expect(screen.getByText("Add widget", { selector: "button" })).toBeEnabled());
    expect(screen.getByLabelText("Dashboard settings")).toBeEnabled();
    expect(screen.queryByLabelText(/Your account/)).toBeNull();
  });
});
