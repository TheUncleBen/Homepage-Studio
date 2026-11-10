// Upgrades in place (owner, 10 Nov 2026): changing the image digest is the
// whole upgrade. At every start, before anything reads the volumes, Studio
// compares the data version recorded in the state volume with the one this
// build expects and brings the data up to date:
//
// - a new deployment (empty volumes) is stamped with the current version;
// - older data is first saved as a "before upgrade" backup (Administration →
//   Backups, or `node server/backups.mjs list`), then each migration runs in
//   order and the version is recorded after each one;
// - if a migration fails, the backup is put back and Studio stops with a
//   message in the log, so the orchestrator can roll back to the old image,
//   which still finds the data it understands;
// - data written by a newer Studio is never opened by an older one: Studio
//   stops and says which backup to restore (rolling back after an upgrade).
//
// Adding a migration: append { to: DATA_VERSION + 1, name, run } to
// MIGRATIONS and raise DATA_VERSION. A migration receives the two volume
// roots, must be safe to run again after an interruption, and must not need
// the network or the native renderer.
import fs from 'node:fs/promises';
import { join } from 'node:path';
import { createBackupStore, restoreBackupFiles } from './backups.mjs';
import { migrateLegacyLooks } from './migrations/legacy-looks.mjs';

export const DATA_VERSION = 1;
export const DATA_MARKER = 'studio-data.json';
const KEEP_UPGRADE_BACKUPS = 3;

export class UpgradeError extends Error {
  constructor(message, code) { super(message); this.name = 'UpgradeError'; this.code = code; }
}

export const MIGRATIONS = Object.freeze([
  // Version 1 starts the record. Data from before it (candidates up to
  // 1c3b5bd) may still hold widget looks from before the block widgets.
  { to: 1, name: 'Convert widget looks from before the block widgets', run: migrateLegacyLooks },
]);

async function exists(path) {
  try { await fs.lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

export async function readDataVersion(stateRoot) {
  let text;
  try { text = await fs.readFile(join(stateRoot, DATA_MARKER), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  let value;
  try { value = JSON.parse(text); } catch { value = null; }
  if (!value || !Number.isSafeInteger(value.version) || value.version < 0) {
    throw new UpgradeError(`${DATA_MARKER} in the state volume is damaged, so Studio can't tell which version wrote the data.`, 'DATA_VERSION_INVALID');
  }
  return value;
}

async function writeDataVersion(stateRoot, version, buildRevision) {
  const file = join(stateRoot, DATA_MARKER);
  const temporary = `${file}.${process.pid}.tmp`;
  const handle = await fs.open(temporary, 'w', 0o600);
  try {
    await handle.writeFile(JSON.stringify({ version, build: buildRevision ?? 'unreleased', updatedAt: new Date().toISOString() }) + '\n');
    await handle.sync();
  } finally { await handle.close(); }
  await fs.rename(temporary, file);
}

// The data version a backup was made at (0 when it predates the record).
export function backupDataVersion(backup) {
  const entry = backup.files.find(file => file.volume === 'state' && file.path === DATA_MARKER);
  if (!entry) return 0;
  try { return JSON.parse(Buffer.from(entry.data, 'base64').toString('utf8')).version; } catch { return Infinity; }
}

export async function upgradeData({ configRoot, stateRoot, buildRevision, log = console, migrations = MIGRATIONS, target = DATA_VERSION }) {
  await fs.mkdir(stateRoot, { recursive: true, mode: 0o700 });
  const recorded = await readDataVersion(stateRoot);
  if (!recorded) {
    // Nothing yet in either volume: a new deployment, already current.
    const used = await exists(join(configRoot, 'studio-dashboards.json')) || await exists(join(configRoot, 'services.yaml')) || await exists(join(stateRoot, 'state.json'));
    if (!used) { await writeDataVersion(stateRoot, target, buildRevision); return { from: target, to: target, fresh: true }; }
  }
  const from = recorded?.version ?? 0;
  if (from > target) {
    throw new UpgradeError(`The data was written by a newer Studio (data version ${from}; this image understands up to ${target}). Deploy the newer image again; to go back to this one, stage the "before upgrade" backup first (docs/UPGRADING.md, Going back).`, 'DATA_TOO_NEW');
  }
  if (from === target) {
    if (recorded.build !== (buildRevision ?? 'unreleased')) await writeDataVersion(stateRoot, target, buildRevision);
    return { from, to: target };
  }
  const steps = migrations.filter(step => step.to > from && step.to <= target).sort((a, b) => a.to - b.to);
  const store = createBackupStore({ configRoot, stateRoot, buildRevision });
  let backup;
  try { backup = await store.create('before-upgrade'); }
  catch (error) { throw new UpgradeError(`The data couldn't be saved before upgrading, so nothing was changed (${error.message}).`, 'UPGRADE_BACKUP_FAILED'); }
  log.log(`Studio upgrade: data version ${from} → ${target}. What was there before is kept as ${backup.name}.`);
  let step;
  try {
    for (step of steps) {
      await step.run({ configRoot, stateRoot, log });
      await writeDataVersion(stateRoot, step.to, buildRevision);
      log.log(`Studio upgrade: ${step.to}. ${step.name}: done.`);
    }
  } catch (error) {
    log.error(`Studio upgrade: step ${step.to} (${step.name}) failed: ${error.message}. Putting back ${backup.name}.`);
    await restoreBackupFiles({ configRoot, stateRoot, name: backup.name });
    throw new UpgradeError(`The upgrade to data version ${step.to} failed and the data was put back as it was. Deploy the previous image, and report this log.`, 'UPGRADE_FAILED');
  }
  await pruneUpgradeBackups(store).catch(() => {});
  return { from, to: target, backup: backup.name };
}

// Keep the newest few automatic upgrade backups; the rest are pruned.
async function pruneUpgradeBackups(store) {
  const automatic = (await store.list()).filter(item => item.kind === 'before-upgrade');
  for (const item of automatic.slice(KEEP_UPGRADE_BACKUPS)) await store.remove(item.name);
}
