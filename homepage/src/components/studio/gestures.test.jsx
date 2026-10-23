// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { touchesNativeContent, useLongPress, useStackGestures } from "./gestures";
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
  it("keeps a touch swipe active when implicit child capture transfers to its gesture owner", () => {
    const root = document.createElement("div");
    const child = document.createElement("strong");
    root.append(child);
    document.body.append(root);
    let captured = false;
    root.setPointerCapture = vi.fn(() => {
      captured = true;
    });
    root.hasPointerCapture = vi.fn(() => captured);
    root.releasePointerCapture = vi.fn(() => {
      captured = false;
    });
    const controller = createStackPlayback({ ids: ["a", "b"] });
    const drag = vi.fn();
    const { result, unmount } = renderHook(() => useStackGestures({ controller, onDrag: drag }));
    try {
      act(() => {
        result.current.onPointerDown(pointer(root, 200, 0, child));
        result.current.onPointerMove(pointer(root, 140, 0, child));
        // Real touch transfers its implicit child capture before the owner's
        // gotpointercapture. hasPointerCapture already names the pending owner.
        child.dispatchEvent(Object.assign(new Event("lostpointercapture", { bubbles: true }), { pointerId: 1 }));
      });
      expect(controller.getSnapshot().blockedReasons).toContain("gesture");
      expect(drag).toHaveBeenLastCalledWith(-60);
      expect(root.releasePointerCapture).not.toHaveBeenCalled();
      act(() => result.current.onPointerUp(pointer(root, 140)));
      expect(controller.getSnapshot()).toMatchObject({ activeId: "b", blockedReasons: [] });
      expect(drag).toHaveBeenLastCalledWith(0);
      expect(root.releasePointerCapture).toHaveBeenCalledOnce();
    } finally {
      unmount();
      root.remove();
      controller.destroy();
    }
  });

  it.each(["lostpointercapture", "pointercancel"])("still cancels a swipe on genuine %s", (type) => {
    const root = document.createElement("div");
    document.body.append(root);
    let captured = false;
    root.setPointerCapture = vi.fn(() => {
      captured = true;
    });
    root.hasPointerCapture = vi.fn(() => captured);
    root.releasePointerCapture = vi.fn(() => {
      captured = false;
    });
    const controller = createStackPlayback({ ids: ["a", "b"] });
    const drag = vi.fn();
    const { result, unmount } = renderHook(() => useStackGestures({ controller, onDrag: drag }));
    try {
      act(() => {
        result.current.onPointerDown(pointer(root, 200));
        result.current.onPointerMove(pointer(root, 140));
        if (type === "lostpointercapture") captured = false;
        root.dispatchEvent(Object.assign(new Event(type, { bubbles: true }), { pointerId: 1 }));
        result.current.onPointerUp(pointer(root, 140));
      });
      expect(controller.getSnapshot()).toMatchObject({ activeId: "a", blockedReasons: [] });
      expect(drag).toHaveBeenLastCalledWith(0);
    } finally {
      unmount();
      root.remove();
      controller.destroy();
    }
  });

  it("cancels rather than navigates when a second pointer starts outside the stack", () => {
    const root = document.createElement("div");
    const controller = createStackPlayback({ ids: ["a", "b"] });
    const { result, unmount } = renderHook(() => useStackGestures({ controller }));
    act(() => {
      result.current.onPointerDown(pointer(root, 200));
      result.current.onPointerMove(pointer(root, 140));
      window.dispatchEvent(Object.assign(new Event("pointerdown"), { pointerId: 2 }));
      result.current.onPointerUp(pointer(root, 140));
    });
    expect(controller.getSnapshot()).toMatchObject({ activeId: "a", blockedReasons: [] });
    unmount();
    controller.destroy();
  });
  it("ends an uncaptured pointer released outside the stack without leaving playback blocked", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const controller = createStackPlayback({ ids: ["a", "b"] });
    const drag = vi.fn();
    const { result, unmount } = renderHook(() => useStackGestures({ controller, onDrag: drag }));
    act(() => result.current.onPointerDown(pointer(root, 200)));
    expect(controller.getSnapshot().blockedReasons).toContain("gesture");
    act(() => window.dispatchEvent(Object.assign(new Event("pointerup"), { pointerId: 1 })));
    expect(controller.getSnapshot().blockedReasons).toEqual([]);
    expect(controller.getSnapshot().activeId).toBe("a");
    unmount();
    root.remove();
    controller.destroy();
  });

  it("cancels a captured gesture on window blur without a manual navigation", () => {
    const root = document.createElement("div");
    root.setPointerCapture = vi.fn();
    root.releasePointerCapture = vi.fn();
    const controller = createStackPlayback({ ids: ["a", "b"] });
    const drag = vi.fn();
    const { result, unmount } = renderHook(() => useStackGestures({ controller, onDrag: drag }));
    act(() => {
      result.current.onPointerDown(pointer(root, 200));
      result.current.onPointerMove(pointer(root, 140));
      window.dispatchEvent(new Event("blur"));
    });
    expect(controller.getSnapshot().blockedReasons).toEqual([]);
    expect(drag).toHaveBeenLastCalledWith(0);
    expect(controller.getSnapshot().activeId).toBe("a");
    unmount();
    controller.destroy();
  });

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
  it("leaves touches that start on native controls, embeds, charts or horizontal scrollers to that content", () => {
    const root = document.createElement("section");
    root.innerHTML = `
      <div class="body"><p class="text">Plain</p>
        <a href="https://example.test/"><span class="link">Link</span></a>
        <input class="input" /><textarea class="area"></textarea><select class="select"></select>
        <label class="label">Label</label><div contenteditable="true"><b class="editable">Edit</b></div>
        <iframe class="frame"></iframe><embed class="embed" /><canvas class="canvas"></canvas>
        <svg><g><rect class="chart"></rect></g></svg>
        <div class="wide"><span class="wide-child">Wide</span></div>
        <div class="tall"><span class="tall-child">Tall</span></div>
        <button data-studio-stack-title><strong class="title">Title</strong></button>
      </div>`;
    document.body.append(root);
    const wide = root.querySelector(".wide");
    wide.style.overflowX = "auto";
    Object.defineProperty(wide, "scrollWidth", { value: 600 });
    Object.defineProperty(wide, "clientWidth", { value: 300 });
    const tall = root.querySelector(".tall");
    tall.style.overflowY = "auto";
    Object.defineProperty(tall, "scrollHeight", { value: 600 });
    Object.defineProperty(tall, "clientHeight", { value: 300 });
    const at = (selector, pointerType = "touch") => touchesNativeContent({ pointerType, target: root.querySelector(selector), currentTarget: root });
    try {
      for (const selector of [".link", ".input", ".area", ".select", ".label", ".editable", ".frame", ".embed", ".canvas", ".chart", ".wide-child"])
        expect(at(selector), selector).toBe(true);
      for (const selector of [".text", ".body", ".tall-child", ".title"]) expect(at(selector), selector).toBe(false);
      // Mouse behavior is unchanged: only the original interactive list applies.
      expect(at(".label", "mouse")).toBe(false);
      expect(at(".wide-child", "mouse")).toBe(false);
      expect(at(".input", "mouse")).toBe(true);
    } finally {
      root.remove();
    }
  });
  it("navigates from a touch swipe on plain body content but not from inside a horizontal scroller", () => {
    const root = document.createElement("section");
    root.innerHTML = '<div class="plain"></div><div class="wide"><span></span></div>';
    document.body.append(root);
    const wide = root.querySelector(".wide");
    wide.style.overflowX = "scroll";
    Object.defineProperty(wide, "scrollWidth", { value: 600 });
    Object.defineProperty(wide, "clientWidth", { value: 300 });
    root.setPointerCapture = vi.fn();
    const controller = createStackPlayback({ ids: ["a", "b", "c"] });
    const { result, unmount } = renderHook(() => useStackGestures({ controller }));
    const touch = (x, target) => ({ ...pointer(root, x, 0, target), pointerType: "touch" });
    try {
      act(() => {
        result.current.onPointerDown(touch(200, wide.firstChild));
        result.current.onPointerMove(touch(120, wide.firstChild));
        result.current.onPointerUp(touch(120, wide.firstChild));
      });
      expect(controller.getSnapshot().activeId).toBe("a");
      expect(root.setPointerCapture).not.toHaveBeenCalled();
      act(() => {
        result.current.onPointerDown(touch(200, root.querySelector(".plain")));
        result.current.onPointerMove(touch(120, root.querySelector(".plain")));
        result.current.onPointerUp(touch(120, root.querySelector(".plain")));
      });
      expect(controller.getSnapshot().activeId).toBe("b");
    } finally {
      unmount();
      root.remove();
      controller.destroy();
    }
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

describe("Intentional panel and empty-board holds", () => {
  it("cancels an outside release, window blur, and secondary pointer without leaving delayed edit actions", () => {
    vi.useFakeTimers();
    try {
      const root = document.createElement("div");
      const hold = vi.fn();
      const { result, unmount } = renderHook(() => useLongPress({ onLongPress: hold }));
      for (const event of [
        Object.assign(new Event("pointerup"), { pointerId: 1 }),
        Object.assign(new Event("pointercancel"), { pointerId: 1 }),
        Object.assign(new Event("lostpointercapture"), { pointerId: 1 }),
        new Event("blur"),
        Object.assign(new Event("pointerdown"), { pointerId: 2 }),
      ]) {
        act(() => {
          result.current.onPointerDown(pointer(root, 200));
          window.dispatchEvent(event);
          vi.advanceTimersByTime(500);
        });
      }
      expect(hold).not.toHaveBeenCalled();
      act(() => {
        result.current.onPointerDown(pointer(root, 200));
        vi.advanceTimersByTime(420);
      });
      expect(hold).toHaveBeenCalledTimes(1);
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});
