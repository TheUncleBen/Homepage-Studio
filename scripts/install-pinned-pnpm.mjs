#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Verify the recorded package-manager tarball before installing those exact bytes.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
async function npm(args) {
  try {
    return (await execute('npm', args, { encoding: 'utf8', timeout: 180000, maxBuffer: 4 * 1024 * 1024 })).stdout;
  } catch { throw new Error(`npm ${args[0]} failed while preparing the pinned package manager.`); }
}

export async function installPinnedPnpm(lock, { run = npm } = {}) {
  if (!/^\d+\.\d+\.\d+$/.test(lock?.pnpmVersion || '') || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(lock?.pnpmIntegrity || '')) {
    throw new Error('The package-manager version and SHA-512 integrity must be pinned.');
  }
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-pnpm-'));
  try {
    const expectedName = `pnpm-${lock.pnpmVersion}.tgz`;
    const packed = JSON.parse(await run(['pack', `pnpm@${lock.pnpmVersion}`, '--json', '--ignore-scripts', '--pack-destination', temporary]));
    if (!Array.isArray(packed) || packed.length !== 1 || packed[0].filename !== expectedName || packed[0].version !== lock.pnpmVersion) {
      throw new Error('npm returned an unexpected package-manager archive.');
    }
    const archive = path.join(temporary, expectedName);
    const stat = await fs.lstat(archive);
    if (!stat.isFile() || stat.size < 1 || stat.size > 64 * 1024 * 1024) throw new Error('The package-manager archive must be a bounded regular file.');
    const bytes = await fs.readFile(archive);
    if (`sha512-${createHash('sha512').update(bytes).digest('base64')}` !== lock.pnpmIntegrity) {
      throw new Error('The pnpm archive differs from the SHA-512 integrity in upstream.lock.json.');
    }
    await run(['install', '--global', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', archive]);
    return { pnpmVersion: lock.pnpmVersion, pnpmIntegrity: lock.pnpmIntegrity };
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [filename, ...extra] = process.argv.slice(2);
    if (!filename || extra.length) throw new Error('Usage: node scripts/install-pinned-pnpm.mjs <upstream.lock.json>');
    console.log(JSON.stringify(await installPinnedPnpm(JSON.parse(await fs.readFile(filename, 'utf8')))));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
