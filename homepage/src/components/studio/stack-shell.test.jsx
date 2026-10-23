// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { boardFocusOrder } from "./focus-order";
import StackShell from "./stack-shell";

const stack = {
  id: "s",
  panelIds: ["a", "b", "c"],
  rect: { x: 0, y: 0, w: 4, h: 3 },
  playback: {
    mode: "manual",
    intervalMs: 10000,
    manualHoldMs: 30000,
    transition: "horizontal",
    transitionDurationMs: 250,
    loop: true,
  },
};
const panels = [
  { id: "a", title: "Clock" },
  { id: "b", title: "Search" },
  { id: "c", title: "Calendar" },
];
beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "Date", "performance"],
  });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("Native board stack controls", () => {
  it("cancels a pending header hold when Quick Launch opens before the hold threshold", () => {
    const hold = vi.fn();
    let controller;
    const props = {
      stack,
      panels,
      rect: {},
      editing: false,
      reducedMotion: false,
      onActive: vi.fn(),
      onLongPress: hold,
      registerController: (_, value) => {
        if (value) controller = value;
      },
    };
    const { rerender } = render(<StackShell {...props} />);
    fireEvent(
      screen.getByText("Widget stack"),
      Object.assign(new Event("pointerdown", { bubbles: true }), {
        pointerId: 1,
        button: 0,
        isPrimary: true,
        clientX: 100,
        clientY: 20,
      }),
    );
    expect(controller.getSnapshot().blockedReasons).toContain("gesture");
    rerender(<StackShell {...props} overlayOpen />);
    act(() => vi.advanceTimersByTime(500));
    expect(hold).not.toHaveBeenCalled();
    expect(controller.getSnapshot().blockedReasons).not.toContain("gesture");
  });
  it("freezes the remaining automatic interval behind an external overlay and resumes without catching up", () => {
    let controller;
    const props = {
      stack: { ...stack, playback: { ...stack.playback, mode: "automatic" } },
      panels,
      rect: {},
      editing: false,
      reducedMotion: false,
      onActive: vi.fn(),
      registerController: (_, value) => {
        if (value) controller = value;
      },
    };
    const { rerender } = render(<StackShell {...props} />);
    act(() => vi.advanceTimersByTime(4000));
    rerender(<StackShell {...props} overlayOpen />);
    act(() => vi.advanceTimersByTime(60000));
    expect(controller.getSnapshot()).toMatchObject({ activeId: "a", remainingMs: 6000, playing: true });
    rerender(<StackShell {...props} />);
    act(() => vi.advanceTimersByTime(5999));
    expect(controller.getSnapshot().activeId).toBe("a");
    act(() => vi.advanceTimersByTime(1));
    expect(controller.getSnapshot().activeId).toBe("b");
  });
  it("does not enter editing after a short pointer release outside its local header", () => {
    const hold = vi.fn();
    render(
      <StackShell
        stack={stack}
        panels={panels}
        rect={{}}
        editing={false}
        reducedMotion={false}
        onActive={() => {}}
        onLongPress={hold}
        registerController={() => {}}
      />,
    );
    fireEvent(
      screen.getByText("Widget stack"),
      Object.assign(new Event("pointerdown", { bubbles: true }), {
        pointerId: 1,
        button: 0,
        isPrimary: true,
        clientX: 100,
        clientY: 20,
      }),
    );
    act(() => window.dispatchEvent(Object.assign(new Event("pointerup"), { pointerId: 1 })));
    act(() => vi.advanceTimersByTime(500));
    expect(hold).not.toHaveBeenCalled();
  });

  it("locks arrangement controls during a write without recreating playback or advancing a suspended stack", () => {
    let controller;
    const register = (_, value) => {
      if (value) controller = value;
    };
    const props = {
      stack: { ...stack, playback: { ...stack.playback, mode: "automatic" } },
      panels,
      rect: {},
      reducedMotion: false,
      onActive: vi.fn(),
      registerController: register,
      onEdit: vi.fn(),
      onManipulate: vi.fn(),
      onUnitKey: vi.fn(),
    };
    const { rerender } = render(<StackShell {...props} editing />);
    const original = controller;
    rerender(<StackShell {...props} editing busy />);
    for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
    act(() => vi.advanceTimersByTime(60000));
    expect(controller).toBe(original);
    expect(controller.getSnapshot().activeId).toBe("a");
    expect(controller.getSnapshot().playing).toBe(true);
    rerender(<StackShell {...props} editing />);
    expect(screen.getByRole("button", { name: "Edit stack" })).toBeEnabled();
    rerender(<StackShell {...props} editing={false} />);
    act(() => vi.advanceTimersByTime(10000));
    expect(controller).toBe(original);
    expect(controller.getSnapshot().activeId).toBe("b");
  });
  it("keeps one Play/Pause control and a quiet title picker while manual keys apply the 30-second hold", async () => {
    let controller;
    render(
      <StackShell
        stack={stack}
        panels={panels}
        rect={{}}
        editing={false}
        reducedMotion={false}
        onActive={() => {}}
        registerController={(_, value) => {
          controller = value;
        }}
      />,
    );
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Choose widget in stack: Clock" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByRole("button", { name: /previous|next/i })).not.toBeInTheDocument();
    const carousel = screen.getByRole("region", { name: /Clock/ });
    // The label alone carries state; aria-pressed would announce it twice.
    expect(screen.getByRole("button", { name: "Play slideshow" })).not.toHaveAttribute("aria-pressed");
    fireEvent.click(screen.getByRole("button", { name: "Play slideshow" }));
    expect(controller.getSnapshot().playing).toBe(true);
    expect(screen.getByRole("button", { name: "Pause slideshow" })).not.toHaveAttribute("aria-pressed");
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    fireEvent.keyDown(carousel, { key: "ArrowRight" });
    expect(controller.getSnapshot().activeId).toBe("b");
    act(() => {
      vi.advanceTimersByTime(29999);
    });
    expect(controller.getSnapshot().activeId).toBe("b");
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(controller.getSnapshot().activeId).toBe("c");
    fireEvent.click(screen.getByRole("button", { name: "Pause slideshow" }));
    fireEvent.keyDown(carousel, { key: "ArrowLeft" });
    act(() => {
      vi.advanceTimersByTime(60000);
    });
    expect(controller.getSnapshot().activeId).toBe("b");
    expect(controller.getSnapshot().playing).toBe(false);
  });
  it("survives Strict Mode effect replay and keeps playback available after a real cleanup", async () => {
    let controller;
    const register = (_, value) => {
      if (value) controller = value;
    };
    const { unmount } = render(
      <StrictMode>
        <StackShell
          stack={stack}
          panels={panels}
          rect={{}}
          editing={false}
          reducedMotion={false}
          onActive={() => {}}
          registerController={register}
        />
      </StrictMode>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole("button", { name: "Play slideshow" }));
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(controller.getSnapshot().activeId).toBe("b");
    unmount();
    await Promise.resolve();
    expect(controller.getSnapshot().destroyed).toBe(true);
  });
  it("blocks initial automatic rotation for reduced motion, but explicit Play is available", () => {
    let controller;
    render(
      <StackShell
        stack={{ ...stack, playback: { ...stack.playback, mode: "automatic" } }}
        panels={panels}
        rect={{}}
        editing={false}
        reducedMotion
        onActive={() => {}}
        registerController={(_, value) => {
          controller = value;
        }}
      />,
    );
    expect(controller.getSnapshot().playing).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Play slideshow" }));
    expect(controller.getSnapshot().playing).toBe(true);
  });
  it("supports stack right-click selection and excludes Play button focus from blockers", () => {
    const hold = vi.fn();
    let controller;
    render(
      <StackShell
        stack={stack}
        panels={panels}
        rect={{}}
        editing={false}
        reducedMotion={false}
        onActive={() => {}}
        onLongPress={hold}
        registerController={(_, value) => {
          controller = value;
        }}
      />,
    );
    fireEvent.contextMenu(screen.getByText("Widget stack"));
    expect(hold).toHaveBeenCalledWith("s");
    screen.getByRole("button", { name: "Play slideshow" }).focus();
    expect(controller.getSnapshot().blockedReasons).not.toContain("content-focus");
  });
});

describe("Stack selection checkbox", () => {
  const editProps = (overrides = {}) => ({
    stack,
    panels,
    rect: {},
    editing: true,
    reducedMotion: false,
    onActive: vi.fn(),
    registerController: vi.fn(),
    onEdit: vi.fn(),
    onManipulate: vi.fn(),
    onUnitKey: vi.fn(),
    onLongPress: vi.fn(),
    onSelect: vi.fn(),
    ...overrides,
  });

  it("toggles the stack id from a Select checkbox named after the active widget, only in edit mode", () => {
    const props = editProps();
    const { rerender } = render(<StackShell {...props} />);
    const checkbox = screen.getByRole("checkbox", { name: "Select stack Clock" });
    expect(checkbox.closest("label")).toHaveClass("studio-select-target");
    expect(checkbox.closest("header")).toHaveClass("studio-stack-header");
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    expect(props.onSelect).toHaveBeenCalledExactlyOnceWith("s");
    rerender(<StackShell {...props} selected />);
    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);
    expect(props.onSelect).toHaveBeenCalledTimes(2);
    expect(props.onSelect).toHaveBeenLastCalledWith("s");
    rerender(<StackShell {...props} selected busy />);
    expect(checkbox).toBeDisabled();
    rerender(<StackShell {...props} editing={false} />);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("is the stack's first header control in Tab order, before Move stack", () => {
    render(
      <div data-testid="canvas">
        <StackShell {...editProps()} />
      </div>,
    );
    const order = boardFocusOrder(screen.getByTestId("canvas"), ["s"]).map(
      (element) => element.getAttribute("aria-label") || element.textContent,
    );
    expect(order.slice(1, 3)).toEqual(["Select stack Clock", "Move stack. Arrow keys move; Shift and arrows resize."]);
  });

  it("does not treat a right-click on the selection target as the selecting header hold", () => {
    const props = editProps();
    render(<StackShell {...props} />);
    const target = screen.getByRole("checkbox", { name: "Select stack Clock" }).closest("label");
    const menu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    target.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(false);
    expect(props.onLongPress).not.toHaveBeenCalled();
    expect(props.onSelect).not.toHaveBeenCalled();
  });
});
