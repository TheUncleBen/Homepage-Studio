import { firstPageId } from "./geometry.mjs";

// Merges an arrangement draft onto a board someone else saved meanwhile.
// base: the saved board the draft started from; mine: the draft; theirs: the
// board saved since. What the draft changed (a panel's place, size, page,
// look; a stack; the pages) stays as the draft has it. Everything the draft
// left alone follows theirs, and panels only one side knows are kept from
// theirs (the server drops any that no longer exist and places new ones).

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// What an arrangement changes about a panel, with the page spelled out
// (the editor's page views add it; a saved board may leave it to the first).
const placement = (panel, board) => ({
  rect: panel.rect,
  pageId: panel.pageId ?? firstPageId(board),
  look: panel.look ?? null,
  behaviour: panel.behaviour ?? null,
});
const byId = (list = []) => new Map(list.map((item) => [item.id, item]));

export function rebaseBoard(base, mine, theirs) {
  if (!theirs) return mine;
  if (!mine || !base) return theirs;
  const baseUnits = byId(base.panels);
  const minePanels = byId(mine.panels);
  const panels = theirs.panels.map((panel) => {
    const own = minePanels.get(panel.id);
    const before = baseUnits.get(panel.id);
    // Changed in this draft: the draft wins for that panel.
    if (!own || !before || same(placement(own, mine), placement(before, base))) return panel;
    const { look, behaviour, ...rest } = panel;
    return { ...rest, rect: own.rect, pageId: own.pageId, ...lookOf(own) };
  });
  const baseStacks = byId(base.stacks);
  const mineStacks = byId(mine.stacks);
  const theirStacks = byId(theirs.stacks);
  // Stacks this draft made or changed win; ones it removed stay removed.
  const stacks = [
    ...theirs.stacks.filter((stack) => {
      const before = baseStacks.get(stack.id);
      return !(before && !mineStacks.has(stack.id) && same(before, stack));
    }),
  ].map((stack) => {
    const own = mineStacks.get(stack.id);
    const before = baseStacks.get(stack.id);
    return own && before && !same(own, before) ? own : stack;
  });
  for (const stack of mine.stacks) if (!baseStacks.has(stack.id) && !theirStacks.has(stack.id)) stacks.push(stack);
  // A panel can be in only one stack; this draft's stacks claim theirs first.
  const claimed = new Set();
  const ordered = [...stacks].sort((a, b) => Number(mineStacks.has(b.id)) - Number(mineStacks.has(a.id)));
  const kept = new Set(
    ordered
      .filter((stack) => {
        if (stack.panelIds.some((id) => claimed.has(id))) return false;
        stack.panelIds.forEach((id) => claimed.add(id));
        return true;
      })
      .map((stack) => stack.id),
  );
  const pages = same(mine.pages, base.pages) ? theirs.pages : mine.pages;
  const next = { ...theirs, pages, panels, stacks: stacks.filter((stack) => kept.has(stack.id)) };
  if (!same(mine.looks, base.looks)) next.looks = mine.looks;
  // A tablet or phone layout this draft arranged (or let follow desktop
  // again) wins for that size; the server places anything new on it.
  for (const size of ["tablet", "phone"]) {
    if (same(mine.layouts?.[size], base.layouts?.[size])) continue;
    const layouts = { ...next.layouts };
    if (mine.layouts?.[size]) layouts[size] = mine.layouts[size];
    else delete layouts[size];
    if (Object.keys(layouts).length) next.layouts = layouts;
    else delete next.layouts;
  }
  return next;
}

function lookOf(panel) {
  const out = {};
  if (panel.look) out.look = panel.look;
  if (panel.behaviour) out.behaviour = panel.behaviour;
  return out;
}
