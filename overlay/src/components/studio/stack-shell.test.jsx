// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  it("has only a Play/Pause navigation button and manual keys apply the30-second hold", async () => {
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
    expect(screen.getAllByRole("button")).toHaveLength(1);
    const carousel = screen.getByRole("region", { name: /Clock/ });
    fireEvent.click(screen.getByRole("button", { name: "Play slideshow" }));
    expect(controller.getSnapshot().playing).toBe(true);
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
    expect(controller.getSnapshot().blockedReasons).not.toContain(
      "content-focus",
    );
  });
});
