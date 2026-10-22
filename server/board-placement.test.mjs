// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { BOARD_COLUMNS, DEFAULT_PLAYBACK, intersects, nextPosition, reconcileBoard, rect, validateStoredBoard } from './board.mjs';

// The original row-major scan is deliberately retained as an independent
// behavioral oracle for the optimized allocator, only on bounded fixtures.
function referencePosition(size, occupied) {
  const w = Math.min(BOARD_COLUMNS, Math.max(1, size.w)), h = Math.max(1, size.h);
  const bottom = occupied.reduce((value, position) => Math.max(value, position.y + position.h), 0);
  for (let y = 0; y <= bottom; y++) for (let x = 0; x <= BOARD_COLUMNS - w; x++) {
    const candidate = { x, y, w, h };
    if (!occupied.some(position => intersects(candidate, position))) return candidate;
  }
  return { x: 0, y: bottom, w, h };
}

function referenceBoard(sources, previous, legacyLayout = { items: {} }) {
  previous = validateStoredBoard(previous);
  const sourceIds = new Set(sources.map(source => source.id));
  const byId = new Map(previous.panels.map(panel => [panel.id, panel]));
  const stacked = new Set();
  const stacks = previous.stacks.flatMap(stack => {
    const panelIds = stack.panelIds.filter(id => sourceIds.has(id));
    if (panelIds.length < 2) return [];
    panelIds.forEach(id => stacked.add(id));
    return [{ ...stack, panelIds }];
  });
  const occupied = stacks.map(stack => stack.rect);
  for (const source of sources) if (!stacked.has(source.id) && byId.has(source.id)) occupied.push(byId.get(source.id).rect);
  const panels = sources.map(source => {
    let position = byId.get(source.id)?.rect;
    if (!position) {
      const legacy = legacyLayout.items?.[source.id];
      try { if (legacy) position = rect(legacy); } catch { /* Match legacy migration. */ }
      if (!position || occupied.some(other => intersects(position, other))) position = referencePosition({ w: 4, h: source.kind === 'serviceWidget' ? 5 : 3 }, occupied);
      if (!stacked.has(source.id)) occupied.push(position);
    }
    return { ...source, rect: { ...position } };
  });
  for (const old of previous.stacks) {
    const survivors = old.panelIds.filter(id => sourceIds.has(id));
    if (survivors.length !== 1) continue;
    const panel = panels.find(value => value.id === survivors[0]);
    const others = [...stacks.map(stack => stack.rect), ...panels.filter(value => value.id !== panel.id && !stacked.has(value.id)).map(value => value.rect)];
    panel.rect = others.some(other => intersects(old.rect, other)) ? referencePosition(old.rect, others) : { ...old.rect };
  }
  return { version: 2, columns: BOARD_COLUMNS, panels, stacks };
}

function random(seed) {
  let state = seed;
  return maximum => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % maximum; };
}
const source = (id, kind = 'service') => ({ id: `panel-${id}`, kind, title: `Panel ${id}` });
const board = (panels, stacks = []) => ({ version: 2, columns: BOARD_COLUMNS, panels, stacks });

test('single-placement searches preserve row-major order across varied sizes and occupied geometry', () => {
  const cases = [
    { occupied: [], sizes: [{ w: 4, h: 3 }, { w: 12, h: 1000 }, { w: 0, h: 0 }, { w: 20, h: 2 }] },
    { occupied: [{ x: 0, y: 0, w: 4, h: 5 }, { x: 8, y: 0, w: 4, h: 3 }], sizes: [{ w: 4, h: 3 }, { w: 5, h: 1 }, { w: 12, h: 2 }] },
    { occupied: [{ x: 0, y: 0, w: 4, h: 3 }, { x: 0, y: 0, w: 4, h: 3 }, { x: 2, y: 2, w: 7, h: 6 }], sizes: [{ w: 3, h: 1 }, { w: 7, h: 3 }, { w: 12, h: 1000 }] },
    { occupied: [{ x: 0, y: 100000, w: 12, h: 1000 }, { x: 0, y: 0, w: 1, h: 1000 }], sizes: [{ w: 1, h: 1000 }, { w: 12, h: 1000 }, { w: 4, h: 5 }] },
    { occupied: Array.from({ length: 101 }, (_, index) => ({ x: 0, y: index * 1000, w: 12, h: 1000 })), sizes: [{ w: 12, h: 1000 }] },
  ];
  for (const { occupied, sizes } of cases) for (const size of sizes) assert.deepEqual(nextPosition(size, occupied), referencePosition(size, occupied));
  const pick = random(0x51cc1684);
  for (let fixture = 0; fixture < 250; fixture++) {
    const occupied = Array.from({ length: pick(35) }, () => {
      const w = pick(12) + 1;
      return { x: pick(13 - w), y: pick(40), w, h: pick(12) + 1 };
    });
    const size = { w: pick(12) + 1, h: pick(20) + 1 };
    assert.deepEqual(nextPosition(size, occupied), referencePosition(size, occupied), `fixture ${fixture}`);
  }
});

test('reconciliation preserves stored panels, legacy positions, mixed sizes and surviving or collapsed stacks', () => {
  const previous = board([
    { ...source('kept'), rect: { x: 0, y: 0, w: 3, h: 4 } },
    { ...source('a', 'serviceWidget'), rect: { x: 4, y: 0, w: 4, h: 5 } },
    { ...source('b', 'informationWidget'), rect: { x: 8, y: 0, w: 4, h: 3 } },
    { ...source('c', 'bookmark'), rect: { x: 8, y: 0, w: 4, h: 3 } },
    { ...source('removed'), rect: { x: 0, y: 20, w: 4, h: 3 } },
    { ...source('alone'), rect: { x: 4, y: 20, w: 4, h: 3 } },
    { ...source('far'), rect: { x: 0, y: 100000, w: 12, h: 1000 } },
  ], [
    { id: 'stack-kept', panelIds: ['panel-a', 'panel-b', 'panel-c'], rect: { x: 3, y: 2, w: 5, h: 7 }, playback: DEFAULT_PLAYBACK },
    { id: 'stack-collapsed', panelIds: ['panel-removed', 'panel-alone'], rect: { x: 0, y: 0, w: 7, h: 4 }, playback: DEFAULT_PLAYBACK },
  ]);
  const sources = [source('first', 'serviceWidget'), source('kept'), source('legacy'), source('a', 'serviceWidget'), source('b', 'informationWidget'), source('alone'), source('far'), ...Array.from({ length: 60 }, (_, index) => source(index, index % 2 ? 'serviceWidget' : 'bookmark'))];
  const legacy = { items: { 'panel-first': { x: 0, y: 0, w: 4, h: 3 }, 'panel-legacy': { x: 9, y: 10, w: 3, h: 8 }, 'panel-1': { x: 10, y: 0, w: 4, h: 5 } } };
  assert.deepEqual(reconcileBoard(sources, previous, legacy), referenceBoard(sources, previous, legacy));
});

test('deterministic mixed reconciliation fixtures match the original first-free placement', () => {
  const pick = random(0x03e48b8b), kinds = ['service', 'serviceWidget', 'informationWidget', 'bookmark'];
  for (let fixture = 0; fixture < 100; fixture++) {
    const position = () => { const w = pick(12) + 1; return { x: pick(13 - w), y: pick(40), w, h: pick(12) + 1 }; };
    const oldPanels = Array.from({ length: 24 }, (_, index) => ({ ...source(index, kinds[pick(kinds.length)]), rect: position() }));
    const stacks = Array.from({ length: 6 }, (_, index) => ({ id: `stack-${index}`, panelIds: oldPanels.slice(index * 3, index * 3 + 3).map(panel => panel.id), rect: position(), playback: DEFAULT_PLAYBACK }));
    const sources = [...oldPanels.filter(() => pick(4) !== 0).map(({ rect: _rect, ...entry }) => entry), ...Array.from({ length: 50 }, (_, index) => source(index + 24, kinds[pick(kinds.length)]))];
    // Interleave new and persisted entries; persisted reservations cannot depend
    // on whether their source happens to appear before a newly placed panel.
    for (let index = sources.length - 1; index > 0; index--) { const other = pick(index + 1); [sources[index], sources[other]] = [sources[other], sources[index]]; }
    const legacy = { items: Object.fromEntries(sources.filter(() => pick(3) === 0).map(entry => [entry.id, position()])) };
    const previous = board(oldPanels, stacks);
    assert.deepEqual(reconcileBoard(sources, previous, legacy), referenceBoard(sources, previous, legacy), `fixture ${fixture}`);
  }
});

test('initial placement stays bounded through the supported panel limit and a sparse ceiling coordinate', async () => {
  // A subprocess timeout makes a regression to the cubic initial scan fail
  // without blocking the test runner's event loop for minutes.
  const result = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { MAX_PANELS, reconcileBoard } from ${JSON.stringify(new URL('./board.mjs', import.meta.url).href)};
    for (const [count, kind, h] of [[600, 'service', 3], [MAX_PANELS, 'serviceWidget', 5]]) {
      const sources = Array.from({ length: count }, (_, index) => ({ id: 'panel-' + index, kind }));
      const board = reconcileBoard(sources, null);
      assert.equal(board.panels.length, count);
      for (let index = 0; index < count; index++) assert.deepEqual(board.panels[index].rect, { x: (index % 3) * 4, y: Math.floor(index / 3) * h, w: 4, h });
      const far = { ...sources[0], rect: { x: 0, y: 100000, w: 12, h: 1000 } };
      const restored = reconcileBoard(sources, { version: 2, columns: 12, panels: [far], stacks: [] });
      assert.deepEqual(restored.panels[0].rect, far.rect);
      for (let index = 1; index < count; index++) assert.deepEqual(restored.panels[index].rect, { x: ((index - 1) % 3) * 4, y: Math.floor((index - 1) / 3) * h, w: 4, h });
      const persisted = { version: 2, columns: 12, panels: board.panels, stacks: [] };
      assert.deepEqual(reconcileBoard(sources, persisted), board);
    }
    process.stdout.write('bounded placement passed');
  `], { timeout: 10000, maxBuffer: 1024 * 1024 });
  assert.equal(result.stdout, 'bounded placement passed');
});
