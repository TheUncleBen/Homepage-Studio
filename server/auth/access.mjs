// Pure access rules: who can open which dashboard, at which level, and which
// session policy applies. Kept free of I/O so every rule is unit tested.

// Owner decision D4 (23 Oct 2026): members get View or Arrange. Widget and
// integration settings, raw files, custom CSS/JS, import/export and access
// lists stay with administrators.
export const LEVELS = ['none', 'view', 'arrange', 'admin'];
export const GRANT_LEVELS = ['view', 'arrange'];
export const rank = level => LEVELS.indexOf(level);
export const atLeast = (level, required) => rank(level) >= rank(required);

// Groups a user belongs to: local groups by id, identity-provider groups by
// the names the provider last reported.
export function userGroupIds(data, user) {
  const idpNames = new Set(user.oidcGroups ?? []);
  const local = new Set(user.groupIds ?? []);
  return data.groups.filter(group => (group.kind === 'idp' ? idpNames.has(group.name) : local.has(group.id))).map(group => group.id);
}

export function dashboardLevel(data, user, dashboardId) {
  if (!user || user.disabled) return 'none';
  if (user.role === 'admin') return 'admin';
  const subjects = new Set(['user:' + user.id, ...userGroupIds(data, user).map(id => 'group:' + id)]);
  let best = 'none';
  for (const grant of data.grants[dashboardId] ?? []) {
    if (subjects.has(grant.subject) && rank(grant.level) > rank(best)) best = grant.level;
  }
  return best;
}

// A user's own policy wins. Otherwise the strictest value of each setting
// across their groups' policies applies, and the default fills the rest.
export function effectivePolicy(data, user) {
  const byId = new Map(data.policies.map(policy => [policy.id, policy]));
  const fallback = byId.get('default');
  if (user.policyId && byId.has(user.policyId)) return { ...byId.get(user.policyId) };
  const policies = userGroupIds(data, user)
    .map(id => data.groups.find(group => group.id === id)?.policyId)
    .filter(id => id && byId.has(id))
    .map(id => byId.get(id));
  if (!policies.length) return { ...fallback };
  const minimum = key => {
    const values = policies.map(policy => policy[key]);
    // null means "never": any finite limit is stricter.
    const finite = values.filter(value => value !== null && value !== undefined);
    return finite.length ? Math.min(...finite) : null;
  };
  return {
    id: policies.map(policy => policy.id).join('+'),
    name: policies.map(policy => policy.name).join(' + '),
    idleMinutes: minimum('idleMinutes'),
    absoluteMinutes: minimum('absoluteMinutes'),
    persistent: policies.every(policy => policy.persistent),
    stepUpMinutes: Math.min(...policies.map(policy => policy.stepUpMinutes)),
    maxSessions: minimum('maxSessions'),
  };
}

// Where the bare address takes someone. An administrator goes to the
// Dashboards page unless they chose a dashboard of their own. A member goes
// to their own default, else the default of the first of their groups (in
// the order set under Administration → Groups) that has one. Only
// dashboards the person can open count; null means the Dashboards page.
export function landingDashboard(data, user, dashboards) {
  const usable = id => typeof id === 'string' && dashboards.some(entry => entry.id === id && !entry.archived) && dashboardLevel(data, user, id) !== 'none';
  if (usable(user.defaultDashboardId)) return user.defaultDashboardId;
  if (user.role === 'admin') return null;
  const mine = new Set(userGroupIds(data, user));
  for (const group of data.groups) {
    if (mine.has(group.id) && usable(group.defaultDashboardId)) return group.defaultDashboardId;
  }
  return null;
}

// Required level for a dashboard-relative request. Anything under
// /studio/ that is not listed needs an administrator (default deny).
const VIEW_GET = new Set(['/studio/api/board', '/studio/api/access', '/studio/catalog.json', '/studio/logo']);
const ARRANGE_POST = new Set(['/studio/api/board', '/studio/api/discovery-visibility', '/studio/api/appearance', '/studio/api/logo']);
// The editor and settings pages are opened from the Dashboards page.
const ARRANGE_GET = new Set(['/studio/api/appearance', '/studio/edit', '/studio/settings']);
// Admin operations that also need a recent sign-in.
const STEP_UP = new Set(['POST /studio/api/save', 'POST /studio/api/import', 'POST /studio/api/restore', 'GET /studio/api/export']);

export function requiredLevel(method, path) {
  if (!path.startsWith('/studio/')) {
    // The native MCP endpoint has its own bearer-token model. It stays off
    // while Studio sign-in is on.
    if (path === '/api/mcp' || path.startsWith('/api/mcp/')) return { level: 'blocked' };
    return { level: 'view' };
  }
  const read = method === 'GET' || method === 'HEAD';
  if (read && VIEW_GET.has(path)) return { level: 'view' };
  if (read && ARRANGE_GET.has(path)) return { level: 'arrange' };
  if (method === 'POST' && ARRANGE_POST.has(path)) return { level: 'arrange' };
  const stepUp = STEP_UP.has(`${read ? 'GET' : method} ${path}`) || (read && path.startsWith('/studio/api/backups/'));
  return { level: 'admin', stepUp };
}

export function validGrantList(list, data) {
  if (!Array.isArray(list) || list.length > 500) return false;
  const users = new Set(data.users.map(user => 'user:' + user.id));
  const groups = new Set(data.groups.map(group => 'group:' + group.id));
  const seen = new Set();
  for (const grant of list) {
    if (!grant || typeof grant !== 'object' || Object.keys(grant).some(key => !['subject', 'level'].includes(key))) return false;
    if (!GRANT_LEVELS.includes(grant.level) || typeof grant.subject !== 'string' || seen.has(grant.subject)) return false;
    if (!users.has(grant.subject) && !groups.has(grant.subject)) return false;
    seen.add(grant.subject);
  }
  return true;
}
