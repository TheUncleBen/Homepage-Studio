import { describe, expect, it } from "vitest";

import {
  ACCENT_PRESETS,
  appearanceConfig,
  appearanceStyles,
  appearanceTokens,
  contrastRatio,
  hexColor,
} from "./appearance.mjs";

describe("appearance settings", () => {
  it("keeps the empty dashboard dark and respects an existing native light theme", () => {
    expect(appearanceConfig()).toEqual({ mode: "dark", accent: "#b299be" });
    expect(appearanceTokens({ theme: "light" }).mode).toBe("light");
    expect(
      appearanceTokens({ theme: "light", studioTheme: { mode: "dark" } }).mode,
    ).toBe("dark");
  });

  it("uses bounded colors and never interpolates raw configuration into CSS", () => {
    expect(hexColor("#AbC")).toBe("#aabbcc");
    expect(hexColor("red;}</style><script>")).toBeNull();
    expect(hexColor({ color: "#fff" })).toBeNull();
    expect(
      appearanceStyles({
        studioTheme: {
          mode: "</style>",
          accent: "</style><script>alert(1)</script>",
        },
      }),
    ).toBe(appearanceStyles({}));
  });

  it("emits both device schemes in server-rendered CSS without browser storage", () => {
    const settings = { studioTheme: { mode: "system", accent: "#81a8c8" } };
    expect(appearanceStyles(settings)).toContain(
      "@media(prefers-color-scheme:light)",
    );
    expect(appearanceTokens(settings, true).mode).toBe("dark");
    expect(appearanceTokens(settings, false).mode).toBe("light");
  });

  it("keeps normal text and chosen accents readable across both palettes", () => {
    for (const mode of ["light", "dark"]) {
      for (const accent of [
        ...ACCENT_PRESETS.map((preset) => preset.color),
        "#000000",
        "#ffffff",
        "#ff0000",
        "#00ff00",
        "#0000ff",
        "#ffff00",
        "#7788aa",
        "#aa00ee",
      ]) {
        const { tokens } = appearanceTokens({ studioTheme: { mode, accent } });
        for (const background of [
          tokens.bg,
          tokens.surface,
          tokens.raised,
          tokens.input,
          tokens["accent-soft"],
        ]) {
          for (const text of [tokens.text, tokens.muted, tokens.accent])
            expect(contrastRatio(text, background)).toBeGreaterThanOrEqual(4.5);
          expect(
            contrastRatio(tokens.focus, background),
          ).toBeGreaterThanOrEqual(3);
        }
        for (const background of [
          tokens["accent-solid"],
          tokens["accent-hover"],
        ])
          expect(
            contrastRatio(tokens["accent-contrast"], background),
          ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrastRatio(tokens["danger-contrast"], tokens["danger-solid"]),
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
