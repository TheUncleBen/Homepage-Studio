import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';
import { convertBoard, convertLook, convertSettingsText, convertLibraryText, migrateLegacyLooks } from './migrations/legacy-looks.mjs';
import { validateLook } from '../homepage/src/components/studio/look.mjs';
import { createConfigStore } from './config.mjs';

const quiet = { log() {}, error() {} };

test('each old look becomes the blocks that drew it', () => {
  assert.deepEqual(convertLook({ layout: 'hero', heroSize: 'l', trend: 'day', fill: 'solid', values: [{ field: 'a', slot: 'hidden' }, { field: 'b', slot: 'hero' }, { field: 'c' }] }), {
    fill: 'solid', values: [{ field: 'a' }, { field: 'b' }, { field: 'c' }],
    blocks: [{ id: 'b1', type: 'big', values: ['b'], size: 'l', trend: 'day' }, { id: 'b2', type: 'numbers', values: ['c'] }],
  });
  assert.deepEqual(convertLook({ layout: 'quiet' }), { blocks: [{ id: 'b1', type: 'quiet' }] });
  assert.deepEqual(convertLook({ show: 'table' }), { blocks: [{ id: 'b1', type: 'numbers', arrange: 'list' }] });
  assert.deepEqual(convertLook({ show: 'bar', chartRange: '7d', values: [{ field: 'q' }, { field: 'n', slot: 'number' }] }).blocks,
    [{ id: 'b1', type: 'big', first: true }, { id: 'b2', type: 'chart', style: 'bar', range: '7d', values: ['q'] }, { id: 'b3', type: 'numbers', values: ['n'] }]);
  assert.deepEqual(convertLook({ show: 'pie' }).blocks, [{ id: 'b1', type: 'pie', style: 'pie' }]);
  assert.deepEqual(convertLook({ show: 'gauge', values: [{ field: 'x', slot: 'hero' }] }).blocks, [{ id: 'b1', type: 'gauge', values: ['x'] }]);
  assert.deepEqual(convertLook({ show: 'status', chartRange: '7d' }).blocks, [{ id: 'b1', type: 'status', range: '7d' }]);
  // The default old look is the default block look: nothing extra is stored.
  assert.deepEqual(convertLook({ layout: 'hero', show: 'numbers', fill: 'tint' }), { fill: 'tint' });
  // Inherited from the dashboard's card look.
  assert.deepEqual(convertLook({}, { inherited: { layout: 'quiet' } }), { blocks: [{ id: 'b1', type: 'quiet' }] });
  // A current look is left as it is.
  const current = { fill: 'tint', blocks: [{ id: 'b1', type: 'pie' }] };
  assert.equal(convertLook(current), current);
  // Saved looks with old settings stay valid either way.
  for (const look of [{ layout: 'quiet', columns: '3' }, { show: 'donut', heroSize: 'xl' }]) assert.ok(validateLook(convertLook(look)) !== null);
});

test('hidden values stay hidden and every shown value stays shown (UI review H1, H2)', () => {
  const blocks = (look) => convertLook(look).blocks;
  // No Hero: the Big number leads with the first value that wasn't hidden;
  // values set to Number still show below it.
  assert.deepEqual(blocks({ values: [{ field: 'a', slot: 'hidden' }, { field: 'b' }, { field: 'c', slot: 'number' }] }),
    [{ id: 'b1', type: 'big', values: ['b'] }, { id: 'b2', type: 'numbers', values: ['c'] }]);
  // Quiet and table list every value that wasn't hidden, whatever its slot.
  assert.deepEqual(blocks({ layout: 'quiet', values: [{ field: 'a', slot: 'hidden' }, { field: 'b', slot: 'hero' }, { field: 'c', slot: 'number' }] }),
    [{ id: 'b1', type: 'quiet', values: ['b', 'c'] }]);
  assert.deepEqual(blocks({ show: 'table', values: [{ field: 'a', slot: 'hidden' }, { field: 'b', slot: 'number' }] }),
    [{ id: 'b1', type: 'numbers', arrange: 'list', values: ['b'] }]);
  assert.deepEqual(blocks({ show: 'bar', values: [{ field: 'a', slot: 'hidden' }, { field: 'b' }, { field: 'c', slot: 'number' }] }),
    [{ id: 'b1', type: 'big', values: ['b'] }, { id: 'b2', type: 'chart', style: 'bar', values: ['b'] }, { id: 'b3', type: 'numbers', values: ['c'] }]);
  assert.deepEqual(blocks({ show: 'pie', values: [{ field: 'a', slot: 'hidden' }, { field: 'b' }, { field: 'c' }] }),
    [{ id: 'b1', type: 'pie', style: 'pie', values: ['b', 'c'] }]);
  assert.deepEqual(blocks({ show: 'gauge', values: [{ field: 'a', slot: 'hidden' }, { field: 'b' }] }),
    [{ id: 'b1', type: 'gauge', values: ['b'] }]);
});

test('settings.yaml loses only the old card settings, keeping comments', () => {
  const { text, inherited } = convertSettingsText('# mine\ntitle: T\nstudioTheme:\n  card:\n    layout: quiet\n    fill: tint\n');
  assert.deepEqual(inherited, { layout: 'quiet' });
  assert.equal(text, '# mine\ntitle: T\nstudioTheme:\n  card:\n    fill: tint\n');
  assert.equal(convertSettingsText('studioTheme:\n  card:\n    show: line\n').text, '{}\n');
  assert.equal(convertSettingsText('title: T\nstudioTheme:\n  card:\n    show: line\n').text, 'title: T\n');
});

test('saved widgets and looks are converted', () => {
  const out = JSON.parse(convertLibraryText(JSON.stringify({ version: 1, entries: [
    { id: 'a', name: 'L', kind: 'look', look: { layout: 'quiet' } },
    { id: 'b', name: 'W', kind: 'widget', widget: { kind: 'informationWidget', type: 'resources', config: {}, look: { show: 'gauge' } } },
  ] })));
  assert.deepEqual(out.entries[0].look, { blocks: [{ id: 'b1', type: 'quiet' }] });
  assert.deepEqual(out.entries[1].widget.look, { blocks: [{ id: 'b1', type: 'gauge' }] });
});

test('a dashboard holding an old look loads after the migration (owner report, 10 Nov 2026)', async () => {
  const base = await fs.mkdtemp(join(os.tmpdir(), 'legacy-looks-'));
  const configRoot = join(base, 'config'), stateRoot = join(base, 'state');
  const store = createConfigStore({ configDir: configRoot, stateDir: stateRoot });
  const first = await store.initialize();
  await store.save({ revision: first.revision, servicesYaml: '- Network:\n    - pfSense Firewall:\n        href: https://fw.example.test\n        widget:\n          type: pfsense\n          url: https://fw.example.test\n' });
  const state = JSON.parse(await fs.readFile(join(stateRoot, 'state.json'), 'utf8'));
  const panel = state.board.panels.find((item) => item.kind === 'serviceWidget');
  panel.look = { layout: 'hero', trend: 'week', values: [{ field: 'load', slot: 'hero' }] };
  await fs.writeFile(join(stateRoot, 'state.json'), JSON.stringify(state));
  await fs.writeFile(join(configRoot, 'settings.yaml'), 'studioTheme:\n  card:\n    layout: quiet\n');
  await assert.rejects(createConfigStore({ configDir: configRoot, stateDir: stateRoot }).initialize(), /Unknown widget look setting: layout/);
  await migrateLegacyLooks({ configRoot, stateRoot, log: quiet });
  const loaded = await createConfigStore({ configDir: configRoot, stateDir: stateRoot }).initialize();
  assert.deepEqual(loaded.board.panels.find((item) => item.kind === 'serviceWidget').look.blocks,
    [{ id: 'b1', type: 'big', values: ['load'], trend: 'week' }, { id: 'b2', type: 'numbers' }]);
  // Running it again changes nothing.
  const before = await fs.readFile(join(stateRoot, 'state.json'), 'utf8');
  await migrateLegacyLooks({ configRoot, stateRoot, log: quiet });
  assert.equal(await fs.readFile(join(stateRoot, 'state.json'), 'utf8'), before);
});

test('old card settings reach only widgets that draw values', () => {
  const board = { panels: [
    { id: 't', kind: 'service', look: { fill: 'tint' } },
    { id: 'h', kind: 'informationWidget', nativeLocator: { type: 'heading' }, look: { fill: 'plain' } },
    { id: 'w', kind: 'serviceWidget', look: { fill: 'tint' } },
  ] };
  const out = convertBoard(board, { layout: 'quiet' });
  assert.deepEqual(out.panels[0].look, { fill: 'tint' });
  assert.deepEqual(out.panels[1].look, { fill: 'plain' });
  assert.deepEqual(out.panels[2].look, { fill: 'tint', blocks: [{ id: 'b1', type: 'quiet' }] });
});

test('a dashboard with only a config folder is converted too', async () => {
  const base = await fs.mkdtemp(join(os.tmpdir(), 'legacy-dirs-'));
  const configRoot = join(base, 'config'), stateRoot = join(base, 'state');
  await fs.mkdir(join(configRoot, 'dashboards', 'abc'), { recursive: true }); await fs.mkdir(stateRoot);
  await fs.writeFile(join(configRoot, 'dashboards', 'abc', 'settings.yaml'), 'studioTheme:\n  card:\n    show: line\n    fill: tint\n');
  await migrateLegacyLooks({ configRoot, stateRoot, log: quiet });
  assert.equal(await fs.readFile(join(configRoot, 'dashboards', 'abc', 'settings.yaml'), 'utf8'), 'studioTheme:\n  card:\n    fill: tint\n');
});

test('an export from before the block widgets imports with its looks converted', async () => {
  const base = await fs.mkdtemp(join(os.tmpdir(), 'legacy-import-'));
  const store = createConfigStore({ configDir: join(base, 'config'), stateDir: join(base, 'state') });
  const first = await store.initialize();
  await store.save({ revision: first.revision, widgetsYaml: '- resources:\n    cpu: true\n' });
  const exported = await store.exportCurrent();
  const state = JSON.parse(exported.files['state.json']);
  state.board.panels[0].look = { show: 'gauge' };
  exported.files['state.json'] = JSON.stringify(state);
  exported.files['settings.yaml'] = 'studioTheme:\n  card:\n    layout: quiet\n';
  const current = await store.load();
  const result = await store.importArchive({ revision: current.revision, archive: exported });
  assert.deepEqual(result.board.panels[0].look, { blocks: [{ id: 'b1', type: 'gauge' }] });
});
