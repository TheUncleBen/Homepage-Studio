// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import StudioIcon from "./icons";

describe("Studio icons", () => {
  it("draws dashboard settings as sliders rather than a rayed sun", () => {
    const { container } = render(<StudioIcon name="settings" />);
    const path = container.querySelector("path").getAttribute("d");
    // A circle drawn with arcs plus diagonal rays read as a light/dark toggle.
    expect(path).not.toMatch(/a4 4/);
    expect(path).not.toMatch(/l2 2/);
    expect(path).toBe("M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4");
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});
