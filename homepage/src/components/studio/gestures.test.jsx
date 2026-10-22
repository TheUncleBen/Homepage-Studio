// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useStackGestures } from "./gestures";
import { createStackPlayback } from "./playback.mjs";

function pointer(root, x, y = 0, target = root) {
  return {
    button: 0,
    pointerId: 1,
    clientX: x,
    clientY: y,
    currentTarget: root,
    target,
    preventDefault: vi.fn(),
  };
}
describe("Stack pointer/trackpad gestures", () => {
  it("reports finger-following offsets, switches at threshold and clears transient drag state", () => {
    const root = document.createElement("div");
    root.setPointerCapture = vi.fn();
    root.releasePointerCapture = vi.fn();
    const controller = createStackPlayback({ ids: ["a", "b"] });
    const drag = vi.fn();
    const { result } = renderHook(() => useStackGestures({ controller, onDrag: drag }));
    act(() => {
      result.current.onPointerDown(pointer(root, 200));
      result.current.onPointerMove(pointer(root, 140));
    });
    expect(drag).toHaveBeenLastCalledWith(-60);
    expect(controller.getSnapshot().blockedReasons).toContain("gesture");
    act(() => {
      result.current.onPointerUp(pointer(root, 140));
    });
    expect(controller.getSnapshot().activeId).toBe("b");
    expect(drag).toHaveBeenLastCalledWith(0);
    expect(controller.getSnapshot().blockedReasons).not.toContain("gesture");
    controller.destroy();
  });
  it("leaves vertical page scrolling and interactive native content alone", () => {
    const root = document.createElement("div");
    const input = document.createElement("input");
    root.append(input);
    const controller = createStackPlayback({ ids: ["a", "b"] });
    const drag = vi.fn();
    const { result } = renderHook(() => useStackGestures({ controller, onDrag: drag }));
    act(() => {
      result.current.onPointerDown(pointer(root, 200, 0, input));
      result.current.onPointerMove(pointer(root, 100));
      result.current.onPointerUp(pointer(root, 100));
    });
    expect(controller.getSnapshot().activeId).toBe("a");
    act(() => {
      result.current.onPointerDown(pointer(root, 200));
      result.current.onPointerMove(pointer(root, 195, 70));
      result.current.onPointerUp(pointer(root, 100, 100));
    });
    expect(controller.getSnapshot().activeId).toBe("a");
    expect(controller.getSnapshot().blockedReasons).toEqual([]);
    controller.destroy();
  });
  it("uses horizontal trackpad input with a cooldown without treating vertical wheels as slide navigation", () => {
    const root = document.createElement("div");
    const controller = createStackPlayback({ ids: ["a", "b", "c"] });
    const { result } = renderHook(() => useStackGestures({ controller }));
    act(() => {
      result.current.onWheel({
        currentTarget: root,
        target: root,
        deltaX: 0,
        deltaY: 100,
        deltaMode: 0,
      });
    });
    expect(controller.getSnapshot().activeId).toBe("a");
    act(() => {
      result.current.onWheel({
        currentTarget: root,
        target: root,
        deltaX: 80,
        deltaY: 1,
        deltaMode: 0,
      });
      result.current.onWheel({
        currentTarget: root,
        target: root,
        deltaX: 80,
        deltaY: 1,
        deltaMode: 0,
      });
    });
    expect(controller.getSnapshot().activeId).toBe("b");
    controller.destroy();
  });
});
