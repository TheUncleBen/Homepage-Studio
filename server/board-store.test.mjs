import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createConfigStore } from './config.mjs';
import { DEFAULT_PLAYBACK } from './board.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'homepage-studio-board-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const options = { configDir: path.join(root, 'config'), stateDir: path.join(root, 'state') };
  const store = createConfigStore(options);
  await store.initialize();
  return { store, options, ...options };
}
const clone = (value) => structuredClone(value);
const sample = `- Infrastructure:
    - Host:
        href: https://host.example.test
        widgets:
          - type: glances
            url: http://first.example.test
            metric: cpu
            password: synthetic-only-password
          - type: glances
            url: http://second.example.test
            metric: memory
        widget:
          type: portainer
          url: http://portainer.example.test
          env: 1
          key: '{{HOMEPAGE_FILE_PORTAINER_KEY}}'
`;

test('the board exposes independently addressable native content without raw widget configuration', async (t) => {
  const { store } = await fixture(t);
  const initial = await store.load();
  const current = await store.save({ revision: initial.revision, servicesYaml: sample,
    widgetsYaml: '- datetime:\n    format: { timeStyle: short }\n- search:\n    provider: google\n',
    bookmarksYaml: '- Reading:\n    - Homepage:\n        - href: https://gethomepage.dev\n          abbr: HP\n' });
  const envelope = await store.loadBoard();
  assert.equal(envelope.revision, current.revision);
  assert.deepEqual(envelope.board.panels.map((p) => p.kind), ['service', 'serviceWidget', 'serviceWidget', 'serviceWidget', 'informationWidget', 'informationWidget', 'bookmark']);
  assert.deepEqual(envelope.board.panels.filter((p) => p.kind === 'serviceWidget').map((p) => p.nativeLocator.proxyIndex), [0, 1, -1]);
  assert.deepEqual(envelope.board.panels.filter((p) => p.kind === 'serviceWidget').map((p) => p.nativeLocator.widgetIndex), [0, 1, 2]);
  assert.doesNotMatch(JSON.stringify(envelope), /synthetic-only-password|HOMEPAGE_FILE|portainer\.example|first\.example|"config"/);
  assert.equal(current.settingsConfig.constructor, Object);
});

test('mixed single and multiple service widgets retain identities through type changes, removal, insertion and restart', async (t) => {
  const { store, options } = await fixture(t);
  let current = await store.save({ revision: (await store.load()).revision, servicesYaml: sample });
  const [first, second, single] = current.serviceWidgets;
  current = await store.mutateServiceWidget({ revision: current.revision, action: 'update', id: second.id, type: 'customapi', config: { metric: null, mappings: [{ field: 'value', label: 'Value' }] } });
  assert.equal(current.serviceWidgets[1].id, second.id);
  assert.equal(current.serviceWidgets[1].type, 'customapi');
  assert.equal(current.serviceWidgets[1].config.metric, undefined);
  assert.equal(current.serviceWidgets[1].config.url, second.config.url);
  current = await store.mutateServiceWidget({ revision: current.revision, action: 'delete', id: first.id });
  assert.deepEqual(current.serviceWidgets.map((w) => w.id), [second.id, single.id]);
  assert.equal(current.serviceWidgets[0].sourceIndex, 0);
  current = await store.mutateServiceWidget({ revision: current.revision, action: 'add', serviceId: single.serviceId, type: 'uptimekuma', config: { url: 'http://status.example.test', slug: 'home' } });
  assert.equal(current.serviceWidgets[0].id, second.id);
  assert.equal(current.serviceWidgets[2].id, single.id);
  assert.deepEqual((await createConfigStore(options).load()).serviceWidgets.map((w) => w.id), current.serviceWidgets.map((w) => w.id));
  current = await store.mutateServiceWidget({ revision: current.revision, action: 'delete', id: single.id });
  assert.equal(current.services[0].config.widget, undefined);
  assert.equal(current.services[0].config.widgets.length, 2);
});

test('raw service-widget reorder reserves exact fingerprints before positional fallbacks', async (t) => {
  const { store } = await fixture(t);
  let current = await store.save({ revision: (await store.load()).revision, servicesYaml: sample });
  const ids = new Map(current.serviceWidgets.map((w) => [w.config.url, w.id]));
  const config = current.services[0].config;
  config.widgets.reverse();
  config.widgets.unshift({ type: 'glances', url: 'http://new.example.test', metric: 'disk' });
  current = await store.save({ revision: current.revision, servicesYaml: JSON.stringify([{ Infrastructure: [{ Host: config }] }]) });
  for (const widget of current.serviceWidgets.filter((w) => ids.has(w.config.url))) assert.equal(widget.id, ids.get(widget.config.url));
  assert.equal(new Set(current.serviceWidgets.map((w) => w.id)).size, 4);
});

test('a widget-only parent produces one panel and removing its last widget does not leave a blank service tile', async (t) => {
  const { store, options } = await fixture(t);
  let current = await store.mutateServiceWidget({ revision: (await store.load()).revision, action: 'add', newService: { name: 'Media usage', group: ['Home', 'Media'] }, type: 'jellyfin', config: { url: 'http://media.example.test', key: '{{HOMEPAGE_VAR_MEDIA_KEY}}' } });
  assert.equal(current.services.length, 1);
  assert.deepEqual(current.board.panels.map((p) => p.kind), ['serviceWidget']);
  current = await createConfigStore(options).mutateServiceWidget({ revision: current.revision, action: 'delete', id: current.serviceWidgets[0].id });
  assert.deepEqual(current.services, []);
  assert.deepEqual(current.board.panels, []);
});

test('deleting the last widget preserves an explicitly created or legacy id-only service after restart', async (t) => {
  const { store, options } = await fixture(t);
  let current = await store.mutateService({ revision: (await store.load()).revision, action: 'add', name: 'Explicit service', group: 'Home', config: {} });
  const id = current.services[0].id;
  current = await store.mutateServiceWidget({ revision: current.revision, action: 'add', serviceId: id, type: 'portainer', config: { url: 'http://portainer.example.test', env: 1 } });
  current = await createConfigStore(options).mutateServiceWidget({ revision: current.revision, action: 'delete', id: current.serviceWidgets[0].id });
  assert.equal(current.services[0].id, id);
  assert.equal(current.board.panels[0].id, id);
  current = await store.save({ revision: current.revision, servicesYaml: '- Home:\n    - Legacy:\n        id: studio-legacy\n        widget:\n          type: portainer\n' });
  current = await createConfigStore(options).mutateServiceWidget({ revision: current.revision, action: 'delete', id: current.serviceWidgets[0].id });
  assert.equal(current.services[0].id, 'studio-legacy');
  assert.equal(current.board.panels[0].kind, 'service');
});

test('service metadata stays visible when an independent widget has no service link', async (t) => {
  const { store } = await fixture(t);
  const current = await store.save({ revision: (await store.load()).revision, servicesYaml: '- Lab:\n    - Media:\n        description: Local media\n        icon: jellyfin.svg\n        widget:\n          type: jellyfin\n          url: http://media.example.test\n' });
  assert.deepEqual(current.board.panels.map((panel) => panel.kind), ['service', 'serviceWidget']);
});

test('raw YAML type edits retain both information and service-widget stack identities', async (t) => {
  const { store, options } = await fixture(t);
  let current = await store.save({ revision: (await store.load()).revision, servicesYaml: sample, widgetsYaml: '- datetime: {}\n- search: {}\n' });
  const serviceId = current.serviceWidgets[0].id, infoId = current.infoWidgets[0].id;
  const board = clone(current.board);
  board.stacks = [{ id: 'mixed-types', panelIds: [serviceId, infoId], rect: { x: 0, y: 20, w: 6, h: 4 }, playback: DEFAULT_PLAYBACK }];
  await store.saveBoard({ revision: current.revision, board });
  current = await store.load();
  const unchangedId = current.serviceWidgets[1].id;
  current = await store.save({ revision: current.revision, servicesYaml: current.servicesYaml.replace('type: glances', 'type: customapi'), widgetsYaml: '- greeting:\n    text: Hello\n- search: {}\n' });
  assert.equal(current.serviceWidgets[0].id, serviceId);
  assert.equal(current.serviceWidgets[1].id, unchangedId);
  assert.equal(current.infoWidgets[0].id, infoId);
  assert.deepEqual(current.board.stacks, board.stacks);
  const restarted = await createConfigStore(options).load();
  assert.deepEqual(restarted.board.stacks, board.stacks);
  assert.equal(restarted.board.panels.find((panel) => panel.id === serviceId).nativeLocator.type, 'customapi');
  assert.equal(restarted.board.panels.find((panel) => panel.id === infoId).nativeLocator.type, 'greeting');
});

test('bookmark editing preserves comments, extra option mappings and identity when renamed or moved', async (t) => {
  const { store, options } = await fixture(t);
  let current = await store.save({ revision: (await store.load()).revision, bookmarksYaml: '# Reading list\n- Reading:\n    - Homepage:\n        - href: https://gethomepage.dev # upstream docs\n          abbr: HP\n          customOption: keep\n        - preservedFuture: true\n' });
  const id = current.bookmarks[0].id;
  current = await store.mutateBookmark({ revision: current.revision, action: 'update', id, name: 'Dashboard docs', group: 'Tools', config: { description: 'Reference', abbr: null } });
  assert.equal(current.bookmarks[0].id, id);
  assert.equal(current.bookmarks[0].config.customOption, 'keep');
  assert.equal(current.bookmarks[0].config.abbr, undefined);
  assert.match(current.bookmarksYaml, /Reading list/);
  assert.match(current.bookmarksYaml, /upstream docs/);
  assert.match(current.bookmarksYaml, /preservedFuture: true/);
  assert.equal((await createConfigStore(options).load()).bookmarks[0].id, id);
  current = await store.mutateBookmark({ revision: current.revision, action: 'add', name: 'Other', group: 'Tools', config: { href: 'https://other.example.test' } });
  assert.equal(current.bookmarks.length, 2);
  current = await store.mutateBookmark({ revision: current.revision, action: 'delete', id });
  assert.equal(current.bookmarks[0].name, 'Other');
});

test('structured bookmark edits reject missing destinations and preserve native relative URLs and literal references', async (t) => {
  const { store } = await fixture(t);
  let current = await store.load();
  for (const config of [{}, { href: '' }, { href: '   ' }, { href: '/relative' }]) {
    await assert.rejects(store.mutateBookmark({ revision: current.revision, action: 'add', name: 'Broken', group: 'Home', config }), { code: 'INVALID_BOOKMARK' });
    assert.equal((await store.load()).revision, current.revision);
    assert.equal((await store.listBackups()).length, 0);
  }
  for (const [name, config] of [
    ['Absolute', { href: 'https://bookmark.example.test/path' }],
    ['Relative', { href: '/relative', description: 'Local page' }],
    ['Email', { href: 'mailto:user@example.test', description: 'Email' }],
    ['Reference', { href: '{{HOMEPAGE_VAR_BOOKMARK_URL}}' }],
  ]) current = await store.mutateBookmark({ revision: current.revision, action: 'add', name, group: 'Home', config });
  assert.equal(current.bookmarks.length, 4);
  assert.match(current.bookmarksYaml, /\{\{HOMEPAGE_VAR_BOOKMARK_URL\}\}/);
  const relative = current.bookmarks.find((entry) => entry.name === 'Relative');
  const count = (await store.listBackups()).length;
  await assert.rejects(store.mutateBookmark({ revision: current.revision, action: 'update', id: relative.id, config: { description: null } }), { code: 'INVALID_BOOKMARK' });
  assert.equal((await store.load()).revision, current.revision);
  assert.equal((await store.listBackups()).length, count);
});

test('all nine files participate in one validated save and retain opaque custom scripts and native placeholders', async (t) => {
  const { store, configDir } = await fixture(t);
  let current = await store.load();
  const extra = {
    dockerYaml: 'lab:\n  host: docker.example.test\n  port: 2376\n',
    kubernetesYaml: 'mode: default\n',
    proxmoxYaml: 'node:\n  url: https://node.example.test:8006\n  token: {{HOMEPAGE_FILE_PROXMOX_TOKEN}}\n',
    customCss: '.widget { color: #a790bb; }\n', customJs: 'window.userScript = () => ({ text: "not: yaml" });\n',
  };
  current = await store.save({ revision: current.revision, ...extra });
  for (const [field, text] of Object.entries(extra)) assert.equal(current[field], text);
  const before = current.revision, backups = (await store.listBackups()).length;
  await assert.rejects(store.save({ revision: before, customJs: 'should not save', dockerYaml: '[]\n' }));
  assert.equal((await store.load()).revision, before);
  assert.equal((await store.listBackups()).length, backups);
  assert.equal(await fs.readFile(path.join(configDir, 'custom.js'), 'utf8'), extra.customJs);
  current = await store.mutateSettings({ revision: current.revision, config: { title: 'Home', customOption: { nested: 'preserved' } } });
  current = await store.mutateSettings({ revision: current.revision, config: { title: 'Studio', background: null } });
  assert.deepEqual(current.settingsConfig.customOption, { nested: 'preserved' });
});

test('a board save persists stack settings and geometry, strips client metadata and checks revision', async (t) => {
  const { store, options } = await fixture(t);
  const current = await store.save({ revision: (await store.load()).revision, widgetsYaml: '- datetime: {}\n- search: {}\n- resources: {}\n' });
  const board = clone(current.board);
  board.stacks.push({ id: 'stack-test', panelIds: board.panels.slice(0, 2).map((p) => p.id), rect: { x: 0, y: 0, w: 4, h: 3 }, playback: { ...DEFAULT_PLAYBACK, mode: 'automatic' } });
  board.panels[0].nativeLocator = { password: 'must-not-persist' };
  board.panels[0].title = 'must-not-persist';
  const saved = await store.saveBoard({ revision: current.revision, board });
  assert.doesNotMatch(JSON.stringify(saved), /must-not-persist/);
  assert.equal(saved.board.stacks[0].playback.manualHoldMs, 30000);
  assert.equal(saved.board.stacks[0].playback.intervalMs, 10000);
  assert.deepEqual((await createConfigStore(options).loadBoard()).board, saved.board);
  await assert.rejects(store.saveBoard({ revision: current.revision, board }), { code: 'REVISION_CONFLICT' });
});

test('invalid board graphs, collisions, missing native panels and playback bounds reject before snapshot creation', async (t) => {
  const { store } = await fixture(t);
  const current = await store.save({ revision: (await store.load()).revision, widgetsYaml: '- datetime: {}\n- search: {}\n' });
  const base = current.board, ids = base.panels.map((p) => p.id);
  const invalid = [];
  let board = clone(base); board.panels[1].rect = clone(board.panels[0].rect); invalid.push(board);
  board = clone(base); board.panels.pop(); invalid.push(board);
  board = clone(base); board.panels[0].rect.w = 13; invalid.push(board);
  board = clone(base); board.stacks = [{ id: 'self', panelIds: [ids[0], 'self'], rect: base.panels[0].rect }]; invalid.push(board);
  board = clone(base); board.stacks = [{ id: 'repeat', panelIds: [ids[0], ids[0]], rect: base.panels[0].rect }]; invalid.push(board);
  for (const playback of [{ manualHoldMs: 0 }, { intervalMs: 0 }, { mode: 'auto' }, { transition: 'slide' }, { transitionDurationMs: 2001 }]) {
    board = clone(base); board.stacks = [{ id: 'stack', panelIds: ids, rect: base.panels[0].rect, playback }]; invalid.push(board);
  }
  const count = (await store.listBackups()).length;
  for (const value of invalid) await assert.rejects(store.saveBoard({ revision: current.revision, board: value }));
  assert.equal((await store.listBackups()).length, count);
  assert.equal((await store.load()).revision, current.revision);
});

test('removing a stacked source collapses a single-member stack into a free panel with stable identity', async (t) => {
  const { store } = await fixture(t);
  let current = await store.save({ revision: (await store.load()).revision, widgetsYaml: '- datetime: {}\n- search: {}\n' });
  const ids = current.board.panels.map((p) => p.id), board = clone(current.board);
  board.stacks = [{ id: 'stack', panelIds: ids, rect: { x: 4, y: 7, w: 5, h: 4 }, playback: DEFAULT_PLAYBACK }];
  await store.saveBoard({ revision: current.revision, board });
  current = await store.load();
  current = await store.mutateInfoWidget({ revision: current.revision, action: 'delete', id: ids[0] });
  assert.deepEqual(current.board.stacks, []);
  assert.equal(current.board.panels[0].id, ids[1]);
  assert.deepEqual(current.board.panels[0].rect, board.stacks[0].rect);
});

test('restoring a snapshot restores its board and source identities and exports do not create snapshots', async (t) => {
  const { store } = await fixture(t);
  let current = await store.save({ revision: (await store.load()).revision, widgetsYaml: '- datetime: {}\n- search: {}\n' });
  const board = clone(current.board);
  board.stacks = [{ id: 'stack', panelIds: board.panels.map((p) => p.id), rect: { x: 0, y: 2, w: 6, h: 4 }, playback: DEFAULT_PLAYBACK }];
  await store.saveBoard({ revision: current.revision, board });
  const before = await store.load();
  current = await store.mutateInfoWidget({ revision: before.revision, action: 'delete', id: before.infoWidgets[0].id });
  const backup = (await store.listBackups()).find((b) => b.revision === before.revision);
  const snapshot = await store.exportBackup(backup.id);
  assert.equal(Object.keys(snapshot.before).length, 10);
  const count = (await store.listBackups()).length;
  const exported = await store.exportCurrent();
  assert.equal(Object.keys(exported.files).length, 10);
  assert.equal((await store.listBackups()).length, count);
  current = await store.restoreBackup({ revision: current.revision, backupId: backup.id });
  assert.deepEqual(current.board, before.board);
  assert.deepEqual(current.infoWidgets, before.infoWidgets);
  assert.ok((await store.listBackups()).some((b) => b.revision !== before.revision));
});

test('legacy four-file transaction recovery and restore preserve newer optional files', async (t) => {
  const { store, options, configDir, stateDir } = await fixture(t);
  const current = await store.load(), before = {};
  for (const file of ['services.yaml', 'widgets.yaml', 'bookmarks.yaml', 'settings.yaml']) before[file] = await fs.readFile(path.join(configDir, file), 'utf8');
  before['state.json'] = null;
  const after = { ...before, 'settings.yaml': 'title: Interrupted\n' };
  const hash = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
  const backup = { version: 1, createdAt: '2026-01-01T00:00:00.000Z', revision: current.revision, changedFiles: ['settings.yaml'], before, afterHashes: Object.fromEntries(Object.entries(after).map(([k, v]) => [k, hash(v)])) };
  await fs.writeFile(path.join(stateDir, 'backups', 'backup-legacy.json'), JSON.stringify(backup));
  await fs.writeFile(path.join(configDir, 'settings.yaml'), after['settings.yaml']);
  await fs.writeFile(path.join(configDir, 'custom.css'), '/* newer user theme */');
  await fs.writeFile(path.join(stateDir, 'transaction.json'), JSON.stringify({ version: 1, backupId: 'backup-legacy' }));
  const restarted = createConfigStore(options);
  const recovered = await restarted.initialize();
  assert.equal(recovered.settingsYaml, before['settings.yaml']);
  assert.equal(recovered.customCss, '/* newer user theme */');
  const restored = await restarted.restoreBackup({ revision: recovered.revision, backupId: 'backup-legacy' });
  assert.equal(restored.customCss, recovered.customCss);
});

test('legacy layout is migrated without writing during reads, and unsupported state refuses silent reset', async (t) => {
  const { store, stateDir } = await fixture(t);
  const current = await store.mutateInfoWidget({ revision: (await store.load()).revision, action: 'add', type: 'datetime', config: {} });
  const info = current.infoWidgets[0], state = JSON.parse(await fs.readFile(path.join(stateDir, 'state.json'), 'utf8'));
  const legacy = { version: 1, infoWidgets: state.infoWidgets, layout: { version: 1, items: { [info.id]: { x: 3, y: 8, w: 4, h: 5 } } } };
  const bytes = JSON.stringify(legacy);
  await fs.writeFile(path.join(stateDir, 'state.json'), bytes);
  assert.deepEqual((await store.loadBoard()).board.panels[0].rect, legacy.layout.items[info.id]);
  assert.equal(await fs.readFile(path.join(stateDir, 'state.json'), 'utf8'), bytes);
  await fs.writeFile(path.join(stateDir, 'state.json'), '{"version":99}');
  await assert.rejects(store.loadBoard(), { code: 'INVALID_STATE' });
});

test('deeply nested YAML fails validation without changing files or creating a snapshot', async (t) => {
  const { store } = await fixture(t);
  const before = await store.load();
  await assert.rejects(store.save({ revision: before.revision, settingsYaml: 'nested: ' + '['.repeat(5000) + '1' + ']'.repeat(5000) }), { code: 'INVALID_YAML' });
  assert.equal((await store.load()).revision, before.revision);
  assert.deepEqual(await store.listBackups(), []);
});
