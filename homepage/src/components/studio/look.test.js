import { describe, expect, it } from "vitest";

import {
  BUILT_IN_LOOK,
  DEFAULT_BLOCKS,
  blocksOf,
  classOf,
  contrast,
  fitColour,
  inheritedBehaviour,
  inheritedLook,
  lookAt,
  needsHistory,
  readLook,
  ruleLevel,
  setOverride,
  validateBehaviour,
  validateLook,
  validateStudioTheme,
} from "./look.mjs";

const DARK = { mode: "dark", accent: "#5fb3a1", text: "#ececea", inkDark: "#141414" };
const LIGHT = { mode: "light", accent: "#3c6e47", text: "#1d1c1a", inkDark: "#1d1c1a" };

describe("widget look validation", () => {
  it("accepts every offered choice and normalises colours", () => {
    expect(validateLook({ arrange: "grid", fill: "solid", colour: "#ABC", strength: "strong" })).toEqual({
      arrange: "grid",
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
        values: [{ field: "authentik.logins", label: " Sign-ins today ", format: "short" }],
      }),
    ).toEqual({ values: [{ field: "authentik.logins", label: "Sign-ins today", format: "short" }] });
    // Where a value shows is up to the blocks now; the old slot is refused.
    expect(() => validateLook({ values: [{ field: "a", slot: "hero" }] })).toThrow();
    expect(() => validateLook({ values: [{ field: "a" }, { field: "a" }] })).toThrow(/unique/);
    expect(() => validateLook({ values: [{ field: "a", label: "x".repeat(41) }] })).toThrow(/40/);
  });

  it("validates behaviour", () => {
    expect(validateBehaviour({ target: "same", refresh: "30s" })).toEqual({ target: "same", refresh: "30s" });
    expect(() => validateBehaviour({ refresh: "1s" })).toThrow();
    expect(() => validateBehaviour({ x: 1 })).toThrow(/Unknown/);
  });

  it("reads tolerantly for rendering", () => {
    expect(readLook({ fill: "neon", arrange: "row", layout: "quiet", junk: 1 })).toEqual({ arrange: "row" });
    expect(readLook(null)).toEqual({});
  });
});

describe("silent inheritance", () => {
  it("layers built-in, platform and dashboard defaults", () => {
    expect(inheritedLook({ fill: "tint" }, { align: "left" })).toMatchObject({
      fill: "tint",
      align: "left",
      edge: "line",
    });
    expect(inheritedBehaviour({ target: "same" }).target).toBe("same");
  });

  it("stores a key only while it differs, and drops it when set back", () => {
    const inherited = { ...BUILT_IN_LOOK, fill: "plain" };
    const once = setOverride(undefined, "fill", "solid", inherited);
    expect(once).toEqual({ fill: "solid" });
    expect(setOverride(once, "fill", "plain", inherited)).toBeUndefined();
    expect(setOverride({ align: "left", fill: "solid" }, "fill", "plain", inherited)).toEqual({ align: "left" });
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
  it("keeps a chart block, its range, line colour and colour rules", () => {
    expect(
      validateLook({
        blocks: [{ id: "c1", type: "chart", values: ["cpu"], range: "7d" }],
        values: [{ field: "cpu", colour: "#AABBCC", rules: { warn: 70, problem: 90 } }],
      }),
    ).toEqual({
      blocks: [{ id: "c1", type: "chart", values: ["cpu"], range: "7d" }],
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
    expect(() => validateLook({ show: "line" })).toThrow(/Unknown/);
    expect(() => validateLook({ blocks: [{ id: "c1", type: "chart", range: "forever" }] })).toThrow();
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
    const one = (block) => look({ blocks: [{ id: "x", ...block }] });
    expect(needsHistory(look({}))).toBe(false);
    expect(needsHistory(one({ type: "numbers", arrange: "list" }))).toBe(false);
    for (const type of ["chart", "pie", "bars", "gauge", "response", "status"])
      expect(needsHistory(one({ type }))).toBe(true);
    expect(needsHistory(one({ type: "big", trend: "hour" }))).toBe(true);
    expect(needsHistory(one({ type: "big" }))).toBe(false);
    expect(needsHistory(look({ values: [{ field: "cpu", rules: { warn: 1 } }] }))).toBe(true);
    // A chart only at one size still needs history.
    expect(needsHistory(look({ sizes: { wide: { blocks: [{ id: "x", type: "chart" }] } } }))).toBe(true);
  });
});

describe("blocks and sizes (mock-ups v4)", () => {
  it("keeps blocks with their own options and drops options left at their default", () => {
    expect(
      validateLook({
        blocks: [
          { id: "b1", type: "big", values: ["a"], size: "xl", trend: "day", labels: true },
          { id: "b2", type: "numbers", arrange: "list", columns: "auto" },
          { id: "b3", type: "pie", style: "pie", legend: "below" },
          { id: "b4", type: "logs" },
        ],
      }).blocks,
    ).toEqual([
      { id: "b1", type: "big", values: ["a"], size: "xl", trend: "day" },
      { id: "b2", type: "numbers", arrange: "list" },
      { id: "b3", type: "pie", style: "pie", legend: "below" },
      { id: "b4", type: "logs" },
    ]);
  });

  it("refuses blocks that can't apply", () => {
    expect(() => validateLook({ blocks: [{ id: "x", type: "sparkle" }] })).toThrow();
    expect(() => validateLook({ blocks: [{ id: "x", type: "big", legend: "off" }] })).toThrow();
    expect(() =>
      validateLook({
        blocks: [
          { id: "x", type: "big" },
          { id: "x", type: "numbers" },
        ],
      }),
    ).toThrow();
    expect(() => validateLook({ blocks: [{ id: "../x", type: "big" }] })).toThrow();
    expect(() =>
      validateLook({ blocks: Array.from({ length: 13 }, (_, i) => ({ id: `b${i}`, type: "quiet" })) }),
    ).toThrow();
    expect(() => validateLook({ blocks: [{ id: "x", type: "logs", values: ["a"] }] })).toThrow();
    // A service tile may show nothing but its header.
    expect(validateLook({ blocks: [] })).toEqual({ blocks: [] });
  });

  it("gives each size its own layout, and only the keys a size can set", () => {
    expect(validateLook({ sizes: { wide: { arrange: "row", blocks: [{ id: "a", type: "quiet" }] } } })).toEqual({
      sizes: { wide: { arrange: "row", blocks: [{ id: "a", type: "quiet" }] } },
    });
    expect(() => validateLook({ sizes: { huge: { arrange: "row" } } })).toThrow(/Unknown size/);
    expect(() => validateLook({ sizes: { wide: { fill: "solid" } } })).toThrow();
    expect(validateLook({ sizes: { wide: {} } })).toBeUndefined();
  });

  it("works out the kind of size and the look in force there", () => {
    expect(classOf(600, 150)).toBe("wide");
    expect(classOf(150, 400)).toBe("tall");
    expect(classOf(200, 200)).toBe("small");
    expect(classOf(400, 360)).toBe("large");
    expect(classOf(280, 240)).toBe("regular");
    const look = { arrange: "col", sizes: { wide: { arrange: "row" } } };
    expect(lookAt(look, 600, 150).arrange).toBe("row");
    expect(lookAt(look, 300, 300).arrange).toBe("col");
    expect(blocksOf({})).toBe(DEFAULT_BLOCKS);
    expect(blocksOf({ blocks: [] })).toEqual([]);
  });

  it("keeps the dashboard's card look to style only", () => {
    expect(() => validateStudioTheme({ card: { blocks: [{ id: "a", type: "big" }] } })).toThrow();
    expect(() => validateStudioTheme({ card: { sizes: { wide: { arrange: "row" } } } })).toThrow();
    expect(validateStudioTheme({ card: { fill: "tint", text: "fixed" } })).toEqual({
      card: { fill: "tint", text: "fixed" },
    });
  });
});
