// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { relaxed, shapeOrder, standsUp } from "./fit.mjs";

// jsdom has no layout: give each element the sizes a browser would measure.
const sized = (node, { sw = 100, cw = 100, sh = 100, ch = 100 } = {}) => {
  for (const [key, value] of Object.entries({ scrollWidth: sw, clientWidth: cw, scrollHeight: sh, clientHeight: ch }))
    Object.defineProperty(node, key, { configurable: true, value });
  return node;
};
function card(blockSizes) {
  const root = sized(document.createElement("div"));
  const body = sized(document.createElement("div"));
  body.className = "studio-blocks";
  root.append(body);
  for (const size of blockSizes) {
    const block = sized(document.createElement("div"), size);
    block.className = "studio-block";
    body.append(block);
  }
  return root;
}

describe("standsUp", () => {
  it("passes a card whose blocks are only too wide", () => {
    expect(standsUp(card([{ sw: 140, cw: 74 }]))).toBe(true);
  });
  it("fails a card with a block cut off at the bottom", () => {
    expect(standsUp(card([{}, { sh: 29, ch: 21 }]))).toBe(false);
  });
});

describe("relaxed", () => {
  it("sets every choice that has an Auto to Auto and keeps the values", () => {
    const { look, blocks } = relaxed({ arrange: "row" }, [
      { id: "a", type: "numbers", arrange: "row", values: ["x"] },
      { id: "b", type: "pie", legend: "beside" },
    ]);
    expect(look).toMatchObject({ arrange: "auto", headerAt: "auto" });
    expect(blocks[0]).toMatchObject({ arrange: "auto", columns: "auto", values: ["x"] });
    expect(blocks[1].legend).toBe("auto");
  });
});

describe("shapeOrder", () => {
  it("prefers a row on a short card and a list on a tall one", () => {
    expect(shapeOrder(400, 90)[0]).toBe("row");
    expect(shapeOrder(100, 300)[0]).toBe("list");
  });
});
