// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CardLookContext } from "./card-look";
import Filler, { isFiller, noteParts } from "./fillers";
import { panelMinimum } from "./geometry.mjs";

const filler = (type, options = {}, card = { target: "new" }) =>
  render(
    <CardLookContext.Provider value={card}>
      <Filler widget={{ type, options: { index: 0, ...options } }} />
    </CardLookContext.Provider>,
  );

describe("Studio's filler widgets (U6)", () => {
  it("knows its four fillers and nothing else", () => {
    expect(["heading", "note", "picture", "spacer"].every(isFiller)).toBe(true);
    expect(isFiller("greeting")).toBe(false);
    expect(isFiller(undefined)).toBe(false);
  });

  it("shows a heading as a level-2 heading in the chosen size", () => {
    const { container } = filler("heading", { text: "Media", text_size: "2xl" });
    expect(screen.getByRole("heading", { level: 2, name: "Media" })).toBeTruthy();
    expect(container.querySelector(".studio-filler-heading").className).toContain("studio-datetime-2xl");
    // An unknown size falls back to Extra large.
    const other = filler("heading", { text: "Other", text_size: "huge" });
    expect(other.container.querySelector(".studio-filler-heading").className).toContain("studio-datetime-xl");
  });

  it("keeps a note's text as text: markup is shown, never run", () => {
    const { container } = filler("note", { text: '<img src=x onerror="alert(1)"> <b>bold</b>\nsecond line' });
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror="alert(1)"> <b>bold</b>');
    expect(container.textContent).toContain("\nsecond line");
  });

  it("turns web addresses in a note into links, leaving sentence punctuation out", () => {
    expect(noteParts("Wiki: https://wiki.example.org/a?b=1. Done")).toEqual([
      { text: "Wiki: " },
      { link: "https://wiki.example.org/a?b=1" },
      { text: ". Done" },
    ]);
    expect(noteParts("javascript:alert(1) and ftp://x")).toEqual([{ text: "javascript:alert(1) and ftp://x" }]);
    filler("note", { text: "See https://wiki.example.org" });
    const link = screen.getByRole("link", { name: "https://wiki.example.org" });
    expect(link.getAttribute("href")).toBe("https://wiki.example.org");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("opens a note's links in the same tab when the widget says so", () => {
    filler("note", { text: "https://a.example.org" }, { target: "same" });
    expect(screen.getByRole("link").getAttribute("target")).toBeNull();
  });

  it("asks for text when a note is empty", () => {
    filler("note", { text: "  " });
    expect(screen.getByText("Write your note in its settings.")).toBeTruthy();
  });

  it("shows only this dashboard's uploaded pictures", () => {
    const { container } = filler("picture", {
      image: "/studio/api/images/0123456789abcdef01234567",
      fit: "fit",
      alt: "The rack",
    });
    const image = screen.getByRole("img", { name: "The rack" });
    expect(image.getAttribute("src")).toBe("/studio/api/images/0123456789abcdef01234567");
    expect(image.style.objectFit).toBe("contain");
    expect(container.querySelector(".studio-filler-picture-empty")).toBeNull();
    for (const image of ["https://tracker.example.org/x.png", "/studio/api/images/../../etc", "javascript:alert(1)"]) {
      const other = filler("picture", { image });
      expect(other.container.querySelector("img")).toBeNull();
      expect(other.container.textContent).toBe("Choose a picture in its settings.");
      other.unmount();
    }
  });

  it("draws a spacer as an empty block that only says what it is", () => {
    const { container } = filler("spacer");
    expect(container.querySelector(".studio-filler-spacer").getAttribute("aria-hidden")).toBe("true");
    expect(container.textContent).toBe("Spacer");
  });

  it("lets a heading or spacer be one row", () => {
    const minimum = (type) => panelMinimum({ kind: "informationWidget", nativeLocator: { type } });
    expect(minimum("heading")).toEqual({ w: 2, h: 1 });
    expect(minimum("spacer")).toEqual({ w: 1, h: 1 });
    expect(minimum("note")).toEqual({ w: 3, h: 2 });
    expect(minimum("picture")).toEqual({ w: 2, h: 2 });
  });
});
