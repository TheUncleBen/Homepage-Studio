export const COLUMNS = 12;
export const ROW_HEIGHT = 72;
export const GAP = 16;

// Grid minima protect readable content space; overflowing native internals remain
// scrollable, never scaled down. These are content-class limits, not a claim
// that every service integration has identical layout needs.
export function panelMinimum(panel) {
  if (panel.kind === "service" || panel.kind === "bookmark")
    return { w: 3, h: 2 };
  if (panel.kind === "informationWidget") {
    if (
      ["resources", "kubernetes", "longhorn"].includes(
        panel.nativeLocator?.type,
      )
    )
      return { w: 4, h: 3 };
    return { w: panel.nativeLocator?.type === "search" ? 4 : 3, h: 2 };
  }
  if (panel.kind === "serviceWidget") {
    if (panel.nativeLocator?.type === "calendar") return { w: 6, h: 5 };
    if (["iframe", "mjpeg"].includes(panel.nativeLocator?.type))
      return { w: 4, h: 5 };
    if (["glances", "customapi"].includes(panel.nativeLocator?.type))
      return { w: 4, h: 4 };
    return { w: 4, h: 3 };
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
      stack ? 3 : 1,
      ...minima.map((minimum) => minimum.h + (stack ? 1 : 0)),
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
  const w = Math.max(1, Math.min(columns, Math.round(Number(rect.w) || 4)));
  const h = Math.max(1, Math.min(1000, Math.round(Number(rect.h) || 3)));
  return {
    x: Math.max(0, Math.min(columns - w, Math.round(Number(rect.x) || 0))),
    y: Math.max(0, Math.min(100000, Math.round(Number(rect.y) || 0))),
    w,
    h,
  };
}

export function intersects(a, b) {
  return (
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  );
}

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
  if (projection.columns === COLUMNS || !delta.y) return moveUnit(board, id, destination);
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
  if (from === to || Math.abs(target.y - nearest.rect.y) > nearest.rect.h / 2) return moveUnit(board, id, destination);

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
  // Repair only that case. Canonical priority matters between overlapping
  // projected columns; disjoint columns may keep their original desktop order.
  const projected = [];
  placed.length = 0;
  const settle = (rect, others) => {
    let next = rect;
    let collisions = others.filter((other) => intersects(next, other.rect));
    while (collisions.length) {
      next = { ...next, y: Math.max(...collisions.map((other) => other.rect.y + other.rect.h)) };
      collisions = others.filter((other) => intersects(next, other.rect));
    }
    return next;
  };
  reordered.forEach((unit, index) => {
    const original = canonical.get(unit.id);
    const slot = slots[index];
    let rect = fitMinimum({ ...original.rect, x: slot.x, y: slot.y }, unitMinimum(board, unit.id));
    let shape = projectRect(rect, projection.columns);
    projected.forEach((other, previous) => {
      if (shape.x < other.rect.x + other.rect.w && shape.x + shape.w > other.rect.x) {
        const prior = placed[previous].rect;
        rect.y = Math.max(rect.y, prior.y + (rect.x <= prior.x ? 1 : 0));
      }
    });
    rect = settle(rect, placed);
    shape = settle(projectRect(rect, projection.columns), projected);
    const prior = projected.at(-1)?.rect;
    if (prior && (shape.y < prior.y || (shape.y === prior.y && shape.x < prior.x))) {
      rect = settle({ ...rect, y: Math.max(rect.y, prior.y + (shape.x <= prior.x ? 1 : 0)) }, placed);
      shape = settle(projectRect(rect, projection.columns), projected);
    }
    placed.push({ ...original, rect });
    projected.push({ id: unit.id, rect: shape });
  });
  return applyRectangles(board, new Map(placed.map((unit) => [unit.id, unit.rect])));
}

// Project both canonical edges with the same rounding rule so units that share
// a canonical edge share a projected edge. Rounding x and w independently
// staggered 8-column rows and pushed adjacent tiles down.
function projectEdge(edge, columns) {
  return Math.round((edge * columns) / COLUMNS);
}

function projectRect(rect, columns) {
  if (columns === COLUMNS) return rect;
  const left = projectEdge(rect.x, columns);
  const right = projectEdge(rect.x + rect.w, columns);
  return clampRect(
    {
      ...rect,
      x: left,
      w: Math.max(columns === 4 ? 4 : 3, right - left),
    },
    columns,
  );
}

function projectColumns(board, columns) {
  const units = unitsForBoard(board).sort(
    (a, b) =>
      a.rect.y - b.rect.y || a.rect.x - b.rect.x || a.id.localeCompare(b.id),
  );
  const placed = [];
  units.forEach((unit) => {
    const raw = fitMinimum(clampRect(unit.rect), unitMinimum(board, unit.id));
    let rect = projectRect(raw, columns);
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
    rows: Math.max(4, ...placed.map((unit) => unit.rect.y + unit.rect.h)),
  };
}

export function projectBoard(board, width) {
  return projectColumns(board, width < 560 ? 4 : width < 940 ? 8 : COLUMNS);
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
