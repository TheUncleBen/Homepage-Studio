// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import CardDateTime, { splitFormat } from "./card-datetime";

vi.mock("next-i18next/pages", () => ({ useTranslation: () => ({ i18n: { language: "en-US" } }) }));
vi.mock("utils/hooks/use-current-time", () => ({ default: () => Date.UTC(2026, 10, 2, 9, 5) }));

describe("Date & Time in a card", () => {
  it("splits a format with a time and a date, keeping shared options on both", () => {
    expect(splitFormat({ timeStyle: "short", dateStyle: "full", hour12: false, timeZone: "UTC" })).toEqual({
      time: { timeStyle: "short", hour12: false, timeZone: "UTC" },
      date: { dateStyle: "full", hour12: false, timeZone: "UTC" },
    });
    expect(splitFormat({ hour: "2-digit", weekday: "long" })).toEqual({
      time: { hour: "2-digit" },
      date: { weekday: "long" },
    });
    expect(splitFormat({ timeStyle: "short" })).toBeNull();
    expect(splitFormat({})).toBeNull();
    expect(splitFormat()).toBeNull();
  });

  it("shows the time large with the date under it", () => {
    const { container } = render(
      <CardDateTime
        options={{ text_size: "xl", format: { timeStyle: "short", dateStyle: "full", timeZone: "UTC" } }}
      />,
    );
    expect(screen.getByText("9:05 AM")).toHaveClass("studio-datetime-hero", "studio-datetime-xl");
    expect(screen.getByText("Monday, November 2, 2026")).toHaveClass("studio-datetime-below");
    expect(container.querySelectorAll("span")).toHaveLength(2);
  });

  it("keeps one line when the format has only a time or only a date", () => {
    const { container } = render(<CardDateTime options={{ format: { timeStyle: "short", timeZone: "UTC" } }} />);
    expect(screen.getByText("9:05 AM")).toHaveClass("studio-datetime-lg");
    expect(container.querySelector(".studio-datetime-below")).toBeNull();
  });
});
