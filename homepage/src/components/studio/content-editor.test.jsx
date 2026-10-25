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
  it("names the kind in All when an information and an integration widget share a name", () => {
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
    expect(screen.getByText("Custom API (information widget)")).toBeInTheDocument();
    expect(screen.getByText("Custom API (integration widget)")).toBeInTheDocument();
    expect(screen.getByText("Date & Time")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Information", exact: true }));
    expect(screen.getByText("Custom API")).toBeInTheDocument();
    expect(screen.queryByText(/\(information widget\)/)).not.toBeInTheDocument();
  });
});
