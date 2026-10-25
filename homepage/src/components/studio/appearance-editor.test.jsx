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
    fireEvent.change(screen.getByLabelText("Display mode"), {
      target: { value: "light" },
    });
    expect(onChange).toHaveBeenLastCalledWith({
      ...initial,
      theme: "light",
      studioTheme: { future: null, mode: "light" },
    });
    // Presets apply once the dashboard stops following the platform accent.
    expect(screen.getByRole("button", { name: "Sage", exact: true })).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/Use the platform accent color/));
    fireEvent.click(screen.getByRole("button", { name: "Sage", exact: true }));
    expect(onChange.mock.lastCall[0]).toMatchObject({
      theme: "light",
      studioTheme: { mode: "light", accent: "#91b09e", future: null },
      providers: initial.providers,
    });
    fireEvent.change(screen.getByLabelText("Display mode"), {
      target: { value: "system" },
    });
    expect(onChange.mock.lastCall[0]).not.toHaveProperty("theme");
    expect(onChange.mock.lastCall[0].studioTheme.mode).toBe("system");
  });

  it("follows each platform default separately until the dashboard sets its own", () => {
    const onChange = vi.fn();
    const platform = { mode: "light", accent: "#91b09e", background: null };
    render(<AppearanceEditor settings={{ title: "Kitchen" }} platform={platform} onChange={onChange} />);
    expect(screen.getByLabelText("Display mode")).toHaveValue("platform");
    expect(screen.getByRole("option", { name: "Platform default (Light)" })).toBeInTheDocument();
    const follow = screen.getByLabelText("Use the platform accent color (#91b09e)");
    expect(follow).toBeChecked();
    expect(screen.getByLabelText("Accent color")).toHaveValue("#91b09e");
    // Choosing an own display mode leaves the accent following the platform.
    fireEvent.change(screen.getByLabelText("Display mode"), { target: { value: "dark" } });
    expect(onChange).toHaveBeenLastCalledWith({ title: "Kitchen", theme: "dark", studioTheme: { mode: "dark" } });
  });

  it("returns a setting to the platform default by removing only that key", () => {
    const onChange = vi.fn();
    const settings = { theme: "dark", studioTheme: { mode: "dark", accent: "#81a8c8", future: 1 } };
    render(<AppearanceEditor settings={settings} platform={{ mode: "light", accent: "#91b09e" }} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText(/Use the platform accent color/));
    expect(onChange).toHaveBeenLastCalledWith({ theme: "dark", studioTheme: { mode: "dark", future: 1 } });
    fireEvent.change(screen.getByLabelText("Display mode"), { target: { value: "platform" } });
    expect(onChange).toHaveBeenLastCalledWith({ studioTheme: { accent: "#81a8c8", future: 1 } });
  });

  it("retains partially typed colors, reports invalid drafts and synchronizes an external YAML correction", () => {
    const onChange = vi.fn(),
      onValidity = vi.fn();
    render(<Draft onChange={onChange} onValidity={onValidity} />);
    const input = screen.getByLabelText("Accent color");
    expect(input).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/Use the platform accent color/));
    expect(input).toBeEnabled();
    fireEvent.change(input, { target: { value: "#abc" } });
    expect(input).toHaveValue("#abc");
    expect(onChange.mock.lastCall[0].studioTheme.accent).toBe("#aabbcc");
    fireEvent.change(input, { target: { value: "#abcd" } });
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(onValidity).toHaveBeenLastCalledWith(false);
    expect(onChange).toHaveBeenCalledTimes(2);
    fireEvent.click(
      screen.getByRole("button", { name: "Apply valid YAML draft" }),
    );
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
    const { container, unmount } = render(
      <Draft initial={{ studioTheme: { mode: "system" } }} />,
    );
    const preview = container.querySelector(".studio-appearance-preview");
    expect(preview.style.getPropertyValue("--studio-bg")).toBe("#f4f3f6");
    act(() => {
      media.matches = true;
      listener();
    });
    expect(preview.style.getPropertyValue("--studio-bg")).toBe("#111115");
    fireEvent.change(screen.getByLabelText("Display mode"), {
      target: { value: "light" },
    });
    expect(preview.style.getPropertyValue("--studio-bg")).toBe("#f4f3f6");
    unmount();
    expect(media.removeEventListener).toHaveBeenCalledWith("change", listener);
  });
});
