// SPDX-License-Identifier: AGPL-3.0-or-later
// Integration regressions use only disposable temporary fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createConfigStore } from './config.mjs';
import { DISCOVERY_UPSTREAM_COMMIT } from './discovery.mjs';

const sid = n => `discovered-service-${n.toString(16).padStart(32, '0')}`;
const wid = n => `discovered-widget-${n.toString(16).padStart(32, '0')}`;
const source = (n = 1, widget = false) => ({
  id: widget ? wid(n) : sid(n), kind: widget ? 'serviceWidget' : 'service', title: `Discovered ${n}${widget ? ' · glances' : ''}`, group: 'Lab / Discovered',
  nativeLocator: { discovered: true, discoveryId: sid(n), serviceId: sid(n), origin: 'docker', groupPath: ['Lab', 'Discovered'], name: `Discovered ${n}`,
    ...(widget ? { widgetIndex: 0, sourceKey: 'widgets', sourceIndex: 0, proxyIndex: 0, type: 'glances' } : {}) },
});
const manifest = (sources = [source(), source(1, true)]) => ({ protocolVersion: 1, upstreamCommit: DISCOVERY_UPSTREAM_COMMIT, sources, warnings: [] });
const clone = value => structuredClone(value);

async function tree(root) {
  const result = {};
  async function walk(current, prefix = '') {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = `${prefix}${entry.name}`;
      if (entry.isDirectory()) await walk(path.join(current, entry.name), `${relative}/`);
      else result[relative] = await fs.readFile(path.join(current, entry.name), 'utf8');
    }
  }
  await walk(root);
  return result;
}

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'homepage-discovery-review-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const provider = { response: manifest(), error: null, calls: [] };
  const discoveryReader = async host => {
    provider.calls.push(host);
    if (provider.error) throw provider.error;
    return clone(provider.response);
  };
  const options = { configDir: path.join(root, 'config'), stateDir: path.join(root, 'state'), discoveryReader };
  const store = createConfigStore(options);
  await store.initialize();
  return { root, store, options, provider };
}

async function refresh(store) { await store.refreshDiscovery('dashboard.internal:3000'); return store.load(); }
function withStack(board) {
  const copy = clone(board);
  copy.stacks = [{ id: 'independent-discovery-stack', panelIds: [sid(1), wid(1)], rect: { x: 2, y: 20, w: 7, h: 5 }, playback: { mode: 'automatic', intervalMs: 17000, manualHoldMs: 30000, transition: 'horizontal', transitionDurationMs: 250, loop: true } }];
  return copy;
}
async function savedStack(store) {
  const current = await refresh(store);
  await store.saveBoard({ revision: current.revision, board: withStack(current.board) });
  return store.load();
}
const shape = board => ({
  version: board.version, columns: board.columns,
  panels: board.panels.map(({ id, kind, rect, nativeLocator }) => ({ id, kind, rect, nativeLocator })),
  stacks: board.stacks,
});

test('startup, readiness, recovery preparation and ordinary store reads never invoke native discovery', async t => {
  const { store, provider } = await fixture(t);
  assert.equal(provider.calls.length, 0);
  await store.checkReadiness();
  await store.prepareForNative();
  await store.load();
  await store.loadBoard();
  await store.listBackups();
  await store.exportCurrent();
  assert.equal(provider.calls.length, 0);
  await store.refreshDiscovery('dashboard.internal:3000');
  assert.deepEqual(provider.calls, ['dashboard.internal:3000']);
});

test('refresh and board/state reads expose native panels without changing any persisted byte or revision', async t => {
  const { root, store } = await fixture(t);
  const before = await tree(root), initial = await store.load();
  const current = await refresh(store);
  const board = await store.loadBoard();
  assert.equal(current.revision, initial.revision);
  assert.deepEqual(board.board.panels.map(panel => panel.id), [sid(1), wid(1)]);
  assert.ok(board.discoveredSources.every(entry => entry.available === true));
  assert.deepEqual(await tree(root), before);
  assert.deepEqual(await store.listBackups(), []);
});

test('an explicit board save persists safe source identities and stack settings through a discovery-free restart', async t => {
  const { root, store, provider, options } = await fixture(t);
  const nativeBefore = await tree(options.configDir);
  const current = await savedStack(store);
  const saved = JSON.parse(await fs.readFile(path.join(options.stateDir, 'state.json'), 'utf8'));
  assert.deepEqual(saved.discoveredSources, manifest().sources);
  assert.ok(saved.discoveredSources.every(entry => !Object.hasOwn(entry, 'available')));
  assert.deepEqual(saved.hiddenDiscoveredIds, []);
  assert.deepEqual(await tree(options.configDir), nativeBefore);
  assert.equal((await store.listBackups()).length, 1);
  const beforeRestart = await tree(root), calls = provider.calls.length;
  const restarted = await createConfigStore(options).load();
  assert.equal(provider.calls.length, calls);
  assert.equal(restarted.revision, current.revision);
  assert.deepEqual(shape(restarted.board), shape(current.board));
  assert.ok(restarted.discoveredSources.every(entry => entry.available === false));
  assert.deepEqual(await tree(root), beforeRestart);
});

test('provider outage and successful empty discovery preserve saved stack membership and geometry without writes', async t => {
  const { root, store, provider } = await fixture(t);
  const saved = await savedStack(store), before = await tree(root);
  provider.error = new Error('private token that must not escape');
  let current = await refresh(store);
  assert.deepEqual(shape(current.board), shape(saved.board));
  assert.ok(current.discoveredSources.every(entry => entry.available === false));
  assert.deepEqual(current.warnings.map(item => item.code), ['NATIVE_DISCOVERY_UNAVAILABLE']);
  assert.doesNotMatch(JSON.stringify(current.warnings), /private|token/);
  assert.deepEqual(await tree(root), before);
  provider.error = null; provider.response = manifest([]);
  current = await refresh(store);
  assert.deepEqual(shape(current.board), shape(saved.board));
  assert.ok(current.discoveredSources.every(entry => entry.available === false));
  assert.deepEqual(current.warnings, []);
  assert.deepEqual(await tree(root), before);
});

test('partial recovery updates availability per identity and preserves absent stack members on later save/restart', async t => {
  const { store, provider, options } = await fixture(t);
  const saved = await savedStack(store);
  provider.response = manifest([source(1)]);
  const partial = await refresh(store);
  assert.deepEqual(partial.discoveredSources.map(entry => [entry.id, entry.available]), [[sid(1), true], [wid(1), false]]);
  assert.deepEqual(shape(partial.board), shape(saved.board));
  const changed = clone(partial.board); changed.stacks[0].rect.y += 1;
  await store.saveBoard({ revision: partial.revision, board: changed });
  const restarted = await createConfigStore(options).load();
  assert.deepEqual(restarted.board.stacks, changed.stacks);
  assert.deepEqual(restarted.discoveredSources.map(entry => entry.id), [sid(1), wid(1)]);
});

test('hiding and restoring discovered panels changes only Studio preferences, keeps metadata and survives refresh/restart', async t => {
  const { store, options } = await fixture(t);
  const saved = await savedStack(store), nativeBefore = await tree(options.configDir);
  let current = await store.mutateDiscoveryVisibility({ revision: saved.revision, id: wid(1), hidden: true });
  assert.deepEqual(current.hiddenDiscoveredIds, [wid(1)]);
  assert.deepEqual(current.board.panels.map(panel => panel.id), [sid(1)]);
  assert.equal(current.discoveredSources.length, 2);
  assert.equal(current.board.stacks.length, 0);
  current = await refresh(store);
  assert.deepEqual(current.board.panels.map(panel => panel.id), [sid(1)]);
  const restartedStore = createConfigStore(options);
  current = await restartedStore.load();
  assert.deepEqual(current.hiddenDiscoveredIds, [wid(1)]);
  assert.equal(current.discoveredSources.length, 2);
  current = await restartedStore.mutateDiscoveryVisibility({ revision: current.revision, id: wid(1), hidden: false });
  assert.deepEqual(current.hiddenDiscoveredIds, []);
  assert.deepEqual(current.board.panels.map(panel => panel.id), [sid(1), wid(1)]);
  assert.deepEqual(await tree(options.configDir), nativeBefore);
});

test('snapshot restore recovers discovered visibility, original stack geometry/playback and retained identity', async t => {
  const { store, options } = await fixture(t);
  const saved = await savedStack(store);
  let current = await store.mutateDiscoveryVisibility({ revision: saved.revision, id: wid(1), hidden: true });
  const restoreVisible = (await store.listBackups()).find(backup => backup.revision === saved.revision);
  assert.ok(restoreVisible);
  current = await store.restoreBackup({ revision: current.revision, backupId: restoreVisible.id });
  assert.deepEqual(current.hiddenDiscoveredIds, []);
  assert.deepEqual(shape(current.board), shape(saved.board));
  current = await store.mutateDiscoveryVisibility({ revision: current.revision, id: wid(1), hidden: true });
  const hiddenRevision = current.revision;
  current = await store.mutateDiscoveryVisibility({ revision: current.revision, id: wid(1), hidden: false });
  const restoreHidden = (await store.listBackups()).find(backup => backup.revision === hiddenRevision);
  assert.ok(restoreHidden);
  current = await store.restoreBackup({ revision: current.revision, backupId: restoreHidden.id });
  assert.deepEqual(current.hiddenDiscoveredIds, [wid(1)]);
  assert.deepEqual(current.board.panels.map(panel => panel.id), [sid(1)]);
  const restarted = await createConfigStore(options).load();
  assert.deepEqual(restarted.hiddenDiscoveredIds, [wid(1)]);
  assert.equal(restarted.discoveredSources.length, 2);
});

test('malicious manifests never overwrite safe cache or place secret fields in state, backups or responses', async t => {
  const { root, store, provider } = await fixture(t);
  const saved = await savedStack(store);
  const secret = 'synthetic-discovery-secret-marker-94';
  provider.response = manifest();
  provider.response.sources[0].nativeLocator.config = { password: secret, url: `http://${secret}.invalid` };
  let current = await refresh(store);
  assert.deepEqual(shape(current.board), shape(saved.board));
  assert.ok(current.discoveredSources.every(entry => entry.available === false));
  assert.ok(!JSON.stringify(current).includes(secret));
  const board = clone(current.board); board.stacks[0].rect.y += 2;
  await store.saveBoard({ revision: current.revision, board });
  assert.ok(!JSON.stringify(await tree(root)).includes(secret));
  provider.response = { ...manifest(), upstreamCommit: 'wrong' };
  current = await refresh(store);
  assert.deepEqual(current.board.stacks, board.stacks);
  assert.equal(current.warnings[0].code, 'NATIVE_DISCOVERY_UNAVAILABLE');
});

test('invalid visibility preferences and stale mutations are rejected before any persistence', async t => {
  const { root, store } = await fixture(t);
  const saved = await savedStack(store), before = await tree(root);
  await assert.rejects(store.mutateDiscoveryVisibility({ revision: saved.revision, id: wid(99), hidden: true }), error => error.code === 'TILE_NOT_FOUND');
  await assert.rejects(store.mutateDiscoveryVisibility({ revision: saved.revision, id: wid(1), hidden: 'true' }), error => error.code === 'INVALID_ACTION');
  await assert.rejects(store.mutateDiscoveryVisibility({ revision: 'stale', id: wid(1), hidden: true }), error => error.code === 'REVISION_CONFLICT');
  await assert.rejects(store.save({ revision: saved.revision, hiddenDiscoveredIds: ['regular-native-widget'] }), error => error.code === 'INVALID_DISCOVERY_MANIFEST');
  await assert.rejects(store.save({ revision: saved.revision, hiddenDiscoveredIds: [wid(99)] }), error => error.code === 'TILE_NOT_FOUND');
  assert.deepEqual(await tree(root), before);
});

test('a discovery-only source arrival prevents saving an obsolete board despite unchanged file revision', async t => {
  const { root, store, provider } = await fixture(t);
  const saved = await savedStack(store), before = await tree(root);
  provider.response = manifest([source(), source(1, true), source(2)]);
  const refreshed = await refresh(store);
  assert.equal(refreshed.revision, saved.revision);
  assert.equal(refreshed.board.panels.length, 3);
  await assert.rejects(store.saveBoard({ revision: saved.revision, board: saved.board }), error => error.code === 'INVALID_BOARD');
  assert.deepEqual(await tree(root), before);
  assert.deepEqual(refreshed.board.stacks, saved.board.stacks);
});

test('external native YAML edits win over stale dashboard saves and are not overwritten by discovery state', async t => {
  const { root, store, options } = await fixture(t);
  const saved = await savedStack(store);
  const external = '- External:\n    - Native service:\n        href: https://example.invalid\n';
  await fs.writeFile(path.join(options.configDir, 'services.yaml'), external);
  const before = await tree(root);
  await assert.rejects(store.saveBoard({ revision: saved.revision, board: saved.board }), error => error.code === 'REVISION_CONFLICT');
  assert.deepEqual(await tree(root), before);
  assert.equal(await fs.readFile(path.join(options.configDir, 'services.yaml'), 'utf8'), external);
  const current = await store.load();
  assert.deepEqual(current.board.stacks, saved.board.stacks);
  assert.equal(current.board.panels.length, 3);
});

test('safe producer warnings survive reads without arbitrary exception text or state writes', async t => {
  const { root, store, provider } = await fixture(t);
  provider.response.warnings = [{ code: 'POSITIONAL_WIDGET_IDENTITY', count: 2 }, { code: 'AMBIGUOUS_NATIVE_SOURCE', count: 1 }];
  const before = await tree(root);
  const current = await refresh(store);
  assert.deepEqual(current.warnings.map(({ code, count }) => ({ code, count })), provider.response.warnings);
  assert.ok(current.warnings.every(warning => typeof warning.message === 'string' && warning.message.length > 0));
  assert.deepEqual(await tree(root), before);
});
