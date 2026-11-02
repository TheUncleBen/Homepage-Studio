// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { parseColour } from "./appearance.mjs";
import ColourField from "./colour-field";

describe("colour input", () => {
  it("reads hex and rgb, and refuses the rest", () => {
    expect(parseColour("#B9B")).toBe("#bb99bb");
    expect(parseColour("rgb(178, 153, 190)")).toBe("#b299be");
    expect(parseColour("178 153 190")).toBe("#b299be");
    expect(parseColour("rgb(300, 1, 1)")).toBeNull();
    expect(parseColour("red")).toBeNull();
  });

  it("sends a typed or pasted colour as hex once it is valid", () => {
    const onChange = vi.fn();
    render(<ColourField label="Card colour" value="#3fb27f" onChange={onChange} />);
    const text = screen.getByRole("textbox", { name: "Card colour" });
    fireEvent.change(text, { target: { value: "rgb(178, 153" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/Use hex/)).toBeTruthy();
    fireEvent.change(text, { target: { value: "rgb(178, 153, 190)" } });
    expect(onChange).toHaveBeenCalledWith("#b299be");
  });
});
