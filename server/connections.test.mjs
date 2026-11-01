import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';
import { CONNECTIONS_FILE, connectionUsage, createConnectionStore, placeholder, publicConnection, validAddress } from './connections.mjs';

const tempDir = async (t) => {
  const dir = await fs.mkdtemp(join(os.tmpdir(), 'studio-connections-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
};

test('saved connections keep secrets on disk, private, and write-only', async (t) => {
  const dir = await tempDir(t);
  const store = createConnectionStore({ dir });
  const entry = await store.add({ name: 'NAS', url: 'https://nas.example.org/', key: 'k1', password: '' });
  assert.match(entry.id, /^[A-F0-9]{16}$/);
  assert.equal(entry.url, 'https://nas.example.org');
  assert.deepEqual(entry.secrets, { key: 'k1' });
  assert.equal((await fs.stat(join(dir, CONNECTIONS_FILE))).mode & 0o777, 0o600);
  const shown = publicConnection(entry);
  assert.deepEqual(shown.has, { key: true, username: false, password: false });
  assert.doesNotMatch(JSON.stringify(shown), /k1/);
  const kept = await store.update(entry.id, { key: '', username: 'admin' });
  assert.deepEqual(kept.secrets, { key: 'k1', username: 'admin' });
  const cleared = await store.update(entry.id, { clear: ['key', 'url'] });
  assert.deepEqual(cleared.secrets, { username: 'admin' });
  assert.equal(cleared.url, 'https://nas.example.org');
});

test('saved connections refuse bad names, addresses and duplicates', async (t) => {
  const store = createConnectionStore({ dir: await tempDir(t) });
  await store.add({ name: 'NAS', url: 'http://nas.example.org' });
  await assert.rejects(store.add({ name: 'nas', url: 'http://other.example.org' }), /already a connection/);
  await assert.rejects(store.add({ name: '', url: 'http://a.example.org' }), /1 to 60/);
  await assert.rejects(store.add({ name: 'A', url: 'ftp://a.example.org' }), /http/);
  await assert.rejects(store.add({ name: 'A', url: 'https://user:pw@a.example.org' }), /own fields/);
  await assert.rejects(store.add({ name: 'A', url: 'https://a.example.org', key: 'a\nb' }), /one line/);
  assert.throws(() => validAddress('not a url'), /service address/);
  await assert.rejects(store.update('0000000000000000', { name: 'x' }), { code: 'CONNECTION_NOT_FOUND' });
});

test('a connection in use is not removed, and usage is found by placeholder', async (t) => {
  const store = createConnectionStore({ dir: await tempDir(t) });
  const entry = await store.add({ name: 'Router', url: 'https://router.example.org' }, { id: 'ABCDEF0123456789' });
  assert.equal(entry.id, 'ABCDEF0123456789');
  const files = { 'services.yaml': `- R:\n    widget:\n      url: "${placeholder(entry.id, 'url')}"\n`, 'widgets.yaml': '' };
  const usedBy = connectionUsage(entry.id, files);
  assert.deepEqual(usedBy, ['services.yaml']);
  await assert.rejects(store.remove(entry.id, { usedBy }), (error) => error.code === 'CONNECTION_IN_USE' && error.status === 409 && error.details.usedBy[0] === 'services.yaml');
  await store.remove(entry.id);
  assert.deepEqual(await store.list(), []);
});

test('an unreadable connections file is reported, not overwritten', async (t) => {
  const dir = await tempDir(t);
  await fs.writeFile(join(dir, CONNECTIONS_FILE), '{nope');
  const store = createConnectionStore({ dir });
  await assert.rejects(store.list(), { code: 'CONNECTIONS_UNAVAILABLE' });
  await assert.rejects(store.add({ name: 'A', url: 'https://a.example.org' }), { code: 'CONNECTIONS_UNAVAILABLE' });
  assert.equal(await fs.readFile(join(dir, CONNECTIONS_FILE), 'utf8'), '{nope');
});
