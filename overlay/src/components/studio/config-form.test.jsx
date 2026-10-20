// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import ConfigForm from "./config-form";

function Fixture({ fields, initial, onChange = () => {} }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <ConfigForm
        value={value}
        onChange={(next) => {
          setValue(next);
          onChange(next);
        }}
        fields={fields}
      />
      <output data-testid="config-value">{JSON.stringify(value)}</output>
    </>
  );
}

describe("Coherent native option drafts", () => {
  it("preserves unknown nested options and literal secret references while editing common fields", () => {
    render(
      <Fixture
        initial={{
          url: "http://example.invalid",
          secret: "{{HOMEPAGE_FILE_API_KEY}}",
          extra: { enabled: false, fields: ["one"] },
        }}
        fields={[{ key: "url", label: "Service URL", type: "string" }]}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Service URL/), {
      target: { value: "http://changed.invalid" },
    });
    const value = JSON.parse(screen.getByTestId("config-value").textContent);
    expect(value).toEqual({
      url: "http://changed.invalid",
      secret: "{{HOMEPAGE_FILE_API_KEY}}",
      extra: { enabled: false, fields: ["one"] },
    });
  });
  it("updates form input type after advanced YAML changes a native union value", () => {
    render(
      <Fixture
        initial={{ network: false }}
        fields={[
          {
            key: "network",
            label: "Network",
            type: "boolean",
            valueTypes: ["boolean", "string"],
          },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Advanced YAML" }));
    fireEvent.change(screen.getByLabelText("Item configuration YAML"), {
      target: { value: "network: eno1\nunknown: [1, false]\n" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Options" }));
    expect(screen.getByRole("textbox", { name: "Network" })).toHaveValue(
      "eno1",
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Network" }), {
      target: { value: "eno2" },
    });
    expect(JSON.parse(screen.getByTestId("config-value").textContent)).toEqual({
      network: "eno2",
      unknown: [1, false],
    });
  });
  it("keeps native defaults absent and creates an ordered selected-field list only after an explicit choice", () => {
    const changed = vi.fn();
    render(
      <Fixture
        initial={{}}
        onChange={changed}
        fields={[
          {
            key: "fields",
            label: "Visible fields",
            type: "array",
            choices: ["healthy", "total"],
          },
        ]}
      />,
    );
    expect(changed).not.toHaveBeenCalled();
    expect(screen.getByTestId("config-value")).toHaveTextContent("{}");
    fireEvent.click(screen.getByLabelText("total"));
    fireEvent.click(screen.getByLabelText("healthy"));
    expect(JSON.parse(screen.getByTestId("config-value").textContent)).toEqual({
      fields: ["total", "healthy"],
    });
  });
  it("does not replace a valid draft with invalid advanced YAML", () => {
    render(<Fixture initial={{ keep: true }} fields={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Advanced YAML" }));
    fireEvent.change(screen.getByLabelText("Item configuration YAML"), {
      target: { value: "keep: [" },
    });
    expect(screen.getByRole("button", { name: "Options" })).toBeDisabled();
    expect(screen.getByTestId("config-value")).toHaveTextContent(
      '{"keep":true}',
    );
  });
});
