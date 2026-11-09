// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import CardValues, { blockFields } from "./card-values";

import Block from "components/services/widget/block";

vi.mock("next-i18next/pages", () => ({ useTranslation: () => ({ t: (key) => key }) }));
// A plain value block: the real one reads dashboard settings.
vi.mock("components/services/widget/block", () => ({
  default: ({ label, value }) => (
    <span>
      {label} {value}
    </span>
  ),
}));

describe("card values", () => {
  it("shows a widget's own content as it is, never folded away", () => {
    const { container } = render(
      <div className="studio-native-content">
        <CardValues
          card={{ id: "embed" }}
          items={[<iframe key="page" title="Embedded page" src="about:blank" />, <p key="note">Own content</p>]}
        />
      </div>,
    );
    expect(screen.getByTitle("Embedded page")).toBeTruthy();
    expect(screen.getByText("Own content")).toBeTruthy();
    // No values to arrange, so nothing hides it or stops it scrolling.
    expect(container.querySelector(".studio-values")).toBeNull();
    expect(container.querySelector("[hidden]")).toBeNull();
  });

  it("draws the default blocks: the first value large and the rest below, nothing folded", () => {
    const { container } = render(
      <div className="studio-native-content">
        <CardValues
          card={{ id: "values" }}
          items={[
            <Block key="a" label="First" value="1" />,
            <Block key="b" label="Second" value="2" />,
            <Block key="c" label="Third" value="3" />,
          ]}
        />
      </div>,
    );
    const blocks = [...container.querySelectorAll(".studio-block")];
    expect(blocks.map((block) => block.dataset.type)).toEqual(["big", "numbers"]);
    expect(blocks[0].textContent).toContain("First");
    expect(blocks[1].textContent).toContain("Second");
    expect(blocks[1].textContent).toContain("Third");
    expect(container.textContent).not.toMatch(/\+\d/);
  });

  const mixed = [
    { id: "q", type: "quiet", values: ["b", "a"] },
    { id: "n", type: "numbers", values: ["a"] },
    { id: "e", type: "big", values: ["gone"] },
  ];
  const items = [<Block key="a" field="a" label="A" value="1" />, <Block key="b" field="b" label="B" value="2" />];
  it("shows a value in every block that picks it, and, while editing, a note in a chosen block with none", () => {
    const { container } = render(
      <CardValues card={{ id: "mixed", editing: true, look: { blocks: mixed }, blocks: mixed }} items={items} />,
    );
    const [quiet, numbers, empty] = container.querySelectorAll(".studio-block");
    expect(quiet.textContent).toBe("B 2A 1");
    expect(numbers.textContent).toBe("A 1");
    expect(empty.textContent).toBe("Pick a value for this Big number");
  });
  it("leaves a block with no values out on the live dashboard and in a default look", () => {
    const live = render(<CardValues card={{ id: "live", look: { blocks: mixed }, blocks: mixed }} items={items} />);
    expect(live.container.querySelectorAll(".studio-block")).toHaveLength(2);
    expect(live.container.textContent).not.toMatch(/Pick/);
    // A one-value widget with the default look shows just its Big number.
    const one = render(
      <CardValues card={{ id: "one", editing: true }} items={[<Block key="a" field="a" label="A" value="1" />]} />,
    );
    expect([...one.container.querySelectorAll(".studio-block")].map((block) => block.dataset.type)).toEqual(["big"]);
  });
});

describe("which values each block shows", () => {
  const keys = ["a", "b", "c", "d"];
  it("gives Numbers and Quiet with none picked the values no other block shows", () => {
    const fields = blockFields(
      [
        { id: "1", type: "big", first: true },
        { id: "2", type: "pie", values: ["c"] },
        { id: "3", type: "numbers" },
      ],
      keys,
      ["c"],
    );
    // A chart's values don't count as shown: they are drawn, not written.
    expect(fields).toEqual({ 1: ["a"], 2: ["c"], 3: ["b", "c", "d"] });
  });
  it("keeps a block's own order and drops values the widget no longer has", () => {
    expect(blockFields([{ id: "1", type: "numbers", values: ["d", "x", "a"] }], keys)).toEqual({ 1: ["d", "a"] });
  });
  it("draws every collected number on a chart with none picked, and one on a gauge", () => {
    expect(
      blockFields(
        [
          { id: "1", type: "chart" },
          { id: "2", type: "gauge" },
          { id: "3", type: "status" },
        ],
        keys,
        ["b", "c"],
      ),
    ).toEqual({ 1: ["b", "c"], 2: ["b"], 3: [] });
  });
});
