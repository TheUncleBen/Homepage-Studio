// SPDX-License-Identifier: AGPL-3.0-or-later
// Snapshot action metadata: every snapshot names the operation that made it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createConfigStore, SNAPSHOT_ACTIONS } from './config.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'homepage-studio-snapshot-action-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const options = { configDir: path.join(root, 'config'), stateDir: path.join(root, 'state') };
  const store = createConfigStore(options);
  await store.initialize();
  return { store, ...options };
}

test('the action codes are short fixed identifiers', () => {
  assert.equal(new Set(SNAPSHOT_ACTIONS).size, SNAPSHOT_ACTIONS.length);
  for (const code of SNAPSHOT_ACTIONS) assert.match(code, /^[a-z][a-z-]{0,47}$/);
  assert.ok(Object.isFrozen(SNAPSHOT_ACTIONS));
});

test('a new snapshot records its action, exports it, restores and imports into another dashboard', async (t) => {
  const source = await fixture(t), target = await fixture(t);
  const before = await source.store.load();
  const saved = await source.store.mutateSettings({ revision: before.revision, config: { title: 'After' } });
  const [snapshot] = await source.store.listBackups();
  assert.equal(snapshot.action, 'settings-saved');
  assert.deepEqual(snapshot.changedFiles, ['settings.yaml', 'state.json']);
  const exported = await source.store.exportBackup(snapshot.id);
  assert.equal(exported.action, 'settings-saved');
  assert.deepEqual(Object.keys(exported).sort(), ['action', 'afterHashes', 'before', 'changedFiles', 'createdAt', 'revision', 'version']);

  const imported = await target.store.importArchive({ revision: (await target.store.load()).revision, archive: JSON.parse(JSON.stringify(exported)) });
  assert.equal(imported.settingsYaml, before.settingsYaml);
  assert.equal((await target.store.listBackups())[0].action, 'dashboard-imported');

  const restored = await source.store.restoreBackup({ revision: saved.revision, backupId: snapshot.id });
  assert.equal(restored.settingsYaml, before.settingsYaml);
  const [restoreSnapshot] = await source.store.listBackups();
  assert.equal(restoreSnapshot.action, 'snapshot-restored');
});

test('import accepts an action code but rejects other action values; a stored snapshot without a known code is refused', async (t) => {
  const source = await fixture(t), target = await fixture(t);
  const before = await source.store.load();
  await source.store.save({ revision: before.revision, customJs: 'window.changed = true;\n' });
  const [snapshot] = await source.store.listBackups();
  const exported = await source.store.exportBackup(snapshot.id);
  for (const action of ['Free text with spaces', 42, null, '<script>', 'x'.repeat(49)]) {
    await assert.rejects(target.store.importArchive({ revision: (await target.store.load()).revision, archive: { ...exported, action } }), { code: 'INVALID_IMPORT' });
  }
  assert.equal((await target.store.listBackups()).length, 0);
  // A code from a newer release is informational only and still imports.
  await target.store.importArchive({ revision: (await target.store.load()).revision, archive: { ...exported, action: 'future-operation' } });

  const file = path.join(source.stateDir, 'backups', `${snapshot.id}.json`);
  const stored = JSON.parse(await fs.readFile(file, 'utf8'));
  for (const action of ['Not a known code', undefined]) {
    await fs.writeFile(file, JSON.stringify({ ...stored, action }));
    await assert.rejects(source.store.listBackups(), { code: 'INVALID_BACKUP' });
    await assert.rejects(source.store.exportBackup(snapshot.id), { code: 'INVALID_BACKUP' });
  }
});
