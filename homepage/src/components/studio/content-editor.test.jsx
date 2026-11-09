// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { SWRConfig } from "swr";
import { describe, expect, it, vi } from "vitest";

import ContentEditor, { ContentPicker, customApiMappingsMissing, ResizeCorner } from "./content-editor";

const customApi = {
  kind: "serviceWidget",
  type: "customapi",
  name: "Custom API",
  defaults: { url: "http://api.example.test/status" },
  fields: [{ key: "url", label: "API URL", type: "string" }],
};

function renderEditor(entry, catalog = { service: [entry], info: [] }) {
  return render(
    <ContentEditor
      state={{ revision: "r1", services: [], groups: [], bookmarks: [] }}
      catalog={catalog}
      entry={entry}
      onSaved={vi.fn()}
      onCancel={vi.fn()}
      onReload={vi.fn()}
      onDuplicate={vi.fn()}
    />,
  );
}

describe("Custom API empty mappings hint", () => {
  it("detects missing or empty mappings only for Custom API", () => {
    expect(customApiMappingsMissing("customapi", {})).toBe(true);
    expect(customApiMappingsMissing("customapi", { mappings: [] })).toBe(true);
    expect(customApiMappingsMissing("customapi", { mappings: {} })).toBe(true);
    expect(customApiMappingsMissing("customapi", { mappings: null })).toBe(true);
    expect(
      customApiMappingsMissing("customapi", {
        mappings: [{ field: "status", label: "Status" }],
      }),
    ).toBe(false);
    expect(
      customApiMappingsMissing("customapi", {
        mappings: { status: { label: "Status" } },
      }),
    ).toBe(false);
    expect(customApiMappingsMissing("glances", {})).toBe(false);
  });

  it("shows a non-blocking hint while mappings are empty and hides it once one is added", () => {
    renderEditor(customApi);
    // A new widget with an address also offers Test connection, whose result is a status too.
    expect(screen.getByRole("button", { name: "Test connection" })).toBeInTheDocument();
    expect(screen.getByText(/has no/)).toHaveTextContent(
      "This Custom API widget has no mappings yet, so its panel will be empty.",
    );
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Status API" },
    });
    const save = screen.getByRole("button", { name: /^(Add|Save)/ });
    expect(save).toBeEnabled();

    fireEvent.click(screen.getByRole("radio", { name: "YAML" }));
    fireEvent.change(screen.getByLabelText("Item configuration YAML"), {
      target: {
        value: "url: http://api.example.test/status\nmappings:\n  - field: status\n    label: Status\n",
      },
    });
    expect(screen.queryByText(/has no/)).not.toBeInTheDocument();
    expect(save).toBeEnabled();
  });

  it("shows the same hint for the Custom API information widget", () => {
    const info = { ...customApi, kind: "informationWidget" };
    renderEditor(info, { service: [], info: [info] });
    expect(screen.getByRole("status")).toHaveTextContent(
      "This Custom API widget has no mappings yet, so its panel will be empty.",
    );
  });

  it("does not show the hint for other integration widgets", () => {
    renderEditor({ ...customApi, type: "glances", name: "Glances" });
    expect(screen.queryByText(/has no/)).not.toBeInTheDocument();
  });
});

describe("Adding with starting settings", () => {
  it("sends a new widget's starting settings, as a duplicate's copied settings, not only what was changed", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ revision: "r2" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const onSaved = vi.fn();
    const copy = {
      kind: "informationWidget",
      type: "greeting",
      name: "Greeting",
      defaults: { text: "Hello", text_size: "xl" },
      fields: [{ key: "text", label: "Text", type: "string" }],
    };
    render(
      <ContentEditor
        state={{ revision: "r1", services: [], groups: [], bookmarks: [] }}
        catalog={{ service: [], info: [copy] }}
        entry={copy}
        onSaved={onSaved}
        onCancel={vi.fn()}
        onReload={vi.fn()}
        onDuplicate={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Add/ }));
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls.find(([, options]) => options?.method === "POST");
    expect(JSON.parse(init.body)).toMatchObject({
      action: "add",
      type: "greeting",
      config: { text: "Hello", text_size: "xl" },
    });
    vi.unstubAllGlobals();
  });
});

describe("Content picker names", () => {
  it("starts a new Resources widget showing CPU and memory, not an empty card", () => {
    const onChoose = vi.fn();
    render(
      <ContentPicker
        catalog={{ info: [{ type: "resources", name: "Resources", defaults: {} }], service: [] }}
        state={{ hiddenDiscoveredIds: [] }}
        onChoose={onChoose}
        onRestore={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Resources/ }));
    expect(onChoose.mock.calls[0][0].defaults).toEqual({ cpu: true, memory: true });
  });

  it("tells apart an information and an integration widget that share a name by their subtitle", () => {
    render(
      <ContentPicker
        catalog={{
          info: [
            { type: "customapi", name: "Custom API" },
            { type: "datetime", name: "Date & Time" },
          ],
          service: [{ type: "customapi", name: "Custom API" }],
        }}
        state={{ hiddenDiscoveredIds: [] }}
        onChoose={vi.fn()}
        onRestore={vi.fn()}
      />,
    );
    // The name stays as it is; the subtitle tells the two apart.
    const customApi = screen.getAllByRole("button", { name: /^Custom API/ });
    expect(customApi.map((item) => item.textContent)).toEqual([
      "Custom APIStands on its own, no app needed.",
      "Custom APILive numbers from one of your apps.",
    ]);
    expect(screen.queryByText(/\(information widget\)/)).not.toBeInTheDocument();
    expect(screen.getByText("Date & Time")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Information", exact: true }));
    expect(screen.getByText("Custom API")).toBeInTheDocument();
  });
});

describe("widget look in the widget dialog", () => {
  const bookmark = { id: "bm-1", name: "Docs", group: "Links", config: { href: "https://docs.example.com" } };
  const board = {
    version: 3,
    columns: 24,
    pages: [{ id: "home", name: "Home" }],
    panels: [
      {
        id: "bm-1",
        kind: "bookmark",
        title: "Docs",
        pageId: "home",
        rect: { x: 0, y: 0, w: 6, h: 2 },
        look: { edge: "shadow" },
      },
    ],
    stacks: [],
  };
  function renderBookmark(fetchMock, source = bookmark) {
    vi.stubGlobal("fetch", fetchMock);
    const onSaved = vi.fn();
    render(
      <ContentEditor
        state={{ revision: "r1", services: [], groups: [], bookmarks: [source] }}
        catalog={{ service: [], info: [] }}
        panel={board.panels[0]}
        wholeBoard={board}
        renderPreview={(panel, override) => (
          <>
            <output data-testid="preview">{JSON.stringify(panel.look ?? null)}</output>
            <output data-testid="preview-link">{JSON.stringify(override)}</output>
          </>
        )}
        onSaved={onSaved}
        onCancel={vi.fn()}
        onReload={vi.fn()}
        onDuplicate={vi.fn()}
      />,
    );
    return onSaved;
  }
  const ok = () =>
    vi.fn(
      async () =>
        new Response(JSON.stringify({ revision: "r2", board }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );

  it("previews the change and saves a look-only edit as the arrangement", async () => {
    const fetchMock = ok();
    const onSaved = renderBookmark(fetchMock);
    fireEvent.click(screen.getByRole("tab", { name: "Look" }));
    fireEvent.click(screen.getByRole("radio", { name: "Line" }));
    // Back to the dashboard's edge: the key is removed, not stored.
    expect(screen.getByTestId("preview")).toHaveTextContent("null");
    fireEvent.click(screen.getByRole("radio", { name: "Round" }));
    expect(screen.getByTestId("preview")).toHaveTextContent('{"corners":"round"}');
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls.find(([, options]) => options?.method === "POST");
    expect(String(url)).toContain("/studio/api/board");
    const body = JSON.parse(init.body);
    expect(body.board.panels[0].look).toEqual({ corners: "round" });
    vi.unstubAllGlobals();
  });

  it("docked beside the board, sends the draft to the board's own card instead of a preview", async () => {
    vi.stubGlobal("fetch", ok());
    const onLiveDraft = vi.fn();
    render(
      <ContentEditor
        state={{ revision: "r1", services: [], groups: [], bookmarks: [bookmark] }}
        catalog={{ service: [], info: [] }}
        panel={board.panels[0]}
        wholeBoard={board}
        renderPreview={() => <output data-testid="preview" />}
        docked
        onLiveDraft={onLiveDraft}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
        onReload={vi.fn()}
        onDuplicate={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("preview")).toBeNull();
    await vi.waitFor(() => expect(onLiveDraft).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("tab", { name: "Look" }));
    fireEvent.click(screen.getByRole("radio", { name: "Round" }));
    await vi.waitFor(() =>
      expect(onLiveDraft.mock.lastCall[0].panel.look).toEqual(expect.objectContaining({ corners: "round" })),
    );
    expect(onLiveDraft.mock.lastCall[0].panel.id).toBe(board.panels[0].id);
  });

  it("shows the link as it is typed in the preview", () => {
    renderBookmark(ok());
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Docs site" } });
    expect(JSON.parse(screen.getByTestId("preview-link").textContent)).toEqual({
      name: "Docs site",
      href: "https://docs.example.com",
    });
    vi.unstubAllGlobals();
  });

  it("sends the arrangement along with a content edit", async () => {
    const fetchMock = ok();
    renderBookmark(fetchMock);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Docs site" } });
    fireEvent.click(screen.getByRole("tab", { name: "Look" }));
    fireEvent.click(screen.getByRole("radio", { name: "Round" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([, options]) => options?.method === "POST")).toBe(true));
    const [url, init] = fetchMock.mock.calls.find(([, options]) => options?.method === "POST");
    expect(String(url)).toContain("/studio/api/bookmark");
    const body = JSON.parse(init.body);
    expect(body.name).toBe("Docs site");
    expect(body.board.panels[0].look).toEqual({ edge: "shadow", corners: "round" });
    vi.unstubAllGlobals();
  });

  it("keeps On click as the only link-target control and hides the panel id", () => {
    renderBookmark(ok(), {
      ...bookmark,
      config: { href: "https://docs.example.com", target: "_self", id: "studio-abc" },
    });
    expect(screen.queryByText("Open target")).toBeNull();
    expect(screen.queryByText("More options")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Behaviour" }));
    expect(screen.getByRole("radiogroup", { name: "On click" })).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});

// Owner rule and Q2, 4 Nov 2026: every widget is self-contained. There is no
// group and no service to choose; the widget's name and link are its own.
describe("a self-contained widget", () => {
  it("adds a widget with only its name: no Group, no Service picker", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ revision: "r2" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderEditor(customApi);
    expect(screen.queryByLabelText("Group")).toBeNull();
    expect(screen.queryByLabelText("Service")).toBeNull();
    expect(screen.getByLabelText("Name")).toHaveValue("Custom API");
    fireEvent.change(screen.getByLabelText("Link"), { target: { value: "https://api.example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to dashboard" }));
    const post = () => fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    await vi.waitFor(() => expect(post()).toBeTruthy());
    expect(String(post()[0])).toContain("/studio/api/service-widget");
    const body = JSON.parse(post()[1].body);
    expect(body.newService).toEqual({ name: "Custom API" });
    expect(body.service).toEqual({ href: "https://api.example.test" });
    expect(body).not.toHaveProperty("serviceId");
    expect(body).not.toHaveProperty("group");
    vi.unstubAllGlobals();
  });
});

// Board 24: the dialog's settings live in sections opened one at a time, each
// summarised while closed; the setup guide has a section of its own.
describe("widget dialog sections", () => {
  const board = {
    version: 3,
    columns: 24,
    pages: [
      { id: "home", name: "Home" },
      { id: "media", name: "Media" },
    ],
    panels: [
      {
        id: "bm-1",
        kind: "bookmark",
        title: "Docs",
        pageId: "media",
        rect: { x: 0, y: 0, w: 6, h: 2 },
        look: { fill: "tint", corners: "round" },
      },
    ],
    stacks: [],
  };
  const renderBookmark = () =>
    render(
      <ContentEditor
        state={{
          revision: "r1",
          services: [],
          groups: [],
          bookmarks: [{ id: "bm-1", name: "Docs", group: "Links", config: { href: "https://docs.example.com/a" } }],
        }}
        catalog={{ service: [], info: [] }}
        panel={board.panels[0]}
        wholeBoard={board}
        renderPreview={() => null}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
        onReload={vi.fn()}
        onDuplicate={vi.fn()}
      />,
    );

  it("edits an existing item in tabs, keeping every tab's settings while another is open", () => {
    renderBookmark();
    const tabs = screen.getAllByRole("tab").map((tab) => tab.textContent);
    // A bookmark shows no values, so it has no Show tab.
    expect(tabs).toEqual(["Data", "Look", "Behaviour"]);
    expect(screen.getByRole("tab", { name: "Data" })).toHaveAttribute("aria-selected", "true");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Docs site" } });
    fireEvent.click(screen.getByRole("tab", { name: "Look" }));
    expect(screen.getByRole("radiogroup", { name: "Fill" })).toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: "Behaviour" }));
    expect(screen.getByRole("combobox", { name: "Page" })).toHaveTextContent("Media");
    expect(screen.queryByRole("radiogroup", { name: "Fill" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Data" }));
    // What was typed on another tab is still there.
    expect(screen.getByLabelText("Name")).toHaveValue("Docs site");
    // The arrow keys move between tabs.
    fireEvent.keyDown(screen.getByRole("tab", { name: "Data" }), { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "Behaviour" })).toHaveAttribute("aria-selected", "true");
  });

  it("resizes from the preview's corner, never below the smallest size, and saves it", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ revision: "r2", board }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <ContentEditor
        state={{
          revision: "r1",
          services: [],
          groups: [],
          bookmarks: [{ id: "bm-1", name: "Docs", group: "Links", config: { href: "https://docs.example.com/a" } }],
        }}
        catalog={{ service: [], info: [] }}
        panel={board.panels[0]}
        wholeBoard={board}
        renderPreview={(panel, override, extra) => (
          <section className="studio-card-preview">
            <output data-testid="rect">{JSON.stringify(panel.rect)}</output>
            {extra}
          </section>
        )}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
        onReload={vi.fn()}
        onDuplicate={vi.fn()}
      />,
    );
    expect(screen.getByText(/Desktop size/)).toHaveTextContent(
      "6 × 2 Desktop size. Drag the corner to change it; it stops at the smallest size these settings allow.",
    );
    const corner = screen.getByRole("button", { name: /^Resize/ });
    fireEvent.keyDown(corner, { key: "ArrowLeft" });
    fireEvent.keyDown(corner, { key: "ArrowLeft" });
    expect(JSON.parse(screen.getByTestId("rect").textContent)).toMatchObject({ w: 5, h: 2 });
    fireEvent.keyDown(corner, { key: "ArrowRight" });
    fireEvent.keyDown(corner, { key: "ArrowRight" });
    fireEvent.keyDown(corner, { key: "ArrowRight" });
    fireEvent.keyDown(corner, { key: "ArrowDown" });
    expect(corner).toHaveAccessibleName(/8 columns wide, 3 rows tall/);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([, options]) => options?.method === "POST")).toBe(true));
    const [url, init] = fetchMock.mock.calls.find(([, options]) => options?.method === "POST");
    expect(String(url)).toContain("/studio/api/board");
    expect(JSON.parse(init.body).board.panels[0].rect).toEqual({ x: 0, y: 0, w: 8, h: 3 });
    vi.unstubAllGlobals();
  });

  it("keeps Duplicate and Delete in the More actions menu beside the tabs", () => {
    renderBookmark();
    expect(screen.queryByRole("menuitem", { name: "Duplicate" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(screen.getByRole("menuitem", { name: "Duplicate" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeInTheDocument();
    // A bookmark can't be saved as a saved widget.
    expect(screen.queryByRole("menuitem", { name: "Save as a saved widget" })).toBeNull();
  });

  it("a new widget opens on its connection, with the setup guide in its own section", () => {
    renderEditor({
      ...customApi,
      guide: [{ type: "p", text: "Turn on the API." }],
      secrets: [
        {
          key: "key",
          label: "API key",
          secret: "homepage_customapi_key",
          variable: "HOMEPAGE_FILE_CUSTOMAPI_KEY",
          reference: "{{HOMEPAGE_FILE_CUSTOMAPI_KEY}}",
        },
      ],
    });
    const connection = screen.getByRole("button", { name: /^Connection/ });
    expect(connection).toHaveAttribute("aria-expanded", "true");
    expect(connection).toHaveTextContent("api.example.test");
    const guide = screen.getByRole("button", { name: /^Setting up Custom API/ });
    expect(guide).toHaveTextContent("how to name its secrets");
    fireEvent.click(guide);
    expect(connection).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Turn on the API.")).toBeVisible();
  });

  it("flags a closed section whose settings need fixing", () => {
    renderEditor({
      ...customApi,
      fields: [...customApi.fields, { key: "refreshInterval", label: "Refresh interval", type: "number" }],
    });
    const connection = screen.getByRole("button", { name: /^Connection/ });
    expect(connection).not.toHaveTextContent("Needs a fix");
    fireEvent.change(screen.getByLabelText("Refresh interval"), { target: { value: "soon" } });
    fireEvent.click(connection);
    expect(connection).toHaveAttribute("aria-expanded", "false");
    expect(connection).toHaveTextContent("Needs a fix");
  });
});

describe("a saved look updated from the widget dialog", () => {
  it("can move the other widgets using it to its new version when the dialog saves", async () => {
    const night = { fill: "tint" };
    const board = {
      version: 3,
      columns: 24,
      pages: [{ id: "home", name: "Home" }],
      panels: [
        {
          id: "bm-1",
          kind: "bookmark",
          title: "Docs",
          pageId: "home",
          rect: { x: 0, y: 0, w: 6, h: 2 },
          look: { corners: "round" },
        },
        { id: "bm-2", kind: "bookmark", title: "Wiki", pageId: "home", rect: { x: 6, y: 0, w: 6, h: 2 }, look: night },
      ],
      stacks: [],
      looks: [{ id: "n", name: "Night", look: night }],
    };
    const fetchMock = vi.fn(async (url) =>
      String(url).includes("/studio/api/library")
        ? new Response(JSON.stringify({ scopes: ["dashboard", "everyone"], looks: [], widgets: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        : new Response(JSON.stringify({ revision: "r2", board }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <ContentEditor
        state={{
          revision: "r1",
          services: [],
          groups: [],
          bookmarks: [
            { id: "bm-1", name: "Docs", group: "Links", config: { href: "https://docs.example.com" } },
            { id: "bm-2", name: "Wiki", group: "Links", config: { href: "https://wiki.example.com" } },
          ],
        }}
        catalog={{ service: [], info: [] }}
        panel={board.panels[0]}
        wholeBoard={board}
        renderPreview={() => null}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
        onReload={vi.fn()}
        onDuplicate={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Look" }));
    fireEvent.click(screen.getByRole("button", { name: "None picked" }));
    fireEvent.click(screen.getByRole("button", { name: "Manage saved looks" }));
    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "1 other widget on this dashboard uses “Night”. Update it too?",
    );
    fireEvent.click(screen.getByRole("button", { name: "Update it" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([, options]) => options?.method === "POST")).toBe(true));
    const body = JSON.parse(fetchMock.mock.calls.find(([, options]) => options?.method === "POST")[1].body);
    expect(body.board.looks).toEqual([{ id: "n", name: "Night", look: { corners: "round" } }]);
    expect(body.board.panels.find((item) => item.id === "bm-2").look).toEqual({ corners: "round" });
    vi.unstubAllGlobals();
  });
});

// Board 26: Links and Saved tabs, the search kept for Back, and saved widgets
// placed as new widgets.
describe("adding a widget", () => {
  const catalog = {
    info: [{ type: "datetime", name: "Date & Time" }],
    service: [{ type: "pfsense", name: "pfSense", description: "Firewall. WAN status and IP." }],
  };
  const json = (value) =>
    new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });

  it("keeps links together, passes the search on for Back and restores it", () => {
    const onChoose = vi.fn();
    const { unmount } = render(
      <ContentPicker catalog={catalog} state={{ hiddenDiscoveredIds: [] }} onChoose={onChoose} onRestore={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Links", exact: true }));
    expect(screen.getAllByRole("button", { name: /^(Service tile|Bookmark)/ })).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "All", exact: true }));
    fireEvent.change(screen.getByLabelText("Find a tile or widget"), { target: { value: "pf" } });
    fireEvent.click(screen.getByRole("button", { name: /^pfSense/ }));
    expect(onChoose).toHaveBeenCalledWith(expect.objectContaining({ type: "pfsense" }), {
      query: "pf",
      category: "all",
    });
    unmount();
    render(
      <ContentPicker
        catalog={catalog}
        state={{ hiddenDiscoveredIds: [] }}
        initial={{ query: "pf", category: "serviceWidget" }}
        onChoose={onChoose}
        onRestore={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Find a tile or widget")).toHaveValue("pf");
    expect(screen.getByRole("button", { name: "Integrations" })).toHaveAttribute("aria-pressed", "true");
  });

  it("lists saved widgets by name, type and who can use them, and places one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          scopes: ["dashboard", "everyone"],
          looks: [],
          widgets: [
            {
              id: "a1",
              kind: "widget",
              name: "Edge firewall",
              scope: "everyone",
              widgetKind: "serviceWidget",
              type: "pfsense",
            },
          ],
        }),
      ),
    );
    const onPlace = vi.fn(async () => {});
    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <ContentPicker
          catalog={catalog}
          state={{ hiddenDiscoveredIds: [] }}
          onChoose={vi.fn()}
          onRestore={vi.fn()}
          onPlace={onPlace}
        />
      </SWRConfig>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Saved" }));
    const entry = await screen.findByRole("button", { name: /^Edge firewall/ });
    expect(entry).toHaveTextContent("pfSense · Everyone");
    fireEvent.click(entry);
    await vi.waitFor(() =>
      expect(onPlace).toHaveBeenCalledWith(expect.objectContaining({ id: "a1", scope: "everyone" })),
    );
    vi.unstubAllGlobals();
  });

  it("saves a widget as a saved widget from Management, for the chosen people", async () => {
    const fetchMock = vi.fn(async (url, init) =>
      init?.method === "POST"
        ? json({ entry: { id: "b2", name: "Clock", scope: "everyone" } })
        : json({ scopes: ["dashboard", "everyone"], looks: [], widgets: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const board = {
      version: 3,
      columns: 24,
      pages: [{ id: "home", name: "Home" }],
      panels: [
        { id: "info-1", kind: "informationWidget", title: "Clock", pageId: "home", rect: { x: 0, y: 0, w: 6, h: 2 } },
      ],
      stacks: [],
    };
    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <ContentEditor
          state={{
            revision: "r1",
            services: [],
            groups: [],
            bookmarks: [],
            infoWidgets: [{ id: "info-1", type: "datetime", config: {} }],
          }}
          catalog={catalog}
          panel={{ ...board.panels[0], nativeLocator: { index: 0, type: "datetime" } }}
          wholeBoard={board}
          renderPreview={() => null}
          onSaved={vi.fn()}
          onCancel={vi.fn()}
          onReload={vi.fn()}
          onDuplicate={vi.fn()}
        />
      </SWRConfig>,
    );
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Save as a saved widget" }));
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Clock" } });
    fireEvent.click(screen.getByRole("radio", { name: "Everyone" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText(/Saved as “Clock” for everyone/);
    const body = JSON.parse(fetchMock.mock.calls.find(([, init]) => init?.method === "POST")[1].body);
    expect(body).toEqual({ action: "add", kind: "widget", scope: "everyone", name: "Clock", panelId: "info-1" });
    vi.unstubAllGlobals();
  });
});

describe("the preview's resize corner", () => {
  const drag = (dx, dy) => {
    let rect = { x: 12, y: 30, w: 6, h: 4 };
    const onChange = (update) => {
      rect = update(rect);
    };
    const view = render(
      <div className="studio-card-preview" data-testid="card">
        <ResizeCorner rect={rect} minimum={{ w: 2, h: 2 }} columns={24} onChange={onChange} />
      </div>,
    );
    // Drawn 6 columns of 40 px and 4 rows of 48 px.
    view.getByTestId("card").getBoundingClientRect = () => ({ width: 240, height: 192, left: 0, top: 0 });
    const corner = view.getByRole("button", { name: /^Resize:/ });
    fireEvent.pointerDown(corner, { clientX: 500, clientY: 400, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 500 + dx, clientY: 400 + dy });
    fireEvent.pointerUp(window);
    view.unmount();
    return rect;
  };

  it("measures a drag from where the pointer pressed, not from the widget's place", () => {
    expect(drag(0, 0)).toMatchObject({ w: 6, h: 4 });
    expect(drag(30, 0)).toMatchObject({ w: 7, h: 4 });
    expect(drag(0, 40)).toMatchObject({ w: 6, h: 5 });
  });
});
