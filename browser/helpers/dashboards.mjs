import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

import { expect, studioApi } from './dashboard.mjs';

export const fixtureId = () => randomUUID().slice(0, 8);
export const dashboardPath = (dashboard, route = '') => `${dashboard.slug ? `/${dashboard.slug}` : ''}${route || '/'}`;

export async function registryMutation(request, action, fields) {
  const registry = await studioApi(request, '/studio/api/dashboards');
  return studioApi(request, '/studio/api/dashboards', { action, revision: registry.revision, ...fields });
}

export async function dashboardSave(request, dashboard, changes) {
  const state = await studioApi(request, dashboardPath(dashboard, '/studio/api/state'));
  const saved = await studioApi(request, dashboardPath(dashboard, '/studio/api/save'), { revision: state.revision, ...changes });
  await studioApi(request, dashboardPath(dashboard, '/api/revalidate'));
  return saved;
}

export async function archiveFixtures(request, ids) {
  for (const id of ids) {
    const registry = await studioApi(request, '/studio/api/dashboards');
    if (registry.dashboards.some(entry => entry.id === id && !entry.archived))
      await studioApi(request, '/studio/api/dashboards', { action: 'archive', id, confirmed: true, revision: registry.revision });
  }
}

// The same upstream URL and cookie name are deliberately used by both native
// renderer workers. A shared cookie jar would send the other dashboard's cookie.
export async function privateUpstreamFixture() {
  const suffix = fixtureId();
  const users = ['Alpha', 'Beta'].map(name => ({ name, token: `fixture-${name.toLowerCase()}-${suffix}`, cookie: `session-${name.toLowerCase()}-${suffix}` }));
  const calls = [];
  const violations = [];
  const server = createServer((request, response) => {
    const user = users.find(entry => request.headers.authorization === `Bearer ${entry.token}`);
    const cookies = request.headers.cookie || '';
    if (!user || request.url !== '/private-metrics') {
      violations.push('Unexpected upstream authorization or address');
      response.writeHead(403, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Unexpected fixture request' }));
      return;
    }
    const returnedCookie = cookies.split(';').map(value => value.trim()).find(value => value.startsWith('studio_fixture_session='));
    const expected = `studio_fixture_session=${user.cookie}`;
    const cookieReturned = returnedCookie === expected;
    calls.push({ user: user.name, cookieReturned, foreignCookie: Boolean(returnedCookie && !cookieReturned) });
    if (returnedCookie && !cookieReturned) violations.push(`Foreign upstream cookie reached ${user.name}`);
    response.writeHead(200, {
      'content-type': 'application/json', 'cache-control': 'no-store',
      'set-cookie': `${expected}; HttpOnly; Path=/; SameSite=Lax`,
    }).end(JSON.stringify({ owner: `${user.name} private data`, cookie: cookieReturned ? 'Cookie round trip confirmed' : 'Cookie issued' }));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '0.0.0.0', resolve); });
  const host = process.env.STUDIO_BROWSER_FIXTURE_HOST || '127.0.0.1';
  return {
    users, calls, violations, url: `http://${host}:${server.address().port}/private-metrics`,
    async close() { server.closeAllConnections(); await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); },
  };
}
