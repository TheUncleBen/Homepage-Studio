import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';
import { upgradeData, readDataVersion, DATA_VERSION, DATA_MARKER, UpgradeError } from './upgrade.mjs';
import { createBackupStore } from './backups.mjs';

const quiet = { log() {}, error() {} };
async function roots() {
  const base = await fs.mkdtemp(join(os.tmpdir(), 'studio-upgrade-'));
  const configRoot = join(base, 'config'), stateRoot = join(base, 'state');
  await fs.mkdir(configRoot); await fs.mkdir(stateRoot);
  return { configRoot, stateRoot };
}
async function legacy() {
  const r = await roots();
  await fs.writeFile(join(r.configRoot, 'studio-dashboards.json'), '{"version":1}');
  await fs.writeFile(join(r.configRoot, 'services.yaml'), '- Group: []\n');
  await fs.writeFile(join(r.stateRoot, 'state.json'), '{"version":2}');
  return r;
}

test('a new deployment is stamped with the current version and gets no backup', async () => {
  const r = await roots();
  const result = await upgradeData({ ...r, buildRevision: 'abc', log: quiet });
  assert.equal(result.fresh, true);
  assert.equal((await readDataVersion(r.stateRoot)).version, DATA_VERSION);
  assert.deepEqual(await createBackupStore(r).list(), []);
});

test('data from before versioning is backed up, migrated in order and stamped', async () => {
  const r = await legacy();
  const ran = [];
  const migrations = [
    { to: 2, name: 'second', run: async () => ran.push(2) },
    { to: 1, name: 'first', run: async ({ configRoot }) => { ran.push(1); await fs.writeFile(join(configRoot, 'services.yaml'), 'migrated\n'); } },
  ];
  const result = await upgradeData({ ...r, buildRevision: 'new', log: quiet, migrations, target: 2 });
  assert.deepEqual(ran, [1, 2]);
  assert.equal(result.from, 0);
  assert.equal((await readDataVersion(r.stateRoot)).version, 2);
  const backups = await createBackupStore(r).list();
  assert.equal(backups.length, 1);
  assert.equal(backups[0].kind, 'before-upgrade');
  assert.equal(await fs.readFile(join(r.configRoot, 'services.yaml'), 'utf8'), 'migrated\n');
  // Run again: already current, nothing more happens.
  await upgradeData({ ...r, buildRevision: 'new', log: quiet, migrations, target: 2 });
  assert.deepEqual(ran, [1, 2]);
  assert.equal((await createBackupStore(r).list()).length, 1);
});

test('a failed migration puts the data back exactly and leaves the old version', async () => {
  const r = await legacy();
  const migrations = [{ to: 1, name: 'breaks', run: async ({ configRoot }) => { await fs.writeFile(join(configRoot, 'services.yaml'), 'half-done\n'); throw new Error('boom'); } }];
  await assert.rejects(upgradeData({ ...r, log: quiet, migrations, target: 1 }), e => e instanceof UpgradeError && e.code === 'UPGRADE_FAILED');
  assert.equal(await fs.readFile(join(r.configRoot, 'services.yaml'), 'utf8'), '- Group: []\n');
  assert.equal(await readDataVersion(r.stateRoot), null);
});

test('data from a newer Studio is refused and left untouched', async () => {
  const r = await legacy();
  await fs.writeFile(join(r.stateRoot, DATA_MARKER), JSON.stringify({ version: DATA_VERSION + 5 }));
  await assert.rejects(upgradeData({ ...r, log: quiet }), e => e.code === 'DATA_TOO_NEW');
  assert.equal(JSON.parse(await fs.readFile(join(r.stateRoot, DATA_MARKER), 'utf8')).version, DATA_VERSION + 5);
});

test('a damaged version record stops the start instead of guessing', async () => {
  const r = await legacy();
  await fs.writeFile(join(r.stateRoot, DATA_MARKER), 'not json');
  await assert.rejects(upgradeData({ ...r, log: quiet }), e => e.code === 'DATA_VERSION_INVALID');
});

test('only the newest three upgrade backups are kept', async () => {
  const r = await legacy();
  const store = createBackupStore(r);
  for (let target = 1; target <= 5; target++) {
    // A distinct name per run: backups are named by the second.
    await upgradeData({ ...r, log: quiet, migrations: [{ to: target, name: 'step', run: async () => {} }], target });
    await new Promise(resolve => setTimeout(resolve, 1050));
  }
  const kept = (await store.list()).filter(item => item.kind === 'before-upgrade');
  assert.equal(kept.length, 3);
});
