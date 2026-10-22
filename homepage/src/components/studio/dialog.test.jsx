// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import StudioDialog from "./dialog";

describe("Dialog pending focus", () => {
  it("contains focus while controls are disabled, blocks dismissal, then restores a retained field", () => {
    const onClose = vi.fn();
    const view = (busy) => (
      <StudioDialog title="Pending editor" onClose={onClose} busy={busy}>
        <input aria-label="Draft" disabled={busy} />
      </StudioDialog>
    );
    const { rerender } = render(view(false));
    const input = screen.getByRole("textbox", { name: "Draft" });
    input.focus();
    rerender(view(true));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveFocus();
    expect(fireEvent.keyDown(dialog, { key: "Tab" })).toBe(false);
    expect(dialog).toHaveFocus();
    expect(fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true })).toBe(false);
    expect(dialog).toHaveFocus();
    fireEvent(dialog, new Event("cancel", { bubbles: false, cancelable: true }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Close dialog" })).toBeDisabled();
    rerender(view(false));
    expect(input).toHaveFocus();
    fireEvent(dialog, new Event("cancel", { bubbles: false, cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
