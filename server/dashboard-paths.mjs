import { join, resolve } from 'node:path';

export const DASHBOARD_REGISTRY_FILE = 'studio-dashboards.json';
export const DASHBOARD_REGISTRY_MARKER = 'studio-dashboards.initialized';
export const MAX_DASHBOARDS = 64;
export const MAX_REGISTRY_BYTES = 128 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const reserved = new Set(['api', 'images', 'icons', 'locales', 'assets', 'public', 'fonts', 'config', 'dashboards', 'studio', 'studio-icons']);
export class DashboardError extends Error {
  constructor(message, code = 'INVALID_DASHBOARD', status = 400) {
    super(message); this.name = 'DashboardError'; this.code = code; this.status = status;
  }
}
export function validateDashboardId(id) {
  if (id !== 'default' && (typeof id !== 'string' || !uuid.test(id))) throw new DashboardError('Invalid dashboard identity.', 'INVALID_DASHBOARD_ID');
  return id;
}
export function validateDashboardName(name) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 100 || /[\u0000-\u001f\u007f]/.test(name)) throw new DashboardError('Give the dashboard a name of 1 to 100 characters.', 'INVALID_DASHBOARD_NAME');
  return name.trim();
}
export function validateDashboardSlug(slug, id) {
  // The main dashboard has no address until an administrator picks one.
  if (slug === '' && id === 'default') return slug;
  if (typeof slug !== 'string' || slug.length > 64 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug) || reserved.has(slug)) throw new DashboardError('Use a unique address of 1 to 64 lowercase letters, numbers or internal hyphens, without a reserved application path.', 'INVALID_DASHBOARD_SLUG');
  return slug;
}
const exactKeys = (value, keys) => value && !Array.isArray(value) && typeof value === 'object' && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
// How long an archived dashboard is kept before it is deleted for good
// (owner request E3, board 28): days, or never. 30 is the default and is
// never stored.
export const ARCHIVE_RETENTION = Object.freeze([7, 30, 90, 'never']);
export const DEFAULT_ARCHIVE_RETENTION = 30;
export const archiveRetentionOf = manifest => manifest.archiveRetention ?? DEFAULT_ARCHIVE_RETENTION;
// When an archived dashboard is deleted automatically, or null for never.
export function archiveDeletesAt(entry, retention) {
  if (!entry.archived || retention === 'never' || !entry.archivedAt) return null;
  return new Date(Date.parse(entry.archivedAt) + retention * 24 * 60 * 60 * 1000).toISOString();
}
export function validateDashboardManifest(value) {
  const invalid = () => { throw new DashboardError('The dashboard registry is invalid. Existing dashboard files have not been changed.', 'INVALID_DASHBOARD_REGISTRY', 503); };
  const retention = Object.hasOwn(value ?? {}, 'archiveRetention');
  if (retention && (!ARCHIVE_RETENTION.includes(value.archiveRetention) || value.archiveRetention === DEFAULT_ARCHIVE_RETENTION)) invalid();
  if (!exactKeys(value, ['version', 'revision', 'dashboards', ...(retention ? ['archiveRetention'] : [])]) || value.version !== 1 || typeof value.revision !== 'string' || !uuid.test(value.revision) || !Array.isArray(value.dashboards) || !value.dashboards.length || value.dashboards.length > MAX_DASHBOARDS) invalid();
  const ids = new Set(), slugs = new Set();
  try {
    for (const entry of value.dashboards) {
      // An archived dashboard says when it was archived.
      if (!exactKeys(entry, ['id', 'name', 'slug', 'archived', ...(entry?.archived ? ['archivedAt'] : [])]) || typeof entry.archived !== 'boolean') invalid();
      if (entry.archived && (typeof entry.archivedAt !== 'string' || !Number.isFinite(Date.parse(entry.archivedAt)))) invalid();
      validateDashboardId(entry.id); validateDashboardSlug(entry.slug, entry.id);
      if (validateDashboardName(entry.name) !== entry.name || ids.has(entry.id) || slugs.has(entry.slug) || (entry.id === 'default' && entry.archived)) invalid();
      ids.add(entry.id); slugs.add(entry.slug);
    }
  } catch { invalid(); }
  if (!ids.has('default')) invalid();
  return value;
}
// The suggested address for a new dashboard: the lowest free of "dashboard",
// "dashboard-2", "dashboard-3", …, counting archived dashboards as taken.
export function suggestedDashboardSlug(dashboards) {
  const taken = new Set(dashboards.map(entry => entry.slug));
  let slug = 'dashboard';
  for (let n = 2; taken.has(slug); n++) slug = 'dashboard-' + n;
  return slug;
}
export const dashboardBasePath = entry => entry.slug ? '/' + validateDashboardSlug(entry.slug, entry.id) : '';
export function dashboardConfigDir(root, id) {
  validateDashboardId(id);
  return id === 'default' ? resolve(root) : join(resolve(root), 'dashboards', id);
}
export const dashboardStateDir = dashboardConfigDir;
