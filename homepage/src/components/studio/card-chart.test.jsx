// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  CardChart,
  axes,
  chartRanges,
  chartSeries,
  dataStart,
  heroSeries,
  historyRange,
  niceTicks,
  scales,
  statusBars,
  timeTicks,
  trendOf,
  uptimeOf,
} from "./card-chart";

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
  it("draws the values its block picks, in that order, with their own names and colours", () => {
    const card = {
      fields: ["blocked", "Blocked today"],
      values: [{ field: "blocked", label: "Blocked", colour: "#112233" }],
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
    expect(historyRange({ blocks: [{ id: "c", type: "chart", range: "7d" }] })).toBe("7d");
    expect(historyRange({ blocks: [{ id: "b", type: "big", trend: "day" }] })).toBe("7d");
    expect(historyRange({ blocks: [{ id: "b", type: "big", trend: "hour" }] })).toBe("6h");
    // The longest any block needs, at any size.
    expect(
      historyRange({
        blocks: [{ id: "r", type: "response" }],
        sizes: { large: { blocks: [{ id: "c", type: "chart", range: "30d" }] } },
      }),
    ).toBe("30d");
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
    // Less history than the range: drawn from its first number, and says so.
    expect(screen.getByRole("img").getAttribute("aria-label")).toMatch(/^Since /);
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

  it("full view: lines sharing a unit share an axis, a percentage gets the right-hand one (Ben, 2 Nov)", () => {
    const series = chartSeries(history, {}, (label) => label);
    const scaled = axes(series, history.points);
    expect(scaled.right.format).toBe("percent");
    expect(scaled.right.range).toEqual({ min: 0, max: 100, ticks: [0, 25, 50, 75, 100] });
    expect(scaled.left.format).toBe("number");
    expect(scaled.left.entries.map((entry) => entry.field.field)).toEqual(["queries", "blocked"]);
    // Queries and Blocked are drawn against the same numbers.
    expect(scaled.ranges.get("queries")).toBe(scaled.ranges.get("blocked"));
    expect(niceTicks(16000, 84000)).toEqual({ min: 0, max: 100000, ticks: [0, 20000, 40000, 60000, 80000, 100000] });
    expect(niceTicks(3, 3).ticks.length).toBeGreaterThan(1);
  });

  it("starts a short history at its first number, and marks round times", () => {
    const series = chartSeries(history, {}, (label) => label);
    expect(dataStart(series, history.points, NOW - 24 * HOUR)).toBe(NOW - 2 * HOUR);
    expect(dataStart(series, history.points, NOW - 2 * HOUR)).toBe(null);
    const { ticks, step } = timeTicks(NOW - 2 * HOUR, NOW);
    expect(step).toBe(30 * 60e3);
    expect(ticks.length).toBeGreaterThanOrEqual(4);
    expect(ticks.every((at) => at >= NOW - 2 * HOUR && at <= NOW)).toBe(true);
  });

  it("hiding a line keeps the others' colours", () => {
    const shown = chartSeries(history, {}, (label) => label);
    const hidden = chartSeries(
      history,
      { values: [{ field: "Blocked today" }, { field: "queries", slot: "hidden" }] },
      (l) => l,
    );
    expect(hidden.find((entry) => entry.field.field === "blocked").colour).toBe(
      shown.find((entry) => entry.field.field === "blocked").colour,
    );
  });

  it("a gauge shows the chosen value, else the first percentage", () => {
    const series = chartSeries(history, { values: [{ field: "queries" }] }, (label) => label);
    expect(heroSeries(series, true).field.field).toBe("Blocked today");
    expect(heroSeries(series).field.field).toBe("Blocked today");
    const chosen = chartSeries(history, { fields: ["blocked"] }, (label) => label);
    expect(heroSeries(chosen, true, true).field.field).toBe("blocked");
  });

  it("donut writes its hero's share in the middle, its legend beside it", () => {
    render(<CardChart card={{ show: "donut", chartRange: "24h", history, values: [{ field: "queries" }] }} />);
    // 84000 of 102022 is 82 %.
    expect(document.querySelector(".studio-chart-centre").textContent).toBe("82%");
    expect(document.querySelector(".studio-chart-parts .studio-chart-legend")).toBeTruthy();
  });
});

// Board 27: a pie of running and stopped with the total beside it.
describe("values beside a chart", () => {
  const portainer = {
    fields: [
      { field: "portainer.running", label: "portainer.running", format: "plain" },
      { field: "portainer.stopped", label: "portainer.stopped", format: "plain" },
      { field: "portainer.total", label: "portainer.total", format: "plain" },
    ],
    points: [[1000, 31, 92, 123]],
    latest: { at: 1000, values: { "portainer.running": 31, "portainer.stopped": 92, "portainer.total": 123 } },
  };

  it("never makes a total a slice of a pie; it stands beside the chart", () => {
    const { container } = render(<CardChart card={{ show: "pie", chartRange: "24h", history: portainer }} />);
    const legend = container.querySelector(".studio-chart-legend");
    expect(legend.textContent).toContain("portainer.running");
    expect(legend.textContent).not.toContain("portainer.total");
    expect(container.querySelector(".studio-chart-numbers").textContent).toContain("portainer.total");
    expect(container.querySelector(".studio-chart-numbers").textContent).toContain("123");
  });

  it("a pie of picked counts draws them though most collected values are percentages", () => {
    const proxmox = {
      fields: [
        { field: "cpu", label: "CPU", format: "percent" },
        { field: "memory", label: "Memory", format: "percent" },
        { field: "disk", label: "Disk", format: "percent" },
        { field: "running", label: "Running", format: "plain" },
        { field: "stopped", label: "Stopped", format: "plain" },
      ],
      points: [[1000, 30, 71, 40, 42, 3]],
      latest: { at: 1000, values: { cpu: 30, memory: 71, disk: 40, running: 42, stopped: 3 } },
    };
    const { container } = render(
      <CardChart card={{ show: "pie", chartRange: "24h", history: proxmox, fields: ["running", "stopped"] }} />,
    );
    const legend = container.querySelector(".studio-chart-legend").textContent;
    expect(legend).toContain("Running");
    expect(legend).toContain("Stopped");
    expect(container.querySelector(".studio-chart-round")).toBeTruthy();
  });

  it("a line chart draws only the values its block picks", () => {
    const card = {
      show: "line",
      chartRange: "24h",
      history: portainer,
      fields: ["portainer.running", "portainer.total"],
    };
    expect(chartSeries(portainer, card, (label) => label).map((entry) => entry.field.field)).toEqual([
      "portainer.running",
      "portainer.total",
    ]);
    const { container } = render(<CardChart card={card} />);
    expect(container.querySelector(".studio-chart-legend").textContent).not.toContain("portainer.stopped");
  });
});
