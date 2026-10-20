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
  return {
    ...board,
    panels: board.panels.map((panel) =>
      rectangles.has(panel.id)
        ? { ...panel, rect: rectangles.get(panel.id) }
        : panel,
    ),
    stacks: board.stacks.map((stack) =>
      rectangles.has(stack.id)
        ? { ...stack, rect: rectangles.get(stack.id) }
        : stack,
    ),
  };
}

export function projectBoard(board, width) {
  const columns = width < 560 ? 4 : width < 940 ? 8 : COLUMNS;
  const units = unitsForBoard(board).sort(
    (a, b) =>
      a.rect.y - b.rect.y || a.rect.x - b.rect.x || a.id.localeCompare(b.id),
  );
  const placed = [];
  units.forEach((unit) => {
    const raw = fitMinimum(clampRect(unit.rect), unitMinimum(board, unit.id));
    let rect =
      columns === COLUMNS
        ? raw
        : clampRect(
            {
              ...raw,
              x: Math.floor((raw.x * columns) / COLUMNS),
              w: Math.max(
                columns === 4 ? 4 : 3,
                Math.round((raw.w * columns) / COLUMNS),
              ),
            },
            columns,
          );
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
