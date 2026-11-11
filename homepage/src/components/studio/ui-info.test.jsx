// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Group } from "./ui";

describe("info notes", () => {
  it("Esc closes an open note and goes no further", () => {
    const outer = vi.fn();
    render(
      <div onKeyDown={outer}>
        <Group title="Status" info="What status means." />
      </div>,
    );
    const button = screen.getByRole("button", { name: "About Status" });
    fireEvent.click(button);
    expect(screen.getByRole("note").textContent).toBe("What status means.");
    fireEvent.keyDown(button, { key: "Escape" });
    expect(screen.queryByRole("note")).toBe(null);
    expect(outer).not.toHaveBeenCalled();
    // With the note closed, Esc reaches the dialog as usual.
    fireEvent.keyDown(button, { key: "Escape" });
    expect(outer).toHaveBeenCalledTimes(1);
  });
});
