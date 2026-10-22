#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Precompress only immutable build assets. Requests stream these representations
// directly; runtime configuration and integration responses are never included.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { gzip, brotliCompress, constants } from 'node:zlib';

const gzipAsync = promisify(gzip), brotliAsync = promisify(brotliCompress);
const types = new Set(['.js', '.css', '.json', '.svg', '.txt', '.map']);

export async function compressStaticAssets(directory) {
  const root = path.resolve(directory);
  if (!(await fs.lstat(root)).isDirectory() || await fs.realpath(root) !== root) throw new Error('Build assets must use a real directory.');
  const summary = { files: 0, bytes: 0, gzipBytes: 0, brotliBytes: 0 };
  async function walk(current) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const filename = path.join(current, entry.name);
      if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) throw new Error('Build assets must contain only regular files and directories.');
      if (entry.isDirectory()) { await walk(filename); continue; }
      if (!types.has(path.extname(filename).toLowerCase())) continue;
      const bytes = await fs.readFile(filename);
      // Tiny bootstrap/manifest files are cheaper to serve as-is.
      const [gz, br] = bytes.length < 1024 ? [] : await Promise.all([
        gzipAsync(bytes, { level: 6 }),
        brotliAsync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }),
      ]);
      if (bytes.length >= 1024) { summary.files++; summary.bytes += bytes.length; }
      for (const [suffix, compressed, key] of [['gz', gz, 'gzipBytes'], ['br', br, 'brotliBytes']]) {
        const destination = `${filename}.${suffix}`;
        // A rebuilt tree may contain prior sidecars; never follow a link when
        // replacing one, and remove a sidecar if it no longer saves bytes.
        const existing = await fs.lstat(destination).catch(error => { if (error.code !== 'ENOENT') throw error; });
        if (existing && !existing.isFile()) throw new Error('Compressed assets must be regular files.');
        if (existing) await fs.unlink(destination);
        if (compressed && compressed.length < bytes.length) {
          await fs.writeFile(destination, compressed, { flag: 'wx', mode: 0o644 });
          summary[key] += compressed.length;
        } else if (compressed) summary[key] += bytes.length;
      }
    }
  }
  await walk(root);
  return summary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [directory, ...extra] = process.argv.slice(2);
    if (!directory || extra.length) throw new Error('Usage: node scripts/compress-static-assets.mjs <immutable-assets-directory>');
    console.log(JSON.stringify(await compressStaticAssets(directory)));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
