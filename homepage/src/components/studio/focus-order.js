import { useEffect, useRef } from "react";

// Sequential focus order for the board.
//
// Native panel hosts keep one DOM order for their whole lifetime: moving an
// iframe or other native host to reorder the DOM can reload or reset it, so
// panel hosts stay in board order and stack shells stay in their own layer.
// Tab and Shift+Tab therefore follow the projected layout instead: units are
// visited in reading order (row, then column), a stack's own controls before
// its active widget, and each unit's controls in their DOM order.

const TABBABLE = [
  "a[href]",
  "area[href]",
  "button",
  'input:not([type="hidden"])',
  "select",
  "textarea",
  "iframe",
  "summary",
  "audio[controls]",
  "video[controls]",
  '[contenteditable]:not([contenteditable="false"])',
  "[tabindex]",
].join(",");

function isTabbable(element) {
  if (element.tabIndex < 0 || element.matches(":disabled") || element.closest("[inert]")) return false;
  if (element.type === "radio" && element.name && !element.checked) {
    // A radio group is one tab stop: its checked radio, otherwise its first.
    const group = [...(element.form || document).querySelectorAll('input[type="radio"]')].filter(
      (radio) => radio.name === element.name,
    );
    if (group.some((radio) => radio.checked) || group[0] !== element) return false;
  }
  return element.checkVisibility ? element.checkVisibility({ visibilityProperty: true }) : true;
}

const tabbables = (root) => [...root.querySelectorAll(TABBABLE)].filter(isTabbable);

function unitOf(element) {
  const shell = element.closest("[data-stack-shell-id]");
  if (shell) return { id: shell.dataset.stackShellId, part: 0 };
  const panel = element.closest("[data-panel-id]");
  if (panel) return { id: panel.dataset.stackId || panel.dataset.panelId, part: 1 };
  return null;
}

// The board's tabbable elements in reading order. Elements outside any unit,
// such as the empty-board action, come first in DOM order.
export function boardFocusOrder(canvas, unitIds) {
  const rank = new Map(unitIds.map((id, index) => [id, index]));
  return tabbables(canvas)
    .map((element, index) => {
      const unit = unitOf(element);
      return { element, index, rank: unit ? (rank.get(unit.id) ?? unitIds.length) : -1, part: unit?.part ?? 0 };
    })
    .sort((a, b) => a.rank - b.rank || a.part - b.part || a.index - b.index)
    .map((entry) => entry.element);
}

// The document's sequence with the board's elements in reading order.
function sequences(canvas, unitIds) {
  const dom = tabbables(document);
  const start = dom.findIndex((element) => canvas.contains(element));
  if (start < 0) return { dom, visual: dom };
  const outside = dom.filter((element) => !canvas.contains(element));
  return {
    dom,
    visual: [...outside.slice(0, start), ...boardFocusOrder(canvas, unitIds), ...outside.slice(start)],
  };
}

function modalOpen() {
  try {
    return Boolean(document.querySelector("dialog:modal"));
  } catch {
    return Boolean(document.querySelector("dialog[open]"));
  }
}

export function useBoardFocusOrder(canvasRef, unitIds) {
  const order = useRef(unitIds);
  useEffect(() => {
    order.current = unitIds;
  }, [unitIds]);
  useEffect(() => {
    // Two moves are not visible as a keydown here, so the focus they produce
    // is corrected afterwards: leaving a native iframe (Tab inside it belongs
    // to its own document) and entering the page from outside it, where the
    // browser picks the iframe's DOM neighbour or the page's DOM edge.
    let iframe = null;
    let enteredAt = 0;
    let pointerAt = 0;
    const board = () => {
      const canvas = canvasRef.current;
      return canvas && !canvas.closest("[inert]") && !modalOpen() ? canvas : null;
    };
    const unfocused = () => !document.activeElement || document.activeElement === document.body;
    const keyDown = (event) => {
      if (event.key !== "Tab" || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (unfocused()) enteredAt = Date.now();
      const canvas = board();
      const current = document.activeElement;
      if (!canvas || !current || current.closest("dialog")) return;
      const { dom, visual } = sequences(canvas, order.current);
      const step = event.shiftKey ? -1 : 1;
      const index = visual.indexOf(current);
      if (index < 0) return;
      const target = visual[index + step];
      if (!target) {
        // Nothing follows on the page: hand the browser the board's DOM edge so
        // its own Tab leaves the board instead of returning to a DOM neighbour.
        const inBoard = dom.filter((element) => canvas.contains(element));
        const edge = step > 0 ? inBoard.at(-1) : inBoard[0];
        if (canvas.contains(current) && edge && edge !== current) edge.focus({ preventScroll: true });
        return;
      }
      if (!canvas.contains(current) && !canvas.contains(target)) return;
      if (dom[dom.indexOf(current) + step] === target) return;
      event.preventDefault();
      target.focus();
    };
    // The focused element is observable once the blur has been handled.
    const windowBlur = () =>
      queueMicrotask(() => {
        const canvas = board();
        const current = document.activeElement;
        iframe = canvas && current?.tagName === "IFRAME" && canvas.contains(current) ? current : null;
      });
    const windowFocus = () => {
      if (unfocused()) enteredAt = Date.now();
    };
    const focusIn = (event) => {
      if (event.target?.tagName === "IFRAME") return;
      const left = iframe;
      const entering = Date.now() - enteredAt < 1000;
      iframe = null;
      enteredAt = 0;
      const canvas = board();
      if (!canvas || event.relatedTarget || Date.now() - pointerAt < 1000) return;
      let target = null;
      if (left) {
        const { dom, visual } = sequences(canvas, order.current);
        const at = dom.indexOf(left);
        const step = dom[at + 1] === event.target ? 1 : dom[at - 1] === event.target ? -1 : 0;
        target = step && visual[visual.indexOf(left) + step];
      } else if (entering && canvas.contains(event.target)) {
        const { dom, visual } = sequences(canvas, order.current);
        target = event.target === dom.at(-1) ? visual.at(-1) : event.target === dom[0] ? visual[0] : null;
      }
      if (target && target !== event.target) target.focus();
    };
    const pointerDown = () => {
      pointerAt = Date.now();
    };
    document.addEventListener("keydown", keyDown);
    document.addEventListener("focusin", focusIn);
    document.addEventListener("pointerdown", pointerDown, true);
    window.addEventListener("blur", windowBlur);
    window.addEventListener("focus", windowFocus);
    return () => {
      document.removeEventListener("keydown", keyDown);
      document.removeEventListener("focusin", focusIn);
      document.removeEventListener("pointerdown", pointerDown, true);
      window.removeEventListener("blur", windowBlur);
      window.removeEventListener("focus", windowFocus);
    };
  }, [canvasRef]);
}
