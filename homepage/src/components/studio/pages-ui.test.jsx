// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import StudioBoard from "./board";

vi.mock("./native-panel", () => ({
  default: ({ panel }) => <output data-testid={`native-${panel.id}`}>{panel.title}</output>,
}));
vi.mock("components/resolvedicon", () => ({ default: ({ icon }) => <i data-icon={icon} /> }));

const CONFIG = "a".repeat(64);
const panel = (id, pageId, x = 0) => ({
  id,
  title: id,
  kind: "informationWidget",
  rect: { x, y: 0, w: 8, h: 6 },
  pageId,
});
const twoPages = {
  version: 3,
  columns: 24,
  pages: [
    { id: "home", name: "Overview" },
    { id: "media", name: "Media", icon: "mdi-filmstrip" },
  ],
  panels: [panel("clock", "home"), panel("weather", "home", 8), panel("plex", "media")],
  stacks: [],
};

async function mount({ board = twoPages, mode = "live" } = {}) {
  let state = { revision: "r1", configurationRevision: CONFIG, board: structuredClone(board) };
  const writes = [];
  // A small stand-in for the server's editing session: undo and redo step
  // back through the saved states.
  const past = [];
  const future = [];
  const fetch = vi.fn(async (path, options) => {
    let value;
    if (options?.method === "POST") {
      const body = JSON.parse(options.body);
      writes.push({ path, body });
      if (path.endsWith("/studio/api/undo") || path.endsWith("/studio/api/redo")) {
        const [from, to] = path.endsWith("/undo") ? [past, future] : [future, past];
        to.push(state);
        state = from.pop();
        value = { ...state, canUndo: past.length > 0, canRedo: future.length > 0 };
      } else {
        past.push(state);
        future.length = 0;
        state = { ...state, revision: `r${writes.length + 1}`, ...(body.board ? { board: body.board } : {}) };
        value = state;
      }
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
  else await waitFor(() => expect(screen.getByRole("button", { name: "Search" })).toBeEnabled());
  return { ...view, writes };
}

beforeEach(() => {
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

describe("Pages on a dashboard", () => {
  it("shows no tab bar with one page, and no group filter", async () => {
    await mount({ board: { ...twoPages, pages: [twoPages.pages[0]], panels: twoPages.panels.slice(0, 2) } });
    expect(screen.queryByRole("navigation", { name: "Pages" })).toBeNull();
    expect(screen.queryByRole("button", { name: "All content" })).toBeNull();
  });

  it("mounts only the page in view; tabs, keys and the address change page", async () => {
    await mount();
    const nav = screen.getByRole("navigation", { name: "Pages" });
    expect(within(nav).getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("native-clock")).toBeInTheDocument();
    expect(screen.queryByTestId("native-plex")).toBeNull();
    fireEvent.click(within(nav).getByRole("link", { name: "Media" }));
    await screen.findByTestId("native-plex");
    expect(screen.queryByTestId("native-clock")).toBeNull();
    expect(window.location.hash).toBe("#media");
    fireEvent.keyDown(document.body, { key: "[" });
    await screen.findByTestId("native-clock");
    fireEvent.keyDown(document.body, { key: "2" });
    await screen.findByTestId("native-plex");
    act(() => {
      window.history.pushState(null, "", "/#overview");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await screen.findByTestId("native-clock");
  });

  it("opens the page named in the address", async () => {
    window.history.replaceState(null, "", "/#media");
    await mount();
    await screen.findByTestId("native-plex");
  });

  it("adds a page, names it in place, undoes and redoes, and saves pages with the arrangement", async () => {
    const { writes } = await mount({ mode: "edit" });
    fireEvent.click(screen.getByRole("button", { name: "Add page" }));
    const name = await screen.findByRole("textbox", { name: "Page name" });
    fireEvent.change(name, { target: { value: "Network" } });
    fireEvent.keyDown(name, { key: "Enter" });
    const nav = screen.getByRole("navigation", { name: "Pages" });
    await within(nav).findByRole("button", { name: "Network" });
    expect(screen.getByText("Nothing here yet")).toBeInTheDocument();
    // Saved by itself, every page with it.
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].path).toBe("/studio/api/board");
    expect(writes[0].body.board.pages.map((page) => page.name)).toEqual(["Overview", "Network", "Media"]);
    expect(writes[0].body.editSession).toMatch(/^[a-f0-9]{36}$/);
    await waitFor(() => expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled());
    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    await waitFor(() => expect(within(nav).queryByRole("button", { name: "Network" })).toBeNull());
    expect(writes[1].path).toBe("/studio/api/undo");
    expect(writes[1].body.editSession).toBe(writes[0].body.editSession);
    fireEvent.keyDown(document.body, { key: "y", ctrlKey: true });
    await within(nav).findByRole("button", { name: "Network" });
    expect(writes[2].path).toBe("/studio/api/redo");
  });

  it("Esc while naming a new page takes it back; Enter keeps it as New page", async () => {
    await mount({ mode: "edit" });
    const nav = screen.getByRole("navigation", { name: "Pages" });
    fireEvent.click(screen.getByRole("button", { name: "Add page" }));
    fireEvent.keyDown(await screen.findByRole("textbox", { name: "Page name" }), { key: "Escape" });
    await waitFor(() => expect(within(nav).queryByRole("button", { name: "New page" })).toBeNull());
    expect(within(nav).getByRole("button", { name: "Overview" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Add page" }));
    fireEvent.keyDown(await screen.findByRole("textbox", { name: "Page name" }), { key: "Enter" });
    await within(nav).findByRole("button", { name: "New page" });
  });

  it("refuses a duplicate page name while typing", async () => {
    await mount({ mode: "edit" });
    fireEvent.click(screen.getByRole("button", { name: "Add page" }));
    const name = await screen.findByRole("textbox", { name: "Page name" });
    fireEvent.change(name, { target: { value: "media" } });
    expect(screen.getByRole("alert")).toHaveTextContent("already a page called");
    fireEvent.keyDown(name, { key: "Enter" });
    expect(screen.getByRole("textbox", { name: "Page name" })).toBeInTheDocument();
  });

  it("deletes a page by moving its widgets, and moves selected widgets to another page", async () => {
    const { writes } = await mount({ mode: "edit" });
    const nav = screen.getByRole("navigation", { name: "Pages" });
    fireEvent.click(within(nav).getByRole("button", { name: "Media" }));
    await screen.findByTestId("native-plex");
    fireEvent.click(screen.getByRole("button", { name: "Media page options" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete page…" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/1 widget/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete page" }));
    await screen.findByTestId("native-plex");
    expect(screen.getByTestId("native-clock")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Pages" })).toBeInTheDocument();
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].body.board.pages).toEqual([{ id: "home", name: "Overview" }]);
    expect(writes[0].body.board.panels.every((item) => item.pageId === "home")).toBe(true);
  });
});

describe("Duplicate page", () => {
  it("asks the controller to copy the page and opens the copy", async () => {
    const { writes } = await mount({ mode: "edit" });
    fireEvent.click(screen.getByRole("button", { name: "Overview page options" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate page" }));
    await waitFor(() => expect(writes.some((write) => write.path === "/studio/api/page-duplicate")).toBe(true));
    expect(writes.find((write) => write.path === "/studio/api/page-duplicate").body).toEqual({
      revision: "r1",
      pageId: "home",
      editSession: expect.stringMatching(/^[a-f0-9]{36}$/),
    });
  });
});
