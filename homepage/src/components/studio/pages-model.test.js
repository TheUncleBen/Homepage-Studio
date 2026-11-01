import { describe, expect, it } from "vitest";

import {
  addPage,
  freePageName,
  mergePage,
  movePage,
  moveToPage,
  pageBoard,
  pageFromHash,
  pageHash,
  pageNameProblem,
  removePage,
  unitsOnPage,
  updatePage,
} from "./geometry.mjs";

const panel = (id, rect, pageId) => ({ id, kind: "service", title: id, rect, ...(pageId ? { pageId } : {}) });
const board = () => ({
  version: 3,
  columns: 24,
  pages: [
    { id: "home", name: "Overview" },
    { id: "media", name: "Media" },
  ],
  panels: [
    panel("a", { x: 0, y: 0, w: 8, h: 6 }),
    panel("b", { x: 8, y: 0, w: 8, h: 6 }, "home"),
    panel("c", { x: 0, y: 0, w: 8, h: 6 }, "media"),
    panel("d", { x: 0, y: 0, w: 8, h: 6 }, "media"),
  ],
  stacks: [{ id: "s", panelIds: ["d"], rect: { x: 8, y: 0, w: 8, h: 6 }, pageId: "media" }],
});

describe("pages", () => {
  it("adds a page with a free name and id after the given page", () => {
    const { board: next, pageId } = addPage(board(), freePageName(board()), "home");
    expect(next.pages.map((page) => page.name)).toEqual(["Overview", "New page", "Media"]);
    expect(pageId).toBe("new-page");
    const again = addPage(next, freePageName(next));
    expect(again.board.pages.at(-1)).toEqual({ id: "new-page-2", name: "New page 2" });
  });

  it("checks names like the controller", () => {
    expect(pageNameProblem(board(), " media ")).toMatch(/already/);
    expect(pageNameProblem(board(), "Media", "media")).toBeNull();
    expect(pageNameProblem(board(), "")).toMatch(/needs/);
    expect(pageNameProblem(board(), "x".repeat(41))).toMatch(/40/);
  });

  it("links pages by name and still accepts an id", () => {
    const renamed = updatePage(board(), "media", { name: "Films & TV" });
    expect(pageHash(renamed, "media")).toBe("#films-tv");
    expect(pageFromHash(renamed, "#films-tv")).toBe("media");
    expect(pageFromHash(renamed, "#media")).toBe("media");
    expect(pageFromHash(renamed, "#nope")).toBeNull();
  });

  it("keeps first-page widgets in place when pages are reordered", () => {
    const next = movePage(board(), "media", 0);
    expect(next.pages[0].id).toBe("media");
    expect(pageBoard(next, "home").panels.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("moves a panel or a whole stack to the end of another page", () => {
    const moved = moveToPage(board(), "a", "media");
    expect(moved.panels.find((item) => item.id === "a")).toMatchObject({ pageId: "media", rect: { y: 6 } });
    const stack = moveToPage(board(), "s", "home");
    expect(stack.stacks[0].pageId).toBe("home");
    expect(stack.panels.find((item) => item.id === "d").pageId).toBe("home");
  });

  it("deletes a page, moving or dropping its widgets", () => {
    const moved = removePage(board(), "media", "home");
    expect(moved.pages.map((page) => page.id)).toEqual(["home"]);
    expect(unitsOnPage(moved, "home").map((unit) => unit.id).sort()).toEqual(["a", "b", "c", "s"]);
    const dropped = removePage(board(), "media", null);
    expect(dropped.panels.map((item) => item.id)).toEqual(["a", "b"]);
    expect(dropped.stacks).toEqual([]);
    expect(removePage(removePage(board(), "media", null), "home", null).pages).toHaveLength(1);
  });

  it("merges a page view back without touching other pages", () => {
    const whole = board();
    const view = pageBoard(whole, "media");
    const next = mergePage(whole, { ...view, panels: view.panels.map((item) => ({ ...item, title: "x" })) });
    expect(next.panels.filter((item) => item.title === "x").map((item) => item.id)).toEqual(["c", "d"]);
    expect(next.stacks).toHaveLength(1);
  });
});
