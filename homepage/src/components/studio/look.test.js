import { describe, expect, it } from "vitest";

import {
  BUILT_IN_LOOK,
  contrast,
  fitColour,
  inheritedBehaviour,
  inheritedLook,
  needsHistory,
  readLook,
  ruleLevel,
  setOverride,
  validateBehaviour,
  validateLook,
} from "./look.mjs";

const DARK = { mode: "dark", accent: "#5fb3a1", text: "#ececea", inkDark: "#141414" };
const LIGHT = { mode: "light", accent: "#3c6e47", text: "#1d1c1a", inkDark: "#1d1c1a" };

describe("widget look validation", () => {
  it("accepts every offered choice and normalises colours", () => {
    expect(validateLook({ layout: "quiet", fill: "solid", colour: "#ABC", strength: "strong" })).toEqual({
      layout: "quiet",
      fill: "solid",
      colour: "#aabbcc",
      strength: "strong",
    });
    expect(validateLook({})).toBeUndefined();
  });

  it("refuses unknown keys and values so nothing else reaches card styles", () => {
    expect(() => validateLook({ fill: "neon" })).toThrow(/offered choices/);
    expect(() => validateLook({ css: "x" })).toThrow(/Unknown/);
    expect(() => validateLook({ colour: "red;}" })).toThrow(/hex/);
    expect(() => validateLook({ background: { source: "builtin", id: "../x" } })).toThrow();
    expect(() => validateLook({ background: { source: "builtin", id: "dunes", blur: 50 } })).toThrow(/blur/);
  });

  it("checks arranged values", () => {
    expect(
      validateLook({
        values: [{ field: "authentik.logins", slot: "hero", label: " Sign-ins today ", format: "short" }],
      }),
    ).toEqual({ values: [{ field: "authentik.logins", slot: "hero", label: "Sign-ins today", format: "short" }] });
    expect(() =>
      validateLook({
        values: [
          { field: "a", slot: "hero" },
          { field: "b", slot: "hero" },
        ],
      }),
    ).toThrow(/one value/);
    expect(() => validateLook({ values: [{ field: "a" }, { field: "a" }] })).toThrow(/unique/);
    expect(() => validateLook({ values: [{ field: "a", label: "x".repeat(41) }] })).toThrow(/40/);
  });

  it("validates behaviour", () => {
    expect(validateBehaviour({ target: "same", refresh: "30s" })).toEqual({ target: "same", refresh: "30s" });
    expect(() => validateBehaviour({ refresh: "1s" })).toThrow();
    expect(() => validateBehaviour({ x: 1 })).toThrow(/Unknown/);
  });

  it("reads tolerantly for rendering", () => {
    expect(readLook({ fill: "neon", layout: "quiet", junk: 1 })).toEqual({ layout: "quiet" });
    expect(readLook(null)).toEqual({});
  });
});

describe("silent inheritance", () => {
  it("layers built-in, platform and dashboard defaults", () => {
    expect(inheritedLook({ fill: "tint" }, { layout: "quiet" })).toMatchObject({
      fill: "tint",
      layout: "quiet",
      edge: "line",
    });
    expect(inheritedBehaviour({ target: "same" }).target).toBe("same");
  });

  it("stores a key only while it differs, and drops it when set back", () => {
    const inherited = { ...BUILT_IN_LOOK, fill: "plain" };
    const once = setOverride(undefined, "fill", "solid", inherited);
    expect(once).toEqual({ fill: "solid" });
    expect(setOverride(once, "fill", "plain", inherited)).toBeUndefined();
    expect(setOverride({ layout: "quiet", fill: "solid" }, "fill", "plain", inherited)).toEqual({ layout: "quiet" });
  });
});

describe("colour fit", () => {
  const colours = ["#ffcc00", "#fd4b2d", "#0066ff", "#00ff00", "#ff00ff", "#000000", "#ffffff", "#888888"];
  it("always reaches 4.5:1 text contrast in both modes and every strength", () => {
    for (const theme of [DARK, LIGHT])
      for (const strength of ["soft", "medium", "strong"])
        for (const colour of colours) {
          const result = fitColour(colour, theme, strength);
          expect(contrast(result.ink, result.fill)).toBeGreaterThanOrEqual(4.5);
        }
  });

  it("keeps yellow yellow on strong dark fills", () => {
    const { fill } = fitColour("#ffcc00", DARK, "strong");
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(fill.slice(i, i + 2), 16));
    expect(r).toBeGreaterThan(180);
    expect(g).toBeGreaterThan(150);
    expect(b).toBeLessThan(120);
  });

  it("returns null for anything that is not a colour", () => {
    expect(fitColour("red", DARK)).toBeNull();
  });
});

describe("charts and colour rules", () => {
  it("keeps a chart format, time range, line colour and colour rules", () => {
    expect(
      validateLook({
        show: "line",
        chartRange: "7d",
        values: [{ field: "cpu", colour: "#AABBCC", rules: { warn: 70, problem: 90 } }],
      }),
    ).toEqual({
      show: "line",
      chartRange: "7d",
      values: [{ field: "cpu", colour: "#aabbcc", rules: { warn: 70, problem: 90 } }],
    });
    expect(
      validateLook({ values: [{ field: "free", rules: { warn: 20, problem: 5, lower: true } }] }).values[0].rules,
    ).toEqual({
      warn: 20,
      problem: 5,
      lower: true,
    });
  });

  it("refuses rules that cannot apply", () => {
    expect(() => validateLook({ show: "sparkle" })).toThrow();
    expect(() => validateLook({ chartRange: "forever" })).toThrow();
    expect(() => validateLook({ values: [{ field: "cpu", rules: {} }] })).toThrow(/warning or a problem/);
    expect(() => validateLook({ values: [{ field: "cpu", rules: { warn: 90, problem: 70 } }] })).toThrow(
      /past the warning/,
    );
    expect(() => validateLook({ values: [{ field: "cpu", rules: { warn: "high" } }] })).toThrow(/needs a number/);
    expect(() => validateLook({ values: [{ field: "cpu", rules: { warn: 1, lower: false } }] })).toThrow();
    expect(() => validateLook({ values: [{ field: "cpu", rules: { warn: 1, colour: "red" } }] })).toThrow(/Unknown/);
    expect(() => validateLook({ values: [{ field: "cpu", colour: "red" }] })).toThrow(/hex colour/);
  });

  it("works out a value's level under its rules", () => {
    const rule = { warn: 70, problem: 90 };
    expect(ruleLevel(rule, 50)).toBe(null);
    expect(ruleLevel(rule, 70)).toBe("warn");
    expect(ruleLevel(rule, 95)).toBe("problem");
    expect(ruleLevel({ warn: 20, problem: 5, lower: true }, 10)).toBe("warn");
    expect(ruleLevel({ warn: 20, problem: 5, lower: true }, 3)).toBe("problem");
    expect(ruleLevel({ problem: 90 }, 80)).toBe(null);
    expect(ruleLevel(rule, null)).toBe(null);
    expect(ruleLevel(undefined, 99)).toBe(null);
  });

  it("collects history only for charts, trends and colour rules", () => {
    const look = (override) => inheritedLook(BUILT_IN_LOOK, override);
    expect(needsHistory(look({}))).toBe(false);
    expect(needsHistory(look({ show: "table" }))).toBe(false);
    for (const show of ["line", "area", "bar", "donut", "pie", "gauge"])
      expect(needsHistory(look({ show }))).toBe(true);
    expect(needsHistory(look({ layout: "hero", trend: "hour" }))).toBe(true);
    expect(needsHistory(look({ layout: "quiet", trend: "hour" }))).toBe(false);
    expect(needsHistory(look({ values: [{ field: "cpu", rules: { warn: 1 } }] }))).toBe(true);
  });
});
