// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it } from "vitest";

import { boardFocusOrder, useBoardFocusOrder } from "./focus-order";

// DOM order mirrors the board: panel hosts in board order, then stack shells.
function Board({ order, after = true }) {
  const canvas = useRef(null);
  useBoardFocusOrder(canvas, order);
  return (
    <>
      <button>Before board</button>
      <div ref={canvas}>
        <section data-panel-id="lower">
          <a href="#lower">Lower link</a>
        </section>
        <section data-panel-id="member" data-stack-id="stack">
          <input aria-label="Stacked input" />
        </section>
        <section data-panel-id="hidden-member" data-stack-id="stack" inert>
          <a href="#hidden">Inactive member link</a>
        </section>
        <section data-panel-id="right">
          <button>Right button</button>
          <button disabled>Disabled button</button>
        </section>
        <section data-stack-shell-id="stack" tabIndex={0} aria-label="Stack shell">
          <button>Play slideshow</button>
        </section>
      </div>
      {after && <button>After board</button>}
    </>
  );
}
const name = (element) => element.getAttribute("aria-label") || element.textContent;
const tab = (shiftKey = false) => fireEvent.keyDown(document.activeElement, { key: "Tab", shiftKey });

describe("Board focus order", () => {
  it("orders units by reading order, a stack's controls before its active widget", () => {
    render(<Board order={[]} />);
    const canvas = screen.getByLabelText("Stack shell").parentElement;
    expect(boardFocusOrder(canvas, ["stack", "lower", "right"]).map(name)).toEqual([
      "Stack shell",
      "Play slideshow",
      "Stacked input",
      "Lower link",
      "Right button",
    ]);
  });

  it("moves Tab and Shift+Tab through the board in reading order and leaves it at either end", () => {
    render(<Board order={["stack", "lower", "right"]} />);
    screen.getByText("Before board").focus();
    const walk = [];
    for (let step = 0; step < 6; step += 1) {
      const event = tab();
      // An uncancelled Tab is left to the browser; emulate its DOM-order step.
      if (event) {
        const all = [...document.querySelectorAll("a[href],button:not(:disabled),input,[tabindex]")].filter(
          (element) => !element.closest("[inert]"),
        );
        all[all.indexOf(document.activeElement) + 1]?.focus();
      }
      walk.push(name(document.activeElement));
    }
    expect(walk).toEqual([
      "Stack shell",
      "Play slideshow",
      "Stacked input",
      "Lower link",
      "Right button",
      "After board",
    ]);
    tab(true);
    expect(document.activeElement).toHaveTextContent("Right button");
    screen.getByLabelText("Stack shell").focus();
    tab(true);
    expect(document.activeElement).toHaveTextContent("Before board");
  });

  it("leaves the board forwards when nothing follows it on the page", () => {
    render(<Board order={["stack", "lower", "right"]} after={false} />);
    screen.getByText("Right button").focus();
    expect(tab()).toBe(true);
    // The browser continues from the board's last element in DOM order.
    expect(document.activeElement).toHaveTextContent("Play slideshow");
  });

  it("enters the board backwards at its visually last element when nothing on the page had focus", () => {
    render(<Board order={["stack", "lower", "right"]} after={false} />);
    document.activeElement.blur();
    expect(fireEvent.keyDown(document.body, { key: "Tab", shiftKey: true })).toBe(true);
    // The browser enters at the page's last element in DOM order.
    screen.getByText("Play slideshow").focus();
    expect(document.activeElement).toHaveTextContent("Right button");
  });
});
