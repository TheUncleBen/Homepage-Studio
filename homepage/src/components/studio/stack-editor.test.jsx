// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import StackEditor, { PositionEditor } from "./stack-editor";

describe("Stack playback editor", () => {
  it("applies and reopens the selected manual delay without shortening a longer normal interval", () => {
    const stack = {
      id: "stack",
      panelIds: ["clock", "greeting"],
      rect: { x: 0, y: 0, w: 4, h: 3 },
      playback: {
        mode: "manual",
        intervalMs: 60000,
        manualHoldMs: 30000,
        transition: "horizontal",
        transitionDurationMs: 250,
        loop: true,
      },
    };
    const board = {
      version: 2,
      columns: 12,
      panels: ["clock", "greeting"].map((id) => ({
        id,
        kind: "informationWidget",
        title: id,
        group: "",
        nativeLocator: { type: id === "clock" ? "datetime" : "greeting" },
        rect: { x: 0, y: 0, w: 4, h: 2 },
      })),
      stacks: [stack],
    };
    const onApply = vi.fn();
    const callbacks = { onApply, onClose: vi.fn(), onPanelEdit: vi.fn() };
    const { unmount } = render(
      <StackEditor stack={stack} board={board} {...callbacks} />,
    );
    const delay = screen.getByRole("spinbutton", {
      name: "Manual navigation delay (seconds)",
    });
    expect(delay).toHaveValue(30);
    expect(delay).toHaveAttribute("min", "1");
    expect(delay).toHaveAttribute("max", "3600");

    fireEvent.change(delay, { target: { value: "45" } });
    expect(onApply).not.toHaveBeenCalled();
    expect(stack.playback.manualHoldMs).toBe(30000);
    expect(
      screen.getByText(/Manual switching while playing waits 60 seconds/),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Apply to arrangement" }),
    );
    expect(onApply).toHaveBeenCalledTimes(1);
    const appliedBoard = onApply.mock.calls[0][0];
    expect(appliedBoard.stacks[0].playback).toEqual({
      ...stack.playback,
      manualHoldMs: 45000,
    });

    unmount();
    render(
      <StackEditor
        stack={appliedBoard.stacks[0]}
        board={appliedBoard}
        {...callbacks}
      />,
    );
    expect(
      screen.getByRole("spinbutton", {
        name: "Manual navigation delay (seconds)",
      }),
    ).toHaveValue(45);
    expect(
      screen.getByText(/Manual switching while playing waits 60 seconds/),
    ).toBeInTheDocument();
  });

  it("keeps raw position text while typing and validates without rewriting other fields", () => {
    const onApply = vi.fn();
    render(
      <PositionEditor
        unit={{ id: "clock", rect: { x: 8, y: 2, w: 4, h: 3 }, minimum: { w: 3, h: 2 } }}
        onApply={onApply}
        onClose={vi.fn()}
      />,
    );
    const column = screen.getByRole("spinbutton", { name: "Column" });
    const width = screen.getByRole("spinbutton", { name: "Width" });
    const apply = screen.getByRole("button", { name: "Apply to arrangement" });

    fireEvent.change(width, { target: { value: "" } });
    expect(width).toHaveValue(null);
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a width.");
    expect(width).toHaveAttribute("aria-invalid", "true");
    expect(apply).toBeDisabled();

    fireEvent.change(width, { target: { value: "1" } });
    fireEvent.change(width, { target: { value: "12" } });
    expect(width).toHaveValue(12);
    expect(column).toHaveValue(8);
    expect(screen.getByRole("alert")).toHaveTextContent("Column plus width cannot exceed 12");
    expect(apply).toBeDisabled();

    fireEvent.change(column, { target: { value: "0" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(apply).toBeEnabled();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Height" }), { target: { value: "1" } });
    fireEvent.blur(screen.getByRole("spinbutton", { name: "Height" }));
    expect(screen.getByRole("spinbutton", { name: "Height" })).toHaveValue(2);
    fireEvent.click(apply);
    expect(onApply).toHaveBeenCalledWith({ x: 0, y: 2, w: 12, h: 2 });
  });

  it("clamps an out-of-range value only on blur and still applies an unchanged position", () => {
    const onApply = vi.fn();
    const rect = { x: 0, y: 0, w: 4, h: 3 };
    render(<PositionEditor unit={{ id: "clock", rect }} onApply={onApply} onClose={vi.fn()} />);
    const width = screen.getByRole("spinbutton", { name: "Width" });
    fireEvent.change(width, { target: { value: "38" } });
    expect(width).toHaveValue(38);
    expect(screen.getByRole("alert")).toHaveTextContent("Width must be between 1 and 12.");
    expect(screen.getByRole("spinbutton", { name: "Column" })).toHaveValue(0);
    fireEvent.blur(width);
    expect(width).toHaveValue(12);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.change(width, { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply to arrangement" }));
    expect(onApply).toHaveBeenCalledWith(rect);
  });

  it("keeps raw slideshow timing text while typing and validates on blur and apply without rewriting other fields", () => {
    const stack = {
      id: "stack",
      panelIds: ["clock", "greeting"],
      rect: { x: 0, y: 0, w: 4, h: 3 },
      playback: { mode: "manual", intervalMs: 2500, manualHoldMs: 30000, transition: "horizontal", transitionDurationMs: 250, loop: true },
    };
    const board = {
      version: 2,
      columns: 12,
      panels: ["clock", "greeting"].map((id) => ({ id, kind: "informationWidget", title: id, group: "", rect: { x: 0, y: 0, w: 4, h: 2 } })),
      stacks: [stack],
    };
    const onApply = vi.fn();
    render(<StackEditor stack={stack} board={board} onApply={onApply} onClose={vi.fn()} onPanelEdit={vi.fn()} />);
    const interval = screen.getByRole("spinbutton", { name: "Seconds per widget" });
    const delay = screen.getByRole("spinbutton", { name: "Manual navigation delay (seconds)" });
    const duration = screen.getByRole("spinbutton", { name: "Animation duration (ms)" });
    const apply = screen.getByRole("button", { name: "Apply to arrangement" });
    expect(interval).toHaveValue(2.5);

    // Clearing a field keeps it empty instead of snapping to the minimum.
    fireEvent.change(interval, { target: { value: "" } });
    expect(interval).toHaveValue(null);
    expect(interval).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter the seconds per widget.");
    expect(apply).toBeDisabled();
    expect(delay).toHaveValue(30);
    expect(duration).toHaveValue(250);

    // Typing a multi-digit value passes through intermediate digits untouched.
    fireEvent.change(interval, { target: { value: "0" } });
    expect(interval).toHaveValue(0);
    expect(screen.getByRole("alert")).toHaveTextContent("between 1 and 3600 seconds");
    fireEvent.change(interval, { target: { value: "15" } });
    expect(interval).toHaveValue(15);
    expect(interval).not.toHaveAttribute("aria-invalid");
    expect(apply).toBeEnabled();

    // Out-of-range text is kept while typing and clamped only on blur.
    fireEvent.change(duration, { target: { value: "5000" } });
    expect(duration).toHaveValue(5000);
    expect(duration).toHaveAttribute("aria-invalid", "true");
    expect(apply).toBeDisabled();
    expect(interval).toHaveValue(15);
    fireEvent.blur(duration);
    expect(duration).toHaveValue(2000);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    fireEvent.change(delay, { target: { value: "1.5" } });
    expect(delay).toHaveValue(1.5);
    expect(apply).toBeEnabled();
    fireEvent.click(apply);
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0][0].stacks[0].playback).toEqual({
      ...stack.playback,
      intervalMs: 15000,
      manualHoldMs: 1500,
      transitionDurationMs: 2000,
    });
  });

  it("names every Move out button after its member", () => {
    const stack = {
      id: "stack",
      panelIds: ["clock", "greeting"],
      rect: { x: 0, y: 0, w: 4, h: 3 },
      playback: { mode: "manual", intervalMs: 10000, manualHoldMs: 30000, transition: "horizontal", transitionDurationMs: 250, loop: true },
    };
    const board = {
      version: 2,
      columns: 12,
      panels: ["clock", "greeting"].map((id) => ({ id, kind: "informationWidget", title: id === "clock" ? "Clock" : "Greeting", group: "", rect: { x: 0, y: 0, w: 4, h: 2 } })),
      stacks: [stack],
    };
    render(<StackEditor stack={stack} board={board} onApply={vi.fn()} onClose={vi.fn()} onPanelEdit={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Move out Clock from stack" })).toHaveTextContent("Move out");
    fireEvent.click(screen.getByRole("button", { name: "Move out Greeting from stack" }));
    expect(screen.queryByRole("button", { name: "Move out Greeting from stack" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Move out .* from stack$/ })).toHaveLength(1);
  });
});
