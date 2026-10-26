#!/usr/bin/env node
// Full backups of a deployment: every dashboard, the dashboard registry, the
// platform look and sign-in data, in one file. Administrators create,
// download, upload and restore them in Administration → Backups; they are kept
// in the state volume (studio-backups/), so the command line can restore one
// when the web pages can't be reached:
//
//   docker exec -it <container> node server/backups.mjs list
//   docker exec -it <container> node server/backups.mjs create
//   docker exec -it <container> node server/backups.mjs restore <name>
//
// A backup is gzip-compressed JSON listing each file of the config and state
// volumes. Signed-in sessions, the recovery link and the backups themselves
// are left out. A restore is staged and applied at the next start, before
// anything reads the volumes, so nothing half-loaded keeps running; after it
// everyone signs in again.
import fs from 'node:fs/promises';
import { join, resolve, dirname, sep, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import zlib from 'node:zlib';

const gzip = promisify(zlib.gzip), gunzip = promisify(zlib.gunzip);
export const BACKUP_DIR = 'studio-backups';
export const RESTORE_MARKER = 'studio-restore.json';
export const BACKUP_FORMAT = 'homepage-studio-backup';
export const MAX_BACKUP_BYTES = 256 * 1024 * 1024;
const tooLarge = () => new BackupError(`Studio's files are too large for a backup in the app (at most ${MAX_BACKUP_BYTES / (1024 * 1024)} MiB). Back up the volumes instead, as docs/OPERATIONS.md describes.`, 'BACKUP_TOO_LARGE', 413);
const MAX_BACKUP_FILES = 20000;
const NAME = /^studio-backup-\d{8}-\d{6}(?:-(?:uploaded|before-restore))?(?:-\d+)?\.json\.gz$/;
// Never part of a backup: the backups, a staged restore, sessions and the
// one-time recovery link (a restore signs everyone out), and temporary files.
const SKIPPED_STATE = new Set([BACKUP_DIR, RESTORE_MARKER, 'auth/sessions.json', 'auth/recovery.json']);
const SKIPPED_CONFIG = new Set(['logs']);
const base = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export class BackupError extends Error {
  constructor(message, code = 'INVALID_BACKUP', status = 400) {
    super(message); this.name = 'BackupError'; this.code = code; this.status = status;
  }
}

const stamp = (date = new Date()) => date.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
export const validBackupName = name => typeof name === 'string' && NAME.test(name);

async function walk(root, skipped, prefix = '') {
  const out = [];
  let entries;
  try { entries = await fs.readdir(join(root, prefix), { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return out; throw error; }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (skipped.has(path) || entry.name.endsWith('.tmp')) continue;
    if (entry.isDirectory()) out.push(...await walk(root, skipped, path));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

// A path inside a volume: relative, plain segments, no way out.
function safePath(path) {
  if (typeof path !== 'string' || !path || path.length > 1024 || path.startsWith('/') || path.includes('\\') || path.includes('\0')) return false;
  return path.split('/').every(segment => segment && segment !== '.' && segment !== '..') && posix.normalize(path) === path;
}

export function createBackupStore({ configRoot, stateRoot, buildRevision = 'unreleased' }) {
  const directory = join(stateRoot, BACKUP_DIR);
  const fileOf = name => {
    if (!validBackupName(name)) throw new BackupError('There is no backup with that name.', 'BACKUP_NOT_FOUND', 404);
    return join(directory, name);
  };
  async function freeName(kind) {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const first = `studio-backup-${stamp()}${kind ? '-' + kind : ''}`;
    for (let index = 0; index < 100; index++) {
      const name = `${first}${index ? '-' + index : ''}.json.gz`;
      try { await fs.access(join(directory, name)); } catch { return name; }
    }
    throw new BackupError('Too many backups were made this second. Try again.', 'BACKUP_BUSY', 409);
  }
  async function write(name, bytes) {
    const temporary = join(directory, `${name}.${process.pid}.tmp`);
    await fs.writeFile(temporary, bytes, { mode: 0o600, flag: 'wx' });
    await fs.rename(temporary, join(directory, name));
  }
  // Every backup Studio makes can be restored: the files together stay
  // within the same limit an upload or a restore accepts.
  async function archive() {
    const files = [];
    let total = 0;
    for (const [volume, root, skipped] of [['config', configRoot, SKIPPED_CONFIG], ['state', stateRoot, SKIPPED_STATE]]) {
      for (const path of await walk(root, skipped)) {
        const full = join(root, path);
        const [data, stat] = await Promise.all([fs.readFile(full), fs.stat(full)]);
        total += data.length;
        if (total > MAX_BACKUP_BYTES) throw tooLarge();
        files.push({ volume, path, mode: stat.mode & 0o777, data: data.toString('base64') });
      }
    }
    const bytes = await gzip(Buffer.from(JSON.stringify({ format: BACKUP_FORMAT, version: 1, createdAt: new Date().toISOString(), buildRevision, files })));
    if (bytes.length > MAX_BACKUP_BYTES) throw tooLarge();
    return bytes;
  }
  return {
    directory,
    async list() {
      let names;
      try { names = (await fs.readdir(directory)).filter(validBackupName); }
      catch (error) { if (error.code === 'ENOENT') return []; throw error; }
      const items = await Promise.all(names.map(async name => {
        const stat = await fs.stat(join(directory, name));
        return { name, bytes: stat.size, createdAt: stat.mtime.toISOString(), kind: name.includes('-before-restore') ? 'before-restore' : name.includes('-uploaded') ? 'uploaded' : 'created' };
      }));
      return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.name.localeCompare(a.name));
    },
    async create(kind) {
      const bytes = await archive();
      const name = await freeName(kind);
      await write(name, bytes);
      return { name, bytes: bytes.length };
    },
    async read(name) {
      try { return await fs.readFile(fileOf(name)); }
      catch (error) { if (error.code === 'ENOENT') throw new BackupError('There is no backup with that name.', 'BACKUP_NOT_FOUND', 404); throw error; }
    },
    // An uploaded file is checked in full before it is kept.
    async upload(bytes) {
      await parseBackup(bytes);
      const name = await freeName('uploaded');
      await write(name, bytes);
      return { name, bytes: bytes.length };
    },
    async remove(name) {
      try { await fs.unlink(fileOf(name)); }
      catch (error) { if (error.code === 'ENOENT') throw new BackupError('There is no backup with that name.', 'BACKUP_NOT_FOUND', 404); throw error; }
    },
    // Checks the backup now and applies it at the next start.
    async stageRestore(name) {
      await parseBackup(await this.read(name));
      const temporary = join(stateRoot, `${RESTORE_MARKER}.${process.pid}.tmp`);
      await fs.writeFile(temporary, JSON.stringify({ name, requestedAt: new Date().toISOString() }), { mode: 0o600 });
      await fs.rename(temporary, join(stateRoot, RESTORE_MARKER));
      return { name };
    },
  };
}

export async function parseBackup(bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.length) throw new BackupError('Choose a Studio backup file.');
  if (bytes.length > MAX_BACKUP_BYTES) throw new BackupError(`A backup can be at most ${MAX_BACKUP_BYTES / (1024 * 1024)} MiB.`, 'BACKUP_TOO_LARGE', 413);
  let value;
  try { value = JSON.parse((await gunzip(bytes, { maxOutputLength: 4 * MAX_BACKUP_BYTES })).toString('utf8')); }
  catch { throw new BackupError('This file is not a Studio backup.'); }
  if (value?.format !== BACKUP_FORMAT) throw new BackupError('This file is not a Studio backup.');
  if (value.version !== 1) throw new BackupError('This backup was made by a newer version of Studio.', 'BACKUP_VERSION');
  if (!Array.isArray(value.files) || value.files.length > MAX_BACKUP_FILES) throw new BackupError('This backup is damaged.');
  const seen = new Set();
  for (const file of value.files) {
    const key = `${file?.volume}/${file?.path}`;
    if (!['config', 'state'].includes(file?.volume) || !safePath(file.path) || typeof file.data !== 'string' || seen.has(key)) throw new BackupError('This backup is damaged.');
    if (file.volume === 'state' && [...SKIPPED_STATE].some(skipped => file.path === skipped || file.path.startsWith(skipped + '/'))) throw new BackupError('This backup is damaged.');
    seen.add(key);
  }
  if (!seen.has('config/studio-dashboards.json')) throw new BackupError('This backup has no dashboard list, so it is not a whole deployment.');
  return value;
}

async function clear(root, keep) {
  let entries;
  try { entries = await fs.readdir(root); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const name of entries) if (!keep.has(name)) await fs.rm(join(root, name), { recursive: true, force: true });
}

async function writeFiles(roots, files) {
  for (const file of files) {
    const target = resolve(roots[file.volume], ...file.path.split('/'));
    if (!target.startsWith(resolve(roots[file.volume]) + sep)) throw new BackupError('This backup is damaged.');
    await fs.mkdir(dirname(target), { recursive: true, mode: 0o700 });
    // Restored files are Studio's own to read and write, whatever mode the
    // backup recorded.
    await fs.writeFile(target, Buffer.from(file.data, 'base64'), { mode: 0o600 });
    await fs.chmod(target, 0o600);
  }
}

// Runs before the server reads anything. A staged restore first saves what
// is there now as a "before restore" backup, then replaces both volumes. If
// writing fails part-way, that backup is put back.
export async function applyPendingRestore({ configRoot, stateRoot, buildRevision, log = console }) {
  const marker = join(stateRoot, RESTORE_MARKER);
  let request;
  try { request = JSON.parse(await fs.readFile(marker, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; await fs.rm(marker, { force: true }); log.error('Studio restore: the staged restore could not be read, so nothing was restored.'); return null; }
  await fs.rm(marker, { force: true });
  const store = createBackupStore({ configRoot, stateRoot, buildRevision });
  let backup;
  try { backup = await parseBackup(await store.read(request.name)); }
  catch (error) { log.error(`Studio restore: ${request.name} was not restored: ${error.message}`); return null; }
  let before;
  try { before = await store.create('before-restore'); }
  catch (error) { log.error(`Studio restore: ${request.name} was not restored: what is there now couldn't be saved first (${error.message})`); return null; }
  const roots = { config: configRoot, state: stateRoot };
  const keep = { config: SKIPPED_CONFIG, state: new Set([BACKUP_DIR]) };
  try {
    await clear(configRoot, keep.config); await clear(stateRoot, keep.state);
    await writeFiles(roots, backup.files);
  } catch (error) {
    log.error(`Studio restore: ${request.name} could not be written (${error.code || error.message}); putting back ${before.name}.`);
    const previous = await parseBackup(await store.read(before.name));
    await clear(configRoot, keep.config); await clear(stateRoot, keep.state);
    await writeFiles(roots, previous.files);
    return { restored: null, before: before.name };
  }
  log.log(`Studio restore: restored ${request.name}. What was there before is kept as ${before.name}.`);
  return { restored: request.name, before: before.name };
}

export function studioRoots(env = process.env) {
  return { configRoot: resolve(env.HOMEPAGE_CONFIG_DIR || join(base, 'config')), stateRoot: resolve(env.STUDIO_STATE_DIR || join(base, 'state')) };
}

export async function run(argv, env = process.env, out = console) {
  const [command, name] = argv;
  const store = createBackupStore({ ...studioRoots(env), buildRevision: env.STUDIO_BUILD_REVISION });
  const size = bytes => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (command === 'list') {
    const items = await store.list();
    if (!items.length) out.log('No backups yet. Create one with "create", or in Administration → Backups.');
    for (const item of items) out.log([item.name, item.createdAt, size(item.bytes)].join('\t'));
    return;
  }
  if (command === 'create') {
    const made = await store.create();
    out.log(`Created ${made.name} (${size(made.bytes)}) in ${store.directory}.`);
    return;
  }
  if (command === 'restore' && name) {
    await store.stageRestore(name);
    out.log(`${name} is checked and will be restored when Studio next starts. Restart it now, for example:\n\n  docker service update --force homepage_studio      (Swarm)\n  docker compose restart studio                     (Compose)\n\nWhat is there now is saved as a "before restore" backup first. Everyone signs in again afterwards.`);
    return;
  }
  out.error('Usage:\n  node server/backups.mjs list\n  node server/backups.mjs create\n  node server/backups.mjs restore <name>');
  process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run(process.argv.slice(2)).catch(error => { console.error(error.message); process.exit(1); });
}
