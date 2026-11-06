import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createConnectionStore } from './connections.mjs';
import { createImageLibrary } from './image-library.mjs';
import { createLibrary, SHARED_LIBRARY_FILE } from './library.mjs';
import { createPersonalStore } from './personal.mjs';
import { createSavedItems } from './saved-items.mjs';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const USER = '0123abcd-0000-4000-8000-00000000abcd';

async function setup() {
  const root = await fs.mkdtemp(join(tmpdir(), 'studio-saved-'));
  const personal = createPersonalStore({ stateRoot: root });
  const sharedLibrary = createLibrary({ dir: root, file: SHARED_LIBRARY_FILE, looks: false });
  const dashboardDir = join(root, 'dash');
  const dashboard = { id: 'default', name: 'Main dashboard', stores: { library: createLibrary({ dir: dashboardDir, looks: false }), connections: createConnectionStore({ dir: dashboardDir }), images: createImageLibrary({ stateDir: dashboardDir }) } };
  const saved = createSavedItems({ personal, sharedLibrary, dashboards: async () => [dashboard], users: async () => [{ id: USER, username: 'ben', displayName: 'Ben' }] });
  return { personal, sharedLibrary, dashboard, saved };
}

test('My account › Saved lists my items with where copies are used, and renames and deletes them', async () => {
  const { personal, dashboard, saved } = await setup();
  const me = personal.forUser(USER);
  const connection = await me.connections.add({ name: 'NAS', url: 'https://nas.example.org', key: 'secret-key' }, { by: 'ben' });
  await dashboard.stores.connections.add({ name: 'NAS', url: 'https://nas.example.org' }, { id: connection.id });
  const logo = await me.images.add({ kind: 'logo', name: 'nas.png', image: PNG, by: 'ben' });
  await me.library.add({ kind: 'look', name: 'Calm', look: { fill: 'tint' } }, { by: 'ben' });
  const { items } = await saved.mine(USER);
  assert.deepEqual(items.map(item => item.kind).sort(), ['connection', 'logo', 'look']);
  const nas = items.find(item => item.kind === 'connection');
  assert.equal(nas.detail, 'nas.example.org');
  assert.deepEqual(nas.usedOn, ['Main dashboard']);
  assert.equal(JSON.stringify(items).includes('secret-key'), false, 'keys never listed');
  assert.deepEqual(items.find(item => item.kind === 'logo').usedOn, []);
  await saved.changeMine(USER, { action: 'rename', kind: 'logo', id: logo.id, name: 'NAS logo' });
  const after = await saved.changeMine(USER, { action: 'delete', kind: 'connection', id: connection.id });
  assert.equal(after.items.find(item => item.kind === 'logo').name, 'NAS logo');
  assert.equal(after.items.some(item => item.kind === 'connection'), false);
  assert.equal((await dashboard.stores.connections.list()).length, 1, 'the dashboard keeps its copy');
  await assert.rejects(saved.changeMine(USER, { action: 'rename', kind: 'logo', id: logo.id, name: '  ' }), /Give it a name/);
  await assert.rejects(saved.changeMine(USER, { action: 'delete', kind: 'background', id: logo.id }), /no longer exists/);
});

test('Administration › Saved items shows everyone’s with owner and place; dashboard connections are managed in its settings', async () => {
  const { personal, dashboard, sharedLibrary, saved } = await setup();
  const widget = { kind: 'informationWidget', type: 'datetime', config: {} };
  await sharedLibrary.add({ kind: 'widget', name: 'Clock', widget }, { by: 'admin' });
  const local = await dashboard.stores.library.add({ kind: 'widget', name: 'Local clock', widget }, { by: 'ben' });
  const conn = await dashboard.stores.connections.add({ name: 'Router', url: 'https://router.example.org' }, { by: 'ben' });
  await personal.forUser(USER).library.add({ kind: 'look', name: 'Mine', look: { fill: 'solid' } }, { by: 'ben' });
  const { items } = await saved.all();
  const byName = Object.fromEntries(items.map(item => [item.name, item]));
  assert.equal(byName.Clock.place.type, 'everyone');
  assert.equal(byName.Clock.owner, 'admin');
  assert.equal(byName['Local clock'].place.name, 'Main dashboard');
  assert.equal(byName.Router.canChange, false);
  assert.equal(byName.Mine.owner, 'Ben');
  await assert.rejects(saved.changeAny({ action: 'delete', place: { type: 'dashboard', id: 'default' }, kind: 'connection', id: conn.id }), /in its settings/);
  const after = await saved.changeAny({ action: 'delete', place: { type: 'dashboard', id: 'default' }, kind: 'widget', id: local.id });
  assert.equal(after.items.some(item => item.name === 'Local clock'), false);
  await assert.rejects(saved.changeAny({ action: 'delete', place: { type: 'person', id: '0123abcd-0000-4000-8000-00000000ffff' }, kind: 'look', id: 'abc' }), /no longer exists/);
});

// UI review of the 65f724c feedback build (L4): a saved widget's type shows
// by its catalog name.
test('a saved widget is listed by its widget name, not its type key', async () => {
  const { sharedLibrary, personal, dashboard } = await setup();
  const saved = createSavedItems({ personal, sharedLibrary, dashboards: async () => [dashboard], users: async () => [], widgetName: async (type) => ({ customapi: 'Custom API' })[type] || type });
  await dashboard.stores.library.add({ kind: 'widget', name: 'Tracker', widget: { kind: 'serviceWidget', type: 'customapi', title: 'Tracker', config: { url: 'https://api.example.test' }, service: {} } });
  const { items } = await saved.all();
  assert.equal(items.find(item => item.name === 'Tracker').detail, 'Custom API');
});
