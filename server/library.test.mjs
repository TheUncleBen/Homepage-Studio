import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';
import { connectionIdsOf, createLibrary, LIBRARY_FILE, publicEntry, validWidget } from './library.mjs';
import { placeholder } from './connections.mjs';

const tempDir = async (t) => {
  const dir = await fs.mkdtemp(join(os.tmpdir(), 'studio-library-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
};
const widget = {
  kind: 'serviceWidget',
  type: 'pfsense',
  title: 'pfSense',
  config: { url: 'https://fw.example.test', key: 'typed-secret', version: 2, type: 'ignored' },
  service: { href: 'https://fw.example.test', ping: 'fw.example.test', siteMonitor: '' },
  look: { corners: 'round' },
  // Never kept: size and place belong to each dashboard's layout.
  rect: { x: 0, y: 0, w: 10, h: 5 },
  pageId: 'home',
};

test('a saved widget keeps its configuration only, privately, and shows only its name and type', async (t) => {
  const dir = await tempDir(t);
  const library = createLibrary({ dir });
  const entry = await library.add({ kind: 'widget', name: 'Firewall', widget });
  assert.deepEqual(Object.keys(entry.widget).sort(), ['config', 'kind', 'look', 'service', 'title', 'type']);
  assert.equal(entry.widget.config.type, undefined);
  assert.deepEqual(entry.widget.service, { href: 'https://fw.example.test', ping: 'fw.example.test' });
  assert.equal((await fs.stat(join(dir, LIBRARY_FILE))).mode & 0o777, 0o600);
  const shown = publicEntry(entry, 'dashboard');
  assert.deepEqual(Object.keys(shown).sort(), ['id', 'kind', 'name', 'scope', 'type', 'updatedAt', 'widgetKind']);
  assert.doesNotMatch(JSON.stringify(shown), /typed-secret|fw\.example/);
  await assert.rejects(library.add({ kind: 'widget', name: 'firewall', widget }), { code: 'LIBRARY_NAME_TAKEN' });
  const renamed = await library.update(entry.id, { name: 'Edge firewall' });
  assert.equal(renamed.name, 'Edge firewall');
  await library.remove(entry.id);
  assert.deepEqual(await library.list(), []);
});

test('saved looks: look settings only, and none on a dashboard library', async (t) => {
  const dir = await tempDir(t);
  const mine = createLibrary({ dir });
  const look = await mine.add({ kind: 'look', name: 'Night', look: { fill: 'tint', corners: 'round' } });
  assert.deepEqual(publicEntry(look, 'me').look, { fill: 'tint', corners: 'round' });
  await assert.rejects(mine.add({ kind: 'look', name: 'Bad', look: { corners: 'wobbly' } }));
  await assert.rejects(mine.add({ kind: 'look', name: 'Empty', look: {} }), /needs look settings/);
  const dashboard = createLibrary({ dir, file: 'other.json', looks: false });
  await assert.rejects(dashboard.add({ kind: 'look', name: 'Night', look: { fill: 'tint' } }), /arrangement/);
});

test('a saved widget finds the saved connections it uses', () => {
  const config = { url: placeholder('ABCDEF0123456789', 'url'), key: placeholder('ABCDEF0123456789', 'key') };
  assert.deepEqual(connectionIdsOf(config), ['ABCDEF0123456789']);
  assert.throws(() => validWidget({ kind: 'service', type: 'x', config: {} }), /cannot be saved/);
  assert.throws(() => validWidget({ ...widget, title: '' }), /1 to 60/);
});

test('a library never grows past what it can read back, so entries can always be listed and deleted', async (t) => {
  const library = createLibrary({ dir: await tempDir(t) });
  const big = { ...widget, config: { url: 'https://fw.example.test', note: 'x'.repeat(60 * 1024) } };
  let saved = 0;
  let refusal;
  for (let i = 0; i < 100 && !refusal; i++) {
    try { await library.add({ kind: 'widget', name: `Big ${i}`, widget: big }); saved++; }
    catch (error) { refusal = error; }
  }
  assert.equal(refusal?.code, 'LIBRARY_FULL');
  const list = await library.list();
  assert.equal(list.length, saved);
  await library.remove(list[0].id);
  await library.add({ kind: 'widget', name: 'Fits again', widget: big });
});
