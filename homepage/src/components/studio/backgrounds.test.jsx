// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BackgroundGrid, PageBackgroundEditor } from "./background-picker";
import { ABSTRACT, builtInFamily, PATTERNS, SCENES, themedSvg } from "./backgrounds.mjs";
import { autoShade, backgroundSource } from "./card-background";
import { validateLook } from "./look.mjs";

const dark = { mode: "dark", surface: "#1a1b1d", bg: "#121314", accent: "#b299be", muted: "#a3a6aa", "line-strong": "#6e7175" };
const light = { mode: "light", surface: "#ffffff", bg: "#f3f1ec", accent: "#b299be", muted: "#5f5c56", "line-strong": "#8f8b84" };

describe("built-in backgrounds", () => {
  it("offers 14 scenes, 6 abstract designs and 14 patterns", () => {
    expect([SCENES.length, ABSTRACT.length, PATTERNS.length]).toEqual([14, 6, 14]);
  });

  it("draws every abstract design and pattern from the theme's colours only", () => {
    for (const { id } of [...ABSTRACT, ...PATTERNS]) {
      const url = themedSvg(id, dark);
      expect(url.startsWith("data:image/svg+xml,")).toBe(true);
      const markup = decodeURIComponent(url.slice("data:image/svg+xml,".length));
      expect(markup).not.toMatch(/<script|href=|javascript:/i);
      expect(themedSvg(id, light)).not.toBe(url);
    }
  });

  it("refuses colours that are not hex values", () => {
    const url = themedSvg("dots", { ...dark, surface: "red;}<script>" });
    expect(decodeURIComponent(url)).not.toContain("<script>");
  });

  it("knows each id's family and skips unknown ones", () => {
    expect(builtInFamily("coast")).toBe("scene");
    expect(builtInFamily("arcs")).toBe("abstract");
    expect(builtInFamily("terrazzo")).toBe("pattern");
    expect(builtInFamily("nope")).toBeNull();
    expect(backgroundSource({ source: "builtin", id: "nope" }, dark)).toBeNull();
    expect(backgroundSource({ source: "none" }, dark)).toBeNull();
  });
});

describe("auto shade", () => {
  it("shades just enough for muted text at 4.5:1, more over bright pictures", () => {
    const calm = autoShade({ darkest: "#000000", brightest: "#202020" }, dark);
    const bright = autoShade({ darkest: "#000000", brightest: "#f0f0f0" }, dark);
    expect(calm).toBeGreaterThanOrEqual(0.2);
    expect(bright).toBeGreaterThan(calm);
    expect(autoShade(null, dark)).toBe(0.7);
  });
});

describe("background settings", () => {
  it("accepts none for a page and refuses anything with it", () => {
    expect(validateLook({ background: { source: "none" } })).toEqual({ background: { source: "none" } });
    expect(() => validateLook({ background: { source: "none", id: "coast" } })).toThrow();
  });

  it("shows scenes for Picture and the abstract designs and patterns for Pattern", () => {
    const onPick = vi.fn();
    const { unmount } = render(<BackgroundGrid fill="picture" tokens={dark} onPick={onPick} />);
    fireEvent.click(screen.getByRole("radio", { name: "Coast" }));
    expect(onPick).toHaveBeenCalledWith("coast");
    expect(screen.queryByRole("radio", { name: "Abstract" })).toBeNull();
    unmount();
    render(<BackgroundGrid fill="pattern" tokens={dark} onPick={onPick} />);
    expect(screen.getByRole("radio", { name: "Bands" })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Patterns" }));
    expect(screen.getByRole("radio", { name: "Terrazzo" })).toBeTruthy();
  });

  it("lets a page follow, replace or turn off the dashboard's page background", () => {
    const onApply = vi.fn();
    const dashboardBackground = { source: "builtin", id: "coast" };
    render(
      <PageBackgroundEditor
        page={{ id: "p", name: "Media" }}
        dashboardBackground={dashboardBackground}
        tokens={dark}
        onApply={onApply}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("This page uses the dashboard's page background.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "None" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply to arrangement" }));
    expect(onApply).toHaveBeenLastCalledWith({ source: "none" });
    fireEvent.click(screen.getByRole("radio", { name: "Coast" }));
    // Choosing the dashboard's own background again follows it again.
    expect(screen.getByRole("button", { name: "Apply to arrangement" })).toBeDisabled();
  });
});
