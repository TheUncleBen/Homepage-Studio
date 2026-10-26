// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
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
    fireEvent.click(screen.getByRole("radio", { name: "Auto" }));
    expect(onChange.mock.lastCall[0]).not.toHaveProperty("theme");
    expect(onChange.mock.lastCall[0].studioTheme.mode).toBe("system");
  });

  it("follows each platform default separately until the dashboard sets its own", () => {
    const onChange = vi.fn();
    const platform = { mode: "light", accent: "#91b09e", background: null };
    render(<AppearanceEditor settings={{ title: "Kitchen" }} platform={platform} onChange={onChange} />);
    expect(screen.getByRole("radio", { name: "Default" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: "Default (#91b09e)" })).toHaveAttribute("aria-pressed", "true");
    // Following the platform accent needs no hex field.
    expect(screen.queryByLabelText("Accent color")).toBeNull();
    // Choosing an own display mode leaves the accent following the platform.
    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(onChange).toHaveBeenLastCalledWith({ title: "Kitchen", theme: "dark", studioTheme: { mode: "dark" } });
  });

  it("returns a setting to the platform default by removing only that key", () => {
    const onChange = vi.fn();
    const settings = { theme: "dark", studioTheme: { mode: "dark", accent: "#81a8c8", future: 1 } };
    render(
      <AppearanceEditor settings={settings} platform={{ mode: "light", accent: "#91b09e" }} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Default (#91b09e)" }));
    expect(onChange).toHaveBeenLastCalledWith({ theme: "dark", studioTheme: { mode: "dark", future: 1 } });
    fireEvent.click(screen.getByRole("radio", { name: "Default" }));
    expect(onChange).toHaveBeenLastCalledWith({ studioTheme: { accent: "#81a8c8", future: 1 } });
  });

  it("retains partially typed colors, reports invalid drafts and synchronizes an external YAML correction", () => {
    const onChange = vi.fn(),
      onValidity = vi.fn();
    render(<Draft onChange={onChange} onValidity={onValidity} />);
    expect(screen.queryByLabelText("Accent color")).toBeNull();
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
    expect(preview.style.getPropertyValue("--studio-bg")).toBe("#f4f3f6");
    act(() => {
      media.matches = true;
      listener();
    });
    expect(preview.style.getPropertyValue("--studio-bg")).toBe("#111115");
    fireEvent.click(screen.getByRole("radio", { name: "Light" }));
    expect(preview.style.getPropertyValue("--studio-bg")).toBe("#f4f3f6");
    unmount();
    expect(media.removeEventListener).toHaveBeenCalledWith("change", listener);
  });
});
