import { describe, expect, it } from "vitest";

import { rebaseBoard } from "./rebase.mjs";

const panel = (id, x, extra = {}) => ({ id, kind: "service", pageId: "home", rect: { x, y: 0, w: 4, h: 2 }, ...extra });
const board = (panels, extra = {}) => ({
  version: 1,
  columns: 24,
  pages: [{ id: "home", name: "Home" }],
  panels,
  stacks: [],
  ...extra,
});

describe("rebaseBoard", () => {
  it("keeps what this draft moved and follows the other save for the rest", () => {
    const base = board([panel("a", 0), panel("b", 4)]);
    const mine = board([panel("a", 12), panel("b", 4)]);
    const theirs = board([panel("a", 0), panel("b", 8), panel("c", 16)]);
    const merged = rebaseBoard(base, mine, theirs);
    expect(merged.panels.map((p) => [p.id, p.rect.x])).toEqual([
      ["a", 12],
      ["b", 8],
      ["c", 16],
    ]);
  });
  it("a panel removed by the other save stays removed, and a cleared look stays cleared", () => {
    const base = board([panel("a", 0, { look: { fill: "tint" } }), panel("b", 4)]);
    const mine = board([panel("a", 0), panel("b", 6)]);
    const theirs = board([panel("a", 0, { look: { fill: "tint" } })]);
    const merged = rebaseBoard(base, mine, theirs);
    expect(merged.panels).toHaveLength(1);
    expect(merged.panels[0].look).toBeUndefined();
  });
  it("pages follow the draft only when it changed them", () => {
    const base = board([]);
    const theirs = board([], { pages: [{ id: "home", name: "Main" }] });
    expect(rebaseBoard(base, board([]), theirs).pages[0].name).toBe("Main");
    const mine = board([], { pages: [{ id: "home", name: "Mine" }] });
    expect(rebaseBoard(base, mine, theirs).pages[0].name).toBe("Mine");
  });
  it("a stack made in the draft wins over one made elsewhere with the same panel", () => {
    const base = board([panel("a", 0), panel("b", 4), panel("c", 8)]);
    const rect = { x: 0, y: 4, w: 4, h: 2 };
    const mine = { ...base, stacks: [{ id: "s1", pageId: "home", panelIds: ["a", "b"], rect }] };
    const theirs = { ...base, stacks: [{ id: "s2", pageId: "home", panelIds: ["b", "c"], rect }] };
    expect(rebaseBoard(base, mine, theirs).stacks.map((s) => s.id)).toEqual(["s1"]);
  });
});
