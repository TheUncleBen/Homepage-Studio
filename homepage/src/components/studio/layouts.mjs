import {
  clampRect,
  COLUMNS,
  columnsOfPage,
  firstPageId,
  fittedUnits,
  generatedUnits,
  gridColumns,
  intersects,
  isSmallOnPhone,
  mergePage,
  pageBoard,
  pageOf,
  PHONE_COLUMNS,
  PHONE_WIDTH,
  ROW_HEIGHT,
  TABLET_COLUMNS,
  unitsForBoard,
} from "./geometry.mjs";

// One dashboard, a layout for each size (owner decision Q3 and his 4 Nov 2026
// addition; board 22). Desktop is where you usually arrange. The tablet and
// phone layouts are made from it and follow it until you move or resize a
// widget on that size yourself; from then that size keeps your arrangement
// and your sizes in board.layouts[size], keyed by unit (a widget not in a
// stack, or a stack). Position and size belong to the dashboard's layout for
// each size, never to the widget: it stays one widget with one set of
// settings on every size.

export const SIZES = Object.freeze(["desktop", "tablet", "phone"]);
export const SIZE_LABEL = Object.freeze({ desktop: "Desktop", tablet: "Tablet", phone: "Phone" });
export const SIZE_COLUMNS = Object.freeze({ tablet: TABLET_COLUMNS, phone: PHONE_COLUMNS });
// The width each size is shown at in the editor's size switch.
export const SIZE_WIDTH = Object.freeze({ tablet: 820, phone: 390 });
export const TABLET_WIDTH = 940;

export const sizeForWidth = (width) => (width < PHONE_WIDTH ? "phone" : width < TABLET_WIDTH ? "tablet" : "desktop");
export const columnsForSize = (board, size) =>
  board?.layoutSize === size ? gridColumns(board) : (SIZE_COLUMNS[size] ?? gridColumns(board));
export const followsDesktop = (board, size) => size === "desktop" || !board?.layouts?.[size];

const pagesIn = (board) => (board.pages?.length ? board.pages : [{ id: firstPageId(board) }]);

// Where a unit goes on a size it has no place on yet (a widget added, or one
// moved between pages): the size it would have there, at the end.
export function arrivalRect(desktopRect, size, from = COLUMNS) {
  if (size === "phone")
    return { x: 0, y: 0, w: isSmallOnPhone(desktopRect, from) ? PHONE_COLUMNS / 2 : PHONE_COLUMNS, h: desktopRect.h };
  if (size === "tablet")
    return { x: 0, y: 0, w: desktopRect.w * 2 > from ? TABLET_COLUMNS : TABLET_COLUMNS / 2, h: desktopRect.h };
  return { ...desktopRect };
}

// The rectangles of one page on one size: the stored ones for a size you
// arranged (anything without one is placed at the end), else made from desktop.
export function sizeUnits(view, size) {
  // A view already laid out on this size (sizeView) is shown as it is.
  if (size === "desktop" || view.layoutSize === size) return unitsForBoard(view);
  const columns = columnsForSize(view, size);
  const stored = view.layouts?.[size];
  if (!stored) return generatedUnits(view, columns);
  const units = unitsForBoard(view);
  const placed = [];
  const missing = [];
  for (const unit of units) {
    const rect = stored[unit.id];
    if (rect) placed.push({ ...unit, rect: clampRect(rect, columns) });
    else missing.push(unit);
  }
  let bottom = Math.max(0, ...placed.map((unit) => unit.rect.y + unit.rect.h));
  for (const unit of missing.sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x)) {
    const rect = clampRect({ ...arrivalRect(unit.rect, size, gridColumns(view)), y: bottom }, columns);
    placed.push({ ...unit, rect });
    bottom += rect.h;
  }
  return placed;
}

export function sizeProjection(view, size) {
  // Shown on desktop, every widget gets at least the room it needs.
  const units = size === "desktop" ? fittedUnits(view) : sizeUnits(view, size);
  return {
    size,
    columns: columnsForSize(view, size),
    units,
    rows: Math.max(8, ...units.map((unit) => unit.rect.y + unit.rect.h)),
  };
}

// A page laid out on one size, for the editor to change with the ordinary
// geometry (moveUnit, resizeUnit, tidyBoard): the units carry that size's
// rectangles and the view that size's columns.
export function sizeView(view, size) {
  if (size === "desktop") return { ...view, gridColumns: gridColumns(view), layoutSize: "desktop" };
  const rects = new Map(sizeUnits(view, size).map((unit) => [unit.id, unit.rect]));
  const swap = (unit) => (rects.has(unit.id) ? { ...unit, rect: rects.get(unit.id) } : unit);
  return {
    ...view,
    gridColumns: SIZE_COLUMNS[size],
    layoutSize: size,
    desktopColumns: gridColumns(view),
    panels: view.panels.map(swap),
    stacks: view.stacks.map(swap),
  };
}

// Writes a changed size view back. Desktop rectangles are the units' own;
// a tablet or phone change stores that size's whole arrangement, every page,
// so nothing else on that size moves when desktop changes later.
export function applySizeView(whole, view) {
  const size = view.layoutSize;
  if (!size || size === "desktop") return null;
  const rects = {};
  for (const page of pagesIn(whole)) {
    if (page.id === (view.pageId ?? firstPageId(whole))) continue;
    for (const unit of sizeUnits(pageBoard(whole, page.id), size)) rects[unit.id] = unit.rect;
  }
  for (const unit of unitsForBoard(view)) rects[unit.id] = { ...unit.rect };
  return { ...whole, layouts: { ...whole.layouts, [size]: rects } };
}

// Follow desktop again (board 22): the size forgets its own arrangement.
export function followDesktop(whole, size) {
  if (!whole.layouts?.[size]) return whole;
  const layouts = { ...whole.layouts };
  delete layouts[size];
  const next = { ...whole, layouts };
  if (!Object.keys(layouts).length) delete next.layouts;
  return next;
}

// Even or centred grid for a page (board 23). Switching scales each
// widget's columns to the new grid; anything that would then overlap moves
// down, in reading order.
export function setPageGrid(whole, pageId, grid) {
  const page = pagesIn(whole).find((item) => item.id === pageId);
  if (!page || (page.grid || "even") === grid) return whole;
  const from = columnsOfPage(page);
  const to = columnsOfPage({ grid });
  const scale = (rect) => {
    const x = Math.round((rect.x * to) / from);
    const right = Math.round(((rect.x + rect.w) * to) / from);
    return clampRect({ ...rect, x, w: Math.max(1, right - x) }, to);
  };
  const onPage = (unit) => pageOf(whole, unit) === pageId;
  const stacked = new Set(whole.stacks.flatMap((stack) => stack.panelIds));
  const placed = [];
  const rects = new Map();
  for (const unit of unitsForBoard(pageBoard(whole, pageId)).sort(
    (a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x,
  )) {
    let rect = scale(unit.rect);
    let collisions = placed.filter((other) => intersects(rect, other));
    while (collisions.length) {
      rect = { ...rect, y: Math.max(...collisions.map((other) => other.y + other.h)) };
      collisions = placed.filter((other) => intersects(rect, other));
    }
    placed.push(rect);
    rects.set(unit.id, rect);
  }
  const apply = (unit) => (onPage(unit) && rects.has(unit.id) ? { ...unit, rect: rects.get(unit.id) } : unit);
  return {
    ...whole,
    pages: pagesIn(whole).map((item) => {
      if (item.id !== pageId) return item;
      const next = { ...item, grid };
      if (grid === "even") delete next.grid;
      return next;
    }),
    panels: whole.panels.map((panel) => (stacked.has(panel.id) ? panel : apply(panel))),
    stacks: whole.stacks.map(apply),
  };
}

// Centre in row (board 23): on a centred grid, the widget moves to the middle
// column of its row when that space is free.
export function centreInRow(view, id) {
  const columns = gridColumns(view);
  const units = unitsForBoard(view);
  const unit = units.find((item) => item.id === id);
  if (!unit) return view;
  const x = Math.max(0, Math.round((columns - unit.rect.w) / 2));
  const rect = { ...unit.rect, x };
  if (units.some((other) => other.id !== id && intersects(rect, other.rect))) return null;
  const swap = (item) => (item.id === id ? { ...item, rect } : item);
  return { ...view, panels: view.panels.map(swap), stacks: view.stacks.map(swap) };
}

// The pixel height of a size's board, for previews.
export const sizeHeight = (projection, gap) => projection.rows * (ROW_HEIGHT + gap);

const sameRect = (a, b) => a && b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

// Merges an edited page view back into the whole board. On desktop that is
// the page itself. On tablet or phone, the content (looks, pages, stacks,
// removals) merges with the desktop rectangles kept, and the size's layout
// is stored only when a rectangle on it actually changed, so a look changed
// while looking at the phone layout leaves it following desktop.
export function mergeSizeView(whole, view) {
  if (!view.layoutSize || view.layoutSize === "desktop") return mergePage(whole, view);
  const desktop = new Map([...whole.panels, ...whole.stacks].map((unit) => [unit.id, unit.rect]));
  const restore = (unit) => (desktop.has(unit.id) ? { ...unit, rect: desktop.get(unit.id) } : unit);
  const content = mergePage(whole, { ...view, panels: view.panels.map(restore), stacks: view.stacks.map(restore) });
  const before = new Map(
    sizeUnits(pageBoard(content, view.pageId), view.layoutSize).map((unit) => [unit.id, unit.rect]),
  );
  const moved = unitsForBoard(view).some((unit) => !sameRect(before.get(unit.id), unit.rect));
  return moved ? applySizeView(content, view) : content;
}
