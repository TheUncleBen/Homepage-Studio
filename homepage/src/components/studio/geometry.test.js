import { describe, expect, it } from "vitest";

import {
  grownUnits,
  intersects,
  mergePage,
  moveUnit,
  pageBoard,
  panelMinimum,
  pixelRect,
  projectBoard,
  stackBoard,
  unitMinimum,
  unitsForBoard,
  unstackBoard,
} from "./geometry.mjs";

const board = () => ({
  version: 3,
  columns: 24,
  panels: [
    { id: "a", rect: { x: 0, y: 0, w: 8, h: 6 } },
    { id: "b", rect: { x: 8, y: 0, w: 8, h: 6 } },
    { id: "c", rect: { x: 16, y: 0, w: 8, h: 10 } },
  ],
  stacks: [],
});
function disjoint(value) {
  const units = unitsForBoard(value);
  units.forEach((a, index) => units.slice(index + 1).forEach((b) => expect(intersects(a.rect, b.rect)).toBe(false)));
}
function visualOrder(value, width) {
  return [...projectBoard(value, width).units].sort(
    (a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x || a.id.localeCompare(b.id),
  );
}

describe("Studio grid geometry", () => {
  it("retains the board and unchanged panel identities for snapped no-op moves without skipping collision repair", () => {
    const original = board();
    expect(moveUnit(original, "a", original.panels[0].rect)).toBe(original);
    const moved = moveUnit(original, "a", { ...original.panels[0].rect, y: 16 });
    expect(moved.panels[0]).not.toBe(original.panels[0]);
    expect(moved.panels[1]).toBe(original.panels[1]);
    expect(moved.panels[2]).toBe(original.panels[2]);
    const overlapping = {
      ...original,
      panels: original.panels.map((panel) => ({ ...panel, rect: { ...panel.rect, x: 0 } })),
    };
    const repaired = moveUnit(overlapping, "a", overlapping.panels[0].rect);
    expect(repaired).not.toBe(overlapping);
    disjoint(repaired);
  });
  it.each([673, 820])("snaps tablet panels to halves so rows fill the board at %s px", (width) => {
    const row = (widths, y = 0) => {
      let x = 0;
      return widths.map((w, index) => {
        const panel = { id: `${y}-${index}`, kind: "service", rect: { x, y, w, h: 4 } };
        x += w;
        return panel;
      });
    };
    const value = {
      ...board(),
      panels: [...row([12, 12]), ...row([6, 6, 6, 6], 4), ...row([4, 8], 8), ...row([24], 12), ...row([18, 6], 16)],
    };
    const projection = projectBoard(value, width);
    expect(projection.columns).toBe(16);
    const at = (id) => projection.units.find((unit) => unit.id === id).rect;
    // Every panel is half (8 of 16) or, wider than half the desktop, full width.
    projection.units.forEach((unit, index) => {
      expect([8, 16], unit.id).toContain(unit.rect.w);
      expect([0, 8], unit.id).toContain(unit.rect.x);
      expect(unit.rect.x + unit.rect.w).toBeLessThanOrEqual(16);
      projection.units.slice(index + 1).forEach((other) => expect(intersects(unit.rect, other.rect)).toBe(false));
    });
    // Two halves share a row and meet in the middle; quarters pair up two-up.
    expect(at("0-0")).toMatchObject({ x: 0, y: 0, w: 8 });
    expect(at("0-1")).toMatchObject({ x: 8, y: 0, w: 8 });
    expect([at("4-0"), at("4-1"), at("4-2"), at("4-3")].map(({ x, y }) => [x, y])).toEqual([
      [0, 4],
      [8, 4],
      [0, 8],
      [8, 8],
    ]);
    expect(at("12-0")).toMatchObject({ x: 0, w: 16 });
    expect(at("16-0")).toMatchObject({ x: 0, w: 16 });
    expect(at("16-1")).toMatchObject({ x: 0, w: 8 });
  });
  const rects = (projection) =>
    Object.fromEntries(projection.units.map((unit) => [unit.id, [unit.rect.x, unit.rect.y, unit.rect.w, unit.rect.h]]));
  const tiles = (count, w = 8, h = 6) =>
    Array.from({ length: count }, (_, index) => ({
      id: `t${index}`,
      kind: "service",
      rect: { x: (index * w) % 24, y: Math.floor((index * w) / 24) * h, w, h },
    }));
  const expectReadingOrder = (value, width) => {
    const projection = projectBoard(value, width);
    const canonical = unitsForBoard(value)
      .sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x || a.id.localeCompare(b.id))
      .map((unit) => unit.id);
    expect(visualOrder(value, width).map((unit) => unit.id)).toEqual(canonical);
    projection.units.forEach((unit, index) => {
      expect(unit.rect.x + unit.rect.w).toBeLessThanOrEqual(projection.columns);
      projection.units.slice(index + 1).forEach((other) => expect(intersects(unit.rect, other.rect)).toBe(false));
    });
    return projection;
  };
  it.each([673, 820])("wraps a row of three third-width tiles into two then one in reading order at %s px", (width) => {
    const value = { ...board(), panels: tiles(3) };
    const projection = expectReadingOrder(value, width);
    expect(projection.columns).toBe(16);
    expect(rects(projection)).toEqual({ t0: [0, 0, 8, 6], t1: [8, 0, 8, 6], t2: [0, 6, 8, 6] });
  });
  it.each([673, 820])("reflows a 3x3 grid of third-width tiles at %s px without holes or reordering", (width) => {
    const value = { ...board(), panels: tiles(9) };
    const before = JSON.stringify(value);
    const projection = expectReadingOrder(value, width);
    // Two halves per projected row, filling it; only the last row has a remainder.
    projection.units.forEach((unit) => {
      const index = Number(unit.id.slice(1));
      expect(unit.rect, unit.id).toEqual({ x: (index % 2) * 8, y: Math.floor(index / 2) * 6, w: 8, h: 6 });
    });
    expect(projection.rows).toBe(30);
    expect(JSON.stringify(value)).toBe(before);
  });
  it("reflows mixed sizes in reading order, wrapping beside a tall tile before starting a new row", () => {
    const value = {
      ...board(),
      panels: [
        { id: "a", kind: "service", rect: { x: 0, y: 0, w: 12, h: 8 } },
        { id: "b", kind: "service", rect: { x: 12, y: 0, w: 6, h: 4 } },
        { id: "c", kind: "service", rect: { x: 18, y: 0, w: 6, h: 4 } },
        { id: "d", kind: "service", rect: { x: 12, y: 4, w: 12, h: 4 } },
        { id: "e", kind: "service", rect: { x: 0, y: 8, w: 24, h: 4 } },
      ],
    };
    expect(rects(expectReadingOrder(value, 820))).toEqual({
      a: [0, 0, 8, 8],
      b: [8, 0, 8, 4],
      c: [8, 4, 8, 4],
      d: [0, 8, 8, 4],
      e: [0, 12, 16, 4],
    });
    expect(rects(expectReadingOrder(value, 673))).toEqual(rects(projectBoard(value, 820)));
  });
  it("reflows a stack as one unit with its shared rectangle", () => {
    const value = {
      ...board(),
      panels: [
        { id: "a", kind: "service", rect: { x: 0, y: 0, w: 8, h: 6 } },
        { id: "m1", kind: "service", rect: { x: 8, y: 0, w: 8, h: 8 } },
        { id: "m2", kind: "service", rect: { x: 8, y: 0, w: 8, h: 8 } },
        { id: "c", kind: "service", rect: { x: 16, y: 0, w: 8, h: 6 } },
        { id: "d", kind: "service", rect: { x: 0, y: 8, w: 8, h: 6 } },
      ],
      stacks: [{ id: "stack", panelIds: ["m1", "m2"], rect: { x: 8, y: 0, w: 8, h: 8 } }],
    };
    expect(rects(expectReadingOrder(value, 820))).toEqual({
      a: [0, 0, 8, 6],
      stack: [8, 0, 8, 8],
      c: [0, 6, 8, 6],
      d: [8, 8, 8, 6],
    });
  });
  it("pushes collisions deterministically while preserving source identities and untouched values", () => {
    const original = board();
    const moved = moveUnit(original, "a", { x: 8, y: 0, w: 8, h: 6 });
    expect(moved.panels.map((panel) => panel.id)).toEqual(["a", "b", "c"]);
    expect(moved.panels[1].rect).toEqual({ x: 8, y: 6, w: 8, h: 6 });
    expect(original.panels[0].rect.x).toBe(0);
    disjoint(moved);
  });
  it("creates one shared stack rectangle and returns members without overlap on unstack", () => {
    const original = board();
    const stacked = stackBoard(original, ["a", "b"], "stack");
    expect(stacked.stacks[0].playback).toEqual({
      mode: "manual",
      intervalMs: 10000,
      manualHoldMs: 30000,
      transition: "horizontal",
      transitionDurationMs: 250,
      loop: true,
    });
    expect(stacked.panels[1].rect).toEqual(original.panels[1].rect);
    const moved = moveUnit(stacked, "c", { x: 8, y: 0, w: 8, h: 10 });
    const unstacked = unstackBoard(moved, "stack");
    expect(unstacked.stacks).toEqual([]);
    expect(unstacked.panels).toHaveLength(3);
    disjoint(unstacked);
  });
  it("rejects duplicate membership and never creates a singleton stack", () => {
    const stacked = stackBoard(board(), ["a", "b"], "stack");
    expect(stackBoard(stacked, ["a", "c"], "other")).toBe(stacked);
    expect(stackBoard(board(), ["a"], "other").stacks).toHaveLength(0);
  });
  it("projects full-width usable panels at 320px without changing the canonical board", () => {
    const original = board();
    const before = JSON.stringify(original);
    const mobile = projectBoard(original, 284);
    expect(mobile.columns).toBe(8);
    mobile.units.forEach((unit) => {
      const pixels = pixelRect(unit.rect, 284, mobile.columns);
      expect(pixels.width).toBe(284);
      expect(pixels.left).toBe(0);
    });
    mobile.units.forEach((a, index) =>
      mobile.units.slice(index + 1).forEach((b) => expect(intersects(a.rect, b.rect)).toBe(false)),
    );
    expect(JSON.stringify(original)).toBe(before);
  });
  it("enforces readable content-class minimums through common resize geometry and stack sizing", () => {
    const panels = [
      { id: "link", kind: "service" },
      { id: "bookmark", kind: "bookmark" },
      {
        id: "search",
        kind: "informationWidget",
        nativeLocator: { type: "search" },
      },
      {
        id: "metrics",
        kind: "serviceWidget",
        nativeLocator: { type: "sonarr" },
      },
      {
        id: "calendar",
        kind: "serviceWidget",
        nativeLocator: { type: "calendar" },
      },
      { id: "embed", kind: "serviceWidget", nativeLocator: { type: "iframe" } },
    ].map((panel, index) => ({
      ...panel,
      rect: { x: 0, y: index * 12, w: 12, h: 10 },
    }));
    const value = { version: 3, columns: 24, panels, stacks: [] };
    panels.forEach((panel) => {
      const resized = moveUnit(value, panel.id, {
        ...panel.rect,
        w: 1,
        h: 1,
      }).panels.find((item) => item.id === panel.id);
      expect(resized.rect).toMatchObject(panelMinimum(panel));
      expect(pixelRect(resized.rect, 1200).height).toBeGreaterThanOrEqual(84);
    });
    const stacked = stackBoard(value, ["link", "embed"], "stack");
    expect(unitMinimum(stacked, "stack")).toEqual({ w: 8, h: 10 });
    expect(stacked.stacks[0].rect.h).toBe(10);
    const projection = projectBoard(
      {
        ...value,
        panels: panels.map((panel) => ({
          ...panel,
          rect: { x: 0, y: 0, w: 2, h: 2 },
        })),
      },
      284,
    );
    // On a phone (board 22) small widgets next to each other in reading
    // order pair up at half width, tiles with tiles and cards with cards;
    // one without a like small neighbour, and anything wider than a quarter
    // of desktop, takes the full width. A link tile and a metrics card don't pair.
    expect(projection.units.map((unit) => [unit.id, unit.rect.w])).toEqual([
      ["bookmark", 8],
      ["calendar", 8],
      ["embed", 8],
      ["link", 8],
      ["metrics", 8],
      ["search", 8],
    ]);
    projection.units.forEach((unit, index) =>
      projection.units.slice(index + 1).forEach((other) => expect(intersects(unit.rect, other.rect)).toBe(false)),
    );
  });
  it("lays out each page on its own and merges page changes back", () => {
    const whole = {
      ...board(),
      pages: [
        { id: "home", name: "Home" },
        { id: "media", name: "Media" },
      ],
      panels: [...board().panels, { id: "m", pageId: "media", rect: { x: 0, y: 0, w: 8, h: 6 } }],
    };
    const home = pageBoard(whole, "home");
    expect(home.panels.map((panel) => panel.id)).toEqual(["a", "b", "c"]);
    const media = pageBoard(whole, "media");
    expect(media.panels.map((panel) => panel.id)).toEqual(["m"]);
    // "m" sits at the same spot as "a" on another page: no collision.
    const moved = mergePage(whole, moveUnit(home, "b", { x: 0, y: 0, w: 8, h: 6 }));
    expect(moved.panels.find((panel) => panel.id === "m").rect).toEqual({ x: 0, y: 0, w: 8, h: 6 });
    expect(moved.panels.find((panel) => panel.id === "a").rect.y).toBe(6);
    const stacked = mergePage(whole, stackBoard(home, ["a", "b"], "s"));
    expect(stacked.stacks).toEqual([expect.objectContaining({ id: "s", pageId: "home" })]);
    expect(mergePage(whole, whole)).toBe(whole);
  });
});

describe("Tidy up", () => {
  it("slides every widget straight up into free space, in reading order", async () => {
    const { tidyBoard } = await import("./geometry.mjs");
    const board = {
      pages: [{ id: "home", name: "Home" }],
      panels: [
        { id: "a", rect: { x: 0, y: 4, w: 6, h: 2 } },
        { id: "b", rect: { x: 6, y: 0, w: 6, h: 3 } },
        { id: "c", rect: { x: 0, y: 9, w: 12, h: 2 } },
      ],
      stacks: [],
    };
    const tidy = tidyBoard(board);
    expect(Object.fromEntries(tidy.panels.map((panel) => [panel.id, panel.rect.y]))).toEqual({ a: 0, b: 0, c: 3 });
    // A tidy page stays as it is.
    expect(tidyBoard(tidy)).toBe(tidy);
  });
});

describe("Snap guides", () => {
  it("draws a line along each edge the moving widget shares with another", async () => {
    const { snapGuides } = await import("./geometry.mjs");
    const rects = new Map([
      ["moving", { left: 100, top: 200, width: 100, height: 50 }],
      ["above", { left: 100, top: 0, width: 300, height: 40 }],
      ["beside", { left: 300, top: 200, width: 100, height: 80 }],
      ["apart", { left: 500, top: 500, width: 10, height: 10 }],
    ]);
    const lines = snapGuides(rects, "moving");
    expect(lines).toContainEqual({ vertical: true, at: 100, from: 0, to: 250 });
    expect(lines).toContainEqual({ vertical: false, at: 200, from: 100, to: 400 });
    expect(lines).toHaveLength(2);
    expect(snapGuides(rects, "missing")).toEqual([]);
  });
});

describe("spacing", () => {
  it("uses the dashboard's spacing between widgets", async () => {
    const { gapOf, pixelRect } = await import("./geometry.mjs");
    expect(gapOf({})).toBe(12);
    expect(gapOf({ studioTheme: { spacing: "roomy" } })).toBe(20);
    expect(gapOf({ studioTheme: { spacing: "toString" } })).toBe(12);
    expect(pixelRect({ x: 0, y: 1, w: 2, h: 2 }, 234, 24, 6)).toEqual({ left: 0, top: 42, width: 14, height: 78 });
  });
});

describe("widget minimums", () => {
  it("lets an integration card shrink to a small square, because its values fold instead of scrolling", () => {
    expect(panelMinimum({ kind: "serviceWidget", nativeLocator: { type: "pfsense" } })).toEqual({ w: 3, h: 3 });
  });

  it("keeps a larger minimum for widgets that draw their own content", () => {
    expect(panelMinimum({ kind: "serviceWidget", nativeLocator: { type: "calendar" } })).toEqual({ w: 12, h: 9 });
    expect(panelMinimum({ kind: "serviceWidget", nativeLocator: { type: "iframe" } })).toEqual({ w: 8, h: 9 });
  });
});

describe("grownUnits (Board 6: grow instead of clipping)", () => {
  const units = [
    { id: "a", kind: "panel", rect: { x: 0, y: 0, w: 8, h: 4 } },
    { id: "b", kind: "panel", rect: { x: 0, y: 4, w: 4, h: 3 } },
    { id: "c", kind: "panel", rect: { x: 4, y: 4, w: 4, h: 3 } },
  ];
  it("leaves the layout alone when nothing needs more room", () => {
    expect(grownUnits(units, new Map())).toBe(units);
  });
  it("makes a widget taller and moves what it would overlap down", () => {
    const grown = new Map(grownUnits(units, new Map([["a", 7]])).map((unit) => [unit.id, unit.rect]));
    expect(grown.get("a")).toEqual({ x: 0, y: 0, w: 8, h: 7 });
    expect(grown.get("b")).toEqual({ x: 0, y: 7, w: 4, h: 3 });
    expect(grown.get("c")).toEqual({ x: 4, y: 7, w: 4, h: 3 });
  });
  it("never makes a widget shorter", () => {
    expect(grownUnits(units, new Map([["b", 1]])).find((unit) => unit.id === "b").rect.h).toBe(3);
  });
});
