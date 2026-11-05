import { describe, expect, it } from "vitest";

import { intersects, mergePage, moveUnit, pageBoard, resizeUnit, unitsForBoard } from "./geometry.mjs";
import {
  applySizeView,
  centreInRow,
  followDesktop,
  followsDesktop,
  setPageGrid,
  sizeForWidth,
  sizeProjection,
  sizeView,
} from "./layouts.mjs";

const board = () => ({
  version: 3,
  columns: 24,
  pages: [
    { id: "home", name: "Home" },
    { id: "media", name: "Media" },
  ],
  panels: [
    { id: "a", pageId: "home", rect: { x: 0, y: 0, w: 6, h: 4 } },
    { id: "b", pageId: "home", rect: { x: 6, y: 0, w: 6, h: 6 } },
    { id: "c", pageId: "home", rect: { x: 12, y: 0, w: 12, h: 4 } },
    { id: "d", pageId: "home", rect: { x: 0, y: 6, w: 6, h: 4 } },
    { id: "m", pageId: "media", rect: { x: 0, y: 0, w: 8, h: 4 } },
  ],
  stacks: [],
});
const rects = (projection) => Object.fromEntries(projection.units.map((unit) => [unit.id, unit.rect]));
const disjoint = (units) =>
  units.forEach((a, index) => units.slice(index + 1).forEach((b) => expect(intersects(a.rect, b.rect)).toBe(false)));

describe("a layout for each size", () => {
  it("shows a desktop widget stored below its minimum at the minimum, moving what it would cover down", () => {
    const view = pageBoard(
      {
        ...board(),
        panels: [
          {
            id: "g",
            pageId: "home",
            kind: "serviceWidget",
            nativeLocator: { type: "glances" },
            rect: { x: 0, y: 0, w: 4, h: 4 },
          },
          { id: "n", pageId: "home", rect: { x: 4, y: 0, w: 4, h: 4 } },
        ],
      },
      "home",
    );
    const shown = rects(sizeProjection(view, "desktop"));
    expect(shown.g).toEqual({ x: 0, y: 0, w: 8, h: 7 });
    expect(shown.n).toEqual({ x: 4, y: 7, w: 4, h: 4 });
    // What is stored is unchanged.
    expect(unitsForBoard(view).find((unit) => unit.id === "g").rect).toEqual({ x: 0, y: 0, w: 4, h: 4 });
  });

  it("picks the size from the screen width", () => {
    expect(sizeForWidth(390)).toBe("phone");
    expect(sizeForWidth(820)).toBe("tablet");
    expect(sizeForWidth(1280)).toBe("desktop");
  });

  it("makes the phone layout from desktop: reading order, small ones paired, pairs share a height", () => {
    const phone = rects(sizeProjection(pageBoard(board(), "home"), "phone"));
    expect(phone.a).toEqual({ x: 0, y: 0, w: 4, h: 6 });
    expect(phone.b).toEqual({ x: 4, y: 0, w: 4, h: 6 });
    // c is wider than a quarter of desktop; d has no small neighbour left.
    expect(phone.c).toEqual({ x: 0, y: 6, w: 8, h: 4 });
    expect(phone.d).toEqual({ x: 0, y: 10, w: 8, h: 4 });
  });

  it("leaves no hole in the generated tablet layout when desktop rows are offset", () => {
    const view = pageBoard(
      {
        ...board(),
        panels: [
          { id: "a", pageId: "home", rect: { x: 0, y: 0, w: 8, h: 2 } },
          { id: "b", pageId: "home", rect: { x: 8, y: 0, w: 8, h: 2 } },
          { id: "c", pageId: "home", rect: { x: 16, y: 0, w: 8, h: 2 } },
          { id: "d", pageId: "home", rect: { x: 16, y: 3, w: 8, h: 4 } },
          { id: "e", pageId: "home", rect: { x: 0, y: 5, w: 8, h: 4 } },
        ],
      },
      "home",
    );
    const tablet = sizeProjection(view, "tablet").units;
    disjoint(tablet);
    // Every widget sits on the floor or on another widget.
    for (const unit of tablet) {
      if (unit.rect.y === 0) continue;
      const above = { ...unit.rect, y: unit.rect.y - 1 };
      expect(tablet.some((other) => other !== unit && intersects(above, other.rect))).toBe(true);
    }
  });

  it("pairs link tiles with link tiles and cards with cards on the phone", () => {
    const view = pageBoard(
      {
        ...board(),
        panels: [
          { id: "t1", pageId: "home", kind: "service", rect: { x: 0, y: 0, w: 5, h: 2 } },
          { id: "w1", pageId: "home", kind: "serviceWidget", rect: { x: 5, y: 0, w: 6, h: 4 } },
          { id: "w2", pageId: "home", kind: "serviceWidget", rect: { x: 11, y: 0, w: 6, h: 4 } },
          { id: "t2", pageId: "home", kind: "bookmark", rect: { x: 17, y: 0, w: 5, h: 2 } },
          { id: "t3", pageId: "home", kind: "service", rect: { x: 0, y: 4, w: 5, h: 2 } },
        ],
      },
      "home",
    );
    const phone = rects(sizeProjection(view, "phone"));
    // The first tile has a card after it, so it takes the row.
    expect(phone.t1).toEqual({ x: 0, y: 0, w: 8, h: 2 });
    expect(phone.w1).toMatchObject({ x: 0, w: 4 });
    expect(phone.w2).toMatchObject({ x: 4, w: 4, y: phone.w1.y });
    expect(phone.t2).toMatchObject({ x: 0, w: 4, h: 2 });
    expect(phone.t3).toMatchObject({ x: 4, w: 4, h: 2, y: phone.t2.y });
  });

  it("moving a widget on the phone changes only the phone layout, never desktop", () => {
    const whole = board();
    const view = sizeView(pageBoard(whole, "home"), "phone");
    const moved = moveUnit(view, "d", { x: 0, y: 0, w: 8, h: 4 });
    const next = applySizeView(whole, moved);
    expect(next.panels).toEqual(whole.panels);
    expect(followsDesktop(next, "phone")).toBe(false);
    expect(followsDesktop(next, "tablet")).toBe(true);
    const phone = rects(sizeProjection(pageBoard(next, "home"), "phone"));
    expect(phone.d).toEqual({ x: 0, y: 0, w: 8, h: 4 });
    disjoint(sizeProjection(pageBoard(next, "home"), "phone").units);
    // Every page is kept for that size, so a later desktop change moves nothing there.
    expect(next.layouts.phone.m).toEqual({ x: 0, y: 0, w: 8, h: 4 });
  });

  it("resizing a widget on the tablet keeps it the same widget and leaves desktop alone", () => {
    const whole = board();
    const view = sizeView(pageBoard(whole, "home"), "tablet");
    const resized = resizeUnit(view, "a", { ...unitsForBoard(view).find((unit) => unit.id === "a").rect, w: 16 });
    const next = applySizeView(whole, resized);
    expect(next.layouts.tablet.a.w).toBe(16);
    expect(next.panels.find((panel) => panel.id === "a")).toEqual(whole.panels[0]);
    disjoint(sizeProjection(pageBoard(next, "home"), "tablet").units);
  });

  it("a size you arranged no longer follows desktop; a widget added later is placed at the end", () => {
    let whole = applySizeView(board(), sizeView(pageBoard(board(), "home"), "phone"));
    const before = rects(sizeProjection(pageBoard(whole, "home"), "phone"));
    whole = mergePage(whole, moveUnit(pageBoard(whole, "home"), "a", { x: 18, y: 20, w: 6, h: 4 }));
    whole = { ...whole, panels: [...whole.panels, { id: "e", pageId: "home", rect: { x: 0, y: 30, w: 24, h: 4 } }] };
    const after = rects(sizeProjection(pageBoard(whole, "home"), "phone"));
    for (const id of ["a", "b", "c", "d"]) expect(after[id]).toEqual(before[id]);
    expect(after.e).toEqual({ x: 0, y: 14, w: 8, h: 4 });
  });

  it("follow desktop again forgets that size's arrangement", () => {
    const arranged = applySizeView(
      board(),
      moveUnit(sizeView(pageBoard(board(), "home"), "phone"), "d", { x: 0, y: 0, w: 8, h: 4 }),
    );
    const followed = followDesktop(arranged, "phone");
    expect(followed.layouts).toBeUndefined();
    expect(rects(sizeProjection(pageBoard(followed, "home"), "phone"))).toEqual(
      rects(sizeProjection(pageBoard(board(), "home"), "phone")),
    );
  });
});

describe("even or centred grid", () => {
  it("a centred page has 25 columns, scales widgets across, and can centre one in its row", () => {
    const whole = setPageGrid(board(), "home", "centred");
    expect(whole.pages[0].grid).toBe("centred");
    const view = pageBoard(whole, "home");
    expect(view.gridColumns).toBe(25);
    disjoint(unitsForBoard(view));
    expect(Math.max(...unitsForBoard(view).map((unit) => unit.rect.x + unit.rect.w))).toBe(25);
    const lone = { ...view, panels: [{ id: "x", rect: { x: 0, y: 0, w: 9, h: 4 } }], stacks: [] };
    expect(centreInRow(lone, "x").panels[0].rect.x).toBe(8);
    expect(setPageGrid(whole, "home", "even").pages[0].grid).toBeUndefined();
  });

  it("centre in row refuses when the middle is taken", () => {
    const view = {
      version: 3,
      columns: 24,
      gridColumns: 25,
      panels: [
        { id: "x", rect: { x: 0, y: 0, w: 9, h: 4 } },
        { id: "y", rect: { x: 9, y: 0, w: 9, h: 4 } },
      ],
      stacks: [],
    };
    expect(centreInRow(view, "x")).toBeNull();
  });
});

describe("resizing moves only the resized widget", () => {
  it("keeps others in place and moves the resized one to the nearest free space when it no longer fits", () => {
    const view = pageBoard(board(), "home");
    const next = resizeUnit(view, "a", { x: 0, y: 0, w: 12, h: 4 });
    const after = Object.fromEntries(unitsForBoard(next).map((unit) => [unit.id, unit.rect]));
    for (const id of ["b", "c", "d"]) expect(after[id]).toEqual(view.panels.find((panel) => panel.id === id).rect);
    expect(after.a.w).toBe(12);
    disjoint(unitsForBoard(next));
  });
});
