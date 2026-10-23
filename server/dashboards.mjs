import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  DASHBOARD_REGISTRY_FILE, DASHBOARD_REGISTRY_MARKER, MAX_DASHBOARDS, MAX_REGISTRY_BYTES,
  DashboardError, validateDashboardManifest, validateDashboardName, validateDashboardSlug, dashboardBasePath,
} from './dashboard-paths.mjs';

const copy = value => structuredClone(value);
const missing = () => { throw new DashboardError('That dashboard is unavailable. Its address may have changed or it may be archived.', 'DASHBOARD_NOT_FOUND', 404); };
const conflict = () => { throw new DashboardError('The dashboard list changed. Reload the list before applying this change; your draft is still available.', 'DASHBOARD_REVISION_CONFLICT', 409); };
async function realDirectory(directory, create = false) {
  let current = '/';
  for (const part of resolve(directory).split('/').filter(Boolean)) {
    current = join(current, part);
    if (create) try { await fs.mkdir(current, { mode: 0o750 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new DashboardError('Dashboard storage must use real directories without symbolic links.', 'UNSAFE_DASHBOARD_STORAGE', 503);
  }
}
async function readRegistry(file) {
  let handle;
  try {
    handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_REGISTRY_BYTES) throw new Error('Invalid registry file');
    const text = await handle.readFile('utf8');
    if (Buffer.byteLength(text) > MAX_REGISTRY_BYTES) throw new Error('Oversized registry');
    return validateDashboardManifest(JSON.parse(text));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    if (error instanceof DashboardError) throw error;
    throw new DashboardError('The dashboard registry could not be read safely. Existing dashboard files have not been changed.', 'INVALID_DASHBOARD_REGISTRY', 503);
  } finally { await handle?.close(); }
}
async function syncDirectory(directory) {
  const handle = await fs.open(directory, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}
export function createDashboardRegistry({ configRoot, prepareDashboard, cleanupDashboard }) {
  configRoot = resolve(configRoot);
  const registryFile = join(configRoot, DASHBOARD_REGISTRY_FILE);
  const markerFile = join(configRoot, DASHBOARD_REGISTRY_MARKER);
  let queue = Promise.resolve();
  const serial = operation => {
    const result = queue.then(operation, operation);
    queue = result.catch(() => {});
    return result;
  };
  async function read() {
    await realDirectory(configRoot);
    const value = await readRegistry(registryFile);
    if (!value) throw new DashboardError('The dashboard registry is not initialized.', 'DASHBOARDS_NOT_READY', 503);
    return value;
  }
  async function publish(value, previousRevision = null) {
    await realDirectory(configRoot);
    validateDashboardManifest(value);
    const temp = join(configRoot, '.studio-registry-' + randomUUID() + '.tmp');
    let handle;
    try {
      handle = await fs.open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o640);
      await handle.writeFile(JSON.stringify(value, null, 2) + '\n', 'utf8');
      await handle.sync(); await handle.close(); handle = null;
      const current = await readRegistry(registryFile);
      if ((current?.revision ?? null) !== previousRevision) conflict();
      await fs.rename(temp, registryFile);
      await syncDirectory(configRoot);
    } finally {
      await handle?.close();
      await fs.unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }
  async function ensureMarker() {
    const inspect = async () => {
      try {
        const stat = await fs.lstat(markerFile);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new DashboardError('The initialization record is invalid. Restore the complete registry and data set.', 'INVALID_DASHBOARD_REGISTRY', 503);
        return stat;
      } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    };
    if ((await inspect())?.size === 2) return;
    // Only a validated registry permits repair of an interrupted regular marker.
    // Missing registries with any marker fail closed before this operation.
    const temp = join(configRoot, '.studio-marker-' + randomUUID() + '.tmp');
    let handle;
    try {
      handle = await fs.open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o640);
      await handle.writeFile('1\n'); await handle.sync(); await handle.close(); handle = null;
      await inspect(); await fs.rename(temp, markerFile); await syncDirectory(configRoot);
    } finally {
      await handle?.close();
      await fs.unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }
  async function assertFirstUse() {
    let marker = false;
    try { await fs.lstat(markerFile); marker = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    let children = [];
    try { children = await fs.readdir(join(configRoot, 'dashboards')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (marker || children.length) throw new DashboardError('The dashboard registry is missing from an initialized deployment. Restore studio-dashboards.json from the same backup as its dashboard files; existing data has not been changed.', 'DASHBOARD_REGISTRY_MISSING', 503);
  }
  return {
    initialize: () => serial(async () => {
      await realDirectory(configRoot, true);
      let manifest = await readRegistry(registryFile);
      if (!manifest) {
        await assertFirstUse();
        manifest = { version: 1, revision: randomUUID(), dashboards: [{ id: 'default', slug: '', name: 'Main dashboard', archived: false }] };
        await prepareDashboard(manifest.dashboards[0]);
        await publish(manifest);
      }
      await ensureMarker();
      return copy(manifest);
    }),
    read: async () => copy(await read()),
    mutate: change => serial(async () => {
      if (!change || typeof change !== 'object' || Array.isArray(change)) throw new DashboardError('Choose a dashboard operation.', 'INVALID_DASHBOARD_ACTION');
      const fields = { create: ['name', 'slug', 'sourceId'], update: ['id', 'name', 'slug'], archive: ['id', 'confirmed'], restore: ['id'] };
      if (!Object.hasOwn(fields, change.action)) throw new DashboardError('Choose a supported dashboard operation.', 'INVALID_DASHBOARD_ACTION');
      const allowed = new Set(['revision', 'action', ...fields[change.action]]);
      if (Object.keys(change).some(key => !allowed.has(key))) throw new DashboardError('Unexpected dashboard fields.', 'INVALID_DASHBOARD_ACTION');
      const current = await read();
      if (change.revision !== current.revision) conflict();
      const next = copy(current);
      let entry, newEntry;
      try {
        if (change.action === 'create') {
          if (current.dashboards.length >= MAX_DASHBOARDS) throw new DashboardError('This deployment supports up to ' + MAX_DASHBOARDS + ' dashboards, including archives.', 'DASHBOARD_LIMIT');
          entry = { id: randomUUID(), name: validateDashboardName(change.name), slug: validateDashboardSlug(change.slug), archived: false };
          if (current.dashboards.some(item => item.slug === entry.slug)) throw new DashboardError('That address is already used by an active or archived dashboard.', 'DASHBOARD_SLUG_CONFLICT', 409);
          const source = change.sourceId === undefined ? null : current.dashboards.find(item => item.id === change.sourceId && !item.archived);
          if (change.sourceId !== undefined && !source) missing();
          newEntry = entry;
          await prepareDashboard(entry, source, { isNew: true });
          next.dashboards.push(entry);
        } else {
          entry = next.dashboards.find(item => item.id === change.id);
          if (!entry) missing();
          if (change.action === 'update') {
            entry.name = validateDashboardName(change.name);
            entry.slug = validateDashboardSlug(change.slug, entry.id);
            if (next.dashboards.some(item => item.id !== entry.id && item.slug === entry.slug)) throw new DashboardError('That address is already used by an active or archived dashboard.', 'DASHBOARD_SLUG_CONFLICT', 409);
          } else if (change.action === 'archive') {
            if (entry.id === 'default') throw new DashboardError('The original dashboard must remain available. You can rename it or change its address.', 'DEFAULT_DASHBOARD_REQUIRED');
            if (change.confirmed !== true) throw new DashboardError('Confirm archiving this dashboard. Its files and snapshots will be retained.', 'DASHBOARD_CONFIRMATION_REQUIRED');
            entry.archived = true;
          } else {
            await prepareDashboard(entry); entry.archived = false;
          }
        }
        next.revision = randomUUID();
        await publish(next, current.revision);
        return { registry: copy(next), dashboard: copy(entry) };
      } catch (error) {
        if (newEntry && cleanupDashboard) {
          // Publication can have renamed the registry before a directory sync
          // failed. Only a valid, re-read manifest can prove this id is unused.
          const observed = await read().catch(() => null);
          if (observed && !observed.dashboards.some(item => item.id === newEntry.id)) {
            try { await cleanupDashboard(copy(newEntry)); }
            catch { console.error('Unpublished dashboard cleanup failed:', 'DASHBOARD_CLEANUP_FAILED'); }
          }
        }
        throw error;
      }
    }),
  };
}
export const sharedPublic = path => /^\/(?:_next\/static\/|images\/|icons\/|locales\/|fonts\/|assets\/)/.test(path) || /^\/(?:favicon\.ico|homepage\.ico|favicon-(?:16x16|32x32)\.png|apple-touch-icon\.png|android-chrome-(?:192x192|512x512)\.png|mstile-(?:70x70|144x144|150x150|310x150|310x310)\.png|safari-pinned-tab\.svg)$/.test(path);
export function resolveDashboardRoute(manifest, target) {
  if (typeof target !== 'string' || !target.startsWith('/') || target.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(target)) throw new DashboardError('Unsupported request target.', 'INVALID_DASHBOARD_PATH');
  const [pathname] = target.split('?');
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { throw new DashboardError('Malformed dashboard address.', 'INVALID_DASHBOARD_PATH'); }
  if (/%(?:2f|5c|00)/i.test(pathname) || decoded.includes('\\') || decoded.split('/').some(part => part === '.' || part === '..') || /[\u0000-\u001f\u007f]/.test(decoded)) throw new DashboardError('Unsupported dashboard path.', 'INVALID_DASHBOARD_PATH');
  const primary = manifest.dashboards.find(entry => entry.id === 'default');
  if (pathname === '/') return { dashboard: primary, path: target, redirect: primary.slug ? dashboardBasePath(primary) + target.slice(1) : null };
  const named = manifest.dashboards.find(entry => entry.slug && entry.slug === pathname.split('/')[1]);
  if (named) {
    if (named.archived) missing();
    const remainder = target.slice(named.slug.length + 1);
    return { dashboard: named, path: remainder.startsWith('/') ? remainder : '/' + remainder, redirect: null };
  }
  if (sharedPublic(pathname)) return { dashboard: primary, path: target, shared: true, redirect: null };
  if (!primary.slug && (pathname.startsWith('/api/') || pathname.startsWith('/__studio/') || pathname.startsWith('/_next/') || ['/site.webmanifest', '/browserconfig.xml', '/robots.txt'].includes(pathname))) return { dashboard: primary, path: target, redirect: null };
  missing();
}
