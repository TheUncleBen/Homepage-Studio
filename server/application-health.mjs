import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { DashboardError } from './dashboard-paths.mjs';

async function storageRoot(directory) {
  let handle, probe, owned = false;
  try {
    if (await fs.realpath(directory) !== resolve(directory) || !(await fs.lstat(directory)).isDirectory()) throw new Error('Noncanonical storage');
    probe = join(directory, '.studio-application-ready-' + randomUUID() + '.tmp');
    handle = await fs.open(probe, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    owned = true;
    await handle.writeFile('storage check\n'); await handle.sync();
  } catch {
    throw new DashboardError('Application storage is unavailable or not writable. Check the configuration and state volume paths and permissions.', 'APPLICATION_STORAGE_UNAVAILABLE', 503);
  } finally {
    await handle?.close();
    if (owned) await fs.unlink(probe).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
export async function checkApplicationReadiness({ configRoot, stateRoot, rendererDir }) {
  await storageRoot(configRoot); await storageRoot(stateRoot);
  try {
    for (const name of ['server.js', '.next/BUILD_ID', '.next/build-manifest.json']) {
      const file = await fs.open(join(rendererDir, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try { const stat = await file.stat(); if (!stat.isFile() || !stat.size) throw new Error('Missing runtime file'); } finally { await file.close(); }
    }
    for (const name of ['.next/static', 'public']) {
      const directory = join(rendererDir, name);
      if (!(await fs.lstat(directory)).isDirectory()) throw new Error('Missing application assets');
      await fs.access(directory, constants.R_OK | constants.X_OK);
    }
  } catch {
    throw new DashboardError('The controlled application build is incomplete or unreadable. Replace it with the complete qualified image.', 'APPLICATION_RUNTIME_UNAVAILABLE', 503);
  }
  return { dashboardRegistry: 'ok', sharedStorage: 'ok', runtimeFiles: 'ok' };
}
