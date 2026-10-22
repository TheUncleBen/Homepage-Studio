// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PanelHost from "./panel-host";
import { createStackPlayback } from "./playback.mjs";

vi.mock("./native-panel", () => ({ default: () => null }));
const originalAnimate = HTMLElement.prototype.animate;
let animations;
beforeEach(() => {
  animations = [];
  HTMLElement.prototype.animate = vi.fn(function animate(frames, options) {
    const animation = { cancel: vi.fn() };
    animations.push({ panel: this.closest("[data-panel-id]").dataset.panelId, frames, options, animation });
    return animation;
  });
});
afterEach(() => {
  if (originalAnimate) HTMLElement.prototype.animate = originalAnimate;
  else delete HTMLElement.prototype.animate;
});
function setup(ids, transition = "horizontal") {
  const controller = createStackPlayback({ ids });
  const panels = ids.map((id) => ({ id, title: id, kind: "service" }));
  const stack = { id: "stack", panelIds: ids, playback: { transition, transitionDurationMs: 250 } };
  const Native = ({ panel }) => <input aria-label={`Native ${panel.id}`} defaultValue="retained" />;
  const view = (dragOffset = 0, reducedMotion = false) =>
    panels.map((panel) => (
      <PanelHost
        key={panel.id}
        panel={panel}
        stack={stack}
        rect={{ width: 320, height: 248 }}
        active={controller.getSnapshot().activeId === panel.id}
        editing={false}
        controller={() => controller}
        renderNative={Native}
        dragOffset={dragOffset}
        reducedMotion={reducedMotion}
      />
    ));
  const rendered = render(view());
  return { ...rendered, controller, view };
}

describe("Stable slide transitions at a loop boundary", () => {
  it.each([
    { ids: ["a", "b"], transition: "horizontal", axis: "X" },
    { ids: ["a", "b", "c"], transition: "horizontal", axis: "X" },
    { ids: ["a", "b", "c"], transition: "vertical", axis: "Y" },
  ])("animates $transition wrap in the requested direction with $ids", ({ ids, transition, axis }) => {
    const { container, rerender, controller, view, unmount } = setup(ids, transition);
    const hosts = [...container.querySelectorAll(".studio-panel")];
    const inputs = [...container.querySelectorAll("input")];
    expect(animations).toHaveLength(0);
    controller.previous();
    rerender(view());
    expect(container.querySelector('[data-panel-id="a"] .studio-panel-slide').style.transform).toBe(
      `translate${axis}(100%)`,
    );
    expect(animations.findLast((entry) => entry.panel === ids.at(-1))).toMatchObject({
      panel: ids.at(-1),
      frames: [{ transform: `translate${axis}(-100%)` }, { transform: "none" }],
    });
    controller.next();
    rerender(view());
    expect(container.querySelector(`[data-panel-id="${ids.at(-1)}"] .studio-panel-slide`).style.transform).toBe(
      `translate${axis}(-100%)`,
    );
    expect(animations.findLast((entry) => entry.panel === "a")).toMatchObject({
      panel: "a",
      frames: [{ transform: `translate${axis}(100%)` }, { transform: "none" }],
    });
    // Rapid opposite navigation cancels the previous entry animation while all
    // native hosts and form state retain their identity.
    controller.previous();
    rerender(view());
    controller.next();
    rerender(view());
    expect(
      animations
        .filter((entry, index) => index !== animations.findLastIndex((other) => other.panel === entry.panel))
        .every(({ animation }) => animation.cancel.mock.calls.length > 0),
    ).toBe(true);
    expect([...container.querySelectorAll(".studio-panel")]).toEqual(hosts);
    expect([...container.querySelectorAll("input")]).toEqual(inputs);
    expect(inputs.every((input) => input.value === "retained")).toBe(true);
    unmount();
    controller.destroy();
  });
  it("continues the entering panel from its visible swipe offset rather than jumping back to the edge", () => {
    const { rerender, controller, view, unmount } = setup(["a", "b", "c"]);
    controller.previous();
    rerender(view());
    rerender(view(-60));
    controller.next();
    rerender(view());
    expect(animations.findLast((entry) => entry.panel === "a")).toMatchObject({
      panel: "a",
      frames: [{ transform: "translateX(260px)" }, { transform: "none" }],
    });
    rerender(view(60));
    controller.previous();
    rerender(view());
    expect(animations.findLast((entry) => entry.panel === "c")).toMatchObject({
      panel: "c",
      frames: [{ transform: "translateX(-260px)" }, { transform: "none" }],
    });
    unmount();
    controller.destroy();
  });
  it("continues an interrupted transition from the visible position when navigation reverses quickly", () => {
    const { rerender, controller, view, unmount } = setup(["a", "b"]);
    controller.next();
    rerender(view());
    animations.forEach(({ animation }) => {
      animation.playState = "running";
    });
    const computed = vi.spyOn(window, "getComputedStyle").mockReturnValue({ transform: "matrix(1, 0, 0, 1, 120, 0)" });
    try {
      controller.previous();
      rerender(view());
      expect(animations.findLast((entry) => entry.panel === "b").frames).toEqual([
        { transform: "matrix(1, 0, 0, 1, 120, 0)" },
        { transform: "translateX(100%)" },
      ]);
    } finally {
      computed.mockRestore();
      unmount();
      controller.destroy();
    }
  });
  it("does not animate a wrap when reduced motion is requested", () => {
    const { rerender, controller, view, unmount } = setup(["a", "b"]);
    rerender(view(0, true));
    controller.previous();
    rerender(view(0, true));
    expect(animations).toHaveLength(0);
    unmount();
    controller.destroy();
  });
});
