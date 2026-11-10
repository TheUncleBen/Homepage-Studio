// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import StudioBoard from "./board";
import { cardLive } from "./card-look";

vi.mock("./native-panel", () => ({
  default: ({ panel }) => <output data-testid={`native-${panel.id}`}>{panel.title}</output>,
}));
vi.mock("components/resolvedicon", () => ({ default: ({ icon }) => <i data-icon={icon} /> }));

const CONFIG = "a".repeat(64);
const panel = (id, pageId, x = 0, extra = {}) => ({
  id,
  title: id,
  kind: "informationWidget",
  nativeLocator: { index: 0, type: "datetime" },
  rect: { x, y: 0, w: 8, h: 6 },
  pageId,
  ...extra,
});
const twoPages = {
  version: 3,
  columns: 24,
  pages: [
    { id: "home", name: "Overview" },
    { id: "media", name: "Media", icon: "mdi-filmstrip" },
  ],
  panels: [
    panel("clock", "home", 0, { look: { corners: "round", edge: "shadow" } }),
    panel("weather", "home", 8),
    panel("plex", "media", 0, { nativeLocator: { index: 1, type: "openmeteo" } }),
  ],
  stacks: [],
};

async function mount({ board = twoPages, mode = "live", envelope = {}, accessValue = null } = {}) {
  let state = { revision: "r1", configurationRevision: CONFIG, board: structuredClone(board), ...envelope };
  const writes = [];
  const fetch = vi.fn(async (path, options) => {
    let value;
    if (options?.method === "POST") {
      const body = JSON.parse(options.body);
      writes.push({ path, body });
      const { newDiscoveredIds: _saved, ...rest } = state;
      state = { ...rest, revision: `r${writes.length + 1}`, ...(body.board ? { board: body.board } : {}) };
      value = state;
    } else if (path === "/studio/api/access") value = accessValue ?? { authEnabled: false, level: "admin", user: null };
    else if (path.endsWith("/studio/api/panel-status"))
      value = {
        available: true,
        panels: {
          clock: { state: "down", since: Date.now() - 60000, text: "Connection refused · check the address and port" },
        },
      };
    else if (path.startsWith("/studio/api/ops/logs/search"))
      value = {
        events: [{ id: "e1", ts: Date.now(), severity: 3, message: "clock: Down · Connection refused", repeat: 3 }],
      };
    else value = state;
    return { ok: true, status: 200, json: async () => value };
  });
  vi.stubGlobal("fetch", fetch);
  const view = render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <StudioBoard
        nativeData={{ configurationRevision: CONFIG }}
        settings={{ title: "Home lab" }}
        onNativeChange={async () => ({ configurationRevision: CONFIG })}
        onSearch={vi.fn()}
        mode={mode}
        onLeave={vi.fn()}
      />
    </SWRConfig>,
  );
  if (mode === "edit") await waitFor(() => expect(screen.getByRole("button", { name: "Done" })).toBeEnabled());
  else await waitFor(() => expect(screen.getAllByRole("button", { name: "Search" })[0]).toBeEnabled());
  return { ...view, writes };
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/");
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

const menuFor = async (name) => {
  fireEvent.contextMenu(screen.getByTestId(`native-${name}`));
  return screen.findByRole("menu", { name: "Widget actions" });
};

describe("Widget menu while editing", () => {
  it("is not offered while viewing", async () => {
    await mount();
    fireEvent.contextMenu(screen.getByTestId("native-clock"));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("lists only actions that apply", async () => {
    await mount({ mode: "edit" });
    const menu = await menuFor("clock");
    const labels = within(menu)
      .getAllByRole("menuitem")
      .map((item) => item.textContent);
    expect(labels).toEqual([
      "EditE",
      "DuplicateCtrl D",
      "Copy lookCtrl Alt C",
      "Paste lookCtrl Alt V",
      "Use this look on every datetime widget",
      "Move to page…",
      "DeleteDel",
    ]);
    // Nothing copied yet, so there is nothing to paste.
    expect(within(menu).getByRole("menuitem", { name: /Paste look/ })).toBeDisabled();
  });

  it("copies a look and pastes it on another widget, saved with the arrangement", async () => {
    const { writes } = await mount({ mode: "edit" });
    fireEvent.click(within(await menuFor("clock")).getByRole("menuitem", { name: /Copy look/ }));
    expect(await screen.findByText("Look copied")).toBeInTheDocument();
    fireEvent.click(within(await menuFor("weather")).getByRole("menuitem", { name: /Paste look/ }));
    expect(await screen.findByText("Look pasted")).toBeInTheDocument();
    // Saved by itself (autosave).
    await waitFor(() => expect(writes.length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getByText("Saved", { exact: true })).toBeInTheDocument());
    const saved = writes.at(-1).body.board.panels.find((item) => item.id === "weather");
    expect(saved.look).toEqual({ corners: "round", edge: "shadow" });
    // The copy is kept for pasting on other dashboards.
    expect(JSON.parse(localStorage.getItem("studio-look-clipboard"))).toEqual({ corners: "round", edge: "shadow" });
  });

  it("uses one look on every widget of the same type, and only offers it when there are others", async () => {
    const { writes } = await mount({ mode: "edit" });
    fireEvent.click(within(await menuFor("clock")).getByRole("menuitem", { name: /every datetime widget/ }));
    expect(await screen.findByText("Look used on 2 datetime widgets")).toBeInTheDocument();
    // Saved by itself (autosave).
    await waitFor(() => expect(writes.length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getByText("Saved", { exact: true })).toBeInTheDocument());
    const looks = Object.fromEntries(writes.at(-1).body.board.panels.map((item) => [item.id, item.look]));
    expect(looks).toEqual({
      clock: { corners: "round", edge: "shadow" },
      weather: { corners: "round", edge: "shadow" },
      plex: undefined,
    });
  });

  it("moves a widget to another page from the menu", async () => {
    await mount({ mode: "edit" });
    fireEvent.click(within(await menuFor("weather")).getByRole("menuitem", { name: "Move to page…" }));
    const pagesMenu = await screen.findByRole("menu", { name: "Move to page" });
    fireEvent.click(within(pagesMenu).getByRole("menuitem", { name: "Media" }));
    expect(await screen.findByText("Moved to Media")).toBeInTheDocument();
    expect(screen.queryByTestId("native-weather")).toBeNull();
  });

  it("refreshes a widget that updates on its own, and Shift R refreshes the page", async () => {
    const refresh = vi.fn();
    cardLive("weather").refreshers.set("/api/widgets/openmeteo", refresh);
    await mount({ mode: "edit" });
    expect(within(await menuFor("clock")).queryByRole("menuitem", { name: /Refresh now/ })).toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(within(await menuFor("weather")).getByRole("menuitem", { name: /Refresh now/ }));
    expect(refresh).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "R", shiftKey: true });
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(await screen.findByText("Refreshing 1 widget on this page")).toBeInTheDocument();
    cardLive("weather").refreshers.clear();
  });

  it("copies the selected widget's look with Ctrl Alt C", async () => {
    await mount({ mode: "edit" });
    fireEvent.click(screen.getByRole("checkbox", { name: "Select clock" }));
    fireEvent.keyDown(window, { key: "ç", code: "KeyC", ctrlKey: true, altKey: true });
    expect(await screen.findByText("Look copied")).toBeInTheDocument();
  });
});

describe("Several widgets at once", () => {
  it("shows the bar while widgets are selected; Ctrl A selects the page and Esc lets go", async () => {
    await mount({ mode: "edit" });
    expect(screen.queryByRole("toolbar", { name: /selected/ })).toBeNull();
    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    const bar = await screen.findByRole("toolbar", { name: "2 selected" });
    expect(
      within(bar)
        .getAllByRole("button")
        .map((button) => button.textContent || button.getAttribute("aria-label")),
    ).toEqual(["Look", "Size", "Page", "Stack", "Duplicate", "Delete", "Clear selection"]);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("toolbar", { name: /selected/ })).toBeNull();
  });

  it("Shift-click adds a widget to the selection", async () => {
    await mount({ mode: "edit" });
    fireEvent.click(screen.getByTestId("native-clock"), { shiftKey: true });
    fireEvent.click(screen.getByTestId("native-weather"), { shiftKey: true });
    expect(screen.getByRole("toolbar", { name: "2 selected" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Select weather" })).toBeChecked();
  });

  it("changes the look of all of them, marking settings they don't share as Mixed", async () => {
    const { writes } = await mount({ mode: "edit" });
    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    fireEvent.click(within(screen.getByRole("toolbar", { name: "2 selected" })).getByRole("button", { name: "Look" }));
    const dialog = await screen.findByRole("dialog");
    // Clock has round corners and a shadow, weather the defaults.
    expect(within(dialog).getAllByText("Mixed")).toHaveLength(2);
    const apply = within(dialog).getByRole("button", { name: "Apply to 2 widgets" });
    expect(apply).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("radio", { name: "Square" }));
    fireEvent.click(apply);
    expect(await screen.findByText("Changed 2 widgets")).toBeInTheDocument();
    // Saved by itself (autosave).
    await waitFor(() => expect(writes.length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getByText("Saved", { exact: true })).toBeInTheDocument());
    const looks = Object.fromEntries(writes.at(-1).body.board.panels.map((item) => [item.id, item.look]));
    // Only the changed setting is applied; each keeps its own edge.
    expect(looks.clock).toEqual({ corners: "square", edge: "shadow" });
    expect(looks.weather).toEqual({ corners: "square" });
  });

  it("duplicates and deletes them in one save", async () => {
    const { writes } = await mount({ mode: "edit" });
    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    fireEvent.click(
      within(screen.getByRole("toolbar", { name: "2 selected" })).getByRole("button", { name: "Delete" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Delete 2 widgets?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete 2 widgets" }));
    await waitFor(() => expect(writes.find((write) => write.path === "/studio/api/widgets-delete")).toBeTruthy());
    expect(writes.at(-1).body.ids.sort()).toEqual(["clock", "weather"]);
  });
});

describe("Tidy up", () => {
  it("closes gaps on the page in one undoable step, and is off when there are none", async () => {
    const gappy = structuredClone(twoPages);
    gappy.panels[1].rect = { x: 8, y: 9, w: 8, h: 6 };
    const { writes } = await mount({ board: gappy, mode: "edit" });
    fireEvent.click(screen.getByRole("button", { name: "Tidy up" }));
    expect(await screen.findByText("Tidied up")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tidy up" })).toBeDisabled();
    // Saved by itself (autosave).
    await waitFor(() => expect(writes.length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getByText("Saved", { exact: true })).toBeInTheDocument());
    expect(writes.at(-1).body.board.panels.find((item) => item.id === "weather").rect.y).toBe(0);
  });
});

describe("Newly discovered widgets", () => {
  it("asks once which page they go on, with the current page preselected", async () => {
    const board = structuredClone(twoPages);
    board.panels[2].nativeLocator = { ...board.panels[2].nativeLocator, discovered: true };
    const { writes } = await mount({ board, mode: "edit", envelope: { newDiscoveredIds: ["plex"] } });
    const note = await screen.findByRole("group", { name: "Newly discovered widgets" });
    expect(within(note).getByText("A new widget was discovered.")).toBeTruthy();
    const select = within(note).getByRole("combobox", { name: "Put it on" });
    expect(select.textContent).toBe("Overview");
    fireEvent.click(within(note).getByRole("button", { name: "Put it there" }));
    await waitFor(() => expect(screen.queryByRole("group", { name: "Newly discovered widgets" })).toBeNull());
    await waitFor(() => expect(writes.length).toBeGreaterThan(0));
    const saved = writes.at(-1).body.board;
    expect(saved.panels.find((item) => item.id === "plex").pageId).toBe("home");
  });
});

describe("Widget controls on touch screens", () => {
  it("shows Move, Edit and resize only on the widget last tapped", async () => {
    await mount({ mode: "edit" });
    const section = (id) => document.querySelector(`[data-panel-id="${id}"]`);
    const tap = (element) => {
      fireEvent.pointerDown(element, { pointerType: "touch" });
      fireEvent.click(element);
    };
    expect(section("clock").classList.contains("studio-tools-shown")).toBe(false);
    tap(screen.getByTestId("native-clock"));
    expect(section("clock").classList.contains("studio-tools-shown")).toBe(true);
    tap(screen.getByTestId("native-weather"));
    expect(section("clock").classList.contains("studio-tools-shown")).toBe(false);
    expect(section("weather").classList.contains("studio-tools-shown")).toBe(true);
    // A mouse click changes nothing; the controls show on hover there.
    fireEvent.pointerDown(screen.getByTestId("native-clock"), { pointerType: "mouse" });
    fireEvent.click(screen.getByTestId("native-clock"));
    expect(section("weather").classList.contains("studio-tools-shown")).toBe(true);
    // A tap on empty space hides them again.
    tap(document.querySelector(".studio-canvas"));
    expect(section("weather").classList.contains("studio-tools-shown")).toBe(false);
  });
});

describe("Deleting one widget", () => {
  it("deletes at once without a dialog and offers Undo", async () => {
    const { writes } = await mount({ mode: "edit" });
    fireEvent.click(within(await menuFor("weather")).getByRole("menuitem", { name: /^Delete/ }));
    await waitFor(() => expect(writes.some((write) => write.path === "/studio/api/widgets-delete")).toBe(true));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(writes.find((write) => write.path === "/studio/api/widgets-delete").body.ids).toEqual(["weather"]);
    const toast = (await screen.findByText("weather deleted")).closest(".studio-toast");
    expect(await within(toast).findByRole("button", { name: "Undo" })).toBeEnabled();
    expect(screen.getByRole("toolbar", { name: "Editing" }).querySelector("[aria-label='Undo']")).toBeEnabled();
  });
});

describe("Investigate", () => {
  const viewer = (operations) => ({
    authEnabled: true,
    level: "view",
    user: { displayName: "Sam", username: "sam", role: "member" },
    dashboard: { id: "default" },
    operations,
  });

  it("is the only item while viewing, for people with Monitoring or Logs, and opens a sheet", async () => {
    await mount({ accessValue: viewer({ monitoring: true, logs: true }) });
    const menu = await menuFor("clock");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["Investigate"]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Investigate" }));
    const sheet = await screen.findByRole("dialog", { name: /clock: what’s happening/ });
    expect(await within(sheet).findByText("Down")).toBeInTheDocument();
    expect(within(sheet).getByText("Connection refused · check the address and port")).toBeInTheDocument();
    expect(await within(sheet).findByText("clock: Down · Connection refused")).toBeInTheDocument();
    expect(within(sheet).getByRole("link", { name: "Open in Operations" })).toHaveAttribute(
      "href",
      `/studio/operations#monitor/${encodeURIComponent("card:default:clock")}`,
    );
  });

  it("goes to the widget's logs when the card has no status check", async () => {
    await mount({ accessValue: viewer({ monitoring: false, logs: true }) });
    fireEvent.click(within(await menuFor("weather")).getByRole("menuitem", { name: "Investigate" }));
    const sheet = await screen.findByRole("dialog", { name: /weather: what’s happening/ });
    expect(within(sheet).queryByText("Status check")).toBeNull();
    expect(within(sheet).getByRole("link", { name: "Show in Logs" }).getAttribute("href")).toBe(
      `/studio/operations#logs?${new URLSearchParams({ panel: "weather", scope: "default", name: "weather" })}`,
    );
  });

  it("is offered for the widget a stack is showing", async () => {
    const stacked = {
      ...twoPages,
      panels: [panel("clock", "home", 0), panel("weather", "home", 0), panel("plex", "media", 0)],
      stacks: [
        {
          id: "s1",
          panelIds: ["clock", "weather"],
          rect: { x: 0, y: 0, w: 8, h: 6 },
          playback: {
            mode: "manual",
            intervalMs: 10000,
            manualHoldMs: 30000,
            transition: "horizontal",
            transitionDurationMs: 250,
            loop: true,
          },
        },
      ],
    };
    await mount({ board: stacked, accessValue: viewer({ monitoring: true, logs: true }) });
    const menu = await menuFor("clock");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["Investigate"]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Investigate" }));
    expect(await screen.findByRole("dialog", { name: /clock: what’s happening/ })).toBeInTheDocument();
  });

  it("is not offered to viewers without Monitoring or Logs", async () => {
    await mount({ accessValue: viewer({ monitoring: false, logs: false }) });
    fireEvent.contextMenu(screen.getByTestId("native-clock"));
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
