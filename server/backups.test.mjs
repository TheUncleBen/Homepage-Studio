import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createBackupStore, applyPendingRestore, parseBackup, run, RESTORE_MARKER } from './backups.mjs';

async function deployment(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-backups-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const configRoot = path.join(root, 'config'), stateRoot = path.join(root, 'state');
  const files = {
    'config/studio-dashboards.json': '{"dashboards":[]}',
    'config/services.yaml': '- Media: []\n',
    'config/dashboards/abc/settings.yaml': 'title: Kitchen\n',
    'config/logs/homepage.log': 'log line\n',
    'state/board.json': '{"panels":[]}',
    'state/auth/auth.json': '{"users":[]}',
    'state/auth/sessions.json': '{"version":1,"sessions":[]}',
    'state/auth/recovery.json': '{}',
    'state/backups/backup-1.json': '{}',
    'state/half-written.json.tmp': 'x',
  };
  for (const [file, text] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), text);
  }
  return { root, configRoot, stateRoot };
}
const quiet = { log() {}, error() {} };
const gzipJson = value => zlib.gzipSync(Buffer.from(JSON.stringify(value)));

test('a backup holds both volumes except sessions, the recovery link, logs, temporary files and the backups themselves', async t => {
  const { configRoot, stateRoot } = await deployment(t);
  const store = createBackupStore({ configRoot, stateRoot });
  const made = await store.create();
  assert.match(made.name, /^studio-backup-\d{8}-\d{6}\.json\.gz$/);
  const second = await store.create();
  assert.notEqual(second.name, made.name, 'two backups in one second get different names');
  const backup = await parseBackup(await store.read(made.name));
  assert.deepEqual(backup.files.map(file => `${file.volume}/${file.path}`).sort(), [
    'config/dashboards/abc/settings.yaml', 'config/services.yaml', 'config/studio-dashboards.json',
    'state/auth/auth.json', 'state/backups/backup-1.json', 'state/board.json',
  ]);
  assert.equal((await fs.stat(path.join(store.directory, made.name))).mode & 0o777, 0o600);
  const listed = await store.list();
  assert.deepEqual(listed.map(item => item.name).sort(), [made.name, second.name].sort());
  assert.ok(listed.every(item => item.kind === 'created' && item.bytes > 0));
  await store.remove(made.name);
  assert.equal((await store.list()).length, 1);
  for (const name of ['../config/services.yaml', 'studio-backup-x.json.gz', '/etc/passwd']) await assert.rejects(store.read(name), { code: 'BACKUP_NOT_FOUND' }, name);
});

test('uploads and restores accept only whole Studio backups with safe paths', async t => {
  const { configRoot, stateRoot } = await deployment(t);
  const store = createBackupStore({ configRoot, stateRoot });
  const valid = { format: 'homepage-studio-backup', version: 1, files: [{ volume: 'config', path: 'studio-dashboards.json', data: '' }] };
  for (const [bad, why] of [
    [Buffer.from('not gzip'), 'not gzip'],
    [gzipJson({ ...valid, format: 'other' }), 'other format'],
    [gzipJson({ ...valid, version: 2 }), 'newer version'],
    [gzipJson({ ...valid, files: [] }), 'no dashboard list'],
    [gzipJson({ ...valid, files: [...valid.files, { volume: 'config', path: '../escape', data: '' }] }), 'parent path'],
    [gzipJson({ ...valid, files: [...valid.files, { volume: 'config', path: '/etc/passwd', data: '' }] }), 'absolute path'],
    [gzipJson({ ...valid, files: [...valid.files, { volume: 'config', path: 'a//b', data: '' }] }), 'empty segment'],
    [gzipJson({ ...valid, files: [...valid.files, { volume: 'other', path: 'x', data: '' }] }), 'unknown volume'],
    [gzipJson({ ...valid, files: [...valid.files, { volume: 'state', path: 'studio-backups/x', data: '' }] }), 'backups folder'],
    [gzipJson({ ...valid, files: [...valid.files, { volume: 'state', path: 'auth/sessions.json', data: '' }] }), 'sessions'],
    [gzipJson({ ...valid, files: [...valid.files, valid.files[0]] }), 'duplicate'],
  ]) await assert.rejects(store.upload(bad), { name: 'BackupError' }, why);
  assert.deepEqual(await store.list(), [], 'nothing refused is kept');
  const uploaded = await store.upload(gzipJson(valid));
  assert.match(uploaded.name, /-uploaded\.json\.gz$/);
  assert.equal((await store.list())[0].kind, 'uploaded');
});

test('a staged restore replaces both volumes at the next start, keeps what was there, logs and backups, and signs everyone out', async t => {
  const { configRoot, stateRoot } = await deployment(t);
  const store = createBackupStore({ configRoot, stateRoot });
  const made = await store.create();
  // Changes after the backup: an edit, a new file, a new session.
  await fs.writeFile(path.join(configRoot, 'services.yaml'), 'changed\n');
  await fs.writeFile(path.join(stateRoot, 'new.json'), '{}');
  await fs.writeFile(path.join(stateRoot, 'auth/sessions.json'), '{"version":1,"sessions":[{"id":"later"}]}');
  assert.equal(await applyPendingRestore({ configRoot, stateRoot, log: quiet }), null, 'nothing staged, nothing done');
  await store.stageRestore(made.name);
  const result = await applyPendingRestore({ configRoot, stateRoot, log: quiet });
  assert.equal(result.restored, made.name);
  assert.equal(await fs.readFile(path.join(configRoot, 'services.yaml'), 'utf8'), '- Media: []\n');
  assert.equal(await fs.readFile(path.join(configRoot, 'dashboards/abc/settings.yaml'), 'utf8'), 'title: Kitchen\n');
  await assert.rejects(fs.access(path.join(stateRoot, 'new.json')));
  await assert.rejects(fs.access(path.join(stateRoot, 'auth/sessions.json')));
  await assert.rejects(fs.access(path.join(stateRoot, RESTORE_MARKER)));
  assert.equal(await fs.readFile(path.join(configRoot, 'logs/homepage.log'), 'utf8'), 'log line\n');
  const names = (await store.list()).map(item => item.name);
  assert.ok(names.includes(made.name) && names.includes(result.before), 'both backups are kept');
  const before = await parseBackup(await store.read(result.before));
  assert.equal(Buffer.from(before.files.find(file => file.path === 'services.yaml').data, 'base64').toString(), 'changed\n');
  assert.equal(await applyPendingRestore({ configRoot, stateRoot, log: quiet }), null, 'a restore applies once');
});

test('a staged restore of a missing or damaged backup changes nothing', async t => {
  const { configRoot, stateRoot } = await deployment(t);
  await fs.writeFile(path.join(stateRoot, RESTORE_MARKER), JSON.stringify({ name: 'studio-backup-20260101-000000.json.gz' }));
  const errors = [];
  assert.equal(await applyPendingRestore({ configRoot, stateRoot, log: { log() {}, error: message => errors.push(message) } }), null);
  assert.match(errors[0], /was not restored/);
  assert.equal(await fs.readFile(path.join(configRoot, 'services.yaml'), 'utf8'), '- Media: []\n');
  await assert.rejects(fs.access(path.join(stateRoot, RESTORE_MARKER)), 'the marker is cleared so the next start is normal');
});

test('the command line lists, creates and stages a restore', async t => {
  const { configRoot, stateRoot } = await deployment(t);
  const env = { HOMEPAGE_CONFIG_DIR: configRoot, STUDIO_STATE_DIR: stateRoot };
  const lines = [];
  const out = { log: line => lines.push(line), error: line => lines.push(line) };
  await run(['list'], env, out);
  assert.match(lines.pop(), /No backups yet/);
  await run(['create'], env, out);
  const name = /Created (\S+)/.exec(lines.pop())[1];
  await run(['restore', name], env, out);
  assert.match(lines.pop(), /will be restored when Studio next starts/);
  assert.equal(JSON.parse(await fs.readFile(path.join(stateRoot, RESTORE_MARKER), 'utf8')).name, name);
});
