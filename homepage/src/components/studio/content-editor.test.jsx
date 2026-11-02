// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ContentEditor, { ContentPicker, customApiMappingsMissing } from "./content-editor";

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
      onParent={vi.fn()}
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
    expect(screen.getByRole("status")).toHaveTextContent(
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

describe("Content picker names", () => {
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
        onParent={vi.fn()}
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
    fireEvent.click(screen.getByRole("radio", { name: "Line" }));
    // Back to the dashboard's edge: the key is removed, not stored.
    expect(screen.getByTestId("preview")).toHaveTextContent("null");
    fireEvent.click(screen.getByRole("radio", { name: "Round" }));
    expect(screen.getByTestId("preview")).toHaveTextContent('{"corners":"round"}');
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/studio/api/board");
    const body = JSON.parse(init.body);
    expect(body.board.panels[0].look).toEqual({ corners: "round" });
    vi.unstubAllGlobals();
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
    fireEvent.click(screen.getByRole("radio", { name: "Round" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
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
    expect(screen.getByRole("radiogroup", { name: "On click" })).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
