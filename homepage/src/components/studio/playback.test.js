import { describe, expect, it, vi } from "vitest";

import { createStackPlayback } from "./playback.mjs";

describe("Stack transition direction", () => {
  it.each([
    ["a", "b"],
    ["a", "b", "c"],
  ])("preserves explicit previous/next direction through loop boundaries for %s", (...ids) => {
    const controller = createStackPlayback({ ids });
    controller.previous();
    expect(controller.getSnapshot()).toMatchObject({ activeId: ids.at(-1), previousId: "a", direction: -1 });
    controller.next();
    expect(controller.getSnapshot()).toMatchObject({ activeId: "a", previousId: ids.at(-1), direction: 1 });
    controller.destroy();
  });
  it("records forward direction for automatic wrap and uses member order for direct selection", () => {
    vi.useFakeTimers();
    try {
      const controller = createStackPlayback({
        ids: ["a", "b", "c"],
        activeId: "c",
        autoplay: true,
        intervalMs: 10,
        now: () => Date.now(),
      });
      vi.advanceTimersByTime(10);
      expect(controller.getSnapshot()).toMatchObject({ activeId: "a", previousId: "c", direction: 1 });
      controller.select("c");
      expect(controller.getSnapshot().direction).toBe(1);
      controller.select("b");
      expect(controller.getSnapshot().direction).toBe(-1);
      controller.destroy();
    } finally {
      vi.useRealTimers();
    }
  });
});
