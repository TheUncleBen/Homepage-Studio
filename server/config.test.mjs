import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createConfigStore } from './config.mjs';
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';

const INITIAL = `# Ben's dashboard\n- Infrastructure:\n    # Firewall status\n    - pfSense:\n        href: https://firewall.example.test\n        icon: pfsense\n        widget:\n          type: pfsense\n          url: http://firewall.internal\n          key: {{HOMEPAGE_VAR_FIREWALL_KEY}} # keep this reference\n        customUnknown: keep-me\n    - Hosts:\n        - Portainer:\n            href: https://portainer.example.test\n            widget:\n              type: portainer\n              url: http://portainer.internal\n              env: 1\n              key: '{{HOMEPAGE_FILE_PORTAINER_KEY}}'\n- Media: []\n`;

async function fixture(t, services = INITIAL, storeOptions = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'homepage-studio-store-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const configDir = path.join(directory, 'config');
  const stateDir = path.join(directory, 'state');
  await fs.mkdir(configDir);
  await fs.writeFile(path.join(configDir, 'services.yaml'), services);
  await fs.writeFile(path.join(configDir, 'widgets.yaml'), '# Header widgets\n- datetime:\n    text_size: xl # readable clock\n- resources:\n    cpu: true\n    memory: true\n');
  await fs.writeFile(path.join(configDir, 'settings.yaml'), 'title: Ben\nlayout:\n  Infrastructure:\n    style: row\n    columns: 3\n');
  await fs.writeFile(path.join(configDir, 'bookmarks.yaml'), '- References:\n    - Homepage:\n        - href: https://gethomepage.dev\n          abbr: HP\n');
  for (const file of ['docker.yaml', 'kubernetes.yaml', 'proxmox.yaml']) await fs.writeFile(path.join(configDir, file), '{}\n');
  for (const file of ['custom.css', 'custom.js']) await fs.writeFile(path.join(configDir, file), '');
  const options = { configDir, stateDir, ...storeOptions };
  const store = createConfigStore(options);
  return { directory, configDir, stateDir, store, options };
}

test('load preserves secret references and exposes nested services without resolving environment values', async (t) => {
  const { store } = await fixture(t);
  process.env.HOMEPAGE_VAR_FIREWALL_KEY = 'must-never-enter-browser-output';
  t.after(() => { delete process.env.HOMEPAGE_VAR_FIREWALL_KEY; });
  const result = await store.load();
  assert.equal(result.services.length, 2);
  assert.deepEqual(result.services[1].groupPath, ['Infrastructure', 'Hosts']);
  assert.equal(result.services[1].group, 'Infrastructure / Hosts');
  assert.equal(result.services[0].config.widget.key, '{{HOMEPAGE_VAR_FIREWALL_KEY}}');
  assert.equal(result.services[1].config.widget.key, '{{HOMEPAGE_FILE_PORTAINER_KEY}}');
  assert.equal(result.servicesYaml, INITIAL);
  assert.ok(!JSON.stringify(result).includes('must-never-enter-browser-output'));
  assert.deepEqual(result.infoWidgets.map((widget) => widget.type), ['datetime', 'resources']);
});

test('invalid syntax or shape rejects the entire save without changing any file or creating a backup', async (t) => {
  const { store, configDir, stateDir } = await fixture(t);
  const before = await store.load();
  for (const changes of [
    { servicesYaml: '- broken: [unterminated' },
    { servicesYaml: 'not: a-service-list\n' },
    { settingsYaml: '- not-a-settings-mapping\n' },
    { bookmarksYaml: '- Docs:\n  - Wrong: scalar\n' },
    { widgetsYaml: '- resources: nope\n' },
    { servicesYaml: null },
    { layout: { version: 1, items: { invalid: { x: 0, y: 0, w: 0, h: 3 } } } },
  ]) {
    await assert.rejects(store.save({ revision: before.revision, settingsYaml: 'title: Must not be written\n', ...changes }), (error) => error.status === 422);
    assert.equal((await store.load()).revision, before.revision);
    assert.equal(await fs.readFile(path.join(configDir, 'services.yaml'), 'utf8'), INITIAL);
  }
  assert.deepEqual(await fs.readdir(path.join(stateDir, 'backups')), []);
});

test('optimistic revision rejects stale and simultaneous saves', async (t) => {
  const { store } = await fixture(t);
  const before = await store.load();
  const outcomes = await Promise.allSettled([
    store.save({ revision: before.revision, settingsYaml: 'title: First edit\n' }),
    store.save({ revision: before.revision, settingsYaml: 'title: Second edit\n' }),
  ]);
  assert.equal(outcomes.filter((entry) => entry.status === 'fulfilled').length, 1);
  const rejected = outcomes.find((entry) => entry.status === 'rejected');
  assert.equal(rejected.reason.code, 'REVISION_CONFLICT');
  assert.equal(rejected.reason.status, 409);
  await assert.rejects(store.save({ revision: before.revision, settingsYaml: 'title: Stale\n' }), { code: 'REVISION_CONFLICT' });
  assert.equal((await store.load()).settingsYaml, 'title: First edit\n');
});

test('nested add, edit, rename, move and delete retain unknown fields, comments and stable IDs', async (t) => {
  const { store, options } = await fixture(t);
  let result = await store.load();
  const firewall = result.services.find((entry) => entry.name === 'pfSense');
  result = await store.mutateService({ revision: result.revision, action: 'update', id: firewall.id, name: 'Firewall', config: { description: 'Network gateway', icon: null } });
  const updated = result.services.find((entry) => entry.name === 'Firewall');
  assert.equal(updated.id, firewall.id);
  assert.equal(updated.config.customUnknown, 'keep-me');
  assert.equal(updated.config.icon, undefined);
  assert.equal(updated.config.widget.key, '{{HOMEPAGE_VAR_FIREWALL_KEY}}');
  assert.match(result.servicesYaml, /# Ben's dashboard/);
  assert.match(result.servicesYaml, /# Firewall status/);
  assert.match(result.servicesYaml, /key: \{\{HOMEPAGE_VAR_FIREWALL_KEY\}\} # keep this reference/);
  result = await store.mutateService({ revision: result.revision, action: 'add', group: ['Infrastructure', 'Hosts'], name: 'New service', config: { href: 'http://new.example.test', widgets: [{ type: 'resources' }] } });
  const added = result.services.find((entry) => entry.name === 'New service');
  assert.match(added.config.id, /^studio-[a-f\d-]{36}$/);
  assert.equal(added.id, added.config.id);
  result = await store.mutateService({ revision: result.revision, action: 'update', id: added.id, name: 'Moved service', group: 'Media' });
  assert.equal(result.services.find((entry) => entry.id === added.id).group, 'Media');
  result = await store.save({ revision: result.revision, layout: { version: 1, items: { [added.id]: { x: 2, y: 5, w: 4, h: 3 } } } });
  const restarted = createConfigStore(options);
  assert.deepEqual((await restarted.load()).layout, result.layout);
  assert.equal((await restarted.load()).services.find((entry) => entry.name === 'Moved service').id, added.id);
  result = await restarted.mutateService({ revision: result.revision, action: 'delete', id: added.id });
  assert.ok(!result.services.some((entry) => entry.id === added.id));
  assert.equal(result.layout.items[added.id], undefined);
});

test('nested widget edits retain comments and unrelated options while null clears a whole native widget', async (t) => {
  const { store } = await fixture(t);
  let result = await store.load();
  const service = result.services[0];
  result = await store.mutateService({ revision: result.revision, action: 'update', id: service.id, config: { widget: { ...service.config.widget, url: 'http://replacement.internal' } } });
  assert.match(result.servicesYaml, /keep this reference/);
  assert.match(result.servicesYaml, /http:\/\/replacement.internal/);
  result = await store.mutateService({ revision: result.revision, action: 'update', id: service.id, config: { widget: null } });
  assert.equal(result.services[0].config.widget, undefined);
  assert.equal(result.services[0].config.customUnknown, 'keep-me');
});

test('new groups can be created; duplicate names and IDs fail without overwriting', async (t) => {
  const { store } = await fixture(t);
  let result = await store.load();
  result = await store.mutateService({ revision: result.revision, action: 'add', name: 'ntfy', group: ['Applications', 'Messaging'], config: { href: 'http://ntfy.example.test' } });
  assert.ok(result.groups.some((group) => group.label === 'Applications / Messaging'));
  await assert.rejects(store.mutateService({ revision: result.revision, action: 'add', name: 'ntfy', group: 'Applications / Messaging', config: {} }), { code: 'DUPLICATE_SERVICE' });
  await assert.rejects(store.save({ revision: result.revision, servicesYaml: '- Group:\n    - A:\n        id: same\n    - B:\n        id: same\n' }), { code: 'INVALID_CONFIG' });
  assert.equal((await store.load()).revision, result.revision);
});

test('information widget add/edit/type change/delete preserve identity across restart and exact reordering', async (t) => {
  const { store, options } = await fixture(t);
  let result = await store.load();
  const clock = result.infoWidgets.find((entry) => entry.type === 'datetime');
  result = await store.mutateInfoWidget({ revision: result.revision, action: 'update', id: clock.id, config: { text_size: '2xl', locale: 'en-US' } });
  assert.equal(result.infoWidgets[0].id, clock.id);
  assert.match(result.widgetsYaml, /# Header widgets/);
  assert.match(result.widgetsYaml, /readable clock/);
  result = await store.mutateInfoWidget({ revision: result.revision, action: 'add', type: 'customapi', config: { url: 'http://metrics.example.test', mappings: [{ field: 'count', label: 'Count' }] } });
  const added = result.infoWidgets.find((entry) => entry.type === 'customapi');
  assert.match(added.id, /^info-[a-f\d-]{36}$/);
  result = await store.mutateInfoWidget({ revision: result.revision, action: 'update', id: added.id, type: 'search', config: { url: null, mappings: null, provider: 'duckduckgo' } });
  const changed = result.infoWidgets.find((entry) => entry.type === 'search');
  assert.equal(changed.id, added.id);
  assert.deepEqual(changed.config, { provider: 'duckduckgo' });
  const restarted = createConfigStore(options);
  assert.deepEqual((await restarted.load()).infoWidgets, result.infoWidgets);
  result = await restarted.mutateInfoWidget({ revision: result.revision, action: 'delete', id: clock.id });
  assert.ok(!result.infoWidgets.some((entry) => entry.id === clock.id));
  assert.equal(result.infoWidgets.find((entry) => entry.type === 'search').id, added.id);
});

test('raw widget reordering keeps identity by configuration fingerprint', async (t) => {
  const { store } = await fixture(t);
  let result = await store.load();
  result = await store.save({ revision: result.revision, layout: result.layout });
  const before = Object.fromEntries(result.infoWidgets.map((entry) => [entry.type, entry.id]));
  result = await store.save({ revision: result.revision, widgetsYaml: '- resources:\n    cpu: true\n    memory: true\n- datetime:\n    text_size: xl\n' });
  assert.deepEqual(Object.fromEntries(result.infoWidgets.map((entry) => [entry.type, entry.id])), before);
});

test('inserting another information widget of the same type does not steal existing identities', async (t) => {
  const { store } = await fixture(t);
  let result = await store.load();
  result = await store.save({ revision: result.revision, widgetsYaml: '- resources:\n    cpu: true\n- resources:\n    memory: true\n' });
  const cpuId = result.infoWidgets[0].id;
  const memoryId = result.infoWidgets[1].id;
  result = await store.save({ revision: result.revision, widgetsYaml: '- resources:\n    disk: /\n- resources:\n    cpu: true\n- resources:\n    memory: true\n' });
  assert.equal(result.infoWidgets[1].id, cpuId);
  assert.equal(result.infoWidgets[2].id, memoryId);
  assert.notEqual(result.infoWidgets[0].id, cpuId);
  assert.equal(new Set(result.infoWidgets.map((entry) => entry.id)).size, 3);
});

test('editing a null document and anchored service options remains valid and preserves aliases', async (t) => {
  const { store } = await fixture(t, '# Empty dashboard\nnull\n');
  let result = await store.load();
  result = await store.mutateService({ revision: result.revision, action: 'add', name: 'First', config: { href: 'http://first.example.test' } });
  assert.equal(result.services[0].name, 'First');
  result = await store.save({ revision: result.revision, servicesYaml: '- Group:\n    - First:\n        href: &shared http://shared.example.test\n        widget:\n          type: customapi\n          url: *shared\n' });
  const originalId = result.services[0].id;
  result = await store.mutateService({ revision: result.revision, action: 'update', id: originalId, config: { description: 'Keep the original alias', widget: { ...result.services[0].config.widget, refreshInterval: 15000 } } });
  assert.match(result.servicesYaml, /&shared/);
  assert.match(result.servicesYaml, /\*shared/);
  assert.equal(result.services[0].config.widget.url, 'http://shared.example.test');
});

test('placeholder restoration preserves dollar replacement sequences literally', async (t) => {
  const source = '- Group:\n    - Service:\n        href: http://example.test\n        widget:\n          type: customapi\n          key: {{HOMEPAGE_VAR_DOLLAR_$&}}\n';
  const { store } = await fixture(t, source);
  let result = await store.load();
  assert.equal(result.services[0].config.widget.key, '{{HOMEPAGE_VAR_DOLLAR_$&}}');
  result = await store.mutateService({ revision: result.revision, action: 'update', id: result.services[0].id, config: { description: 'Retain literal placeholder' } });
  assert.match(result.servicesYaml, /\{\{HOMEPAGE_VAR_DOLLAR_\$&\}\}/);
  assert.ok(!result.servicesYaml.includes('HOMEPAGESTUDIOPLACEHOLDER'));
});

test('read rejects config symlinks without touching their target', async (t) => {
  const { store, configDir, directory } = await fixture(t);
  const target = path.join(directory, 'outside.yaml');
  await fs.writeFile(target, INITIAL);
  await fs.unlink(path.join(configDir, 'services.yaml'));
  await fs.symlink(target, path.join(configDir, 'services.yaml'));
  await assert.rejects(store.load(), { code: 'UNSAFE_PATH' });
  assert.equal(await fs.readFile(target, 'utf8'), INITIAL);
});

test('a symlinked state path and backup traversal are rejected', async (t) => {
  const { store, stateDir, directory, options } = await fixture(t);
  const before = await store.load();
  await assert.rejects(store.restoreBackup({ revision: before.revision, backupId: '../../services' }), { code: 'INVALID_BACKUP' });
  const outside = path.join(directory, 'outside-state');
  await fs.mkdir(outside);
  await fs.symlink(outside, path.join(directory, 'state-link'));
  await assert.rejects(createConfigStore({ ...options, stateDir: path.join(directory, 'state-link') }).load(), { code: 'UNSAFE_PATH' });
  const externalState = path.join(directory, 'external-state.json');
  await fs.writeFile(externalState, JSON.stringify({ version: 1, layout: { version: 1, items: {} } }));
  await fs.symlink(externalState, path.join(stateDir, 'state.json'));
  await assert.rejects(store.save({ revision: before.revision, settingsYaml: 'title: Change\n' }), { code: 'UNSAFE_PATH' });
});

test('saves keep a private exact backup and a restore creates a new reversible revision', async (t) => {
  const { store, stateDir } = await fixture(t);
  const before = await store.load();
  let result = await store.save({ revision: before.revision, settingsYaml: '# New title\ntitle: Studio\n', servicesYaml: '- New group: []\n' });
  const backups = await store.listBackups();
  assert.equal(backups.length, 1);
  const backupPath = path.join(stateDir, 'backups', `${backups[0].id}.json`);
  const backup = JSON.parse(await fs.readFile(backupPath, 'utf8'));
  assert.equal(backup.before['services.yaml'], INITIAL);
  assert.equal((await fs.stat(backupPath)).mode & 0o777, 0o600);
  result = await store.restoreBackup({ revision: result.revision, backupId: backups[0].id });
  assert.equal(result.servicesYaml, before.servicesYaml);
  assert.equal(result.settingsYaml, before.settingsYaml);
  assert.equal((await store.listBackups()).length, 2);
});

test('startup recovers an interrupted multi-file save from its durable journal', async (t) => {
  const { store, stateDir, configDir, options } = await fixture(t);
  const before = await store.load();
  await store.save({ revision: before.revision, servicesYaml: '- Changed: []\n', settingsYaml: 'title: Changed\n' });
  const [backup] = await store.listBackups();
  // Simulate a process stopping after the services replacement but before the settings replacement.
  await fs.writeFile(path.join(configDir, 'settings.yaml'), before.settingsYaml);
  await fs.writeFile(path.join(stateDir, 'transaction.json'), JSON.stringify({ version: 1, backupId: backup.id }));
  const recovered = await createConfigStore(options).load();
  assert.equal(recovered.revision, before.revision);
  assert.equal(recovered.servicesYaml, before.servicesYaml);
  await assert.rejects(fs.access(path.join(stateDir, 'transaction.json')), { code: 'ENOENT' });
});

test('recovery preserves unrelated external changes and refuses to overwrite them', async (t) => {
  const { store, stateDir, configDir, options } = await fixture(t);
  const before = await store.load();
  await store.save({ revision: before.revision, settingsYaml: 'title: Intended update\n' });
  const [backup] = await store.listBackups();
  await fs.writeFile(path.join(configDir, 'settings.yaml'), 'title: External edit after crash\n');
  await fs.writeFile(path.join(stateDir, 'transaction.json'), JSON.stringify({ version: 1, backupId: backup.id }));
  await assert.rejects(createConfigStore(options).load(), { code: 'RECOVERY_REQUIRED' });
  assert.equal(await fs.readFile(path.join(configDir, 'settings.yaml'), 'utf8'), 'title: External edit after crash\n');
  assert.ok((await fs.readdir(stateDir)).includes('transaction.json'));
});

test('empty config initializes a valid editor view and accepts a first native service', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'homepage-studio-empty-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = createConfigStore({ configDir: path.join(directory, 'config'), stateDir: path.join(directory, 'state') });
  let result = await store.load();
  assert.deepEqual(result.services, []);
  result = await store.mutateService({ revision: result.revision, action: 'add', name: 'First', group: 'Services', config: { href: 'http://service.example.test' } });
  assert.equal(result.services[0].name, 'First');
});

test('generated identity state over the read limit rejects before any backup or configuration commit', async (t) => {
  const { store, configDir, stateDir } = await fixture(t);
  const before = await store.load();
  const originalFiles = Object.fromEntries(await Promise.all(['services.yaml', 'widgets.yaml', 'settings.yaml', 'bookmarks.yaml'].map(async (name) => [name, await fs.readFile(path.join(configDir, name), 'utf8')])));
  const widgetsYaml = '- datetime: {}\n'.repeat(16000);
  assert.ok(Buffer.byteLength(widgetsYaml) < 2 * 1024 * 1024, 'The accepted input size is smaller than the generated state.');
  await assert.rejects(store.save({ revision: before.revision, widgetsYaml, settingsYaml: 'title: Must not be committed\n' }), { code: 'CONFIG_SIZE_LIMIT', status: 422 });
  for (const [name, expected] of Object.entries(originalFiles)) assert.equal(await fs.readFile(path.join(configDir, name), 'utf8'), expected);
  assert.equal((await store.load()).revision, before.revision);
  assert.deepEqual(await store.listBackups(), []);
  await assert.rejects(fs.access(path.join(stateDir, 'state.json')), { code: 'ENOENT' });
  await assert.rejects(fs.access(path.join(stateDir, 'transaction.json')), { code: 'ENOENT' });
  const next = await store.save({ revision: before.revision, settingsYaml: 'title: Editor still usable\n' });
  assert.equal(next.settingsYaml, 'title: Editor still usable\n');
});

test('default retention keeps the newest 25 pre-save snapshots and restore stays reversible', async (t) => {
  const { store } = await fixture(t);
  let current = await store.load();
  assert.equal(current.backupRetention, 25);
  const previous = [];
  for (let i = 0; i < 30; i++) {
    previous.push(current);
    current = await store.save({ revision: current.revision, settingsYaml: `title: Revision ${i}\n` });
  }
  const backups = await store.listBackups();
  assert.equal(backups.length, 25);
  assert.deepEqual(new Set(backups.map((backup) => backup.revision)), new Set(previous.slice(-25).map((state) => state.revision)));
  const restore = backups.find((backup) => backup.revision === previous[5].revision);
  const restored = await store.restoreBackup({ revision: current.revision, backupId: restore.id });
  assert.equal(restored.settingsYaml, previous[5].settingsYaml);
  const afterRestore = await store.listBackups();
  assert.equal(afterRestore.length, 25);
  assert.ok(afterRestore.some((backup) => backup.revision === current.revision), 'The state before restore remains in history.');
});

test('retention is configurable and rejects invalid values instead of silently rounding or disabling backups', async (t) => {
  const { store, options } = await fixture(t, INITIAL, { backupRetention: 2 });
  let current = await store.load();
  for (let i = 0; i < 4; i++) current = await store.save({ revision: current.revision, settingsYaml: `title: Revision ${i}\n` });
  assert.equal((await store.listBackups()).length, 2);
  assert.equal(current.backupRetention, 2);
  for (const backupRetention of [0, -1, 1.5, NaN, Infinity, '25']) {
    assert.throws(() => createConfigStore({ ...options, backupRetention }), { code: 'INVALID_STORE_OPTIONS' });
  }
});

test('startup recovers an old journal before reducing snapshot retention', async (t) => {
  const { store, options, configDir, stateDir } = await fixture(t, INITIAL, { backupRetention: 5 });
  const before = await store.load();
  let current = await store.save({ revision: before.revision, servicesYaml: '- Partial: []\n', settingsYaml: 'title: First\n' });
  const [recoveryBackup] = await store.listBackups();
  current = await store.save({ revision: current.revision, settingsYaml: 'title: Second\n' });
  await store.save({ revision: current.revision, settingsYaml: 'title: Third\n' });
  await fs.writeFile(path.join(configDir, 'settings.yaml'), before.settingsYaml);
  await fs.writeFile(path.join(stateDir, 'transaction.json'), JSON.stringify({ version: 1, backupId: recoveryBackup.id }));
  const restarted = createConfigStore({ ...options, backupRetention: 1 });
  assert.equal((await restarted.initialize()).revision, before.revision);
  await assert.rejects(fs.access(path.join(stateDir, 'transaction.json')), { code: 'ENOENT' });
  assert.equal((await restarted.listBackups()).length, 1);
});

test('failed recovery preserves its old snapshot and all history even when the new retention cap is smaller', async (t) => {
  const { store, options, configDir, stateDir } = await fixture(t, INITIAL, { backupRetention: 5 });
  let current = await store.load();
  current = await store.save({ revision: current.revision, settingsYaml: 'title: First\n' });
  const [recoveryBackup] = await store.listBackups();
  current = await store.save({ revision: current.revision, settingsYaml: 'title: Second\n' });
  await store.save({ revision: current.revision, settingsYaml: 'title: Third\n' });
  await fs.writeFile(path.join(configDir, 'settings.yaml'), 'title: External edit\n');
  await fs.writeFile(path.join(stateDir, 'transaction.json'), JSON.stringify({ version: 1, backupId: recoveryBackup.id }));
  await assert.rejects(createConfigStore({ ...options, backupRetention: 1 }).initialize(), { code: 'RECOVERY_REQUIRED' });
  assert.equal((await fs.readdir(path.join(stateDir, 'backups'))).length, 3);
  await fs.access(path.join(stateDir, 'backups', `${recoveryBackup.id}.json`));
  await fs.access(path.join(stateDir, 'transaction.json'));
  assert.equal(await fs.readFile(path.join(configDir, 'settings.yaml'), 'utf8'), 'title: External edit\n');
});

test('retention cleanup failure reports a warning without turning a committed save into a failed request', async (t) => {
  const { store, stateDir } = await fixture(t, INITIAL, { backupRetention: 1 });
  let current = await store.load();
  current = await store.save({ revision: current.revision, settingsYaml: 'title: First\n' });
  const [old] = await store.listBackups();
  const oldPath = path.join(stateDir, 'backups', `${old.id}.json`);
  const unlink = fs.unlink;
  fs.unlink = async (file, ...args) => {
    if (file === oldPath) throw Object.assign(new Error('Injected history permission failure'), { code: 'EACCES' });
    return unlink.call(fs, file, ...args);
  };
  try {
    const saved = await store.save({ revision: current.revision, settingsYaml: 'title: Saved despite cleanup failure\n' });
    assert.notEqual(saved.revision, current.revision);
    assert.equal(saved.settingsYaml, 'title: Saved despite cleanup failure\n');
    assert.equal(saved.warnings[0]?.code, 'BACKUP_RETENTION_FAILED');
    assert.equal((await store.listBackups()).length, 2);
    await assert.rejects(store.checkReadiness(), { code: 'BACKUP_RETENTION_FAILED', status: 503 });
    await assert.rejects(fs.access(path.join(stateDir, 'transaction.json')), { code: 'ENOENT' });
  } finally { fs.unlink = unlink; }
  await store.checkReadiness();
  assert.equal((await store.listBackups()).length, 1);
  assert.deepEqual((await store.load()).warnings, []);
});

test('initialization persists all nine empty native files before reporting readiness', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'homepage-studio-readiness-empty-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = createConfigStore({ configDir: path.join(directory, 'config'), stateDir: path.join(directory, 'state') });
  assert.deepEqual((await store.initialize()).services, []);
  assert.equal((await store.checkReadiness()).configuration, 'ok');
  assert.deepEqual((await fs.readdir(path.join(directory, 'config'))).sort(), ['bookmarks.yaml', 'custom.css', 'custom.js', 'docker.yaml', 'kubernetes.yaml', 'proxmox.yaml', 'services.yaml', 'settings.yaml', 'widgets.yaml']);
  await fs.unlink(path.join(directory, 'config', 'docker.yaml'));
  await assert.rejects(store.checkReadiness(), { code: 'CONFIG_NOT_INITIALIZED', status: 503 });
});

test('an injected mid-save storage failure restores the exact previous revision before pruning old history', async (t) => {
  const { store, configDir, stateDir } = await fixture(t, INITIAL, { backupRetention: 1 });
  const initial = await store.load();
  const before = await store.save({ revision: initial.revision, settingsYaml: 'title: Before injected failure\n' });
  const rename = fs.rename;
  let injected = false;
  fs.rename = async (from, to, ...args) => {
    if (!injected && to === path.join(configDir, 'settings.yaml')) {
      injected = true;
      throw Object.assign(new Error('Injected mid-transaction failure'), { code: 'EIO' });
    }
    return rename.call(fs, from, to, ...args);
  };
  try {
    await assert.rejects(store.save({ revision: before.revision, servicesYaml: '- Must roll back: []\n', settingsYaml: 'title: Must roll back\n' }), { code: 'EIO' });
  } finally { fs.rename = rename; }
  assert.equal(injected, true);
  assert.equal((await store.load()).revision, before.revision);
  await assert.rejects(fs.access(path.join(stateDir, 'transaction.json')), { code: 'ENOENT' });
  const backups = await store.listBackups();
  assert.equal(backups.length, 1);
  assert.equal(backups[0].revision, before.revision);
});

test('snapshot retention follows commit order through tied clocks, clock rollback and a writer restart', async (t) => {
  const { store, options } = await fixture(t, INITIAL, { backupRetention: 3 });
  const RealDate = globalThis.Date, realRandomUUID = crypto.randomUUID;
  let clock = RealDate.parse('2026-01-01T12:00:00.000Z'), sequence = 1000000;
  globalThis.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  };
  // Descending UUIDs deliberately oppose insertion order when time is tied.
  crypto.randomUUID = () => `00000000-0000-4000-8000-${(sequence--).toString(16).padStart(12, '0')}`;
  syncBuiltinESMExports();
  const before = [];
  try {
    let current = await store.load(), active = store;
    for (let i = 0; i < 8; i++) {
      if (i === 4) { clock -= 3600000; active = createConfigStore(options); }
      before.push(current.revision);
      current = await active.mutateSettings({ revision: current.revision, config: { title: `Operation ${i}` } });
    }
    const backups = await active.listBackups();
    assert.deepEqual(backups.map((entry) => entry.revision), before.slice(-3).reverse());
    assert.equal(new Set(backups.map((entry) => entry.id)).size, 3);
    assert.ok(backups.every((entry) => entry.createdAt === new RealDate(clock).toISOString()), 'Display dates retain the real wall clock.');
    const restored = await active.restoreBackup({ revision: current.revision, backupId: backups[0].id });
    assert.equal(restored.settingsConfig.title, 'Operation 6');
  } finally {
    globalThis.Date = RealDate;
    crypto.randomUUID = realRandomUUID;
    syncBuiltinESMExports();
  }
});
