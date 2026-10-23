import { describe, expect, it } from "vitest";

import {
  intersects,
  moveProjectedUnit,
  moveUnit,
  panelMinimum,
  pixelRect,
  projectBoard,
  stackBoard,
  unitMinimum,
  unitsForBoard,
  unstackBoard,
} from "./geometry.mjs";

const board = () => ({
  version: 2,
  columns: 12,
  panels: [
    { id: "a", rect: { x: 0, y: 0, w: 4, h: 3 } },
    { id: "b", rect: { x: 4, y: 0, w: 4, h: 3 } },
    { id: "c", rect: { x: 8, y: 0, w: 4, h: 5 } },
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
    const moved = moveUnit(original, "a", { ...original.panels[0].rect, y: 8 });
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
  it.each([
    { width: 354, lower: "b" },
    { width: 700, lower: "c" },
  ])("moves a lower projected row upward through existing canonical slots at width $width", ({ width, lower }) => {
    const original = board();
    const projection = projectBoard(original, width);
    const a = projection.units.find((unit) => unit.id === "a");
    const b = projection.units.find((unit) => unit.id === lower);
    expect(b.rect.y).toBeGreaterThan(a.rect.y);
    const dx = ((a.rect.x + a.rect.w / 2 - b.rect.x - b.rect.w / 2) * 12) / projection.columns;
    const moved = moveProjectedUnit(original, lower, { x: dx, y: a.rect.y - b.rect.y }, projection);
    const next = projectBoard(moved, width);
    expect(next.units.find((unit) => unit.id === lower).rect.y).toBe(0);
    expect([...next.units].sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x)[0].id).toBe(lower);
    if (width < 560) expect(moved.panels[2]).toBe(original.panels[2]);
    expect(moved.panels.map((panel) => [panel.rect.w, panel.rect.h])).toEqual(
      original.panels.map((panel) => [panel.rect.w, panel.rect.h]),
    );
    expect(original.panels[1].rect).toEqual({ x: 4, y: 0, w: 4, h: 3 });
    disjoint(moved);
  });
  it("retains order while crossing several projected rows, keeps stack members stable, and preserves a distant unit", () => {
    const original = board();
    original.panels.push(
      { id: "d", rect: { x: 8, y: 0, w: 4, h: 5 } },
      { id: "far", rect: { x: 0, y: 30, w: 6, h: 4 } },
    );
    original.stacks = [{ id: "stack", panelIds: ["c", "d"], rect: { x: 8, y: 0, w: 4, h: 5 } }];
    const projection = projectBoard(original, 354);
    const moved = moveProjectedUnit(original, "stack", { x: 0, y: -6 }, projection);
    const next = projectBoard(moved, 354).units;
    expect(next.map((unit) => unit.id)).toEqual(["stack", "a", "b", "far"]);
    expect(moved.panels[2]).toBe(original.panels[2]);
    expect(moved.panels[3]).toBe(original.panels[3]);
    expect(moved.panels[4]).toBe(original.panels[4]);
    expect(moved.stacks[0].rect).toMatchObject({ w: 4, h: 5 });
    disjoint(moved);
  });
  it("keeps mixed-size responsive slot moves bounded and collision-free without narrowing content", () => {
    const original = board();
    original.panels[0].rect = { x: 0, y: 0, w: 6, h: 5 };
    original.panels[1].rect = { x: 6, y: 0, w: 3, h: 2 };
    original.panels[2].rect = { x: 9, y: 0, w: 3, h: 4 };
    const projection = projectBoard(original, 354);
    const moved = moveProjectedUnit(original, "c", { x: 0, y: -7 }, projection);
    expect(projectBoard(moved, 354).units.map((unit) => unit.id)).toEqual(["c", "a", "b"]);
    moved.panels.forEach((panel, index) => {
      expect(panel.rect.x + panel.rect.w).toBeLessThanOrEqual(12);
      expect([panel.rect.w, panel.rect.h]).toEqual([original.panels[index].rect.w, original.panels[index].rect.h]);
    });
    disjoint(moved);
  });
  it.each([
    { widths: [3, 4, 3], id: "a", dy: 2, expected: ["b", "a", "c"] },
    { widths: [3, 3, 4], id: "c", dy: -4, expected: ["c", "a", "b"] },
  ])("retains intended mobile order after a mixed-width collision: $expected", ({ widths, id, dy, expected }) => {
    let x = 0;
    const original = {
      ...board(),
      panels: widths.map((w, index) => {
        const panel = { id: String.fromCharCode(97 + index), kind: "service", rect: { x, y: 0, w, h: 2 } };
        x += w;
        return panel;
      }),
    };
    const moved = moveProjectedUnit(original, id, { x: 0, y: dy }, projectBoard(original, 354));
    expect(visualOrder(moved, 354).map((unit) => unit.id)).toEqual(expected);
    expect(moved.panels.map((panel) => [panel.rect.w, panel.rect.h])).toEqual(widths.map((w) => [w, 2]));
    disjoint(moved);
  });
  it.each([354, 673, 700, 820])("preserves the requested visual insertion order across varied widths and heights at %s", (width) => {
    const arrangements = [
      [3, 4, 3], [3, 3, 4], [4, 4, 4], [6, 3, 3], [3, 6, 3],
      [4, 5, 3], [5, 3, 4], [3, 4, 5], [6, 6, 3, 3, 4], [3, 5, 4, 4, 3, 5],
    ];
    arrangements.forEach((widths) => {
      let x = 0;
      let y = 0;
      let rowHeight = 0;
      const original = {
        ...board(),
        panels: widths.map((w, index) => {
          const h = [2, 3, 4, 2, 5, 3][index];
          if (x + w > 12) {
            x = 0;
            y += rowHeight;
            rowHeight = 0;
          }
          const panel = { id: `panel-${index}`, kind: "service", rect: { x, y, w, h } };
          x += w;
          rowHeight = Math.max(rowHeight, h);
          return panel;
        }),
      };
      const projection = projectBoard(original, width);
      const visible = visualOrder(original, width);
      visible.forEach((source, from) => visible.forEach((target, to) => {
        if (source.rect.y === target.rect.y) return;
        const expected = visible.map((unit) => unit.id);
        expected.splice(to, 0, ...expected.splice(from, 1));
        const delta = {
          x: ((target.rect.x + target.rect.w / 2 - source.rect.x - source.rect.w / 2) * 12) / projection.columns,
          y: target.rect.y - source.rect.y,
        };
        const moved = moveProjectedUnit(original, source.id, delta, projection);
        expect(visualOrder(moved, width).map((unit) => unit.id), `${widths}: ${source.id} to ${target.id}`).toEqual(expected);
        expect(moved.panels.map((panel) => [panel.rect.w, panel.rect.h])).toEqual(
          original.panels.map((panel) => [panel.rect.w, panel.rect.h]),
        );
        disjoint(moved);
      }));
    });
  });
  it.each([673, 820])("snaps 8-column panels to halves so rows fill the board at %s px", (width) => {
    const row = (widths, y = 0) => {
      let x = 0;
      return widths.map((w, index) => {
        const panel = { id: `${y}-${index}`, kind: "service", rect: { x, y, w, h: 2 } };
        x += w;
        return panel;
      });
    };
    const value = {
      ...board(),
      panels: [...row([6, 6]), ...row([3, 3, 3, 3], 2), ...row([2, 4], 4), ...row([12], 6), ...row([9, 3], 8)],
    };
    const projection = projectBoard(value, width);
    expect(projection.columns).toBe(8);
    const at = (id) => projection.units.find((unit) => unit.id === id).rect;
    // Every panel is half (4 of 8) or, wider than half the desktop, full width.
    projection.units.forEach((unit, index) => {
      expect([4, 8], unit.id).toContain(unit.rect.w);
      expect([0, 4], unit.id).toContain(unit.rect.x);
      expect(unit.rect.x + unit.rect.w).toBeLessThanOrEqual(8);
      projection.units.slice(index + 1).forEach((other) => expect(intersects(unit.rect, other.rect)).toBe(false));
    });
    // Two halves share a row and meet in the middle; quarters pair up two-up.
    expect(at("0-0")).toMatchObject({ x: 0, y: 0, w: 4 });
    expect(at("0-1")).toMatchObject({ x: 4, y: 0, w: 4 });
    expect([at("2-0"), at("2-1"), at("2-2"), at("2-3")].map(({ x, y }) => [x, y])).toEqual([[0, 2], [4, 2], [0, 4], [4, 4]]);
    expect(at("6-0")).toMatchObject({ x: 0, w: 8 });
    expect(at("8-0")).toMatchObject({ x: 0, w: 8 });
    expect(at("8-1")).toMatchObject({ x: 0, w: 4 });
  });
  const rects = (projection) =>
    Object.fromEntries(projection.units.map((unit) => [unit.id, [unit.rect.x, unit.rect.y, unit.rect.w, unit.rect.h]]));
  const tiles = (count, w = 4, h = 3) =>
    Array.from({ length: count }, (_, index) => ({
      id: `t${index}`,
      kind: "service",
      rect: { x: (index * w) % 12, y: Math.floor((index * w) / 12) * h, w, h },
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
  it.each([673, 820])("wraps a row of three 4-wide tiles into two then one in reading order at %s px", (width) => {
    const value = { ...board(), panels: tiles(3) };
    const projection = expectReadingOrder(value, width);
    expect(projection.columns).toBe(8);
    expect(rects(projection)).toEqual({ t0: [0, 0, 4, 3], t1: [4, 0, 4, 3], t2: [0, 3, 4, 3] });
  });
  it.each([673, 820])("reflows a 3x3 grid of 4x3 tiles at %s px without holes or reordering", (width) => {
    const value = { ...board(), panels: tiles(9) };
    const before = JSON.stringify(value);
    const projection = expectReadingOrder(value, width);
    // Two halves per projected row, filling it; only the last row has a remainder.
    projection.units.forEach((unit) => {
      const index = Number(unit.id.slice(1));
      expect(unit.rect, unit.id).toEqual({ x: (index % 2) * 4, y: Math.floor(index / 2) * 3, w: 4, h: 3 });
    });
    expect(projection.rows).toBe(15);
    expect(JSON.stringify(value)).toBe(before);
  });
  it("reflows mixed sizes in reading order, wrapping beside a tall tile before starting a new row", () => {
    const value = {
      ...board(),
      panels: [
        { id: "a", kind: "service", rect: { x: 0, y: 0, w: 6, h: 4 } },
        { id: "b", kind: "service", rect: { x: 6, y: 0, w: 3, h: 2 } },
        { id: "c", kind: "service", rect: { x: 9, y: 0, w: 3, h: 2 } },
        { id: "d", kind: "service", rect: { x: 6, y: 2, w: 6, h: 2 } },
        { id: "e", kind: "service", rect: { x: 0, y: 4, w: 12, h: 2 } },
      ],
    };
    expect(rects(expectReadingOrder(value, 820))).toEqual({
      a: [0, 0, 4, 4],
      b: [4, 0, 4, 2],
      c: [4, 2, 4, 2],
      d: [0, 4, 4, 2],
      e: [0, 6, 8, 2],
    });
    expect(rects(expectReadingOrder(value, 673))).toEqual(rects(projectBoard(value, 820)));
  });
  it("reflows a stack as one unit with its shared rectangle", () => {
    const value = {
      ...board(),
      panels: [
        { id: "a", kind: "service", rect: { x: 0, y: 0, w: 4, h: 3 } },
        { id: "m1", kind: "service", rect: { x: 4, y: 0, w: 4, h: 4 } },
        { id: "m2", kind: "service", rect: { x: 4, y: 0, w: 4, h: 4 } },
        { id: "c", kind: "service", rect: { x: 8, y: 0, w: 4, h: 3 } },
        { id: "d", kind: "service", rect: { x: 0, y: 4, w: 4, h: 3 } },
      ],
      stacks: [{ id: "stack", panelIds: ["m1", "m2"], rect: { x: 4, y: 0, w: 4, h: 4 } }],
    };
    expect(rects(expectReadingOrder(value, 820))).toEqual({
      a: [0, 0, 4, 3],
      stack: [4, 0, 4, 4],
      c: [0, 3, 4, 3],
      d: [4, 4, 4, 3],
    });
  });
  it("writes 8-column moves of a wrapped tile back to the shared desktop layout", () => {
    const original = { ...board(), panels: tiles(6) };
    const projection = projectBoard(original, 820);
    expect(visualOrder(original, 820).map((unit) => unit.id)).toEqual(["t0", "t1", "t2", "t3", "t4", "t5"]);
    // Drag the wrapped t2 up onto t0: it becomes first everywhere.
    const up = moveProjectedUnit(original, "t2", { x: 0, y: -3 }, projection);
    expect(visualOrder(up, 820).map((unit) => unit.id)).toEqual(["t2", "t0", "t1", "t3", "t4", "t5"]);
    expect(visualOrder(up, 1200).map((unit) => unit.id)).toEqual(["t2", "t0", "t1", "t3", "t4", "t5"]);
    disjoint(up);
    // Drag t3 sideways onto t2 in the same projected row: they swap.
    const t2 = projection.units.find((unit) => unit.id === "t2").rect;
    const t3 = projection.units.find((unit) => unit.id === "t3").rect;
    const side = moveProjectedUnit(original, "t3", { x: ((t2.x - t3.x) * 12) / 8, y: 0 }, projection);
    expect(visualOrder(side, 820).map((unit) => unit.id)).toEqual(["t0", "t1", "t3", "t2", "t4", "t5"]);
    expect(side.panels.map((panel) => [panel.rect.w, panel.rect.h])).toEqual(original.panels.map(() => [4, 3]));
    disjoint(side);
  });
  it("pushes collisions deterministically while preserving source identities and untouched values", () => {
    const original = board();
    const moved = moveUnit(original, "a", { x: 4, y: 0, w: 4, h: 3 });
    expect(moved.panels.map((panel) => panel.id)).toEqual(["a", "b", "c"]);
    expect(moved.panels[1].rect).toEqual({ x: 4, y: 3, w: 4, h: 3 });
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
    const moved = moveUnit(stacked, "c", { x: 4, y: 0, w: 4, h: 5 });
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
    expect(mobile.columns).toBe(4);
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
      rect: { x: 0, y: index * 6, w: 6, h: 5 },
    }));
    const value = { version: 2, columns: 12, panels, stacks: [] };
    panels.forEach((panel) => {
      const resized = moveUnit(value, panel.id, {
        ...panel.rect,
        w: 1,
        h: 1,
      }).panels.find((item) => item.id === panel.id);
      expect(resized.rect).toMatchObject(panelMinimum(panel));
      expect(pixelRect(resized.rect, 1200).height).toBeGreaterThan(140);
    });
    const stacked = stackBoard(value, ["link", "embed"], "stack");
    expect(unitMinimum(stacked, "stack")).toEqual({ w: 4, h: 6 });
    expect(stacked.stacks[0].rect.h).toBe(6);
    const projection = projectBoard(
      {
        ...value,
        panels: panels.map((panel) => ({
          ...panel,
          rect: { x: 0, y: 0, w: 1, h: 1 },
        })),
      },
      284,
    );
    projection.units.forEach((unit) => expect(pixelRect(unit.rect, 284, 4).width).toBe(284));
    projection.units.forEach((unit, index) =>
      projection.units.slice(index + 1).forEach((other) => expect(intersects(unit.rect, other.rect)).toBe(false)),
    );
  });
});
