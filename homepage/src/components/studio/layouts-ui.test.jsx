// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import StudioBoard from "./board";
import { PHONE_COLUMNS, rowStep } from "./geometry.mjs";

vi.mock("./native-panel", () => ({
  default: ({ panel }) => <output data-testid={`native-${panel.id}`}>{panel.title}</output>,
}));
vi.mock("components/resolvedicon", () => ({ default: ({ icon }) => <i data-icon={icon} /> }));

// Owner decision, 4 Nov 2026 (boards 22 and 23): a layout for each size, and
// an even or centred grid per page.
const CONFIG = "a".repeat(64);
const panel = (id, x, w = 6) => ({
  id,
  title: id,
  kind: "informationWidget",
  rect: { x, y: 0, w, h: 4 },
  pageId: "home",
});
const BOARD = {
  version: 3,
  columns: 24,
  pages: [
    { id: "home", name: "Home" },
    { id: "media", name: "Media" },
  ],
  panels: [panel("clock", 0), panel("weather", 6), panel("search", 12, 12)],
  stacks: [],
};

async function mount() {
  let state = { revision: "r1", configurationRevision: CONFIG, board: structuredClone(BOARD) };
  const writes = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path, options) => {
      let value = state;
      if (options?.method === "POST") {
        const body = JSON.parse(options.body);
        writes.push({ path, body });
        state = { ...state, revision: `r${writes.length + 1}`, ...(body.board ? { board: body.board } : {}) };
        value = state;
      } else if (path === "/studio/api/access") value = { authEnabled: false, level: "admin", user: null };
      return { ok: true, status: 200, json: async () => value };
    }),
  );
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <StudioBoard
        nativeData={{ configurationRevision: CONFIG }}
        settings={{ title: "Home lab" }}
        onNativeChange={async () => ({ configurationRevision: CONFIG })}
        onSearch={vi.fn()}
        mode="edit"
        onLeave={vi.fn()}
      />
    </SWRConfig>,
  );
  await waitFor(() => expect(screen.getByRole("button", { name: "Done" })).toBeEnabled());
  return { writes };
}

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  vi.stubGlobal("innerWidth", 1440);
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

const section = (name) => screen.getByTestId(`native-${name}`).closest("section");

describe("a layout for each size", () => {
  it("the phone follows desktop until a widget is moved there; that move saves only the phone layout", async () => {
    const { writes } = await mount();
    const sizes = screen.getByRole("group", { name: "Layout size" });
    fireEvent.click(within(sizes).getByRole("button", { name: "Phone" }));
    expect(within(sizes).getByRole("button", { name: "Phone" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/Follows desktop until you move or resize a widget here/)).toBeInTheDocument();
    // Small clock and weather pair up; the wide search goes below them.
    // Four rows down (rows follow the board's width, Board 5).
    expect(section("search").style.top).toBe(`${4 * rowStep(1200, PHONE_COLUMNS)}px`);
    fireEvent.keyDown(
      screen.getByRole("button", { name: "Move search. Use arrow keys; Shift and arrow keys resize." }),
      {
        key: "ArrowUp",
      },
    );
    await waitFor(() => expect(writes).toHaveLength(1));
    const saved = writes[0].body.board;
    expect(saved.panels.map((item) => item.rect)).toEqual(BOARD.panels.map((item) => item.rect));
    expect(saved.layouts.phone.search).toEqual({ x: 0, y: 3, w: 8, h: 4 });
    expect(saved.layouts.tablet).toBeUndefined();
    await screen.findByRole("button", { name: "Follow desktop again" });
    fireEvent.click(screen.getByRole("button", { name: "Follow desktop again" }));
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1].body.board.layouts).toBeUndefined();
  });

  it("a page can use a centred grid of 25 columns", async () => {
    const { writes } = await mount();
    fireEvent.click(screen.getByRole("button", { name: "Home page options" }));
    const menu = await screen.findByRole("menu");
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: "Centred grid, 25 columns" }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].body.board.pages[0].grid).toBe("centred");
    expect(Math.max(...writes[0].body.board.panels.map((item) => item.rect.x + item.rect.w))).toBe(25);
  });
});
