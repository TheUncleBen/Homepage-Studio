// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BUILT_IN_LOOK, DEFAULT_BLOCKS } from "./look.mjs";
import ShowEditor, { chartPool, LimitNote, remedies, scoped, startValues } from "./show-editor";

vi.mock("components/resolvedicon", () => ({ default: () => null }));

const fields = [
  { field: "adguard.queries", label: "Queries" },
  { field: "adguard.blocked", label: "Blocked" },
  { field: "adguard.latency", label: "Latency" },
];
const numbers = fields.map((field) => field.field);
const formats = { "adguard.queries": "number", "adguard.blocked": "number", "adguard.latency": "duration" };

function renderEditor(props = {}) {
  const onLook = vi.fn();
  const onScope = vi.fn();
  const view = render(
    <ShowEditor
      look={{}}
      inheritedLook={BUILT_IN_LOOK}
      fields={fields}
      numbers={numbers}
      formats={formats}
      scope="all"
      onScope={onScope}
      onLook={onLook}
      {...props}
    />,
  );
  return { onLook, onScope, ...view };
}

const addBlock = (name) => {
  fireEvent.click(screen.getByRole("combobox", { name: "Add a block" }));
  fireEvent.click(screen.getByRole("option", { name: new RegExp(`^${name}`) }));
};

describe("chartPool (Rule 1)", () => {
  it("compares numbers written the same way in a pie or bars", () => {
    expect(chartPool("pie", numbers, formats)).toEqual(["adguard.queries", "adguard.blocked"]);
    expect(chartPool("bars", numbers, formats, ["adguard.latency"])).toEqual(["adguard.latency"]);
  });
  it("gives a gauge only percentages and a chart over time every number", () => {
    expect(chartPool("gauge", numbers, formats)).toEqual([]);
    expect(chartPool("gauge", ["a", "b"], { a: "percent", b: "number" })).toEqual(["a"]);
    expect(chartPool("chart", numbers, formats)).toEqual(numbers);
  });
  it("keeps the largest group of the block's own numbers, at least two for a pie", () => {
    const mixed = { mem: "percent", run: "number", stop: "number" };
    expect(chartPool("pie", ["mem", "run", "stop"], mixed, ["mem", "run", "stop"])).toEqual(["run", "stop"]);
    expect(chartPool("pie", ["mem", "run", "stop"], mixed, ["mem"])).toEqual(["run", "stop"]);
  });
  it("offers every number before the formats are known", () => {
    expect(chartPool("pie", numbers, {})).toEqual(numbers);
  });
});

describe("startValues", () => {
  it("gives a new Big number the first value no other block shows", () => {
    const blocks = [{ id: "a", type: "big", values: ["adguard.queries"] }];
    expect(startValues("big", numbers, numbers, blocks, formats)).toEqual(["adguard.blocked"]);
  });
  it("starts a pie with the numbers it can compare and a gauge with one", () => {
    expect(startValues("pie", numbers, numbers, [], formats)).toEqual(["adguard.queries", "adguard.blocked"]);
    expect(startValues("gauge", ["a"], ["a"], [], { a: "percent" })).toEqual(["a"]);
  });
  it("gives blocks without values none", () => {
    expect(startValues("status", numbers, numbers, [], formats)).toBeUndefined();
  });
});

describe("scoped", () => {
  it("stores the default blocks as nothing at All sizes", () => {
    const { write } = scoped({ blocks: [{ id: "x", type: "numbers" }] }, BUILT_IN_LOOK, "all");
    expect(write("blocks", DEFAULT_BLOCKS)?.blocks).toBeUndefined();
  });
  it("writes one size's own setting and drops it when it matches All sizes", () => {
    const look = { arrange: "row" };
    const small = scoped(look, BUILT_IN_LOOK, "small");
    const own = small.write("arrange", "col");
    expect(own.sizes).toEqual({ small: { arrange: "col" } });
    expect(own.arrange).toBe("row");
    expect(scoped(own, BUILT_IN_LOOK, "small").read("arrange")).toBe("col");
    expect(scoped(own, BUILT_IN_LOOK, "small").ownKey("arrange")).toBe(true);
    expect(scoped(own, BUILT_IN_LOOK, "small").write("arrange", "row").sizes).toBeUndefined();
  });
});

describe("ShowEditor", () => {
  it("adds a pie with the numbers it can compare", () => {
    const { onLook } = renderEditor();
    addBlock("Pie");
    const blocks = onLook.mock.calls.at(-1)[0].blocks;
    expect(blocks).toHaveLength(3);
    expect(blocks[2]).toMatchObject({ type: "pie", values: ["adguard.queries", "adguard.blocked"] });
  });

  it("does not offer a gauge without a percentage", () => {
    renderEditor();
    fireEvent.click(screen.getByRole("combobox", { name: "Add a block" }));
    expect(screen.queryByRole("option", { name: /^Gauge/ })).toBeNull();
    expect(screen.getByRole("option", { name: /^Pie/ })).toBeTruthy();
  });

  it("keeps at least one block on a widget", () => {
    renderEditor({ look: { blocks: [{ id: "a", type: "big" }] } });
    expect(screen.getByRole("button", { name: /^Remove/ }).disabled).toBe(true);
  });

  it("lets a service tile show only its header, stored as nothing", () => {
    const { onLook } = renderEditor({ kind: "service", look: { blocks: [{ id: "s", type: "status" }] }, fields: [] });
    fireEvent.click(screen.getByRole("button", { name: /^Remove/ }));
    expect(onLook.mock.calls.at(-1)[0]?.blocks).toBeUndefined();
  });

  it("offers a service tile no value blocks", () => {
    renderEditor({ kind: "service", fields: [], numbers: [] });
    expect(screen.getByText(/Only the header shows/)).toBeTruthy();
    fireEvent.click(screen.getByRole("combobox", { name: "Add a block" }));
    expect(screen.queryByRole("option", { name: /^Big number/ })).toBeNull();
    expect(screen.getByRole("option", { name: /^Status/ })).toBeTruthy();
  });

  it("asks the widget for a value a block wants that it isn't drawing yet", () => {
    const onNativeFields = vi.fn();
    renderEditor({
      look: { blocks: [{ id: "a", type: "numbers", values: ["adguard.queries", "adguard.filtered"] }] },
      fields: fields.slice(0, 1),
      numbers: ["adguard.queries", "adguard.filtered"],
      formats: {},
      choices: ["queries", "blocked", "filtered"],
      prefix: "adguard",
      onNativeFields,
    });
    addBlock("Big number");
    expect(onNativeFields).toHaveBeenCalledWith(["queries", "filtered"]);
  });

  it("edits one size without touching the others", () => {
    const { onLook } = renderEditor({ scope: "small" });
    addBlock("Pie");
    const look = onLook.mock.calls.at(-1)[0];
    expect(look.blocks).toBeUndefined();
    expect(look.sizes.small.blocks).toHaveLength(3);
  });
});

describe("remedies and the limit note", () => {
  it("offers only changes that apply", () => {
    const fixes = remedies({
      blocks: [
        { id: "a", type: "big" },
        { id: "b", type: "numbers", arrange: "row" },
        { id: "c", type: "pie", legend: "beside" },
      ],
      arrange: "row",
      text: "scale",
      textSize: "medium",
    }).map(([label]) => label);
    expect(fixes).toEqual([
      "Hide labels",
      "Allow smaller text",
      "Numbers: Auto",
      "Pie legend: Auto",
      "Blocks sit: Auto",
      "Numbers as quiet",
    ]);
    expect(remedies({ blocks: [{ id: "s", type: "status" }], text: "fixed" }).map(([label]) => label)).toEqual([
      "Let text shrink",
    ]);
  });

  it("says where the corner stopped and applies a change at the size being set up", () => {
    const onLook = vi.fn();
    render(
      <LimitNote
        look={{
          blocks: [
            { id: "a", type: "big" },
            { id: "b", type: "numbers" },
          ],
        }}
        inheritedLook={BUILT_IN_LOOK}
        scope="small"
        fit={{ fits: true, sizeClass: "small", box: { w: 214.4, h: 132 } }}
        limited={{ w: 4, h: 3 }}
        onLook={onLook}
      />,
    );
    expect(screen.getByRole("status").textContent).toMatch(/Stopped at 214 × 132 px.*To go smaller.*for Small sizes/);
    fireEvent.click(screen.getByRole("button", { name: "Hide labels" }));
    const look = onLook.mock.calls[0][0];
    expect(look.sizes.small.blocks.every((block) => block.labels === false)).toBe(true);
    expect(look.blocks.some((block) => block.labels === false)).toBe(false);
  });

  it("explains smaller text and shows nothing while the settings fit", () => {
    const { rerender } = render(
      <LimitNote look={{}} inheritedLook={BUILT_IN_LOOK} fit={{ fits: true, squeezed: true }} onLook={() => {}} />,
    );
    expect(screen.getByRole("status").textContent).toMatch(/text is drawn smaller/);
    expect(screen.getByRole("status").textContent).not.toMatch(/To go smaller/);
    rerender(<LimitNote look={{}} inheritedLook={BUILT_IN_LOOK} fit={{ fits: true }} onLook={() => {}} />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
