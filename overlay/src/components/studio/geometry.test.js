import { describe, expect, it } from "vitest";

import {
  intersects,
  moveUnit,
  pixelRect,
  projectBoard,
  stackBoard,
  unitsForBoard,
  unstackBoard,
  panelMinimum,
  unitMinimum,
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
  units.forEach((a, index) =>
    units
      .slice(index + 1)
      .forEach((b) => expect(intersects(a.rect, b.rect)).toBe(false)),
  );
}

describe("Studio grid geometry", () => {
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
      mobile.units
        .slice(index + 1)
        .forEach((b) => expect(intersects(a.rect, b.rect)).toBe(false)),
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
    projection.units.forEach((unit) =>
      expect(pixelRect(unit.rect, 284, 4).width).toBe(284),
    );
    projection.units.forEach((unit, index) =>
      projection.units
        .slice(index + 1)
        .forEach((other) =>
          expect(intersects(unit.rect, other.rect)).toBe(false),
        ),
    );
  });
});
