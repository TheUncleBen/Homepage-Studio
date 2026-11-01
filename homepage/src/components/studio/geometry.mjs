// 24 columns of 36 px rows (owner-approved board 18): steps half as big as
// before, so a card can fit its content exactly.
export const COLUMNS = 24;
export const ROW_HEIGHT = 36;
export const GAP = 12;
// Narrow screens: tablets use 16 columns (cards snap to halves), phones 8.
export const TABLET_COLUMNS = 16;
export const PHONE_COLUMNS = 8;
export const PHONE_WIDTH = 560;

// Grid minima protect readable content space; overflowing native internals remain
// scrollable, never scaled down. These are content-class limits, not a claim
// that every service integration has identical layout needs.
export function panelMinimum(panel) {
  if (panel.kind === "service" || panel.kind === "bookmark")
    return { w: 5, h: 2 };
  if (panel.kind === "informationWidget") {
    if (
      ["resources", "kubernetes", "longhorn"].includes(
        panel.nativeLocator?.type,
      )
    )
      return { w: 8, h: 4 };
    return { w: panel.nativeLocator?.type === "search" ? 8 : 5, h: 2 };
  }
  if (panel.kind === "serviceWidget") {
    if (panel.nativeLocator?.type === "calendar") return { w: 12, h: 9 };
    if (["iframe", "mjpeg"].includes(panel.nativeLocator?.type))
      return { w: 8, h: 9 };
    if (panel.nativeLocator?.type === "glances") return { w: 8, h: 7 };
    return { w: 6, h: 4 };
  }
  return { w: 1, h: 1 };
}

export function unitMinimum(board, id) {
  const stack = board.stacks.find((item) => item.id === id);
  const panels = board.panels.filter((panel) =>
    stack ? stack.panelIds.includes(panel.id) : panel.id === id,
  );
  const minima = panels.map(panelMinimum);
  return {
    w: Math.max(1, ...minima.map((minimum) => minimum.w)),
    h: Math.max(
      stack ? 5 : 1,
      ...minima.map((minimum) => minimum.h + (stack ? 2 : 0)),
    ),
  };
}

function fitMinimum(rect, minimum) {
  return clampRect({
    ...rect,
    w: Math.max(rect.w, minimum.w),
    h: Math.max(rect.h, minimum.h),
  });
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
  return (
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  );
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

export function moveUnit(board, id, rect) {
  const units = unitsForBoard(board);
  const moved = units.find((unit) => unit.id === id);
  if (!moved) return board;
  moved.rect = fitMinimum(clampRect(rect), unitMinimum(board, id));
  // The manipulated unit has priority. Push intersecting neighbors downward deterministically.
  const placed = [moved];
  units
    .filter((unit) => unit.id !== id)
    .sort(
      (a, b) =>
        a.rect.y - b.rect.y || a.rect.x - b.rect.x || a.id.localeCompare(b.id),
    )
    .forEach((unit) => {
      let candidate = clampRect(unit.rect);
      let collisions = placed.filter((other) =>
        intersects(candidate, other.rect),
      );
      while (collisions.length) {
        candidate = {
          ...candidate,
          y: Math.max(
            ...collisions.map((other) => other.rect.y + other.rect.h),
          ),
        };
        collisions = placed.filter((other) =>
          intersects(candidate, other.rect),
        );
      }
      placed.push({ ...unit, rect: candidate });
    });
  const rectangles = new Map(placed.map((unit) => [unit.id, unit.rect]));
  return applyRectangles(board, rectangles);
}

export function moveProjectedUnit(board, id, delta, projection) {
  const units = unitsForBoard(board);
  const moved = units.find((unit) => unit.id === id);
  if (!moved) return board;
  const destination = { ...moved.rect, x: moved.rect.x + delta.x, y: moved.rect.y + delta.y };
  if (projection.columns === COLUMNS) return moveUnit(board, id, destination);
  const ordered = [...projection.units].sort(
    (a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x || a.id.localeCompare(b.id),
  );
  const from = ordered.findIndex((unit) => unit.id === id);
  if (from < 0) return board;
  const start = ordered[from].rect;
  const target = { x: start.x + start.w / 2 + (delta.x * projection.columns) / COLUMNS, y: start.y + delta.y };
  const distance = (unit) => Math.hypot(target.x - unit.rect.x - unit.rect.w / 2, target.y - unit.rect.y);
  const nearest = ordered.reduce((a, b) => (distance(a) <= distance(b) ? a : b));
  const to = ordered.indexOf(nearest);
  // A sideways drag reorders only within its projected row: at 8 columns a
  // wrapped row no longer sits at its canonical x, so moving onto a neighbour
  // swaps reading order instead of shifting the canonical rect.
  if (
    from === to ||
    (!delta.y && nearest.rect.y !== start.y) ||
    Math.abs(target.y - nearest.rect.y) > nearest.rect.h / 2
  )
    return moveUnit(board, id, destination);

  // A narrow layout can project several desktop columns into successive rows.
  // Reuse the crossed units' canonical slots so moving upward still changes the
  // shared layout, even when every original unit already has canonical y = 0.
  const canonical = new Map(units.map((unit) => [unit.id, unit]));
  const slots = ordered.map((unit) => canonical.get(unit.id).rect);
  const reordered = [...ordered];
  reordered.splice(to, 0, ...reordered.splice(from, 1));
  const placed = [];
  reordered.forEach((unit, index) => {
    const original = canonical.get(unit.id);
    const slot = slots[index];
    let rect = fitMinimum({ ...original.rect, x: slot.x, y: slot.y }, unitMinimum(board, unit.id));
    let collisions = placed.filter((other) => intersects(rect, other.rect));
    while (collisions.length) {
      rect = { ...rect, y: Math.max(...collisions.map((other) => other.rect.y + other.rect.h)) };
      collisions = placed.filter((other) => intersects(rect, other.rect));
    }
    placed.push({ ...original, rect });
  });
  const candidate = applyRectangles(board, new Map(placed.map((unit) => [unit.id, unit.rect])));
  const visible = projectColumns(candidate, projection.columns).units.sort(
    (a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x || a.id.localeCompare(b.id),
  );
  if (visible.every((unit, index) => unit.id === reordered[index].id)) return candidate;

  // Different widths can push an earlier slot below an untouched later slot.
  // A narrow projection shows units in canonical reading order (see
  // projectColumns), so repair by keeping each unit's canonical top-left after
  // the previous unit's; settling only moves a unit further down.
  placed.length = 0;
  reordered.forEach((unit, index) => {
    const original = canonical.get(unit.id);
    const slot = slots[index];
    let rect = fitMinimum({ ...original.rect, x: slot.x, y: slot.y }, unitMinimum(board, unit.id));
    const prior = placed.at(-1)?.rect;
    if (prior && !readsBefore(prior, rect)) rect = { ...rect, y: prior.y + (rect.x <= prior.x ? 1 : 0) };
    let collisions = placed.filter((other) => intersects(rect, other.rect));
    while (collisions.length) {
      rect = { ...rect, y: Math.max(...collisions.map((other) => other.rect.y + other.rect.h)) };
      collisions = placed.filter((other) => intersects(rect, other.rect));
    }
    placed.push({ ...original, rect });
  });
  return applyRectangles(board, new Map(placed.map((unit) => [unit.id, unit.rect])));
}

// Project both canonical edges with the same rounding rule so units that share
// a canonical edge share a projected edge. Rounding x and w independently
// staggered 8-column rows and pushed adjacent tiles down.
function projectEdge(edge, columns) {
  return Math.round((edge * columns) / COLUMNS);
}

// On tablets panels snap to halves: a panel up to half the desktop width is
// half the tablet width, a wider one is full width. Rows therefore fill the
// board two-up instead of leaving a narrow strip, and a desktop row of three
// becomes two, then one (see projectColumns). On phones every unit is full width.
const HALF = TABLET_COLUMNS / 2;
function projectHalves(rect) {
  if (rect.w > COLUMNS / 2) return { ...rect, x: 0, w: 2 * HALF };
  const left = Math.min(HALF, Math.round(projectEdge(rect.x, TABLET_COLUMNS) / HALF) * HALF);
  return { ...rect, x: left, w: HALF };
}

function projectRect(rect, columns) {
  if (columns === COLUMNS) return rect;
  if (columns === TABLET_COLUMNS) return projectHalves(rect);
  return clampRect({ ...rect, x: 0, w: columns }, columns);
}

// Narrow projections reflow in reading order (left to right, then top to
// bottom). Units are taken in canonical reading order. Each keeps its projected
// column and canonical row when that spot is free and still reads after the
// unit placed before it, so tiles that fit side by side stay side by side on
// shared edges. Otherwise it wraps: it takes the first free spot, scanning
// rows from the previous unit's row and each row from the left, that reads
// after the previous unit. On tablets a row of three third-width tiles becomes
// two then one; on phones every unit is full width, so each one simply
// follows the last. The desktop board is shown as stored.
function projectColumns(board, columns) {
  const units = unitsForBoard(board).sort(
    (a, b) =>
      a.rect.y - b.rect.y || a.rect.x - b.rect.x || a.id.localeCompare(b.id),
  );
  const placed = [];
  const free = (rect) => !placed.some((other) => intersects(rect, other.rect));
  units.forEach((unit) => {
    const raw = fitMinimum(clampRect(unit.rect), unitMinimum(board, unit.id));
    let rect = projectRect(raw, columns);
    const previous = placed.at(-1)?.rect;
    if (columns < COLUMNS && previous && (!free(rect) || readsBefore(rect, previous))) {
      wrap: for (let y = previous.y; ; y += 1) {
        for (let x = y === previous.y ? previous.x + 1 : 0; x + rect.w <= columns; x += 1) {
          if (free({ ...rect, x, y })) {
            rect = { ...rect, x, y };
            break wrap;
          }
        }
      }
    }
    // The canonical desktop board is disjoint; push any stray overlap down.
    {
      let collisions = placed.filter((other) => intersects(rect, other.rect));
      while (collisions.length) {
        rect = {
          ...rect,
          y: Math.max(
            ...collisions.map((other) => other.rect.y + other.rect.h),
          ),
        };
        collisions = placed.filter((other) => intersects(rect, other.rect));
      }
    }
    placed.push({ ...unit, rect });
  });
  return {
    columns,
    units: placed,
    rows: Math.max(8, ...placed.map((unit) => unit.rect.y + unit.rect.h)),
  };
}

export function projectBoard(board, width) {
  return projectColumns(board, width < PHONE_WIDTH ? PHONE_COLUMNS : width < 940 ? TABLET_COLUMNS : COLUMNS);
}

export function pixelRect(rect, width, columns = COLUMNS) {
  const column = (width + GAP) / columns;
  return {
    left: rect.x * column,
    top: rect.y * (ROW_HEIGHT + GAP),
    width: Math.max(0, rect.w * column - GAP),
    height: rect.h * (ROW_HEIGHT + GAP) - GAP,
  };
}

export function stackBoard(board, panelIds, id) {
  const existingMembers = new Set(
    board.stacks.flatMap((stack) => stack.panelIds),
  );
  const panels = board.panels.filter(
    (panel) => panelIds.includes(panel.id) && !existingMembers.has(panel.id),
  );
  if (panels.length < 2) return board;
  const origin = panels.reduce((a, b) => (a.rect.y < b.rect.y ? a : b));
  const rect = clampRect({
    ...origin.rect,
    w: Math.max(...panels.map((panel) => panel.rect.w)),
    h: Math.max(...panels.map((panel) => panel.rect.h)),
  });
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
  delete next.pageId;
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
      leaving.flatMap((unit) => (unit.kind === "stack" ? next.stacks.find((s) => s.id === unit.id).panelIds : [unit.id])),
    );
    next = {
      ...next,
      panels: next.panels.filter((item) => !gone.has(item.id)),
      stacks: next.stacks.filter((item) => pageOf(next, item) !== pageId),
    };
  }
  return { ...next, pages: remaining };
}
