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
    if (req.url === '/api/studio/sources') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ protocolVersion: NATIVE_PROTOCOL, upstreamCommit: UPSTREAM_COMMIT, sources: options.sources ?? [], warnings: [] })); }
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
  // A ping keeps the monitor up; ?status=down (here by POST, as a script
  // sends it, without the editor header) brings it down.
  const monitorState = async () => (await request('/studio/api/ops/monitors/' + home.json.item.id, { cookie: admin.cookie })).json.monitor.state;
  assert.equal(await eventually(async () => (await monitorState()) === 'up'), true, 'a heartbeat leaves the push monitor up');
  const failed = await request('/studio/push/' + home.json.token + '?status=down', { method: 'POST', body: JSON.stringify({ msg: 'disk full' }), headers: { 'content-type': 'application/json' } });
  assert.equal(failed.status, 200, failed.text);
  assert.equal(await eventually(async () => (await monitorState()) === 'down'), true, '?status=down brings it down');
  assert.equal((await request('/studio/push/' + home.json.token)).status, 200);
  assert.equal(await eventually(async () => (await monitorState()) === 'up'), true, 'the next heartbeat brings it back up');
  // Log intake with each source's token.
  // As documented: a plain POST with the token, no editor header or Origin.
  const send = (token, message) => request('/studio/ingest/logs', { method: 'POST', body: JSON.stringify({ events: [{ message, level: 'error' }] }), headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token } });
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

  // A check address with credentials never reaches a viewer whole.
  const router = await post('/studio/api/ops/config', { kind: 'monitor', action: 'save', item: { name: 'Router', scope: 'default', type: 'http', interval: 600, http: { url: 'http://admin:RouterPass99@127.0.0.1:1/status?apikey=SECRETKEY123' } } }, { cookie: admin.cookie });
  assert.equal(router.status, 200, router.text);
  const seenByMember = (await request('/studio/api/ops/monitors/' + router.json.item.id, { cookie: member.cookie })).json.monitor;
  assert.equal(seenByMember.target, '127.0.0.1:1');
  const seenByAdmin = (await request('/studio/api/ops/monitors/' + router.json.item.id, { cookie: admin.cookie })).json.monitor;
  assert.equal(seenByAdmin.target, 'http://127.0.0.1:1/status');
  for (const text of [JSON.stringify(seenByMember), (await request('/studio/api/ops/monitors', { cookie: member.cookie })).text]) assert.doesNotMatch(text, /RouterPass99|SECRETKEY123/);
  await post('/studio/api/ops/config', { kind: 'monitor', action: 'delete', id: router.json.item.id }, { cookie: admin.cookie });
  const monitors = await request('/studio/api/ops/monitors', { cookie: member.cookie });
  assert.deepEqual(monitors.json.monitors.map(item => item.name), ['Home backup']);
  assert.equal((await request('/studio/api/ops/monitors/' + labMonitor.json.item.id, { cookie: member.cookie })).status, 404, 'another dashboard\'s monitor looks missing');
  assert.equal((await request('/studio/api/ops/overview?dashboard=' + lab, { cookie: member.cookie })).status, 404);
  const mine = await request('/studio/api/ops/monitors/' + home.json.item.id, { cookie: member.cookie });
  assert.equal(mine.status, 200);
  assert.equal(mine.json.definition, undefined, 'only administrators get the saved settings');

  // Logs: Home's events only, never Lab's, Studio's or sign-in events.
  const search = async (cookie, q = '') => (await request('/studio/api/ops/logs/search?range=1h&q=' + encodeURIComponent(q), { cookie })).json;
  const seen = await eventually(async () => { const result = await search(member.cookie, 'only failure'); return result.events?.length ? result : null; });
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
  const view = await post('/studio/api/ops/config', { kind: 'view', action: 'save', item: { name: 'Lab errors', query: 'dashboard:' + lab + ' severity:error', range: '1h' } }, { cookie: admin.cookie });
  assert.equal(view.status, 200, view.text);
  assert.equal((await request('/studio/api/ops/views', { cookie: member.cookie })).status, 403, 'saved searches can name other dashboards');
  assert.equal((await request('/studio/api/ops/views', { cookie: admin.cookie })).json.views.length, 1);
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

test('keys saved after start, personal keys, widget keys and file secrets are masked in the logs', async t => {
  const context = await setup(t);
  const { request, post, stateDir } = context;
  const admin = await createAdmin(context);
  const source = await post('/studio/api/ops/config', { kind: 'source', action: 'save', item: { name: 'Home app', kind: 'https', scope: 'default' } }, { cookie: admin.cookie });
  assert.equal(source.status, 200, source.text);

  // A widget key typed into services.yaml and a Docker-style secret file.
  const configDir = path.join(path.dirname(stateDir), 'config');
  await fs.writeFile(path.join(configDir, 'services.yaml'), '- Media:\n    - Plex:\n        href: http://plex.test\n        widget:\n          type: plex\n          url: http://plex.test\n          key: WIDGETKEY-4242\n');
  const secretFile = path.join(path.dirname(stateDir), 'file-secret');
  await fs.writeFile(secretFile, 'FILESECRET-5151\n');
  process.env.HOMEPAGE_FILE_TEST_SECRET = secretFile;
  t.after(() => { delete process.env.HOMEPAGE_FILE_TEST_SECRET; });

  // A shared connection saved now, and a personal one; each save refreshes the list.
  const shared = await post('/studio/api/connections', { action: 'add', name: 'Late', url: 'http://late.test', key: 'LATECONNKEY-777' }, { cookie: admin.cookie });
  assert.equal(shared.status, 200, shared.text);
  const personal = await post('/studio/api/my-connections', { action: 'add', name: 'Mine', url: 'http://mine.test', key: 'PERSONALKEY-888' }, { cookie: admin.cookie });
  assert.equal(personal.status, 200, personal.text);

  const sent = await request('/studio/ingest/logs', { method: 'POST', body: JSON.stringify({ events: [{ message: 'leak LATECONNKEY-777 PERSONALKEY-888 WIDGETKEY-4242 FILESECRET-5151', level: 'error' }] }), headers: { 'content-type': 'application/json', authorization: 'Bearer ' + source.json.token } });
  assert.equal(sent.status, 202, sent.text);
  const found = await eventually(async () => { const result = (await request('/studio/api/ops/logs/search?range=1h&q=leak', { cookie: admin.cookie })).json; return result.events?.length ? result : null; });
  const message = found.events[0].message;
  for (const value of ['LATECONNKEY-777', 'PERSONALKEY-888', 'WIDGETKEY-4242', 'FILESECRET-5151']) assert.doesNotMatch(message, new RegExp(value), `${value} is masked`);
});

test('widget errors reported by a browser carry their problem class', async t => {
  const context = await setup(t);
  const { request, post } = context;
  const admin = await createAdmin(context);
  const sent = await post('/studio/api/client-errors', { errors: [{ message: 'Glances: The certificate isn’t trusted', widget: 'glances', errorClass: 'tls-untrusted' }, { message: 'Pi-hole: Name not found · check the address', widget: 'pihole', errorClass: 'made-up' }] }, { cookie: admin.cookie });
  assert.equal(sent.status, 202, sent.text);
  const search = async q => (await request('/studio/api/ops/logs/search?range=1h&q=' + encodeURIComponent(q), { cookie: admin.cookie })).json.events ?? [];
  assert.ok(await eventually(async () => (await search('class:tls-untrusted type:widget.error')).length === 1), 'the class the browser named');
  assert.equal((await search('class:dns type:widget.error')).length, 1, 'an unknown class falls back to the words');
});

test('a widget\'s Logs block reads only its dashboard with a logs grant, and a browser report is marked and kept to widgets on the board', async t => {
  const id = 'discovered-service-0123456789abcdef01234567';
  const source = { id, kind: 'service', title: 'Svc', group: 'Lab', nativeLocator: { discovered: true, discoveryId: id, serviceId: id, groupPath: ['Lab'], name: 'Svc', origin: 'docker' } };
  const context = await setup(t, { sources: [source] });
  const { request, post } = context;
  const admin = await createAdmin(context);
  const member = await inviteMember(context, admin.cookie);
  const viewer = await inviteMember(context, admin.cookie, 'viewer');
  const registry = await request('/studio/api/dashboards', { cookie: admin.cookie });
  const lab = (await post('/studio/api/dashboards', { revision: registry.json.revision, action: 'create', name: 'Lab', slug: 'lab' }, { cookie: admin.cookie })).json.dashboard.id;
  assert.equal((await post('/studio/auth/admin/grants', { dashboardId: 'default', grants: [{ subject: 'user:' + member.invited.id, level: 'view', logs: true }, { subject: 'user:' + viewer.invited.id, level: 'view' }] }, { cookie: admin.cookie })).status, 200);
  assert.equal((await post('/studio/auth/admin/grants', { dashboardId: lab, grants: [{ subject: 'user:' + member.invited.id, level: 'view' }] }, { cookie: admin.cookie })).status, 200);
  assert.ok((await request('/studio/api/state', { cookie: admin.cookie })).json.board.panels.some(panel => panel.id === id));
  // A view-only person's browser reports a widget error, and names a widget
  // that isn't on this board.
  const sent = await post('/studio/api/client-errors', { errors: [{ message: 'Svc: did not answer', widget: 'x', panel: id }, { message: 'Session expired: sign in again', widget: 'x', panel: 'p-not-on-board' }] }, { cookie: viewer.cookie });
  assert.equal(sent.status, 202, sent.text);
  // Exactly the Logs block's request (card-logs.jsx).
  const block = (cookie, panel, dashboard = 'default') => request('/studio/api/ops/logs/search?' + new URLSearchParams({ q: `panel:${panel}`, dashboard, range: '24h', limit: '10' }), { cookie });
  const seen = await eventually(async () => { const found = await block(member.cookie, id); return found.json?.events?.length ? found : null; });
  assert.ok(seen, 'the widget\'s line reaches its Logs block');
  assert.deepEqual(seen.json.events.map(event => [event.scope, event.source_type, event.actor, event.message]), [['default', 'browser', 'viewer', 'Svc: did not answer']]);
  assert.equal((await block(member.cookie, 'p-not-on-board')).json.events.length, 0, 'an id that is not on the board is not a widget\'s line');
  assert.equal((await block(member.cookie, id, lab)).status, 404, 'no logs grant on Lab');
  assert.equal((await block(viewer.cookie, id)).status, 403, 'view-only: no logs');
  assert.equal((await request('/studio/api/access', { cookie: viewer.cookie })).json.operations.logs, false);
});

test('removing a person takes their name out of the logs and incidents', async t => {
  const context = await setup(t);
  const { request, post } = context;
  const admin = await createAdmin(context);
  const member = await inviteMember(context, admin.cookie, 'carol');
  await post('/studio/auth/admin/grants', { dashboardId: 'default', grants: [{ subject: 'user:' + member.invited.id, level: 'view', monitoring: true, logs: true }] }, { cookie: admin.cookie });
  // Carol acknowledges an incident on a push monitor that reported a failure.
  const monitor = await post('/studio/api/ops/config', { kind: 'monitor', action: 'save', item: { name: 'Nightly job', scope: 'default', type: 'push', push: { period: 3600 } } }, { cookie: admin.cookie });
  await request('/studio/push/' + monitor.json.token + '?status=down');
  const incident = await eventually(async () => (await request('/studio/api/ops/incidents', { cookie: member.cookie })).json?.incidents?.[0]);
  assert.ok(incident, 'an incident opened');
  assert.equal((await post('/studio/api/ops/incidents/' + incident.id + '/ack', {}, { cookie: member.cookie })).status, 200);
  const search = async q => (await request('/studio/api/ops/logs/search?range=1h&q=' + encodeURIComponent(q), { cookie: admin.cookie })).json.events ?? [];
  assert.ok((await eventually(async () => (await search('actor:carol')).length >= 2)), 'her sign-up and acknowledgement name her');

  assert.equal((await post('/studio/auth/admin/delete', { id: member.invited.id }, { cookie: admin.cookie })).status, 200);
  assert.equal((await eventually(async () => (await search('actor:carol')).length === 0)), true, 'no event names her as actor');
  assert.equal((await search('carol')).length, 0, 'nor in the words of any message');
  assert.ok((await search('removed person')).length >= 2, 'what happened is kept');
  const timeline = (await request('/studio/api/ops/incidents/' + incident.id, { cookie: admin.cookie })).json;
  assert.doesNotMatch(JSON.stringify(timeline), /carol|Member/, 'the incident timeline no longer names her');
});

test('with sign-in off, Operations, export and log intake are closed', async t => {
  const context = await setup(t, { auth: 'off' });
  const { request, post } = context;
  for (const target of ['/studio/api/ops/access', '/studio/api/ops/logs/export?range=1h', '/studio/api/ops/config']) {
    const answer = await request(target);
    assert.equal(answer.status, 404, target);
  }
  const page = await request('/studio/operations', { headers: html });
  assert.equal(page.status, 404);
  assert.match(page.text, /Operations needs Studio sign-in/, 'says why, not that a dashboard is missing');
  assert.equal((await post('/studio/ingest/logs', { message: 'x' }, { headers: { authorization: 'Bearer ' + 'z'.repeat(32) } })).status, 404);
  assert.equal((await request('/studio/ingest/logs', { method: 'POST', body: '{"message":"x"}', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + 'z'.repeat(32) } })).status, 404, 'a script without the editor header gets the same 404');
  assert.equal((await post('/studio/api/client-errors', { errors: [{ message: 'x' }] })).status, 404);
  const registry = await request('/studio/api/dashboards');
  await post('/studio/api/dashboards', { revision: registry.json.revision, action: 'update', id: 'default', name: 'Main dashboard', slug: 'home' });
  const panels = await request('/studio/api/panel-status');
  assert.equal(panels.status, 200, 'cards still get their status');
});
