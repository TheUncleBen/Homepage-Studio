// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CardChart, chartRanges, chartSeries, historyRange, scales, statusBars, trendOf, uptimeOf } from "./card-chart";

const HOUR = 3600e3;
const NOW = 1_800_000_000_000;
const history = {
  fields: [
    { field: "Blocked today", label: "Blocked today", format: "percent" },
    { field: "queries", label: "pihole.queries", format: "number" },
    { field: "blocked", label: "pihole.blocked", format: "number" },
  ],
  points: [
    [NOW - 2 * HOUR, 20, 80000, 16000],
    [NOW - HOUR, 21, 82000, 17000],
    [NOW, 22, 84000, 18000],
  ],
  latest: { at: NOW, values: { "Blocked today": 22, queries: 84000, blocked: 18000 } },
};

describe("charts", () => {
  it("draws the values the widget shows, in its order, with their own names and colours", () => {
    const card = {
      values: [
        { field: "blocked", label: "Blocked", colour: "#112233" },
        { field: "queries", slot: "hidden" },
      ],
    };
    const series = chartSeries(history, card, (label) => label);
    expect(series.map((entry) => [entry.field.field, entry.name])).toEqual([
      ["blocked", "Blocked"],
      ["Blocked today", "Blocked today"],
    ]);
    expect(series[0].colour).toBe("#112233");
    expect(chartSeries(undefined, card, String)).toEqual([]);
  });

  it("keeps a percentage on its own 0 to 100 scale beside counts", () => {
    const series = chartSeries(history, {}, String);
    const ranges = scales(series, history.points);
    expect(ranges.get("Blocked today")).toEqual({ min: 0, max: 100 });
    expect(ranges.get("queries")).toBe(ranges.get("blocked"));
    expect(ranges.get("queries").max).toBe(84000);
  });

  it("offers only the ranges the dashboard keeps", () => {
    expect(chartRanges({})).toEqual(["1h", "6h", "24h", "7d", "30d"]);
    expect(chartRanges({ studioDefaults: { chartDays: 7 } })).toEqual(["1h", "6h", "24h", "7d"]);
    expect(chartRanges({ studioDefaults: { chartDays: 7 } }, "30d")).toContain("30d");
  });

  it("reads long enough for a trend and works out the change", () => {
    expect(historyRange({ show: "line", chartRange: "7d" })).toBe("7d");
    expect(historyRange({ show: "numbers", layout: "hero", trend: "day" })).toBe("7d");
    expect(historyRange({ show: "numbers", layout: "hero", trend: "hour" })).toBe("6h");
    expect(trendOf(history, "queries", HOUR)).toEqual({ from: 82000, change: 2000 });
    // Nothing near a week ago yet.
    expect(trendOf(history, "queries", 7 * 24 * HOUR)).toBe(null);
    expect(trendOf(history, "missing", HOUR)).toBe(null);
  });

  it("says when it is still collecting, and describes the chart in words", () => {
    const { rerender } = render(<CardChart card={{ show: "line", chartRange: "24h", history: undefined }} />);
    expect(screen.getByText("Loading the chart…")).toBeTruthy();
    rerender(
      <CardChart card={{ show: "line", chartRange: "24h", history: { fields: [], points: [], latest: null } }} />,
    );
    expect(screen.getByText(/Collecting numbers/)).toBeTruthy();
    rerender(<CardChart card={{ show: "line", chartRange: "24h", history }} />);
    expect(screen.getByRole("img").getAttribute("aria-label")).toMatch(/Last 24 h/);
    expect(document.querySelectorAll("path").length).toBe(3);
  });
});

describe("status history", () => {
  const checks = {
    fields: [
      { field: "up", label: "Up", format: "plain" },
      { field: "ms", label: "Response time", format: "plain" },
    ],
    points: Array.from({ length: 80 }, (_, i) => [NOW - (80 - i) * 60e3, i === 70 ? 0 : 1, i === 70 ? null : 40]),
    latest: null,
  };

  it("draws the last 60 checks, up or down, and the share that were up", () => {
    const bars = statusBars(checks);
    expect(bars).toHaveLength(60);
    expect(bars.filter((bar) => !bar.up)).toEqual([{ at: NOW - 10 * 60e3, up: false, ms: null }]);
    expect(uptimeOf(checks)).toBeCloseTo(98.75);
    expect(uptimeOf({ fields: [], points: [] })).toBe(null);
    expect(statusBars(history)).toEqual([]);
  });
});
