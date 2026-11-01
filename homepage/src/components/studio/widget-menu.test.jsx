// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import StudioBoard from "./board";

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

async function mount({ board = twoPages, mode = "live" } = {}) {
  let state = { revision: "r1", configurationRevision: CONFIG, board: structuredClone(board) };
  const writes = [];
  const fetch = vi.fn(async (path, options) => {
    let value;
    if (options?.method === "POST") {
      const body = JSON.parse(options.body);
      writes.push({ path, body });
      state = { ...state, revision: `r${writes.length + 1}`, ...(body.board ? { board: body.board } : {}) };
      value = state;
    } else if (path === "/studio/api/access") value = { authEnabled: false, level: "admin", user: null };
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
  else await waitFor(() => expect(screen.getByRole("button", { name: "Quick Launch" })).toBeEnabled());
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
      "Delete…Del",
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
    fireEvent.click(screen.getByRole("button", { name: "Save arrangement" }));
    await waitFor(() => expect(writes).toHaveLength(1));
    const saved = writes[0].body.board.panels.find((item) => item.id === "weather");
    expect(saved.look).toEqual({ corners: "round", edge: "shadow" });
    // The copy is kept for pasting on other dashboards.
    expect(JSON.parse(localStorage.getItem("studio-look-clipboard"))).toEqual({ corners: "round", edge: "shadow" });
  });

  it("uses one look on every widget of the same type, and only offers it when there are others", async () => {
    const { writes } = await mount({ mode: "edit" });
    fireEvent.click(within(await menuFor("clock")).getByRole("menuitem", { name: /every datetime widget/ }));
    expect(await screen.findByText("Look used on 2 datetime widgets")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save arrangement" }));
    await waitFor(() => expect(writes).toHaveLength(1));
    const looks = Object.fromEntries(writes[0].body.board.panels.map((item) => [item.id, item.look]));
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

  it("copies the selected widget's look with Ctrl Alt C", async () => {
    await mount({ mode: "edit" });
    fireEvent.click(screen.getByRole("checkbox", { name: "Select clock" }));
    fireEvent.keyDown(window, { key: "ç", code: "KeyC", ctrlKey: true, altKey: true });
    expect(await screen.findByText("Look copied")).toBeInTheDocument();
  });
});
