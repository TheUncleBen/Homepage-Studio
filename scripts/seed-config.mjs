import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const EMPTY_CONFIG = Object.freeze({
  'services.yaml': '[]\n', 'widgets.yaml': '[]\n', 'bookmarks.yaml': '[]\n',
  'settings.yaml': '{}\n', 'docker.yaml': '{}\n', 'kubernetes.yaml': '{}\n',
  'proxmox.yaml': '{}\n', 'custom.css': '', 'custom.js': '',
});

async function realDirectory(directory, mode = 0o750) {
  const resolved = path.resolve(directory);
  let current = path.parse(resolved).root;
  for (const part of resolved.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    let stat;
    try { stat = await fs.lstat(current); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      try { await fs.mkdir(current, { mode }); }
      catch (mkdirError) { if (mkdirError.code !== 'EEXIST') throw mkdirError; }
      stat = await fs.lstat(current);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Configuration paths must use real directories.');
  }
  return resolved;
}

export async function seedConfig({ configDir, stateDir }) {
  const config = await realDirectory(configDir);
  const state = await realDirectory(stateDir, 0o700);
  // Recovery owns an interrupted transaction's original and missing files.
  // Let the writer recover before it completes initialization; an eager empty
  // file here could otherwise look like an unrelated edit to the journal.
  try {
    const journal = await fs.lstat(path.join(state, 'transaction.json'));
    if (!journal.isFile() || journal.isSymbolicLink()) throw new Error('The transaction journal must be a regular file.');
    return { created: [], recoveryPending: true };
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const created = [];
  for (const [name, contents] of Object.entries(EMPTY_CONFIG)) {
    const filename = path.join(config, name);
    let handle;
    try {
      handle = await fs.open(filename, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o640);
      await handle.writeFile(contents, 'utf8');
      await handle.sync();
      created.push(name);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const stat = await fs.lstat(filename);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Existing configuration files must be regular files.');
    } finally { await handle?.close(); }
  }
  const directory = await fs.open(config, constants.O_RDONLY | constants.O_DIRECTORY);
  try { await directory.sync(); } finally { await directory.close(); }
  return { created, recoveryPending: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await seedConfig({ configDir: process.env.HOMEPAGE_CONFIG_DIR || '/app/config', stateDir: process.env.STUDIO_STATE_DIR || '/app/state' });
    console.log(`Studio initialized ${result.created.length} missing configuration files.`);
  } catch (error) {
    console.error('Studio could not initialize configuration storage:', error.code || error.message);
    process.exitCode = 1;
  }
}
