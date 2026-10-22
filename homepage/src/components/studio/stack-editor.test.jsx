// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import StackEditor from "./stack-editor";

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
});
