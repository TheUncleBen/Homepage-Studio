import { join, resolve } from 'node:path';

export const DASHBOARD_REGISTRY_FILE = 'studio-dashboards.json';
export const DASHBOARD_REGISTRY_MARKER = 'studio-dashboards.initialized';
export const MAX_DASHBOARDS = 64;
export const MAX_REGISTRY_BYTES = 128 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const reserved = new Set(['api', 'images', 'icons', 'locales', 'assets', 'public', 'fonts', 'config', 'dashboards']);
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
  if (slug === '' && id === 'default') return slug;
  if (typeof slug !== 'string' || slug.length > 64 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug) || reserved.has(slug)) throw new DashboardError('Use a unique address of 1 to 64 lowercase letters, numbers or internal hyphens, without a reserved application path.', 'INVALID_DASHBOARD_SLUG');
  return slug;
}
const exactKeys = (value, keys) => value && !Array.isArray(value) && typeof value === 'object' && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
export function validateDashboardManifest(value) {
  const invalid = () => { throw new DashboardError('The dashboard registry is invalid. Existing dashboard files have not been changed.', 'INVALID_DASHBOARD_REGISTRY', 503); };
  if (!exactKeys(value, ['version', 'revision', 'dashboards']) || value.version !== 1 || typeof value.revision !== 'string' || !uuid.test(value.revision) || !Array.isArray(value.dashboards) || !value.dashboards.length || value.dashboards.length > MAX_DASHBOARDS) invalid();
  const ids = new Set(), slugs = new Set();
  try {
    for (const entry of value.dashboards) {
      if (!exactKeys(entry, ['id', 'name', 'slug', 'archived']) || typeof entry.archived !== 'boolean') invalid();
      validateDashboardId(entry.id); validateDashboardSlug(entry.slug, entry.id);
      if (validateDashboardName(entry.name) !== entry.name || ids.has(entry.id) || slugs.has(entry.slug) || (entry.id === 'default' && entry.archived)) invalid();
      ids.add(entry.id); slugs.add(entry.slug);
    }
  } catch { invalid(); }
  if (!ids.has('default')) invalid();
  return value;
}
export const dashboardBasePath = entry => entry.slug ? '/' + validateDashboardSlug(entry.slug, entry.id) : '';
export function dashboardConfigDir(root, id) {
  validateDashboardId(id);
  return id === 'default' ? resolve(root) : join(resolve(root), 'dashboards', id);
}
export const dashboardStateDir = dashboardConfigDir;
