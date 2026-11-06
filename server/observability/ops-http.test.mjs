// Operations through the real controller (build addendum, 6 Nov 2026): each
// person sees only the dashboards an administrator gave them Monitoring or
// Logs on, export is for administrators, and with sign-in off Operations is
// closed.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStudioServer, NATIVE_PROTOCOL, UPSTREAM_COMMIT } from '../index.mjs';
import { base32Decode, hotp, totpStep } from '../auth/primitives.mjs';
const onPrimary = target => (/^\/(?:api\/|studio\/(?:api\/(?!dashboards|overview|preview|platform|backups|saved-items|trusted-certificates|ops\/)|catalog\.json|edit|settings)|_next\/(?!static\/))/.test(target) ? '/home' + target : target);

const HOST = 'localhost:3001';
const ORIGIN = `http://${HOST}`;
const PASSWORD = 'correct horse battery staple';

async function listen(server) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return server.address().port;
}
async function close(server) {
  server.closeAllConnections?.();
  await new Promise(resolve => server.close(resolve));
}

async function setup(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'homepage-studio-ops-'));
  const configDir = path.join(directory, 'config');
  const stateDir = path.join(directory, 'state');
  await fs.mkdir(configDir);
  await fs.writeFile(path.join(configDir, 'services.yaml'), '[]\n');
  await fs.writeFile(path.join(configDir, 'widgets.yaml'), '[]\n');
  await fs.writeFile(path.join(configDir, 'settings.yaml'), 'title: Auth test\n');
  await fs.writeFile(path.join(configDir, 'bookmarks.yaml'), '[]\n');
  for (const file of ['docker.yaml', 'kubernetes.yaml', 'proxmox.yaml']) await fs.writeFile(path.join(configDir, file), '{}\n');
  const upstreamCalls = [];
  const upstream = http.createServer((req, res) => {
    upstreamCalls.push({ method: req.method, url: req.url, headers: req.headers });
    if (req.url === '/api/studio/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ protocolVersion: NATIVE_PROTOCOL, upstreamCommit: UPSTREAM_COMMIT, buildRevision: 'unreleased' })); }
    if (req.url === '/api/studio/sources') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ protocolVersion: NATIVE_PROTOCOL, upstreamCommit: UPSTREAM_COMMIT, sources: [], warnings: [] })); }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><title>native</title>');
  });
  const upstreamPort = await listen(upstream);
  const app = createStudioServer({ configDir, stateDir, upstream: `http://127.0.0.1:${upstreamPort}`, allowedHosts: HOST, auth: 'on', publicOrigin: ORIGIN, ...options });
  const port = await listen(app.server);
  t.after(async () => {
    await close(app.server);
    await close(upstream);
    await app.shutdown({ graceMs: 0 }).catch(() => {});
    await fs.rm(directory, { recursive: true, force: true });
  });
  function request(target, { method = 'GET', headers = {}, body, cookie } = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: onPrimary(target), method, agent: false, headers: { host: HOST, ...(cookie ? { cookie } : {}), ...headers } }, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json; try { json = JSON.parse(text); } catch {}
          resolve({ status: res.statusCode, headers: res.headers, text, json });
        });
      });
      req.on('error', reject);
      req.setTimeout(10000, () => req.destroy(new Error('Request timed out.')));
      req.end(body);
    });
  }
  const post = (target, value, { cookie, headers = {} } = {}) => request(target, { method: 'POST', cookie, body: JSON.stringify(value ?? {}), headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-studio-request': '1', ...headers } });
  return { request, post, stateDir, upstreamCalls, app };
}

const sessionCookie = response => {
  const value = [].concat(response.headers['set-cookie'] ?? []).map(item => item.split(';')[0]).find(item => item.startsWith('studio_session=') && item.length > 'studio_session='.length);
  assert.ok(value, 'a session cookie is set');
  return value;
};
const currentCode = secret => hotp(base32Decode(secret), totpStep());
const html = { accept: 'text/html,application/xhtml+xml' };

async function createAdmin({ request, post }) {
  const started = await post('/studio/auth/setup/start', { username: 'admin', displayName: 'Admin', password: PASSWORD });
  assert.equal(started.status, 200, started.text);
  const totp = await post('/studio/auth/enroll/totp/start', { token: started.json.token });
  assert.match(totp.json.qr, /^data:image\/svg\+xml;base64,/);
  const confirmed = await post('/studio/auth/enroll/totp/confirm', { token: started.json.token, code: currentCode(totp.json.secret) });
  assert.equal(confirmed.json.enrollment.complete, true);
  const finished = await post('/studio/auth/enroll/finish', { token: started.json.token });
  assert.equal(finished.status, 200, finished.text);
  assert.equal(finished.json.backupCodes.length, 10);
  const cookie = sessionCookie(finished);
  // A new deployment's main dashboard has no address: the first
  // administrator is asked for one, suggested as "dashboard".
  const overview = await request('/studio/api/overview', { cookie });
  assert.equal(overview.json.mainNeedsAddress, true);
  assert.equal(overview.json.suggestedSlug, 'dashboard');
  const dashboardPage = await request('/home/studio/edit', { cookie, headers: html });
  assert.equal(dashboardPage.status, 404, 'nothing answers at an address that was never chosen');
  const registry = await request('/studio/api/dashboards', { cookie });
  const addressed = await post('/studio/api/dashboards', { revision: registry.json.revision, action: 'update', id: 'default', name: 'Main dashboard', slug: 'home' }, { cookie });
  assert.equal(addressed.status, 200, addressed.text);
  assert.equal((await request('/studio/api/overview', { cookie })).json.mainNeedsAddress, false);
  return { cookie, backupCodes: finished.json.backupCodes, request };
}

async function inviteMember({ post }, adminCookie, username = 'member') {
  const invited = await post('/studio/auth/admin/invite', { username, displayName: 'Member' }, { cookie: adminCookie });
  assert.equal(invited.status, 200, invited.text);
  const invite = new URL(invited.json.link).hash.slice(1);
  assert.equal(new URL(invited.json.link).pathname, '/studio/auth/enroll');
  const started = await post('/studio/auth/invite/start', { invite, password: PASSWORD });
  assert.equal(started.status, 200, started.text);
  const totp = await post('/studio/auth/enroll/totp/start', { token: started.json.token });
  await post('/studio/auth/enroll/totp/confirm', { token: started.json.token, code: currentCode(totp.json.secret) });
  const finished = await post('/studio/auth/enroll/finish', { token: started.json.token });
  assert.equal(finished.status, 200, finished.text);
  // The invitation works once.
  assert.equal((await post('/studio/auth/invite/details', { invite })).status, 410);
  return { cookie: sessionCookie(finished), backupCodes: finished.json.backupCodes, invited: invited.json.user };
}


const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function eventually(fn, { tries = 40, every = 250 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) { last = await fn(); if (last) return last; await wait(every); }
  return last;
}

test('each person sees only the dashboards given to them; export and settings stay with administrators', async t => {
  const context = await setup(t);
  const { request, post } = context;
  const admin = await createAdmin(context);
  const member = await inviteMember(context, admin.cookie);
  const registry = await request('/studio/api/dashboards', { cookie: admin.cookie });
  const created = await post('/studio/api/dashboards', { revision: registry.json.revision, action: 'create', name: 'Lab', slug: 'lab' }, { cookie: admin.cookie });
  assert.equal(created.status, 200, created.text);
  const lab = created.json.dashboard.id;

  // Push monitors on each dashboard, and an intake source on Lab.
  const home = await post('/studio/api/ops/config', { kind: 'monitor', action: 'save', item: { name: 'Home backup', scope: 'default', type: 'push', push: { period: 3600 } } }, { cookie: admin.cookie });
  assert.equal(home.status, 200, home.text);
  assert.match(home.json.token, /^[A-Za-z0-9_-]{20,}$/, 'a new push monitor shows its token once');
  assert.equal(home.json.item.push.tokenHash, undefined, 'the token hash is never sent');
  const labMonitor = await post('/studio/api/ops/config', { kind: 'monitor', action: 'save', item: { name: 'Lab backup', scope: lab, type: 'push', push: { period: 3600 } } }, { cookie: admin.cookie });
  assert.equal(labMonitor.status, 200, labMonitor.text);
  const source = await post('/studio/api/ops/config', { kind: 'source', action: 'save', item: { name: 'Lab app', kind: 'https', scope: lab } }, { cookie: admin.cookie });
  assert.equal(source.status, 200, source.text);
  const homeSource = await post('/studio/api/ops/config', { kind: 'source', action: 'save', item: { name: 'Home app', kind: 'https', scope: 'default' } }, { cookie: admin.cookie });

  // Heartbeats: a known token is accepted, an unknown one looks like a missing page.
  assert.equal((await request('/studio/push/' + home.json.token)).status, 200);
  assert.equal((await request('/studio/push/' + 'x'.repeat(32))).status, 404);
  // Log intake with each source's token.
  const send = (token, message) => post('/studio/ingest/logs', { events: [{ message, level: 'error' }] }, { headers: { authorization: 'Bearer ' + token } });
  assert.equal((await send(source.json.token, 'lab only failure')).status, 202);
  assert.equal((await send(homeSource.json.token, 'home only failure')).status, 202);
  assert.equal((await send('y'.repeat(32), 'nobody')).status, 401);

  // No grants yet: no Operations at all.
  assert.equal((await request('/studio/api/ops/access', { cookie: member.cookie })).status, 403);
  // View on both dashboards, Monitoring and Logs on Home only.
  await post('/studio/auth/admin/grants', { dashboardId: 'default', grants: [{ subject: 'user:' + member.invited.id, level: 'view', monitoring: true, logs: true }] }, { cookie: admin.cookie });
  await post('/studio/auth/admin/grants', { dashboardId: lab, grants: [{ subject: 'user:' + member.invited.id, level: 'view' }] }, { cookie: admin.cookie });
  const access = await request('/studio/api/ops/access', { cookie: member.cookie });
  assert.equal(access.status, 200, access.text);
  assert.deepEqual(access.json.dashboards.map(entry => entry.id), ['default']);
  assert.equal(access.json.admin, false);
  const dashboardAccess = await request('/studio/api/access', { cookie: member.cookie });
  assert.deepEqual(dashboardAccess.json.operations, { monitoring: true, logs: true });
  assert.equal(dashboardAccess.json.operationsMenu, true);

  const monitors = await request('/studio/api/ops/monitors', { cookie: member.cookie });
  assert.deepEqual(monitors.json.monitors.map(item => item.name), ['Home backup']);
  assert.equal((await request('/studio/api/ops/monitors/' + labMonitor.json.item.id, { cookie: member.cookie })).status, 404, 'another dashboard\'s monitor looks missing');
  assert.equal((await request('/studio/api/ops/overview?dashboard=' + lab, { cookie: member.cookie })).status, 404);
  const mine = await request('/studio/api/ops/monitors/' + home.json.item.id, { cookie: member.cookie });
  assert.equal(mine.status, 200);
  assert.equal(mine.json.definition, undefined, 'only administrators get the saved settings');

  // Logs: Home's events only, never Lab's, Studio's or sign-in events.
  const search = async (cookie, q = '') => (await request('/studio/api/ops/logs/search?range=1h&q=' + encodeURIComponent(q), { cookie })).json;
  const seen = await eventually(async () => { const result = await search(member.cookie, 'failure'); return result.events?.length ? result : null; });
  assert.deepEqual(seen.events.map(event => event.message), ['home only failure']);
  const all = await search(member.cookie);
  assert.ok(all.events.every(event => event.scope === 'default'), 'nothing from another dashboard or Studio');
  const adminView = await eventually(async () => { const result = await search(admin.cookie, 'type:auth.*'); return result.events?.length ? result : null; });
  assert.ok(adminView.events.some(event => event.event_type === 'auth.signed-in' || event.event_type === 'auth.setup-completed'), 'administrators see sign-in events');
  assert.equal((await search(member.cookie, 'type:auth.*')).events.length, 0);
  // Dashboard changes are audit events: administrators see who made them.
  const changes = await eventually(async () => { const result = await search(admin.cookie, 'type:dashboard.*'); return result.events?.length ? result : null; });
  assert.ok(changes.events.some(event => event.event_type === 'dashboard.create' && event.actor === 'admin' && /Lab/.test(event.message)));
  assert.equal((await search(member.cookie, 'type:dashboard.*')).events.length, 0);
  assert.equal((await request('/studio/api/ops/logs/search?range=1h&dashboard=' + lab, { cookie: member.cookie })).status, 404);

  // Settings and export are for administrators.
  assert.equal((await request('/studio/api/ops/config', { cookie: member.cookie })).status, 403);
  assert.equal((await post('/studio/api/ops/config', { kind: 'monitor', action: 'delete', id: home.json.item.id }, { cookie: member.cookie })).status, 403);
  assert.equal((await request('/studio/api/ops/logs/export?range=1h', { cookie: member.cookie })).status, 403);
  const exported = await request('/studio/api/ops/logs/export?range=1h&format=csv', { cookie: admin.cookie });
  assert.equal(exported.status, 200);
  assert.match(exported.headers['content-disposition'], /attachment; filename="studio-logs-/);
  assert.match(exported.text, /lab only failure/);

  // Monitoring without Logs: monitors yes, logs no.
  await post('/studio/auth/admin/grants', { dashboardId: 'default', grants: [{ subject: 'user:' + member.invited.id, level: 'view', monitoring: true }] }, { cookie: admin.cookie });
  assert.equal((await request('/studio/api/ops/logs/search?range=1h', { cookie: member.cookie })).status, 403);
  assert.equal((await request('/studio/api/ops/monitors', { cookie: member.cookie })).status, 200);

  // Cards' status is open to anyone who can view the dashboard.
  const panels = await request('/studio/api/panel-status', { cookie: member.cookie });
  assert.equal(panels.status, 200);
  assert.equal(typeof panels.json.panels, 'object');
});

test('with sign-in off, Operations, export and log intake are closed', async t => {
  const context = await setup(t, { auth: 'off' });
  const { request, post } = context;
  for (const target of ['/studio/api/ops/access', '/studio/api/ops/logs/export?range=1h', '/studio/api/ops/config']) {
    const answer = await request(target);
    assert.equal(answer.status, 404, target);
  }
  assert.notEqual((await request('/studio/operations', { headers: html })).status, 200);
  assert.equal((await post('/studio/ingest/logs', { message: 'x' }, { headers: { authorization: 'Bearer ' + 'z'.repeat(32) } })).status, 404);
  assert.equal((await post('/studio/api/client-errors', { errors: [{ message: 'x' }] })).status, 404);
  const registry = await request('/studio/api/dashboards');
  await post('/studio/api/dashboards', { revision: registry.json.revision, action: 'update', id: 'default', name: 'Main dashboard', slug: 'home' });
  const panels = await request('/studio/api/panel-status');
  assert.equal(panels.status, 200, 'cards still get their status');
});
