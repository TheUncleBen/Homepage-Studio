// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import AppearanceEditor from "./appearance-editor";

afterEach(() => vi.unstubAllGlobals());

function Draft({ initial = {}, onChange = () => {}, onValidity = () => {} }) {
  const [settings, setSettings] = useState(initial);
  return (
    <>
      <AppearanceEditor
        settings={settings}
        onChange={(next) => {
          setSettings(next);
          onChange(next);
        }}
        onValidity={onValidity}
      />
      <button
        onClick={() =>
          setSettings({
            ...settings,
            studioTheme: { ...settings.studioTheme, accent: "#81a8c8" },
          })
        }
      >
        Apply valid YAML draft
      </button>
    </>
  );
}

describe("dashboard appearance controls", () => {
  it("preserves unknown native settings while editing mode and accent, without installing defaults on open", () => {
    const onChange = vi.fn();
    const initial = {
      title: "Independent instance",
      providers: { weatherapi: "{{HOMEPAGE_VAR_WEATHER}}" },
      studioTheme: { future: null },
    };
    render(<Draft initial={initial} onChange={onChange} />);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("radio", { name: "Light" }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...initial,
      theme: "light",
      studioTheme: { future: null, mode: "light" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sage", exact: true }));
    expect(screen.getByRole("button", { name: "Sage", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(onChange.mock.lastCall[0]).toMatchObject({
      theme: "light",
      studioTheme: { mode: "light", accent: "#91b09e", future: null },
      providers: initial.providers,
    });
    fireEvent.click(screen.getByRole("radio", { name: "Follow device" }));
    expect(onChange.mock.lastCall[0]).not.toHaveProperty("theme");
    expect(onChange.mock.lastCall[0].studioTheme.mode).toBe("system");
  });

  it("shows the platform's values for rows the dashboard leaves alone, with no separate Default choice", () => {
    const onChange = vi.fn();
    const platform = { mode: "light", accent: "#91b09e", base: "slate", background: null };
    render(<AppearanceEditor settings={{ title: "Kitchen" }} platform={platform} onChange={onChange} />);
    expect(
      within(screen.getByRole("radiogroup", { name: "Display mode" })).queryByRole("radio", { name: "Default" }),
    ).toBeNull();
    expect(screen.getByRole("radio", { name: "Light" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Slate" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: "Sage", exact: true })).toHaveAttribute("aria-pressed", "true");
    // Choosing an own display mode leaves the accent following the platform.
    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(onChange).toHaveBeenLastCalledWith({ title: "Kitchen", theme: "dark", studioTheme: { mode: "dark" } });
  });

  it("choosing the platform's own value removes only that key (Rule 2)", () => {
    const onChange = vi.fn();
    const settings = { theme: "dark", studioTheme: { mode: "dark", accent: "#81a8c8", base: "forest", future: 1 } };
    render(
      <AppearanceEditor
        settings={settings}
        platform={{ mode: "light", accent: "#91b09e", base: "graphite" }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Sage", exact: true }));
    expect(onChange).toHaveBeenLastCalledWith({
      theme: "dark",
      studioTheme: { mode: "dark", base: "forest", future: 1 },
    });
    fireEvent.click(screen.getByRole("radio", { name: "Light" }));
    expect(onChange).toHaveBeenLastCalledWith({ studioTheme: { accent: "#81a8c8", base: "forest", future: 1 } });
    fireEvent.click(screen.getByRole("radio", { name: "Graphite" }));
    expect(onChange.mock.lastCall[0].studioTheme).not.toHaveProperty("base");
  });

  it("starts on Graphite and eggplant without a platform file", () => {
    render(<AppearanceEditor settings={{}} onChange={vi.fn()} />);
    expect(screen.getByRole("radio", { name: "Graphite" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: "Eggplant", exact: true })).toHaveAttribute("aria-pressed", "true");
  });

  it("stores card defaults only while they differ from the built-in look", () => {
    const onChange = vi.fn();
    render(<Draft onChange={onChange} />);
    expect(screen.queryByRole("radiogroup", { name: "Fill strength" })).toBeNull();
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Card fill" })).getByRole("radio", { name: "Tint" }));
    expect(onChange.mock.lastCall[0].studioTheme).toEqual({ card: { fill: "tint" } });
    expect(screen.getByRole("radiogroup", { name: "Fill strength" })).toBeTruthy();
    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: "Card fill" })).getByRole("radio", { name: "Plain" }),
    );
    expect(onChange.mock.lastCall[0]).not.toHaveProperty("studioTheme");
  });

  it("retains partially typed colors, reports invalid drafts and synchronizes an external YAML correction", () => {
    const onChange = vi.fn(),
      onValidity = vi.fn();
    render(<Draft onChange={onChange} onValidity={onValidity} />);
    fireEvent.click(screen.getByRole("button", { name: "Ocean", exact: true }));
    const input = screen.getByLabelText("Accent color");
    expect(input).toHaveValue("#81a8c8");
    fireEvent.change(input, { target: { value: "#abc" } });
    expect(input).toHaveValue("#abc");
    expect(onChange.mock.lastCall[0].studioTheme.accent).toBe("#aabbcc");
    fireEvent.change(input, { target: { value: "#abcd" } });
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(onValidity).toHaveBeenLastCalledWith(false);
    expect(onChange).toHaveBeenCalledTimes(2);
    // A custom color shows on the Custom swatch.
    expect(screen.getByRole("button", { name: "Custom" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Apply valid YAML draft" }));
    expect(input).toHaveValue("#81a8c8");
    expect(input).toHaveAttribute("aria-invalid", "false");
    expect(onValidity).toHaveBeenLastCalledWith(true);
  });

  it("previews device changes while keeping a fixed light or dark choice independent", () => {
    let listener;
    const media = {
      matches: false,
      addEventListener: vi.fn((_, changed) => {
        listener = changed;
      }),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal("matchMedia", () => media);
    const { container, unmount } = render(<Draft initial={{ studioTheme: { mode: "system" } }} />);
    const preview = container.querySelector(".studio-appearance-preview");
    expect(preview.style.getPropertyValue("--studio-bg")).toBe("#f3f1ec");
    act(() => {
      media.matches = true;
      listener();
    });
    expect(preview.style.getPropertyValue("--studio-bg")).toBe("#121314");
    fireEvent.click(screen.getByRole("radio", { name: "Light" }));
    expect(preview.style.getPropertyValue("--studio-bg")).toBe("#f3f1ec");
    unmount();
    expect(media.removeEventListener).toHaveBeenCalledWith("change", listener);
  });
});
