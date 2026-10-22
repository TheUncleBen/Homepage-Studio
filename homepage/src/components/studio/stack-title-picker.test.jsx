// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import StackShell from "./stack-shell";

const panels = [
  { id: "a", title: "Clock" },
  { id: "b", title: "Search" },
  { id: "c", title: "Calendar" },
];
const stack = {
  id: "picker-test",
  panelIds: panels.map((panel) => panel.id),
  playback: { mode: "manual", intervalMs: 10000, manualHoldMs: 30000, loop: true },
};
let controller;
function setup(extra = {}) {
  const props = {
    stack,
    panels,
    rect: {},
    editing: false,
    reducedMotion: false,
    onActive: vi.fn(),
    onLongPress: vi.fn(),
    onEdit: vi.fn(),
    onManipulate: vi.fn(),
    onUnitKey: vi.fn(),
    registerController: (_, value) => {
      if (value) controller = value;
    },
    ...extra,
  };
  const view = render(<StackShell {...props} />);
  return { ...view, props };
}
function title() {
  return screen.getByRole("button", { name: /^Choose widget in stack:/ });
}
function pointer(target, type, options = {}) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: 100,
    clientY: 20,
    ...options,
  });
  Object.defineProperties(event, {
    pointerId: { value: options.pointerId ?? 1 },
    isPrimary: { value: options.isPrimary ?? true },
  });
  fireEvent(target, event);
}
function clickTitle(options = {}) {
  pointer(title(), "pointerdown", options);
  pointer(title(), "pointerup", options);
  fireEvent.click(title(), { detail: 1, ...options });
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("Intentional stack title picker", () => {
  it("rejects a title tap when another finger joins anywhere on the page", () => {
    setup();
    pointer(title(), "pointerdown");
    pointer(document.body, "pointerdown", { pointerId: 2, isPrimary: false });
    pointer(document.body, "pointerup", { pointerId: 2, isPrimary: false });
    pointer(title(), "pointerup");
    fireEvent.click(title(), { detail: 1 });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(controller.getSnapshot().activeId).toBe("a");
    clickTitle();
    expect(screen.getByRole("menu")).toBeVisible();
  });

  it("closes on actual membership or order changes and restores focus without replacing the controller", () => {
    const { props, rerender } = setup();
    const original = controller;
    fireEvent.keyDown(title(), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("menu"), { key: "End" });
    expect(screen.getByRole("menuitemradio", { name: "Calendar 3 of 3" })).toHaveFocus();
    rerender(<StackShell {...props} stack={{ ...stack, panelIds: [...stack.panelIds] }} />);
    expect(screen.getByRole("menu")).toBeVisible();
    rerender(<StackShell {...props} stack={{ ...stack, panelIds: ["b", "a"] }} />);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(title()).toHaveFocus();
    expect(controller).toBe(original);
    expect(controller.getSnapshot().blockedReasons).not.toContain("picker");
    expect(controller.getSnapshot().ids).toEqual(["b", "a"]);
  });

  it("opens after a short click, selects without restarting playback, and restores focus", () => {
    setup();
    const original = controller;
    clickTitle();
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: "Clock 1 of 3" })).toHaveFocus();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Calendar 3 of 3" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(title()).toHaveFocus();
    expect(controller).toBe(original);
    expect(controller.getSnapshot()).toMatchObject({ activeId: "c", playing: false });
    act(() => vi.advanceTimersByTime(60000));
    expect(controller.getSnapshot().activeId).toBe("c");
  });

  it("supports keyboard menu navigation and Escape while preserving the manual 30-second hold", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Play slideshow" }));
    act(() => vi.advanceTimersByTime(1000));
    title().focus();
    fireEvent.keyDown(title(), { key: "ArrowDown" });
    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "End" });
    expect(screen.getByRole("menuitemradio", { name: "Calendar 3 of 3" })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(screen.getByRole("menuitemradio", { name: "Search 2 of 3" })).toHaveFocus();
    act(() => vi.advanceTimersByTime(60000));
    expect(controller.getSnapshot().activeId).toBe("a");
    fireEvent.click(document.activeElement);
    expect(controller.getSnapshot()).toMatchObject({ activeId: "b", playing: true });
    act(() => vi.advanceTimersByTime(29999));
    expect(controller.getSnapshot().activeId).toBe("b");
    act(() => vi.advanceTimersByTime(1));
    expect(controller.getSnapshot().activeId).toBe("c");
    fireEvent.keyDown(title(), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(title()).toHaveFocus();
  });

  it("keeps title swipes and minor drags from opening the menu, including their trailing click", () => {
    setup();
    pointer(title(), "pointerdown");
    pointer(title(), "pointermove", { clientX: 40 });
    pointer(title(), "pointerup", { clientX: 40 });
    fireEvent.click(title(), { detail: 1 });
    expect(controller.getSnapshot().activeId).toBe("b");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(500));
    pointer(title(), "pointerdown");
    pointer(title(), "pointermove", { clientX: 90 });
    pointer(title(), "pointerup", { clientX: 90 });
    fireEvent.click(title(), { detail: 1 });
    expect(controller.getSnapshot().activeId).toBe("b");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("rejects long presses, context menus, vertical scrolling and cancelled pointers", () => {
    const { props } = setup();
    pointer(title(), "pointerdown");
    act(() => vi.advanceTimersByTime(420));
    pointer(title(), "pointerup");
    fireEvent.click(title(), { detail: 1 });
    expect(props.onLongPress).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    pointer(title(), "pointerdown");
    fireEvent.contextMenu(title());
    pointer(title(), "pointerup");
    fireEvent.click(title(), { detail: 1 });
    expect(props.onLongPress).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    pointer(title(), "pointerdown");
    pointer(title(), "pointermove", { clientY: 80 });
    pointer(title(), "pointerup", { clientY: 80 });
    fireEvent.click(title(), { detail: 1 });
    pointer(title(), "pointerdown");
    pointer(title(), "pointercancel");
    pointer(title(), "pointerup");
    fireEvent.click(title(), { detail: 1 });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(controller.getSnapshot().activeId).toBe("a");
    expect(controller.getSnapshot().blockedReasons).not.toContain("gesture");
  });

  it("closes permanently when editing or a write begins and leaves other controls independent", () => {
    const { props, rerender } = setup();
    clickTitle();
    rerender(<StackShell {...props} editing />);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(title()).toBeDisabled();
    fireEvent.pointerDown(screen.getByRole("button", { name: /Move stack/ }));
    expect(props.onManipulate).toHaveBeenCalledTimes(1);
    rerender(<StackShell {...props} />);
    expect(title()).toHaveAttribute("aria-expanded", "false");
    clickTitle();
    rerender(<StackShell {...props} busy />);
    rerender(<StackShell {...props} />);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Play slideshow" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(controller.getSnapshot().blockedReasons).not.toContain("picker");
  });
});
