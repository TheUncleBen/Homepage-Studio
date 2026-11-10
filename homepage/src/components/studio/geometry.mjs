// 24 columns of 36 px rows (owner-approved board 18): steps half as big as
// before, so a card can fit its content exactly.
export const COLUMNS = 24;
// A page with a centred grid has 25, so there is a true middle column
// (owner-approved board 23, 4 Nov 2026).
export const CENTRED_COLUMNS = 25;
export const columnsOfPage = (page) => (page?.grid === "centred" ? CENTRED_COLUMNS : COLUMNS);
// The columns of the grid a board view is laid out on: a page's own grid on
// desktop, or a tablet or phone layout's.
export const gridColumns = (board) => board?.gridColumns ?? COLUMNS;
export const ROW_HEIGHT = 36;
export const GAP = 12;
// Rows scale with the columns (Board 5, owner 10 Nov 2026). A column is a
// share of the board's width; a row is as tall, against its column, as it is
// at its layout's reference width, where it is ROW_HEIGHT. So a widget keeps
// its shape on every screen of the same layout, instead of getting wider but
// not taller as the window widens. The references are the boards of a
// 1440 px desktop window, an 820 px tablet and a 390 px phone (the board is
// the window less Studio's side padding: 40, 25 and 18 px).
export const REFERENCE_WIDTH = Object.freeze({ desktop: 1360, tablet: 770, phone: 354 });
// Bounds: rows never get so short that a handle or a line of text has no
// room. Wider than the reference they grow by at most a quarter (45 px), so
// a phone layout on a small tablet or a landscape phone doesn't turn tiles
// into half-empty boxes and the page into a long scroll (UI review M2);
// a desktop's widest board (1600 px) stays just under that.
export const ROW_MIN = 18;
export const ROW_MAX = 45;
// Dashboard Appearance › Spacing: the space between widgets, in pixels.
export const SPACING = Object.freeze({ compact: 6, default: GAP, roomy: 20 });
export const gapOf = (settings) => {
  const spacing = settings?.studioTheme?.spacing;
  return typeof spacing === "string" && Object.hasOwn(SPACING, spacing) ? SPACING[spacing] : GAP;
};
// Narrow screens: tablets use 16 columns (cards snap to halves), phones 8.
export const TABLET_COLUMNS = 16;
export const PHONE_COLUMNS = 8;
export const PHONE_WIDTH = 560;

// Grid minima protect readable content space. An integration card's values
// reflow into as many columns as fit and fold the rest behind "+N more", so its
// minimum is the room for its header and one value (a small square, 3 x 3);
// widgets that draw their own content (calendar, embedded page, camera,
// Glances' charts) keep a larger one because they scroll instead of folding.
export function panelMinimum(panel) {
  if (panel.kind === "service" || panel.kind === "bookmark") return { w: 5, h: 2 };
  if (panel.kind === "informationWidget") {
    // Studio's fillers (fillers.jsx): a heading or spacer can be one row.
    const filler = { heading: { w: 2, h: 1 }, spacer: { w: 1, h: 1 }, note: { w: 3, h: 2 }, picture: { w: 2, h: 2 } };
    if (Object.hasOwn(filler, panel.nativeLocator?.type)) return filler[panel.nativeLocator.type];
    // Resources is one row of meters; its card is one grid row tall.
    if (["kubernetes", "longhorn"].includes(panel.nativeLocator?.type)) return { w: 8, h: 4 };
    return { w: ["resources", "search"].includes(panel.nativeLocator?.type) ? 8 : 5, h: 2 };
  }
  if (panel.kind === "serviceWidget") {
    if (panel.nativeLocator?.type === "calendar") return { w: 12, h: 9 };
    if (["iframe", "mjpeg"].includes(panel.nativeLocator?.type)) return { w: 8, h: 9 };
    if (panel.nativeLocator?.type === "glances") return { w: 8, h: 7 };
    return { w: 3, h: 3 };
  }
  return { w: 1, h: 1 };
}

export function unitMinimum(board, id) {
  const stack = board.stacks.find((item) => item.id === id);
  const panels = board.panels.filter((panel) => (stack ? stack.panelIds.includes(panel.id) : panel.id === id));
  const minima = panels.map(panelMinimum);
  return {
    w: Math.max(1, ...minima.map((minimum) => minimum.w)),
    // A stack has only a thin strip of page dots below its widget (Board 4).
    h: Math.max(stack ? 4 : 1, ...minima.map((minimum) => minimum.h + (stack ? 1 : 0))),
  };
}

function fitMinimum(rect, minimum, columns = COLUMNS) {
  return clampRect(
    {
      ...rect,
      w: Math.max(rect.w, Math.min(columns, minimum.w)),
      h: Math.max(rect.h, minimum.h),
    },
    columns,
  );
}

export function clampRect(rect = {}, columns = COLUMNS) {
  const w = Math.max(1, Math.min(columns, Math.round(Number(rect.w) || 8)));
  const h = Math.max(1, Math.min(2000, Math.round(Number(rect.h) || 6)));
  return {
    x: Math.max(0, Math.min(columns - w, Math.round(Number(rect.x) || 0))),
    y: Math.max(0, Math.min(200000, Math.round(Number(rect.y) || 0))),
    w,
    h,
  };
}

export function intersects(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// True when a starts before b in reading order: top to bottom, then left to right.
const readsBefore = (a, b) => a.y < b.y || (a.y === b.y && a.x < b.x);

export function unitsForBoard(board) {
  const stacked = new Set(board.stacks.flatMap((stack) => stack.panelIds));
  return [
    ...board.panels
      .filter((panel) => !stacked.has(panel.id))
      .map((panel) => ({ id: panel.id, kind: "panel", rect: panel.rect })),
    ...board.stacks.map((stack) => ({
      id: stack.id,
      kind: "stack",
      rect: stack.rect,
    })),
  ];
}

function applyRectangles(board, rectangles) {
  let changed = false;
  const update = (unit) => {
    const rect = rectangles.get(unit.id);
    if (!rect || ["x", "y", "w", "h"].every((key) => rect[key] === unit.rect[key])) return unit;
    changed = true;
    return { ...unit, rect };
  };
  const panels = board.panels.map(update);
  const stacks = board.stacks.map(update);
  return changed ? { ...board, panels, stacks } : board;
}

// Snap guides: while a widget moves, the edges it shares with other widgets
// (left, right, top or bottom, in pixels) as lines spanning both.
export function snapGuides(rects, movingId) {
  const moving = rects.get(movingId);
  if (!moving) return [];
  const edges = (rect) => ({
    left: rect.left,
    right: rect.left + rect.width,
    top: rect.top,
    bottom: rect.top + rect.height,
  });
  const m = edges(moving);
  const lines = new Map();
  const near = (a, b) => Math.abs(a - b) < 1;
  for (const [id, rect] of rects) {
    if (id === movingId || rect.display === "none") continue;
    const o = edges(rect);
    for (const side of ["left", "right"])
      for (const other of ["left", "right"])
        if (near(m[side], o[other])) {
          const key = `v${Math.round(m[side])}`;
          const line = lines.get(key) || { vertical: true, at: m[side], from: m.top, to: m.bottom };
          lines.set(key, { ...line, from: Math.min(line.from, o.top), to: Math.max(line.to, o.bottom) });
        }
    for (const side of ["top", "bottom"])
      for (const other of ["top", "bottom"])
        if (near(m[side], o[other])) {
          const key = `h${Math.round(m[side])}`;
          const line = lines.get(key) || { vertical: false, at: m[side], from: m.left, to: m.right };
          lines.set(key, { ...line, from: Math.min(line.from, o.left), to: Math.max(line.to, o.right) });
        }
  }
  return [...lines.values()];
}

// Tidy up: every widget slides straight up into the free space above it, in
// reading order, so gaps close and nothing changes column or overlaps.
export function tidyBoard(board) {
  const placed = [];
  const rectangles = new Map();
  for (const unit of unitsForBoard(board).sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x)) {
    let rect = { ...unit.rect, y: 0 };
    let collisions = placed.filter((other) => intersects(rect, other));
    while (collisions.length) {
      rect = { ...rect, y: Math.max(...collisions.map((other) => other.y + other.h)) };
      collisions = placed.filter((other) => intersects(rect, other));
    }
    // Never further down than it was.
    if (rect.y > unit.rect.y) rect = { ...unit.rect };
    placed.push(rect);
    rectangles.set(unit.id, rect);
  }
  return applyRectangles(board, rectangles);
}

export function moveUnit(board, id, rect) {
  const units = unitsForBoard(board);
  const moved = units.find((unit) => unit.id === id);
  if (!moved) return board;
  const columns = gridColumns(board);
  moved.rect = fitMinimum(clampRect(rect, columns), unitMinimum(board, id), columns);
  // The manipulated unit has priority. Push intersecting neighbors downward deterministically.
  const placed = [moved];
  units
    .filter((unit) => unit.id !== id)
    .sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x || a.id.localeCompare(b.id))
    .forEach((unit) => {
      let candidate = clampRect(unit.rect, columns);
      let collisions = placed.filter((other) => intersects(candidate, other.rect));
      while (collisions.length) {
        candidate = {
          ...candidate,
          y: Math.max(...collisions.map((other) => other.rect.y + other.rect.h)),
        };
        collisions = placed.filter((other) => intersects(candidate, other.rect));
      }
      placed.push({ ...unit, rect: candidate });
    });
  const rectangles = new Map(placed.map((unit) => [unit.id, unit.rect]));
  return applyRectangles(board, rectangles);
}

// Resizing changes only the widget being resized (owner-approved board 21,
// 4 Nov 2026): when its new size overlaps another widget it moves to the
// nearest free space that fits; the others never move.
export function resizeUnit(board, id, rect) {
  const units = unitsForBoard(board);
  const resized = units.find((unit) => unit.id === id);
  if (!resized) return board;
  const columns = gridColumns(board);
  const wanted = fitMinimum(clampRect(rect, columns), unitMinimum(board, id), columns);
  const others = units.filter((unit) => unit.id !== id).map((unit) => unit.rect);
  const fits = (candidate) => !others.some((other) => intersects(candidate, other));
  let placed = fits(wanted) ? wanted : null;
  if (!placed) {
    const bottom = Math.max(0, ...others.map((other) => other.y + other.h));
    let best = null;
    for (let y = 0; y <= bottom; y += 1) {
      for (let x = 0; x + wanted.w <= columns; x += 1) {
        const candidate = { ...wanted, x, y };
        if (!fits(candidate)) continue;
        const distance = Math.hypot(x - wanted.x, (y - wanted.y) * 2);
        if (!best || distance < best.distance) best = { rect: candidate, distance };
      }
    }
    placed = best?.rect ?? { ...wanted, x: 0, y: bottom };
  }
  return applyRectangles(board, new Map([[id, placed]]));
}

// Project both edges with the same rounding rule so units that share an edge
// share a projected edge. Rounding x and w independently staggered rows.
function projectEdge(edge, columns, from) {
  return Math.round((edge * columns) / from);
}

// On tablets panels snap to halves: a panel up to half the desktop width is
// half the tablet width, a wider one is full width. Rows therefore fill the
// board two-up instead of leaving a narrow strip, and a desktop row of three
// becomes two, then one (see tabletLayout).
const HALF = TABLET_COLUMNS / 2;
function projectHalves(rect, from) {
  if (rect.w * 2 > from) return { ...rect, x: 0, w: 2 * HALF };
  const left = Math.min(HALF, Math.round(projectEdge(rect.x, TABLET_COLUMNS, from) / HALF) * HALF);
  return { ...rect, x: left, w: HALF };
}

const byReadingOrder = (a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x || a.id.localeCompare(b.id);

// Tablet: units reflow in reading order (left to right, then top to
// bottom). Each keeps its half and its desktop row when that spot is free
// and still reads after the unit placed before it, so tiles that fit side by
// side stay side by side. Otherwise it wraps to the first free spot after
// the previous unit.
function tabletLayout(board) {
  const from = gridColumns(board);
  const columns = TABLET_COLUMNS;
  const placed = [];
  const free = (rect) => !placed.some((other) => intersects(rect, other.rect));
  unitsForBoard(board)
    .sort(byReadingOrder)
    .forEach((unit) => {
      const raw = fitMinimum(clampRect(unit.rect, from), unitMinimum(board, unit.id), from);
      let rect = clampRect(projectHalves(raw, from), columns);
      const previous = placed.at(-1)?.rect;
      if (previous && (!free(rect) || readsBefore(rect, previous))) {
        wrap: for (let y = previous.y; ; y += 1) {
          for (let x = y === previous.y ? previous.x + 1 : 0; x + rect.w <= columns; x += 1) {
            if (free({ ...rect, x, y })) {
              rect = { ...rect, x, y };
              break wrap;
            }
          }
        }
      }
      let collisions = placed.filter((other) => intersects(rect, other.rect));
      while (collisions.length) {
        rect = { ...rect, y: Math.max(...collisions.map((other) => other.rect.y + other.rect.h)) };
        collisions = placed.filter((other) => intersects(rect, other.rect));
      }
      placed.push({ ...unit, rect });
    });
  // No half-empty rows (plan rule 3): each widget, in reading order, rises
  // into any free space above it in its own columns.
  for (const item of placed) {
    while (item.rect.y > 0) {
      const up = { ...item.rect, y: item.rect.y - 1 };
      if (placed.some((other) => other !== item && intersects(up, other.rect))) break;
      item.rect = up;
    }
  }
  return placed;
}

// Phone (owner-approved board 22): widgets keep their desktop reading order
// on two columns. One up to a quarter of the desktop width takes half the
// phone width, so small widgets sit side by side; wider ones take the full
// width. A half-width widget with no small neighbour to pair with takes the
// full width instead of leaving a gap, and two side by side share a height.
export const isSmallOnPhone = (rect, from = COLUMNS) => rect.w * 4 <= from;
// Link tiles pair with link tiles and widget cards with widget cards, so a
// pair is alike in height and a tile is never stretched beside a chart.
const phoneGroup = (board, unit) => {
  const panel = board.panels.find((item) => item.id === unit.id);
  return panel && (panel.kind === "service" || panel.kind === "bookmark") ? "tile" : "card";
};
function phoneLayout(board) {
  const from = gridColumns(board);
  const half = PHONE_COLUMNS / 2;
  const units = unitsForBoard(board)
    .sort(byReadingOrder)
    .map((unit) => ({ unit, rect: fitMinimum(clampRect(unit.rect, from), unitMinimum(board, unit.id), from) }));
  const placed = [];
  let y = 0;
  for (let index = 0; index < units.length; index += 1) {
    const { unit, rect } = units[index];
    const next = units[index + 1];
    if (
      isSmallOnPhone(rect, from) &&
      next &&
      isSmallOnPhone(next.rect, from) &&
      phoneGroup(board, unit) === phoneGroup(board, next.unit)
    ) {
      const h = Math.max(rect.h, next.rect.h);
      placed.push({ ...unit, rect: { x: 0, y, w: half, h } });
      placed.push({ ...next.unit, rect: { x: half, y, w: half, h } });
      y += h;
      index += 1;
      continue;
    }
    placed.push({ ...unit, rect: { x: 0, y, w: PHONE_COLUMNS, h: rect.h } });
    y += rect.h;
  }
  return placed;
}

// The desktop board as shown: as stored, except that no widget shows smaller
// than what it needs (a board written by hand or by an older editor can
// store less). Anything that would then overlap moves down, in reading order.
export function fittedUnits(board) {
  const columns = gridColumns(board);
  const placed = [];
  for (const unit of unitsForBoard(board).sort(byReadingOrder)) {
    let rect = fitMinimum(clampRect(unit.rect, columns), unitMinimum(board, unit.id), columns);
    let collisions = placed.filter((other) => intersects(rect, other.rect));
    while (collisions.length) {
      rect = { ...rect, y: Math.max(...collisions.map((other) => other.rect.y + other.rect.h)) };
      collisions = placed.filter((other) => intersects(rect, other.rect));
    }
    placed.push({ ...unit, rect });
  }
  return placed;
}

// Widgets drawn taller than laid out because their settings need the room
// (Board 6: a widget grows instead of clipping). rows: rows each unit needs.
// Anything that would then overlap moves down, in reading order.
export function grownUnits(units, rows) {
  if (!rows?.size) return units;
  // A widget that grows moves the whole band below it down by as much (UI
  // review M1): everything that starts at or below its bottom edge, in every
  // column, so rows that line up at the reference width still line up. A
  // band's shift is the largest of the growths above it, each counted with
  // the shift of the band it sits in.
  const growths = [];
  const shiftAt = (y) =>
    growths.reduce((most, growth) => (growth.bottom <= y ? Math.max(most, growth.shift) : most), 0);
  for (const unit of [...units].sort((a, b) => a.rect.y - b.rect.y)) {
    const extra = Math.max(0, (rows.get(unit.id) || 0) - unit.rect.h);
    if (extra) growths.push({ bottom: unit.rect.y + unit.rect.h, shift: shiftAt(unit.rect.y) + extra });
  }
  if (!growths.length) return units;
  const placed = [];
  for (const unit of [...units].sort(byReadingOrder)) {
    let rect = {
      ...unit.rect,
      y: unit.rect.y + shiftAt(unit.rect.y),
      h: Math.max(unit.rect.h, rows.get(unit.id) || 0),
    };
    // Safety: a band shift never overlaps, but anything that would is moved
    // below what it meets.
    let collisions = placed.filter((other) => intersects(rect, other.rect));
    while (collisions.length) {
      rect = { ...rect, y: Math.max(...collisions.map((other) => other.rect.y + other.rect.h)) };
      collisions = placed.filter((other) => intersects(rect, other.rect));
    }
    placed.push({ ...unit, rect });
  }
  return placed;
}

export function generatedUnits(board, columns) {
  if (columns === TABLET_COLUMNS) return tabletLayout(board);
  if (columns === PHONE_COLUMNS) return phoneLayout(board);
  return unitsForBoard(board);
}

function projectColumns(board, columns) {
  const placed = generatedUnits(board, columns);
  return {
    columns,
    units: placed,
    rows: Math.max(8, ...placed.map((unit) => unit.rect.y + unit.rect.h)),
  };
}

export function projectBoard(board, width) {
  return projectColumns(board, width < PHONE_WIDTH ? PHONE_COLUMNS : width < 940 ? TABLET_COLUMNS : gridColumns(board));
}

// The layout a column count belongs to (TABLET_COLUMNS and PHONE_COLUMNS are
// only ever a tablet's or a phone's).
const layoutOfColumns = (columns) =>
  columns === PHONE_COLUMNS ? "phone" : columns === TABLET_COLUMNS ? "tablet" : "desktop";

// A row's height in pixels on a board this wide, with these columns and gap.
export function rowHeight(width, columns = COLUMNS, gap = GAP) {
  if (!Number.isFinite(width) || width <= 0) return ROW_HEIGHT;
  const reference = REFERENCE_WIDTH[layoutOfColumns(columns)];
  const cell = (width + gap) / columns - gap;
  const referenceCell = (reference + gap) / columns - gap;
  // Narrower than the gaps themselves: as short as a row may be.
  if (!(cell > 0)) return ROW_MIN;
  // Whole hundredths, so the same width always gives exactly the same rows.
  const height = Math.round(((ROW_HEIGHT * cell) / referenceCell) * 100) / 100;
  return Math.min(ROW_MAX, Math.max(ROW_MIN, height));
}
// One row plus the gap below it: the vertical grid step.
export const rowStep = (width, columns = COLUMNS, gap = GAP) =>
  Math.round((rowHeight(width, columns, gap) + gap) * 100) / 100;

// rowWidth: the width rows are worked out from, when it differs from the
// board's (the board ignores a scrollbar coming or going for rows).
export function pixelRect(rect, width, columns = COLUMNS, gap = GAP, rowWidth = width) {
  const column = (width + gap) / columns;
  const row = rowStep(rowWidth, columns, gap);
  return {
    left: rect.x * column,
    top: rect.y * row,
    width: Math.max(0, rect.w * column - gap),
    height: rect.h * row - gap,
  };
}

export function stackBoard(board, panelIds, id) {
  const existingMembers = new Set(board.stacks.flatMap((stack) => stack.panelIds));
  const panels = board.panels.filter((panel) => panelIds.includes(panel.id) && !existingMembers.has(panel.id));
  if (panels.length < 2) return board;
  const origin = panels.reduce((a, b) => (a.rect.y < b.rect.y ? a : b));
  const rect = clampRect(
    {
      ...origin.rect,
      w: Math.max(...panels.map((panel) => panel.rect.w)),
      h: Math.max(...panels.map((panel) => panel.rect.h)),
    },
    gridColumns(board),
  );
  return moveUnit(
    {
      ...board,
      stacks: [
        ...board.stacks,
        {
          id,
          panelIds: panels.map((panel) => panel.id),
          rect,
          playback: {
            mode: "manual",
            intervalMs: 10000,
            manualHoldMs: 30000,
            transition: "horizontal",
            transitionDurationMs: 250,
            loop: true,
          },
        },
      ],
    },
    id,
    rect,
  );
}

export function unstackBoard(board, id) {
  const stack = board.stacks.find((item) => item.id === id);
  if (!stack) return board;
  let next = {
    ...board,
    stacks: board.stacks.filter((item) => item.id !== id),
  };
  // Retained standalone dimensions survive stacking. Resolve any new overlap on return.
  stack.panelIds.forEach((panelId) => {
    const panel = next.panels.find((item) => item.id === panelId);
    if (panel) next = moveUnit(next, panelId, panel.rect);
  });
  return next;
}

// Pages: each page is laid out on its own. Geometry works on one page at a
// time through a page view, and changes are merged back into the whole board.
export const firstPageId = (board) => board?.pages?.[0]?.id ?? "home";
export const pageOf = (board, unit) => unit.pageId ?? firstPageId(board);

export function pageBoard(board, pageId = firstPageId(board)) {
  const onPage = (unit) => pageOf(board, unit) === pageId;
  return {
    ...board,
    pageId,
    gridColumns: columnsOfPage(board?.pages?.find((page) => page.id === pageId)),
    panels: board.panels.filter(onPage),
    stacks: board.stacks.filter(onPage),
  };
}

export function mergePage(board, view) {
  if (!view || view === board) return board;
  const pageId = view.pageId ?? firstPageId(board);
  const changed = new Map(view.panels.map((panel) => [panel.id, { ...panel, pageId }]));
  const panels = board.panels.map((panel) => changed.get(panel.id) ?? panel);
  const stacks = [
    ...board.stacks.filter((stack) => pageOf(board, stack) !== pageId),
    ...view.stacks.map((stack) => ({ ...stack, pageId })),
  ];
  const next = { ...board, panels, stacks };
  for (const key of ["pageId", "gridColumns", "layoutSize", "desktopColumns"]) delete next[key];
  return next;
}

// ---- Pages ---------------------------------------------------------------

export const MAX_PAGES = 20;
export const PAGE_NAME_LIMIT = 40;

export const pageSlug = (name) =>
  String(name)
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "page";

// The address of a page follows its name (#media), so a renamed page gets a
// readable link. An id is accepted too, for links made before a rename.
export function pageFromHash(board, hash) {
  const key = decodeURIComponent(String(hash || "").replace(/^#/, "")).toLocaleLowerCase();
  if (!key) return null;
  const pages = board?.pages || [];
  return (pages.find((page) => pageSlug(page.name) === key) || pages.find((page) => page.id === key))?.id ?? null;
}

export const pageHash = (board, pageId) => {
  const page = board?.pages?.find((item) => item.id === pageId);
  return page ? `#${pageSlug(page.name)}` : "";
};

// Checks a proposed page name the way the controller does. Returns a message
// or null.
export function pageNameProblem(board, name, exceptId) {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) return "A page needs a name.";
  if (trimmed.length > PAGE_NAME_LIMIT) return `A page name is at most ${PAGE_NAME_LIMIT} characters.`;
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return "A page name cannot contain control characters.";
  const lower = trimmed.toLocaleLowerCase();
  if ((board?.pages || []).some((page) => page.id !== exceptId && page.name.toLocaleLowerCase() === lower))
    return `There is already a page called “${trimmed}”.`;
  return null;
}

function freePageId(board, base) {
  const ids = new Set((board.pages || []).map((page) => page.id));
  const stem = pageSlug(base).slice(0, 58);
  if (!ids.has(stem)) return stem;
  for (let index = 2; ; index += 1) if (!ids.has(`${stem}-${index}`)) return `${stem}-${index}`;
}

export function freePageName(board, base = "New page") {
  const names = new Set((board.pages || []).map((page) => page.name.toLocaleLowerCase()));
  if (!names.has(base.toLocaleLowerCase())) return base;
  for (let index = 2; ; index += 1) if (!names.has(`${base} ${index}`.toLocaleLowerCase())) return `${base} ${index}`;
}

export const pagesOf = (board) => (board.pages?.length ? board.pages : [{ id: firstPageId(board), name: "Home" }]);

export function addPage(board, name = freePageName(board), after) {
  const pages = pagesOf(board);
  if (pages.length >= MAX_PAGES) return { board, pageId: null };
  const page = { id: freePageId(board, name), name };
  const index = after ? pages.findIndex((item) => item.id === after) + 1 : pages.length;
  const next = [...pages];
  next.splice(index > 0 ? index : pages.length, 0, page);
  return { board: { ...board, pages: next }, pageId: page.id };
}

export function updatePage(board, pageId, changes) {
  return {
    ...board,
    pages: pagesOf(board).map((page) => {
      if (page.id !== pageId) return page;
      const next = { ...page, ...changes };
      for (const key of Object.keys(changes)) if (changes[key] === undefined) delete next[key];
      if (typeof next.name === "string") next.name = next.name.trim();
      return next;
    }),
  };
}

export function movePage(board, pageId, toIndex) {
  const pages = [...pagesOf(board)];
  const from = pages.findIndex((page) => page.id === pageId);
  if (from < 0) return board;
  const target = Math.max(0, Math.min(pages.length - 1, toIndex));
  if (target === from) return board;
  const [page] = pages.splice(from, 1);
  pages.splice(target, 0, page);
  // Units without an explicit page belong to the first page; pin them before
  // the order changes so they stay where they are.
  const first = firstPageId(board);
  const pin = (unit) => (unit.pageId ? unit : { ...unit, pageId: first });
  return { ...board, pages, panels: board.panels.map(pin), stacks: board.stacks.map(pin) };
}

export const unitsOnPage = (board, pageId) => unitsForBoard(pageBoard(board, pageId));

// Moves a standalone panel or a whole stack to another page. Without a
// rectangle it lands at the end of that page, keeping its size.
export function moveToPage(board, unitId, pageId, rect) {
  const stack = board.stacks.find((item) => item.id === unitId);
  const panel = stack ? null : board.panels.find((item) => item.id === unitId);
  if (!stack && !panel) return board;
  const from = pageOf(board, stack || panel);
  const memberIds = new Set(stack ? stack.panelIds : [unitId]);
  const source = stack || panel;
  let placement = rect;
  if (!placement) {
    const bottom = Math.max(0, ...unitsOnPage(board, pageId).map((unit) => unit.rect.y + unit.rect.h));
    placement = { ...source.rect, x: 0, y: bottom };
  }
  let next = {
    ...board,
    panels: board.panels.map((item) => (memberIds.has(item.id) ? { ...item, pageId } : item)),
    stacks: board.stacks.map((item) => (item.id === unitId ? { ...item, pageId } : item)),
  };
  if (from !== pageId || rect) next = mergePage(next, moveUnit(pageBoard(next, pageId), unitId, placement));
  return next;
}

// Deleting a page moves its units to another page (at the end, in their
// current reading order), or drops them from the arrangement when `to` is
// null (their native content is removed separately).
export function removePage(board, pageId, to) {
  const pages = pagesOf(board);
  if (pages.length <= 1 || !pages.some((page) => page.id === pageId)) return board;
  const remaining = pages.filter((page) => page.id !== pageId);
  const first = firstPageId(board);
  // Pin implicit first-page units before the first page can change.
  let next = {
    ...board,
    panels: board.panels.map((unit) => (unit.pageId ? unit : { ...unit, pageId: first })),
    stacks: board.stacks.map((unit) => (unit.pageId ? unit : { ...unit, pageId: first })),
  };
  const leaving = unitsOnPage(next, pageId).sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
  if (to && remaining.some((page) => page.id === to)) {
    const top = Math.max(0, ...unitsOnPage(next, to).map((unit) => unit.rect.y + unit.rect.h));
    const offset = top - Math.min(...leaving.map((unit) => unit.rect.y), top);
    for (const unit of leaving) next = moveToPage(next, unit.id, to, { ...unit.rect, y: unit.rect.y + offset });
  } else {
    const gone = new Set(
      leaving.flatMap((unit) =>
        unit.kind === "stack" ? next.stacks.find((s) => s.id === unit.id).panelIds : [unit.id],
      ),
    );
    next = {
      ...next,
      panels: next.panels.filter((item) => !gone.has(item.id)),
      stacks: next.stacks.filter((item) => pageOf(next, item) !== pageId),
    };
  }
  return { ...next, pages: remaining };
}
