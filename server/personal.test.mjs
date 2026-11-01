import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPersonalStore, PreferenceError, validatePreferences } from './personal.mjs';

test('preferences store only what differs from the default and refuse anything else', () => {
  assert.deepEqual(validatePreferences({ searchEngine: 'google', motion: 'reduced', clock: 'dashboard' }), { motion: 'reduced' });
  assert.deepEqual(validatePreferences({ searchEngine: 'custom', searchUrl: 'https://search.example.com/?q=%s', suggestionsUrl: '' }), { searchEngine: 'custom', searchUrl: 'https://search.example.com/?q=%s' });
  // What was typed for Custom stays while another engine is chosen.
  assert.deepEqual(validatePreferences({ searchEngine: 'bing', searchUrl: 'https://search.example.com/?q=%s' }), { searchEngine: 'bing', searchUrl: 'https://search.example.com/?q=%s' });
  for (const bad of [null, [], { searchEngine: 'yahoo' }, { unknown: true }, { searchEngine: 'custom' }, { searchUrl: 'https://search.example.com/' }, { searchUrl: 'ftp://example.com/%s' }, { searchUrl: 'https://user:pw@example.com/%s' }, { suggestionsUrl: 'https://example.com/ q=%s' }])
    assert.throws(() => validatePreferences(bad), PreferenceError);
});

test('each person has their own folder, and a damaged preferences file means the defaults', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-personal-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = createPersonalStore({ stateRoot: root });
  const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
  assert.deepEqual(await store.forUser(id).preferences.read(), {});
  assert.deepEqual(await store.forUser(id).preferences.write({ mode: 'light' }), { mode: 'light' });
  assert.deepEqual(await store.forUser(id).preferences.read(), { mode: 'light' });
  await fs.writeFile(path.join(root, 'people', id, 'preferences.json'), '{not json');
  assert.deepEqual(await store.forUser(id).preferences.read(), {});
  assert.throws(() => store.forUser('../../etc'), { code: 'AUTH_REQUIRED' });
  await store.removeUser(id);
  await assert.rejects(fs.stat(path.join(root, 'people', id)), { code: 'ENOENT' });
});
