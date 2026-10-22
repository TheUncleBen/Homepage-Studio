// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { installPinnedPnpm } from '../scripts/install-pinned-pnpm.mjs';

const bytes = Buffer.from('Synthetic package-manager archive. No executable content.');
const lock = { pnpmVersion: '10.34.7', pnpmIntegrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` };

function fixture({ corrupt = false, filename, installFails = false } = {}) {
  const state = { calls: [], temporary: null };
  const run = async args => {
    state.calls.push(args);
    if (args[0] === 'pack') {
      assert.ok(args.includes('--ignore-scripts'));
      assert.equal(args[1], `pnpm@${lock.pnpmVersion}`);
      state.temporary = args[args.indexOf('--pack-destination') + 1];
      const name = `pnpm-${lock.pnpmVersion}.tgz`;
      await fs.writeFile(path.join(state.temporary, name), corrupt ? Buffer.from('Changed archive bytes') : bytes);
      return JSON.stringify([{ filename: filename ?? name, version: lock.pnpmVersion }]);
    }
    assert.deepEqual(args.slice(0, -1), ['install', '--global', '--offline', '--ignore-scripts', '--no-audit', '--no-fund']);
    assert.equal(args.at(-1), path.join(state.temporary, `pnpm-${lock.pnpmVersion}.tgz`));
    assert.deepEqual(await fs.readFile(args.at(-1)), bytes);
    if (installFails) throw new Error('Synthetic installation failure');
    return '';
  };
  return { state, run };
}

test('pnpm is installed from the exact verified archive and temporary bytes are removed', async () => {
  const f = fixture();
  assert.deepEqual(await installPinnedPnpm(lock, f), lock);
  assert.deepEqual(f.state.calls.map(args => args[0]), ['pack', 'install']);
  await assert.rejects(fs.access(f.state.temporary), { code: 'ENOENT' });
});

test('a changed pnpm archive is rejected before installation even if its metadata claims the requested version', async () => {
  const f = fixture({ corrupt: true });
  await assert.rejects(installPinnedPnpm(lock, f), /differs from the SHA-512 integrity/);
  assert.deepEqual(f.state.calls.map(args => args[0]), ['pack']);
  await assert.rejects(fs.access(f.state.temporary), { code: 'ENOENT' });
});

test('unpinned package-manager inputs are rejected before invoking npm', async () => {
  const f = fixture();
  for (const changed of [{}, { ...lock, pnpmVersion: 'latest' }, { ...lock, pnpmVersion: '10.34.7;echo' }, { ...lock, pnpmIntegrity: 'sha512-unverified' }]) {
    await assert.rejects(installPinnedPnpm(changed, f), /must be pinned/);
  }
  assert.deepEqual(f.state.calls, []);
});

test('unexpected archive paths and installation failures are explicit and clean up their temporary files', async () => {
  for (const [options, message] of [[{ filename: '../outside.tgz' }, /unexpected package-manager archive/], [{ installFails: true }, /Synthetic installation failure/]]) {
    const f = fixture(options);
    await assert.rejects(installPinnedPnpm(lock, f), message);
    await assert.rejects(fs.access(f.state.temporary), { code: 'ENOENT' });
  }
});
