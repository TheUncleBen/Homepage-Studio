// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { cardLive } from "./card-look";
import Freshness, { age, freshness } from "./freshness";

afterEach(() => vi.useRealTimers());

describe("How fresh a card's numbers are", () => {
  it("says when the numbers arrived and when the next ones are due", () => {
    expect(freshness({ updatedAt: 1000, interval: 30000 }, 13000)).toEqual({
      stale: false,
      text: "Updated 12 s ago · next in 18 s",
    });
    // Without a refresh interval there is no "next".
    expect(freshness({ updatedAt: 1000, interval: 0 }, 601000).text).toBe("Updated 10 min ago");
    expect(freshness({ updatedAt: 0, interval: 30000 }, 5000)).toBeNull();
  });

  it("calls numbers old once updates have stopped for three intervals (at least a minute)", () => {
    expect(freshness({ updatedAt: 0.001, interval: 10000 }, 59000).stale).toBe(false);
    expect(freshness({ updatedAt: 1, interval: 10000 }, 300001)).toEqual({ stale: true, text: "5 min old" });
    expect(age(7200000)).toBe("2 h");
  });

  it("shows the note with a Refresh now button that asks the integration again", () => {
    vi.useFakeTimers();
    vi.setSystemTime(100000);
    const live = cardLive("fresh-card");
    const refresh = vi.fn();
    live.refreshers.set("/api/services/proxy?x", refresh);
    live.interval = 30000;
    live.updatedAt = 95000;
    render(<Freshness panelId="fresh-card" title="Radarr" />);
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText("Updated 6 s ago · next in 24 s")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh Radarr now" }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
