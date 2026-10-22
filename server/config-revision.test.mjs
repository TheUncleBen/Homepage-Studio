import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createConfigStore } from './config.mjs';

// This is the existing native bridge's byte-level contract. state.json must
// never participate: moving a panel does not change its native source options.
const nativeFiles = [
  ['services.yaml', 'servicesYaml'], ['bookmarks.yaml', 'bookmarksYaml'],
  ['widgets.yaml', 'widgetsYaml'], ['settings.yaml', 'settingsYaml'],
  ['docker.yaml', 'dockerYaml'], ['kubernetes.yaml', 'kubernetesYaml'],
  ['proxmox.yaml', 'proxmoxYaml'], ['custom.css', 'customCss'], ['custom.js', 'customJs'],
];
async function nativeFingerprint(configDir) {
  const digest = createHash('sha256');
  for (const [name] of nativeFiles) {
    digest.update(name);
    digest.update('\0');
    digest.update(await fs.readFile(path.join(configDir, name)));
    digest.update('\0');
  }
  return digest.digest('hex');
}
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'homepage-native-revision-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const configDir = path.join(root, 'config');
  const store = createConfigStore({ configDir, stateDir: path.join(root, 'state') });
  await store.initialize();
  return { store, configDir };
}

test('writer state and board carry the native bridge fingerprint without native configuration bytes', async t => {
  const { store, configDir } = await fixture(t);
  const initial = await store.load();
  const state = await store.mutateSettings({ revision: initial.revision, config: { providers: { fixture: { key: 'synthetic-private-provider' } } } });
  const board = await store.loadBoard();
  const expected = await nativeFingerprint(configDir);
  assert.match(expected, /^[a-f0-9]{64}$/);
  assert.equal(state.configurationRevision, expected);
  assert.equal(board.configurationRevision, expected);
  assert.equal(board.revision, state.revision);
  assert.doesNotMatch(JSON.stringify(board), /synthetic-private-provider|providers/);
});

test('every managed native file changes the fingerprint on the saved and loaded responses', async t => {
  const { store, configDir } = await fixture(t);
  let state = await store.load();
  for (const [name, field] of nativeFiles) {
    const original = state.configurationRevision;
    const comment = name.endsWith('.css') ? '/* Native revision fixture */\n' : name.endsWith('.js') ? '// Native revision fixture\n' : '# Native revision fixture\n';
    state = await store.save({ revision: state.revision, [field]: state[field] + comment });
    assert.notEqual(state.configurationRevision, original, name);
    assert.equal(state.configurationRevision, await nativeFingerprint(configDir), name);
    assert.equal((await store.loadBoard()).configurationRevision, state.configurationRevision, name);
    assert.equal((await store.load()).configurationRevision, state.configurationRevision, name);
  }
});

test('layout-only saves advance the optimistic revision without invalidating native data', async t => {
  const { store, configDir } = await fixture(t);
  const initial = await store.load();
  const state = await store.mutateInfoWidget({ revision: initial.revision, action: 'add', type: 'greeting', config: { text: 'Hello' } });
  const draft = structuredClone(state.board);
  draft.panels[0].rect.y += 4;
  const saved = await store.saveBoard({ revision: state.revision, board: draft });
  assert.notEqual(saved.revision, state.revision);
  assert.equal(saved.configurationRevision, state.configurationRevision);
  assert.equal(saved.configurationRevision, await nativeFingerprint(configDir));
  const loaded = await store.load();
  assert.equal(loaded.configurationRevision, saved.configurationRevision);
  assert.equal(loaded.revision, saved.revision);
});

test('an absent physical file is unpaired instead of fingerprinting an invented default', async t => {
  const { store, configDir } = await fixture(t);
  const original = await store.load();
  await fs.unlink(path.join(configDir, 'custom.css'));
  assert.equal((await store.load()).configurationRevision, null);
  assert.equal((await store.loadBoard()).configurationRevision, null);
  await fs.writeFile(path.join(configDir, 'custom.css'), '');
  assert.equal((await store.load()).configurationRevision, original.configurationRevision);
});
