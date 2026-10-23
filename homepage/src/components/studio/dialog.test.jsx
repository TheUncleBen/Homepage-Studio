// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import StudioDialog, { ErrorMessage } from "./dialog";

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

describe("Conflict message", () => {
  const conflict = { status: 409, message: "Fixture revision changed" };
  it("tells editors with copyable drafts to copy their changes", () => {
    render(<ErrorMessage error={conflict} onReload={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Copy any changes you need");
  });
  it("does not ask for an arrangement draft to be copied and says reloading discards it", () => {
    const onReload = vi.fn();
    render(<ErrorMessage arrangement error={conflict} onReload={onReload} />);
    const alert = screen.getByRole("alert");
    expect(alert).not.toHaveTextContent(/copy/i);
    expect(alert).toHaveTextContent("Your unsaved arrangement is still shown. Reloading the current configuration discards it");
    fireEvent.click(screen.getByRole("button", { name: "Reload current configuration" }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});
