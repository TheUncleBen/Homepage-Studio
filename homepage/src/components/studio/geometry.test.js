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
  it.each([354, 700])("moves a lower projected row upward through existing canonical slots at width %s", (width) => {
    const original = board();
    const projection = projectBoard(original, width);
    const a = projection.units.find((unit) => unit.id === "a");
    const b = projection.units.find((unit) => unit.id === "b");
    expect(b.rect.y).toBeGreaterThan(a.rect.y);
    const moved = moveProjectedUnit(original, "b", { x: 0, y: a.rect.y - b.rect.y }, projection);
    const next = projectBoard(moved, width);
    expect(next.units.find((unit) => unit.id === "b").rect.y).toBe(0);
    expect([...next.units].sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x)[0].id).toBe("b");
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
  it.each([354, 700])("preserves the requested visual insertion order across varied widths and heights at %s", (width) => {
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
