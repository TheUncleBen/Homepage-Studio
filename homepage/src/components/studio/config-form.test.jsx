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
  it("synchronizes adjacent settings changes into valid YAML without discarding an incomplete edit", () => {
    const props = { onChange: vi.fn(), fields: [] };
    const { rerender } = render(
      <ConfigForm {...props} value={{ title: "Before" }} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Advanced YAML" }));
    rerender(
      <ConfigForm
        {...props}
        value={{ title: "Before", studioTheme: { mode: "light" } }}
      />,
    );
    expect(screen.getByLabelText("Item configuration YAML")).toHaveValue(
      "title: Before\nstudioTheme:\n  mode: light\n",
    );
    fireEvent.change(screen.getByLabelText("Item configuration YAML"), {
      target: { value: "studioTheme: [" },
    });
    rerender(
      <ConfigForm
        {...props}
        value={{ title: "Other setting", studioTheme: { mode: "light" } }}
      />,
    );
    expect(screen.getByLabelText("Item configuration YAML")).toHaveValue(
      "studioTheme: [",
    );
    expect(screen.getByRole("button", { name: "Options" })).toBeDisabled();
  });
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
    fireEvent.click(screen.getByRole("button", { name: "Advanced YAML" }));
    expect(screen.getByLabelText("Item configuration YAML")).toHaveValue(
      "keep: [",
    );
  });
  it("reports an advanced YAML error by line and column without echoing the source", () => {
    render(<Fixture initial={{ keep: true }} fields={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Advanced YAML" }));
    fireEvent.change(screen.getByLabelText("Item configuration YAML"), {
      target: { value: "keep: true\nsecret: synthetic-private-marker\nlist: [a, b\n" },
    });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/^Invalid YAML at line 4, column 1: /);
    expect(alert).not.toHaveTextContent("synthetic-private-marker");
  });
  it("retains cyclic YAML as a local invalid draft without exposing it to adjacent controls", () => {
    const changed = vi.fn();
    render(<Fixture initial={{ keep: true }} fields={[]} onChange={changed} />);
    fireEvent.click(screen.getByRole("button", { name: "Advanced YAML" }));
    const text = "x-extra: &loop\n  self: *loop\n";
    fireEvent.change(screen.getByLabelText("Item configuration YAML"), {
      target: { value: text },
    });
    expect(changed).not.toHaveBeenCalled();
    expect(
      screen.getByText(/This item contains cyclic values/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Options" })).toBeDisabled();
    expect(screen.getByTestId("config-value")).toHaveTextContent(
      '{"keep":true}',
    );
    fireEvent.click(screen.getByRole("button", { name: "Advanced YAML" }));
    expect(screen.getByLabelText("Item configuration YAML")).toHaveValue(text);
    fireEvent.change(screen.getByLabelText("Item configuration YAML"), {
      target: { value: "keep: false\n" },
    });
    expect(changed).toHaveBeenCalledWith({ keep: false });
    expect(screen.getByRole("button", { name: "Options" })).toBeEnabled();
  });
  it.each([".inf", "-.inf", ".nan"])(
    "retains non-finite YAML (%s) without coercing it to null, then recovers after correction",
    (number) => {
      const changed = vi.fn();
      render(
        <Fixture initial={{ keep: true }} fields={[]} onChange={changed} />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Advanced YAML" }));
      const yaml = screen.getByLabelText("Item configuration YAML");
      const text = `limits:\n  values: [1, ${number}]\n`;
      fireEvent.change(yaml, { target: { value: text } });
      expect(changed).not.toHaveBeenCalled();
      expect(
        screen.getByText(/This item contains a non-finite number/),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Options" })).toBeDisabled();
      expect(screen.getByTestId("config-value")).toHaveTextContent(
        '{"keep":true}',
      );
      fireEvent.click(screen.getByRole("button", { name: "Advanced YAML" }));
      expect(yaml).toHaveValue(text);
      fireEvent.change(yaml, {
        target: { value: 'limits:\n  values: [1, 100]\nlabel: ".inf"\n' },
      });
      expect(changed).toHaveBeenCalledTimes(1);
      expect(changed).toHaveBeenCalledWith({
        limits: { values: [1, 100] },
        label: ".inf",
      });
      expect(
        screen.queryByText(/This item contains a non-finite number/),
      ).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Options" })).toBeEnabled();
    },
  );
  it("keeps parser-produced strings that resemble overflowing numbers intact", () => {
    const changed = vi.fn();
    render(<Fixture initial={{}} fields={[]} onChange={changed} />);
    fireEvent.click(screen.getByRole("button", { name: "Advanced YAML" }));
    fireEvent.change(screen.getByLabelText("Item configuration YAML"), {
      target: { value: 'large: 1e999\nlabel: ".inf"\n' },
    });
    expect(changed).toHaveBeenCalledWith({ large: "1e999", label: ".inf" });
    expect(screen.getByRole("button", { name: "Options" })).toBeEnabled();
  });
  it("retains a nested JSON overflow in its field until it is corrected instead of propagating a null", () => {
    const changed = vi.fn();
    render(
      <Fixture
        initial={{ limits: { values: [1, 2] } }}
        fields={[{ key: "limits", label: "Limits", type: "object" }]}
        onChange={changed}
      />,
    );
    const limits = screen.getByRole("textbox", { name: "Limits" });
    const overflow = '{"values":[1,1e999]}';
    fireEvent.change(limits, { target: { value: overflow } });
    expect(changed).not.toHaveBeenCalled();
    expect(limits).toHaveValue(overflow);
    expect(limits).toHaveAttribute("aria-invalid", "true");
    expect(
      screen.getByText(/This item contains a non-finite number/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Advanced YAML" }),
    ).toBeDisabled();
    expect(screen.getByTestId("config-value")).toHaveTextContent(
      '{"limits":{"values":[1,2]}}',
    );
    fireEvent.change(limits, { target: { value: '{"values":[1,100]}' } });
    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledWith({ limits: { values: [1, 100] } });
    expect(limits).toHaveAttribute("aria-invalid", "false");
    expect(
      screen.queryByText(/This item contains a non-finite number/),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Advanced YAML" })).toBeEnabled();
  });
});

describe("Accessible configuration views and field errors", () => {
  it("exposes the selected view and explains a view disabled by the other view's error", () => {
    render(<Fixture initial={{ title: "Before" }} fields={[]} />);
    const options = screen.getByRole("button", { name: "Options" });
    const yaml = screen.getByRole("button", { name: "Advanced YAML" });
    expect(options).toHaveAttribute("aria-pressed", "true");
    expect(yaml).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(yaml);
    expect(options).toHaveAttribute("aria-pressed", "false");
    expect(yaml).toHaveAttribute("aria-pressed", "true");
    expect(options).not.toHaveAttribute("aria-describedby");
    fireEvent.change(screen.getByLabelText("Item configuration YAML"), {
      target: { value: "title: [" },
    });
    expect(options).toBeDisabled();
    expect(options).toHaveAccessibleDescription(/Invalid YAML at line/);
  });
  it("links an option field's error message to its input", () => {
    render(
      <Fixture
        initial={{}}
        fields={[
          { key: "url", label: "Service URL", type: "string" },
          { key: "extra", label: "Extra", type: "object" },
        ]}
      />,
    );
    const extra = screen.getByLabelText(/Extra/);
    expect(extra).not.toHaveAttribute("aria-describedby");
    fireEvent.change(extra, { target: { value: "[1]" } });
    expect(extra).toHaveAttribute("aria-invalid", "true");
    expect(extra).toHaveAccessibleDescription("Use a JSON object.");
    const yaml = screen.getByRole("button", { name: "Advanced YAML" });
    expect(yaml).toBeDisabled();
    expect(yaml).toHaveAccessibleDescription("Use a JSON object.");
    fireEvent.change(extra, { target: { value: '{"a":1}' } });
    expect(extra).not.toHaveAttribute("aria-describedby");
    expect(yaml).not.toHaveAttribute("aria-describedby");
  });
});
