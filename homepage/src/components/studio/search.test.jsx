// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PreferencesContext, searchEngine, viewedSettings, withDisplayPreferences } from "./preferences";
import StudioSearch, { matchItems, searchableItems, typedAddress } from "./search";

vi.mock("components/resolvedicon", () => ({ default: () => null }));

const board = {
  pages: [
    { id: "home", name: "Home" },
    { id: "net", name: "Network" },
  ],
  panels: [
    { id: "a", kind: "bookmark", title: "Docs", pageId: "home", nativeLocator: { group: "Links", name: "Docs" } },
    { id: "b", kind: "bookmark", title: "Vault", pageId: "net", nativeLocator: { group: "Links", name: "Vault" } },
    {
      id: "c",
      kind: "informationWidget",
      title: "Clock",
      pageId: "net",
      nativeLocator: { type: "datetime", index: 0 },
    },
  ],
  stacks: [],
};
const data = {
  bookmarks: [
    {
      name: "Links",
      bookmarks: [
        { name: "Docs", href: "https://docs.example.org", description: "Handbook" },
        { name: "Vault", href: "https://vault.example.org", description: "passwords, SSO login" },
      ],
    },
  ],
  widgets: [{ type: "datetime", options: { index: 0 } }],
};

afterEach(() => vi.unstubAllGlobals());

describe("search model", () => {
  it("finds widgets on every page by name, then description, with their page", () => {
    const items = searchableItems(board, data);
    expect(items.map((item) => [item.name, item.pageName])).toEqual([
      ["Docs", "Home"],
      ["Vault", "Network"],
      ["Clock", "Network"],
    ]);
    expect(matchItems(items, "sso").map((item) => item.name)).toEqual(["Vault"]);
    expect(matchItems(items, "sso", { descriptions: false })).toEqual([]);
    // Names first (alphabetical), then a description match.
    expect(matchItems(items, "o").map((item) => item.name)).toEqual(["Clock", "Docs", "Vault"]);
  });

  it("recognises typed web addresses", () => {
    expect(typedAddress("example.org")).toBe("https://example.org");
    expect(typedAddress("http://nas.example:5000/x")).toBe("http://nas.example:5000/x");
    expect(typedAddress("sso login")).toBeNull();
    expect(typedAddress("vault")).toBeNull();
  });

  it("uses the person's engine, Google by default, and their custom address", () => {
    expect(searchEngine({}).name).toBe("Google");
    expect(searchEngine({ searchEngine: "kagi" }).name).toBe("Kagi");
    expect(searchEngine({ searchEngine: "custom", searchUrl: "https://search.example.org/?q=%s" }).url).toBe(
      "https://search.example.org/?q=%s",
    );
  });
});

describe("display preferences", () => {
  it("apply the person's light or dark choice only while viewing", () => {
    const settings = { studioTheme: { mode: "dark", accent: "#b299be" } };
    expect(viewedSettings(settings, { mode: "light" }, false).studioTheme).toEqual({
      mode: "light",
      accent: "#b299be",
    });
    expect(viewedSettings(settings, { mode: "light" }, true)).toBe(settings);
    expect(viewedSettings(settings, { mode: "dashboard" }, false)).toBe(settings);
  });

  it("set the clock and temperature on the widgets that show them", () => {
    const clock = { type: "datetime", options: { format: { timeStyle: "short", hourCycle: "h23" } } };
    expect(withDisplayPreferences(clock, { clock: "12", temperature: "dashboard" }).options.format).toEqual({
      timeStyle: "short",
      hour12: true,
    });
    expect(withDisplayPreferences(clock, { clock: "dashboard", temperature: "dashboard" }).options).toEqual(
      clock.options,
    );
    const weather = { type: "openmeteo", options: { units: "imperial" } };
    expect(withDisplayPreferences(weather, { clock: "dashboard", temperature: "c" }).options.units).toBe("metric");
    expect(withDisplayPreferences({ type: "search", options: {} }, { clock: "12", temperature: "f" }).options).toEqual(
      {},
    );
  });
});

describe("search dialog", () => {
  function mount(query, preferences = {}) {
    const onClose = vi.fn();
    const onShowPanel = vi.fn();
    const open = vi.fn();
    vi.stubGlobal("open", open);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => [query, []] })),
    );
    render(
      <PreferencesContext.Provider value={preferences}>
        <StudioSearch
          board={board}
          data={data}
          query={query}
          onQuery={vi.fn()}
          onClose={onClose}
          onShowPanel={onShowPanel}
        />
      </PreferencesContext.Provider>,
    );
    return { onClose, onShowPanel, open };
  }

  it("lists matches with their page, then the web search", () => {
    mount("vault");
    const list = screen.getByRole("listbox", { name: "Results" });
    const options = within(list).getAllByRole("option");
    expect(options[0]).toHaveTextContent("Vault");
    expect(options[0]).toHaveTextContent("Network");
    expect(options[1]).toHaveTextContent("Search Google for “vault”");
  });

  it("opens a link in a new tab by default and goes to the page for a widget without one", () => {
    const first = mount("vault");
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(first.open).toHaveBeenCalledWith("https://vault.example.org", "_blank", "noopener,noreferrer");
    expect(first.onClose).toHaveBeenCalled();
  });

  it("takes you to a widget's page when it has no link", () => {
    const { onShowPanel } = mount("clock");
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(onShowPanel).toHaveBeenCalledWith(expect.objectContaining({ id: "c", pageId: "net" }));
  });

  it("searches the web with the person's engine and moves with the arrow keys", () => {
    const { open } = mount("vault", { searchEngine: "duckduckgo" });
    const box = screen.getByRole("combobox");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(open).toHaveBeenCalledWith("https://duckduckgo.com/?q=vault", "_blank", "noopener,noreferrer");
  });
});
