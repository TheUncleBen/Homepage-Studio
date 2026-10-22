// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createConfigStore } from './config.mjs';
import { DISCOVERY_UPSTREAM_COMMIT } from './discovery.mjs';

const source = number => {
  const id = `discovered-service-${number.toString(16).padStart(32, '0')}`;
  return { id, kind: 'service', title: `Source ${number}`, group: 'Lab', nativeLocator: {
    discovered: true, discoveryId: id, serviceId: id, origin: 'docker', groupPath: ['Lab'], name: `Source ${number}`,
  } };
};
const manifest = sources => ({ protocolVersion: 1, upstreamCommit: DISCOVERY_UPSTREAM_COMMIT, sources, warnings: [] });

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-discovery-concurrency-'));
  const provider = { calls: 0, response: manifest([source(1)]), pending: null };
  const configDir = path.join(root, 'config');
  const store = createConfigStore({ configDir, stateDir: path.join(root, 'state'), discoveryReader: async () => {
    provider.calls += 1;
    const response = structuredClone(provider.response);
    const pending = provider.pending;
    if (pending) { pending.entered.resolve(); await pending.release.promise; }
    return response;
  } });
  t.after(async () => { provider.pending?.release.resolve(); await fs.rm(root, { recursive: true, force: true }); });
  await store.initialize();
  return { root, configDir, store, provider };
}
function hold(provider) {
  const pending = { entered: Promise.withResolvers(), release: Promise.withResolvers() };
  provider.pending = pending;
  return { started: pending.entered.promise, release() { pending.release.resolve(); if (provider.pending === pending) provider.pending = null; } };
}
async function withoutProvider(operation) {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Local operation waited for the held native provider')), 2000); }),
    ]);
  } finally { clearTimeout(timer); }
}

test('pending native discovery does not hold local read, readiness or recovery operations', async t => {
  const { store, provider } = await fixture(t);
  const before = await store.load();
  const gate = hold(provider);
  const refresh = store.refreshDiscovery('dashboard.example.test');
  try {
    await gate.started;
    const [, readiness, loaded, board] = await withoutProvider(Promise.all([
      store.prepareForNative(), store.checkReadiness(), store.load(), store.loadBoard(),
    ]));
    assert.equal(readiness.configuration, 'ok');
    assert.equal(loaded.revision, before.revision);
    assert.equal(board.revision, before.revision);
    assert.equal(provider.calls, 1);
  } finally { gate.release(); await refresh; }
  assert.equal((await store.loadBoard()).board.panels.length, 1);
});

test('concurrent refresh requests share one native read and permit a later fresh read', async t => {
  const { store, provider } = await fixture(t);
  const gate = hold(provider);
  const first = store.refreshDiscovery('dashboard.example.test');
  const second = store.refreshDiscovery('dashboard.example.test');
  assert.equal(first, second);
  try {
    await gate.started;
    const third = store.refreshDiscovery('dashboard.example.test');
    assert.equal(third, first);
    assert.equal(provider.calls, 1);
  } finally { gate.release(); await Promise.all([first, second]); }
  await store.refreshDiscovery('dashboard.example.test');
  assert.equal(provider.calls, 2);
});

test('a native configuration save completes during discovery and rejects its stale response', async t => {
  const { store, provider } = await fixture(t);
  await store.refreshDiscovery('dashboard.example.test');
  const before = await store.load();
  provider.response = manifest([source(2)]);
  const gate = hold(provider);
  const refresh = store.refreshDiscovery('dashboard.example.test');
  try {
    await gate.started;
    const saved = await withoutProvider(store.mutateSettings({ revision: before.revision, config: { title: 'Changed during provider read' } }));
    assert.notEqual(saved.configurationRevision, before.configurationRevision);
  } finally { gate.release(); await refresh; }
  const after = await store.load();
  assert.equal(after.settingsConfig.title, 'Changed during provider read');
  assert.deepEqual(after.discoveredSources.map(value => value.id), [source(1).id]);
  assert.equal(after.discoveredSources[0].available, false);
  assert.match(after.warnings[0].message, /Configuration changed/);
  await store.refreshDiscovery('dashboard.example.test');
  assert.equal((await store.load()).discoveredSources.find(value => value.id === source(2).id).available, true);
});

test('a replace-and-rollback to identical native bytes cannot publish intervening discovery data', async t => {
  const { store, provider, configDir } = await fixture(t);
  await store.refreshDiscovery('dashboard.example.test');
  const before = await store.load();
  const target = path.join(configDir, 'settings.yaml');
  const original = await fs.readFile(target);
  provider.response = manifest([source(2)]);
  const gate = hold(provider);
  const refresh = store.refreshDiscovery('dashboard.example.test');
  try {
    await gate.started;
    const temporary = path.join(configDir, 'synthetic-settings-replacement');
    await fs.writeFile(temporary, 'title: Intervening configuration\n'); await fs.rename(temporary, target);
    await fs.writeFile(temporary, original); await fs.rename(temporary, target);
    assert.equal((await withoutProvider(store.load())).configurationRevision, before.configurationRevision);
  } finally { gate.release(); await refresh; }
  const after = await store.load();
  assert.equal(after.configurationRevision, before.configurationRevision);
  assert.deepEqual(after.discoveredSources.map(value => value.id), [source(1).id]);
  assert.equal(after.discoveredSources[0].available, false);
});

test('layout-only saves do not discard a still-current native discovery response', async t => {
  const { store, provider } = await fixture(t);
  await store.refreshDiscovery('dashboard.example.test');
  const before = await store.load();
  provider.response = manifest([source(1), source(2)]);
  const gate = hold(provider);
  const refresh = store.refreshDiscovery('dashboard.example.test');
  try {
    await gate.started;
    const board = structuredClone(before.board); board.panels[0].rect.y += 50;
    const saved = await withoutProvider(store.saveBoard({ revision: before.revision, board }));
    assert.notEqual(saved.revision, before.revision);
    assert.equal(saved.configurationRevision, before.configurationRevision);
  } finally { gate.release(); await refresh; }
  const after = await store.load();
  assert.equal(after.discoveredSources.find(value => value.id === source(2).id).available, true);
  assert.equal(after.board.panels.find(value => value.id === source(1).id).rect.y, before.board.panels[0].rect.y + 50);
});

test('an oversized retained/fresh union degrades to the safe retained sources', async t => {
  const { store, provider } = await fixture(t);
  provider.response = manifest(Array.from({ length: 2050 }, (_, index) => source(index + 1)));
  await store.refreshDiscovery('dashboard.example.test');
  provider.response = manifest(Array.from({ length: 2050 }, (_, index) => source(index + 2051)));
  await store.refreshDiscovery('dashboard.example.test');
  const after = await store.load();
  assert.equal(after.discoveredSources.length, 2050);
  assert.ok(after.discoveredSources.every(value => !value.available));
  assert.equal(after.warnings[0].code, 'NATIVE_DISCOVERY_UNAVAILABLE');
});
