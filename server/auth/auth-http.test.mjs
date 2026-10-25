// End-to-end checks of Studio sign-in through the real controller: first
// administrator setup, invitations, the dashboard access levels, sign-in
// with a second factor, and the request-origin rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStudioServer, NATIVE_PROTOCOL, UPSTREAM_COMMIT } from '../index.mjs';
import { base32Decode, hotp, totpStep } from './primitives.mjs';
// The main dashboard lives at /home. Its own addresses (native API, editor
// API, native data) move with it; Studio-wide addresses stay at the root.
const onPrimary = target => (/^\/(?:api\/|studio\/(?:api\/(?!dashboards|overview|platform|backups)|catalog\.json|edit|settings)|_next\/(?!static\/))/.test(target) ? '/home' + target : target);


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
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'homepage-studio-auth-'));
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
  return { request, post, stateDir, upstreamCalls };
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

test('a fresh install sends everyone to first-administrator setup and locks every dashboard', async t => {
  const context = await setup(t);
  const { request, post } = context;
  const home = await request('/', { headers: html });
  assert.equal(home.status, 302);
  assert.equal(home.headers.location, '/studio/auth/setup');
  const api = await request('/studio/api/board');
  assert.equal(api.status, 401);
  assert.equal(api.json.code, 'SETUP_REQUIRED');
  assert.equal((await request('/api/anything')).status, 401);
  assert.equal(context.upstreamCalls.filter(call => call.url === '/api/anything').length, 0, 'nothing reaches the dashboard before setup');
  const state = await request('/studio/auth/state');
  assert.equal(state.json.setupRequired, true);
  const page = await request('/studio/auth/setup', { headers: html });
  assert.equal(page.status, 200);
  assert.match(String(page.headers['content-security-policy']), /script-src 'self'/);
  // A weak password is refused before anything is stored.
  const weak = await post('/studio/auth/setup/start', { username: 'admin', password: 'short' });
  assert.equal(weak.status, 400);
  assert.equal(weak.json.code, 'WEAK_PASSWORD');
  // Setup can't finish without a second factor.
  const started = await post('/studio/auth/setup/start', { username: 'admin', password: PASSWORD });
  const early = await post('/studio/auth/enroll/finish', { token: started.json.token });
  assert.equal(early.json.code, 'FACTOR_REQUIRED');
  // A second browser cannot start setup at the same time.
  const second = await post('/studio/auth/setup/start', { username: 'intruder', password: PASSWORD });
  assert.equal(second.status, 409);
  assert.equal(second.json.code, 'SETUP_IN_PROGRESS');
});

test('the first administrator signs in, sees everything, and setup closes for good', async t => {
  const context = await setup(t);
  const { request, post } = context;
  const admin = await createAdmin(context);
  const access = await request('/studio/api/access', { cookie: admin.cookie });
  assert.equal(access.status, 200);
  assert.equal(access.json.level, 'admin');
  assert.equal(access.json.user.username, 'admin');
  assert.equal((await request('/studio/api/state', { cookie: admin.cookie })).status, 200);
  const again = await post('/studio/auth/setup/start', { username: 'second', password: PASSWORD });
  assert.equal(again.status, 409);
  assert.equal(again.json.code, 'SETUP_DONE');
  const signIn = await request('/studio/auth/sign-in', { headers: html });
  assert.equal(signIn.status, 200, 'sign-in is available once setup is done');
  // The session cookie never reaches the dashboard renderer.
  await request('/api/native-call', { cookie: admin.cookie + '; studio_flow=x; studio_setup=y; other=1' });
  const forwarded = context.upstreamCalls.find(call => call.url === '/api/native-call');
  assert.ok(forwarded);
  assert.doesNotMatch(String(forwarded.headers.cookie ?? ''), /studio_(session|flow|setup)/);
  assert.match(String(forwarded.headers.cookie ?? ''), /other=1/);
});

test('members only reach dashboards shared with them, at the shared level', async t => {
  const context = await setup(t);
  const { request, post } = context;
  const admin = await createAdmin(context);
  const member = await inviteMember(context, admin.cookie);

  // Nothing shared yet: the bare address opens an empty Dashboards page, and
  // dashboards look missing.
  const home = await request('/', { cookie: member.cookie, headers: html });
  assert.equal(home.status, 307);
  assert.equal(home.headers.location, '/studio/dashboards');
  assert.deepEqual((await request('/studio/api/overview', { cookie: member.cookie })).json.dashboards, []);
  assert.equal((await request('/studio/api/board', { cookie: member.cookie })).status, 404, 'an unshared dashboard looks like a missing one');
  const list = await request('/studio/api/dashboards', { cookie: member.cookie });
  assert.deepEqual(list.json.dashboards, []);

  // Share the main dashboard to view.
  const shared = await post('/studio/auth/admin/grants', { dashboardId: 'default', grants: [{ subject: 'user:' + member.invited.id, level: 'view' }] }, { cookie: admin.cookie });
  assert.equal(shared.status, 200, shared.text);
  const access = await request('/studio/api/access', { cookie: member.cookie });
  assert.equal(access.json.level, 'view');
  assert.equal((await request('/studio/api/board', { cookie: member.cookie })).status, 200);
  assert.equal((await request('/home', { cookie: member.cookie, headers: html })).status, 200);
  const board = await request('/studio/api/board', { cookie: member.cookie });
  const arrange = await post('/studio/api/board', { revision: board.json.revision, board: board.json.board }, { cookie: member.cookie });
  assert.equal(arrange.status, 403);
  for (const target of ['/studio/api/state', '/studio/api/export', '/studio/api/backups', '/studio/ready']) {
    assert.equal((await request(target, { cookie: member.cookie })).status, 403, target);
  }
  assert.equal((await post('/studio/api/save', { revision: board.json.revision }, { cookie: member.cookie })).status, 403);
  assert.equal((await request('/studio/auth/admin/overview', { cookie: member.cookie })).status, 403);
  assert.equal((await request('/api/mcp', { cookie: member.cookie })).status, 403, 'the native MCP endpoint stays off with sign-in on');

  // Arrange allows the board and appearance, but still no raw configuration.
  await post('/studio/auth/admin/grants', { dashboardId: 'default', grants: [{ subject: 'user:' + member.invited.id, level: 'arrange' }] }, { cookie: admin.cookie });
  const arranged = await post('/studio/api/board', { revision: board.json.revision, board: board.json.board }, { cookie: member.cookie });
  assert.equal(arranged.status, 200, arranged.text);
  assert.equal(arranged.json.servicesYaml, undefined);
  const appearance = await request('/studio/api/appearance', { cookie: member.cookie });
  assert.equal(appearance.status, 200, appearance.text);
  assert.equal((await request('/studio/api/state', { cookie: member.cookie })).status, 403);

  // Disabling the account ends its sessions at once.
  const disabled = await post('/studio/auth/admin/update', { id: member.invited.id, disabled: true }, { cookie: admin.cookie });
  assert.equal(disabled.status, 200, disabled.text);
  assert.equal((await request('/studio/api/board', { cookie: member.cookie })).status, 401);
});

test('the bare address, the Dashboards page and the editor pages follow each person and their access', async t => {
  const context = await setup(t);
  const { request, post, upstreamCalls } = context;
  const admin = await createAdmin(context);
  const member = await inviteMember(context, admin.cookie);
  const landing = async cookie => (await request('/', { cookie, headers: html })).headers.location;

  // Administrators land on the Dashboards page until they choose a default.
  assert.equal(await landing(admin.cookie), '/studio/dashboards');
  const page = await request('/studio/dashboards', { cookie: admin.cookie, headers: html });
  assert.equal(page.status, 200);
  assert.match(page.text, /data-page="dashboards"/);
  assert.equal((await post('/studio/auth/account/default-dashboard', { dashboardId: 'default' }, { cookie: admin.cookie })).status, 200);
  assert.equal(await landing(admin.cookie), '/home');
  await post('/studio/auth/account/default-dashboard', { dashboardId: null }, { cookie: admin.cookie });
  assert.equal(await landing(admin.cookie), '/studio/dashboards');

  // A second dashboard, and two groups with different defaults.
  const registry = await request('/studio/api/dashboards', { cookie: admin.cookie });
  const media = (await post('/studio/api/dashboards', { revision: registry.json.revision, action: 'create', name: 'Media', slug: 'media' }, { cookie: admin.cookie })).json.dashboard;
  await post('/studio/auth/admin/group', { action: 'create', name: 'Family' }, { cookie: admin.cookie });
  await post('/studio/auth/admin/group', { action: 'create', name: 'Movies' }, { cookie: admin.cookie });
  const groups = (await request('/studio/auth/admin/overview', { cookie: admin.cookie })).json.groups;
  const [family, movies] = ['Family', 'Movies'].map(name => groups.find(group => group.name === name));
  assert.equal((await post('/studio/auth/admin/group', { action: 'update', id: family.id, defaultDashboardId: 'default' }, { cookie: admin.cookie })).status, 200);
  assert.equal((await post('/studio/auth/admin/group', { action: 'update', id: movies.id, defaultDashboardId: media.id }, { cookie: admin.cookie })).status, 200);
  assert.equal((await post('/studio/auth/admin/group', { action: 'update', id: movies.id, defaultDashboardId: 'missing' }, { cookie: admin.cookie })).status, 400);
  await post('/studio/auth/admin/update', { id: member.invited.id, groupIds: [family.id, movies.id] }, { cookie: admin.cookie });

  // A group default the member can't open doesn't count.
  assert.equal(await landing(member.cookie), '/studio/dashboards');
  await post('/studio/auth/admin/grants', { dashboardId: 'default', grants: [{ subject: 'group:' + family.id, level: 'view' }] }, { cookie: admin.cookie });
  await post('/studio/auth/admin/grants', { dashboardId: media.id, grants: [{ subject: 'group:' + movies.id, level: 'view' }] }, { cookie: admin.cookie });
  // The first of their groups, in the administrator's order, wins.
  assert.equal(await landing(member.cookie), '/home');
  assert.equal((await post('/studio/auth/admin/group', { action: 'move', id: movies.id, direction: 'up' }, { cookie: admin.cookie })).status, 200);
  assert.equal(await landing(member.cookie), '/media');
  // Dragging sends the whole order; a stale or partial order is refused.
  assert.equal((await post('/studio/auth/admin/group', { action: 'reorder', ids: [family.id, movies.id] }, { cookie: admin.cookie })).status, 200);
  assert.equal(await landing(member.cookie), '/home');
  assert.equal((await post('/studio/auth/admin/group', { action: 'reorder', ids: [movies.id] }, { cookie: admin.cookie })).status, 409);
  assert.equal((await post('/studio/auth/admin/group', { action: 'reorder', ids: [movies.id, movies.id] }, { cookie: admin.cookie })).status, 409);
  assert.equal((await post('/studio/auth/admin/group', { action: 'reorder', ids: [movies.id, family.id] }, { cookie: admin.cookie })).status, 200);
  assert.equal(await landing(member.cookie), '/media');
  // Their own choice wins over their groups', and must be a dashboard they can open.
  assert.equal((await post('/studio/auth/account/default-dashboard', { dashboardId: 'default' }, { cookie: member.cookie })).status, 200);
  assert.equal(await landing(member.cookie), '/home');
  const other = (await post('/studio/api/dashboards', { revision: (await request('/studio/api/dashboards', { cookie: admin.cookie })).json.revision, action: 'create', name: 'Private', slug: 'private' }, { cookie: admin.cookie })).json.dashboard;
  assert.equal((await post('/studio/auth/account/default-dashboard', { dashboardId: other.id }, { cookie: member.cookie })).status, 400);
  const overview = (await request('/studio/api/overview', { cookie: member.cookie })).json;
  assert.deepEqual(overview.dashboards.map(entry => [entry.name, entry.path, entry.level]), [['Main dashboard', '/home', 'view'], ['Media', '/media', 'view']]);
  assert.equal(overview.landingId, 'default');
  assert.equal(overview.revision, undefined, 'members do not get the registry revision');

  // Editing opens only from Studio addresses, for people who can arrange.
  const viewEdit = await request('/home/studio/edit', { cookie: member.cookie, headers: html });
  assert.equal(viewEdit.status, 303);
  assert.equal(viewEdit.headers.location, '/home');
  assert.ok(!upstreamCalls.some(call => call.url.includes('studio-edit')));
  await post('/studio/auth/admin/grants', { dashboardId: 'default', grants: [{ subject: 'group:' + family.id, level: 'arrange' }] }, { cookie: admin.cookie });
  for (const [target, nativePage] of [['/home/studio/edit', 'studio-edit'], ['/home/studio/settings?x=1', 'studio-settings?x=1']]) {
    const opened = await request(target, { cookie: member.cookie, headers: html });
    assert.equal(opened.status, 200, target);
    assert.ok(upstreamCalls.at(-1).url.endsWith(nativePage), upstreamCalls.at(-1).url);
  }
  for (const target of ['/home/studio-edit', '/home/studio-settings', '/home/_next/data/build/studio-edit.json']) {
    assert.equal((await request(target, { cookie: admin.cookie })).status, 404, target);
  }
  assert.equal((await post('/home/studio/edit', {}, { cookie: admin.cookie })).status, 405);
  // Signed out, the editor address asks for sign-in like any page.
  const signedOut = await request('/home/studio/edit', { headers: html });
  assert.equal(signedOut.status, 302);
  assert.match(signedOut.headers.location, /^\/studio\/auth\/sign-in\?next=%2Fhome%2Fstudio%2Fedit$/);
});

test('sign-in needs the password and a second factor, and failures stay generic', async t => {
  const context = await setup(t);
  const { request, post } = context;
  const admin = await createAdmin(context);
  const member = await inviteMember(context, admin.cookie);
  const wrong = await post('/studio/auth/password', { username: 'member', password: 'not the password at all' });
  assert.equal(wrong.status, 401);
  const unknown = await post('/studio/auth/password', { username: 'nobody', password: 'not the password at all' });
  assert.equal(unknown.status, 401);
  assert.equal(unknown.json.error, wrong.json.error, 'unknown accounts and wrong passwords look the same');
  const first = await post('/studio/auth/password', { username: 'member', password: PASSWORD });
  assert.equal(first.status, 200, first.text);
  assert.equal(first.json.next, 'second-factor');
  assert.ok(first.json.methods.includes('totp') && first.json.methods.includes('backup'));
  assert.equal(first.headers['set-cookie'], undefined, 'a password alone never creates a session');
  const badCode = await post('/studio/auth/second-factor', { token: first.json.token, method: 'backup', code: 'AAAAA-AAAAA' });
  assert.equal(badCode.status, 401);
  const good = await post('/studio/auth/second-factor', { token: first.json.token, method: 'backup', code: member.backupCodes[0] });
  assert.equal(good.status, 200, good.text);
  assert.equal(good.json.backupCodesLeft, 9);
  const cookie = sessionCookie(good);
  assert.equal((await request('/studio/auth/account', { cookie })).status, 200);
  // The same backup code never works twice.
  const again = await post('/studio/auth/password', { username: 'member', password: PASSWORD });
  const reused = await post('/studio/auth/second-factor', { token: again.json.token, method: 'backup', code: member.backupCodes[0] });
  assert.equal(reused.status, 401);
  // Signing out ends the session on the server.
  const out = await post('/studio/auth/sign-out', {}, { cookie });
  assert.equal(out.status, 200);
  assert.equal((await request('/studio/auth/account', { cookie })).status, 401);
});

test('auth pages accept cross-site navigation but sign-in actions do not', async t => {
  const context = await setup(t);
  const { request, post } = context;
  await createAdmin(context);
  const crossSite = { ...html, 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate' };
  assert.equal((await request('/studio/auth/sign-in', { headers: crossSite })).status, 200, 'a bookmark or redirect lands on sign-in');
  assert.equal((await request('/studio/auth/enroll', { headers: crossSite })).status, 200, 'an emailed invitation opens');
  const forged = await post('/studio/auth/password', { username: 'admin', password: PASSWORD }, { headers: { 'sec-fetch-site': 'cross-site' } });
  assert.equal(forged.status, 403);
  const noHeader = await request('/studio/auth/password', { method: 'POST', body: JSON.stringify({ username: 'admin', password: PASSWORD }), headers: { 'content-type': 'application/json', origin: ORIGIN } });
  assert.equal(noHeader.status, 403, 'state-changing requests need the editor header');
  const foreignOrigin = await post('/studio/auth/password', { username: 'admin', password: PASSWORD }, { headers: { origin: 'https://evil.example' } });
  assert.equal(foreignOrigin.status, 403);
});

test('an unsafe next address after sign-in falls back to the home page', async t => {
  const context = await setup(t);
  const admin = await createAdmin(context);
  for (const next of ['//evil.example/', 'https://evil.example/', '/\\evil.example', '/studio/auth/sign-out']) {
    const response = await context.request('/studio/auth/sign-in?next=' + encodeURIComponent(next), { cookie: admin.cookie, headers: html });
    assert.equal(response.status, 302);
    assert.equal(response.headers.location, '/', next);
  }
});

test('sign-in data that cannot be read fails closed', async t => {
  const context = await setup(t);
  await createAdmin(context);
  // Corrupt the stored sign-in data and start a second server on it.
  const authFile = path.join(context.stateDir, 'auth', 'auth.json');
  await fs.writeFile(authFile, '{not json');
  const directory = path.dirname(context.stateDir);
  const configDir = path.join(directory, 'config');
  const app = createStudioServer({ configDir, stateDir: context.stateDir, upstream: 'http://127.0.0.1:9', allowedHosts: HOST, auth: 'on', publicOrigin: ORIGIN });
  const port = await listen(app.server);
  t.after(() => close(app.server));
  const response = await new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: '/', headers: { host: HOST } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); }).on('error', reject);
  });
  assert.equal(response, 503);
});

test('plain HTTP with sign-in on starts locked and explains the fix', async t => {
  const context = await setup(t, { publicOrigin: 'http://dashboard.example.test:3001', allowedHosts: 'dashboard.example.test:3001,' + HOST });
  const page = await context.request('/', { headers: { ...html, host: 'dashboard.example.test:3001' } });
  assert.equal(page.status, 503);
  assert.match(page.text, /needs HTTPS/);
  const api = await context.request('/studio/api/board', { headers: { host: 'dashboard.example.test:3001' } });
  assert.equal(api.status, 503);
  assert.equal(api.json.code, 'HTTPS_REQUIRED');
  const ready = await context.request('/studio/application-ready', { headers: { host: 'dashboard.example.test:3001' } });
  assert.equal(ready.status, 200);
});

test('the command-line recovery link signs in once, for one browser session', async t => {
  const context = await setup(t);
  const admin = await createAdmin(context);
  const member = await inviteMember(context, admin.cookie);
  const { run } = await import('./cli.mjs');
  const lines = [];
  await run(['recover', 'member', '--promote'], { STUDIO_STATE_DIR: context.stateDir, STUDIO_PUBLIC_ORIGIN: ORIGIN }, { log: line => lines.push(line) });
  const link = new URL(lines.join('\n').match(/http:\/\/\S+/)[0]);
  assert.equal(link.pathname, '/studio/auth/recovery');
  const token = link.hash.slice(1);
  assert.equal((await context.post('/studio/auth/recovery/redeem', { token: 'wrong' + token })).status, 410);
  const redeemed = await context.post('/studio/auth/recovery/redeem', { token });
  assert.equal(redeemed.status, 200, redeemed.text);
  assert.doesNotMatch(String(redeemed.headers['set-cookie']), /Max-Age/, 'a recovery session ends with the browser');
  const cookie = sessionCookie(redeemed);
  const account = await context.request('/studio/auth/account', { cookie });
  assert.equal(account.json.recovery, true);
  assert.equal(account.json.user.role, 'admin', '--promote made them an administrator');
  assert.equal(account.json.user.id, member.invited.id);
  assert.equal((await context.post('/studio/auth/recovery/redeem', { token })).status, 410, 'the link works once');
  const listed = [];
  await run(['list'], { STUDIO_STATE_DIR: context.stateDir }, { log: line => listed.push(line) });
  assert.match(listed.join('\n'), /member\tadministrator\tlocal\tactive/);
});

test('a signed-out dashboard inside a frame offers sign-in in a new tab instead of a blocked frame', async t => {
  const context = await setup(t);
  await createAdmin(context);
  const framed = await context.request('/?view=1', { headers: { ...html, 'sec-fetch-dest': 'iframe' } });
  assert.equal(framed.status, 401);
  assert.match(framed.text, /target="_blank"/);
  assert.match(framed.text, /href="http:\/\/localhost:3001\/studio\/auth\/sign-in\?next=%2F%3Fview%3D1"/);
  assert.match(framed.text, /href="">Reload/, 'reload reuses the current address rather than reflecting it');
  assert.doesNotMatch(String(framed.headers['content-security-policy']), /frame-ancestors 'none'/);
  const top = await context.request('/', { headers: html });
  assert.equal(top.status, 302, 'a top-level visit still goes to the sign-in page');
});

test('a refused email is reported to the administrator and recorded in Activity with the server answer', async t => {
  const sent = [];
  const transport = { sendMail: async message => {
    sent.push(message);
    const error = new Error("Can't send mail - all recipients were rejected"); error.code = 'EENVELOPE'; error.responseCode = 550; error.response = '550 5.7.1 Sender address is not verified';
    throw error;
  } };
  const context = await setup(t, { smtpHost: 'smtp.example.test', smtpFromAddress: 'studio@example.test', smtpFromName: 'Family Dashboards', mailTransport: transport });
  const { cookie } = await createAdmin(context);
  const invited = await context.post('/studio/auth/admin/invite', { username: 'mailtest', email: 'person@example.test', sendEmail: true }, { cookie });
  assert.equal(invited.status, 200, invited.text);
  assert.equal(invited.json.emailed, false);
  assert.match(invited.json.emailError, /EENVELOPE 550: 550 5\.7\.1 Sender address is not verified/);
  // Name and address arrive separately, so the mail shows the name.
  assert.deepEqual(sent[0].from, { name: 'Family Dashboards', address: 'studio@example.test' });
  const { events } = (await context.request('/studio/auth/admin/audit', { cookie })).json;
  const failure = events.find(event => event.type === 'email-failed');
  assert.equal(failure.kind, 'Invitation');
  assert.match(failure.reason, /not verified/);
  assert.doesNotMatch(JSON.stringify(failure), /password/i);
});

test('the deployment name comes from the environment, an administrator can change it, and the logo is public', async t => {
  const context = await setup(t, { deploymentName: 'Family Hub' });
  const { request, post } = context;
  // The logo and favicon load before anyone signs in.
  for (const [target, type] of [['/favicon.ico', 'image/x-icon'], ['/studio/brand/logo.svg', 'image/svg+xml'], ['/studio/brand/apple-touch-icon.png', 'image/png']]) {
    const response = await request(target);
    assert.equal(response.status, 200, target);
    assert.equal(response.headers['content-type'], type);
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
  }
  assert.equal((await request('/studio/brand/../index.mjs')).status === 200, false);
  assert.equal((await request('/studio/brand/other.svg')).status === 200, false);
  const setupPage = await request('/studio/auth/setup', { headers: html });
  assert.match(setupPage.text, /<title>Family Hub<\/title>/);
  assert.match(setupPage.text, /data-deployment-name="Family Hub"/);
  assert.match(setupPage.text, /rel="icon" href="\/studio\/brand\/logo.svg"/);
  const admin = await createAdmin(context);
  assert.equal((await request('/studio/api/overview', { cookie: admin.cookie })).json.deploymentName, 'Family Hub');
  const refused = await post('/studio/auth/admin/settings', { deploymentName: '<b>Hub</b>' }, { cookie: admin.cookie });
  assert.equal(refused.status, 400);
  const saved = await post('/studio/auth/admin/settings', { deploymentName: '  The Smiths  ' }, { cookie: admin.cookie });
  assert.equal(saved.status, 200, saved.text);
  assert.equal(saved.json.settings.deploymentName, 'The Smiths');
  assert.equal(saved.json.deploymentNameDefault, 'Family Hub');
  assert.equal((await request('/studio/api/overview', { cookie: admin.cookie })).json.deploymentName, 'The Smiths');
  assert.match((await request('/studio/account', { cookie: admin.cookie, headers: html })).text, /<title>The Smiths<\/title>/);
  // An empty name goes back to the deployment's.
  await post('/studio/auth/admin/settings', { deploymentName: '' }, { cookie: admin.cookie });
  assert.equal((await request('/studio/api/overview', { cookie: admin.cookie })).json.deploymentName, 'Family Hub');
});

test('until the main dashboard has an address, administrators are sent to choose it and members never see it', async t => {
  const context = await setup(t);
  const { request, post } = context;
  const started = await post('/studio/auth/setup/start', { username: 'admin', displayName: 'Admin', password: PASSWORD });
  const totp = await post('/studio/auth/enroll/totp/start', { token: started.json.token });
  await post('/studio/auth/enroll/totp/confirm', { token: started.json.token, code: currentCode(totp.json.secret) });
  const cookie = sessionCookie(await post('/studio/auth/enroll/finish', { token: started.json.token }));
  const registry = await request('/studio/api/dashboards', { cookie });
  const kitchen = await post('/studio/api/dashboards', { revision: registry.json.revision, action: 'create', name: 'Kitchen', slug: 'dashboard' }, { cookie });
  assert.equal(kitchen.status, 200, kitchen.text);
  const overview = await request('/studio/api/overview', { cookie });
  assert.equal(overview.json.mainNeedsAddress, true);
  assert.equal(overview.json.suggestedSlug, 'dashboard-2');
  assert.equal(overview.json.dashboards.find(entry => entry.id === 'default').path, null);
  // Opening another dashboard's page goes to the Dashboards page first.
  const page = await request('/dashboard', { cookie, headers: html });
  assert.equal(page.status, 303);
  assert.equal(page.headers.location, '/studio/dashboards');
  // Its data stays available; only page navigation is redirected.
  assert.equal((await request('/dashboard/studio/api/state', { cookie })).status, 200);
  await post('/studio/auth/admin/grants', { dashboardId: 'default', grants: [] }, { cookie });
  const member = await inviteMember(context, cookie);
  const shared = await post('/studio/auth/admin/grants', { dashboardId: 'default', grants: [{ subject: 'user:' + member.invited.id, level: 'view' }] }, { cookie });
  assert.equal(shared.status, 200, shared.text);
  // Each card says who can open it and when it last changed.
  const cards = (await request('/studio/api/overview', { cookie })).json.dashboards;
  assert.deepEqual(cards.find(entry => entry.id === 'default').audience, { groups: [], people: ['Member'] });
  assert.ok(!Number.isNaN(Date.parse(cards.find(entry => entry.id === 'default').lastChanged)));
  const memberView = await request('/studio/api/overview', { cookie: member.cookie });
  assert.equal(memberView.json.mainNeedsAddress, false);
  assert.equal(memberView.json.suggestedSlug, undefined);
  assert.deepEqual(memberView.json.dashboards, []);
  const landing = await request('/', { cookie: member.cookie, headers: html });
  assert.equal(landing.headers.location, '/studio/dashboards');
});

test('a dashboard logo can be changed by anyone who can arrange it, and only administrators set the platform look', async t => {
  const context = await setup(t);
  const { request, post } = context;
  const admin = await createAdmin(context);
  const member = await inviteMember(context, admin.cookie);
  const share = level => post('/studio/auth/admin/grants', { dashboardId: 'default', grants: [{ subject: 'user:' + member.invited.id, level }] }, { cookie: admin.cookie });
  assert.equal((await share('view')).status, 200);
  // Without its own logo a dashboard shows the Studio logo.
  const fallback = await request('/home/studio/logo', { cookie: member.cookie });
  assert.equal(fallback.status, 200);
  assert.equal(fallback.headers['content-type'], 'image/svg+xml');
  const png = 'data:image/png;base64,' + Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString('base64');
  assert.equal((await post('/home/studio/api/logo', { image: png }, { cookie: member.cookie })).status, 403, 'viewers cannot change it');
  assert.equal((await share('arrange')).status, 200);
  const saved = await post('/home/studio/api/logo', { image: png }, { cookie: member.cookie });
  assert.equal(saved.status, 200, saved.text);
  assert.equal(saved.json.logo.type, 'image/png');
  const own = await request('/home/studio/logo', { cookie: member.cookie });
  assert.equal(own.headers['content-type'], 'image/png');
  assert.match(String(own.headers['content-security-policy']), /sandbox/);
  assert.deepEqual((await request('/home/studio/api/access', { cookie: member.cookie })).json.dashboard.logo, saved.json.logo);
  assert.equal((await post('/home/studio/api/logo', { image: 'data:text/html;base64,' + Buffer.from('<script>1</script>').toString('base64') }, { cookie: member.cookie })).status, 400);
  // A duplicate keeps the logo, independently of its source.
  const registry = await request('/studio/api/dashboards', { cookie: admin.cookie });
  const copy = await post('/studio/api/dashboards', { revision: registry.json.revision, action: 'create', name: 'Copy', slug: 'copy', sourceId: 'default' }, { cookie: admin.cookie });
  assert.equal(copy.status, 200, copy.text);
  assert.deepEqual((await request('/copy/studio/api/access', { cookie: admin.cookie })).json.dashboard.logo, saved.json.logo);
  assert.equal((await post('/home/studio/api/logo', { reset: true }, { cookie: member.cookie })).status, 200);
  assert.equal((await request('/home/studio/logo', { cookie: member.cookie })).headers['content-type'], 'image/svg+xml');
  assert.equal((await request('/copy/studio/logo', { cookie: admin.cookie })).headers['content-type'], 'image/png');
  // The platform look is for administrators; its CSS reaches every viewer.
  assert.equal((await request('/studio/api/platform', { cookie: member.cookie })).status, 403);
  const platform = await request('/studio/api/platform', { cookie: admin.cookie });
  const changed = await post('/studio/api/platform', { revision: platform.json.revision, mode: 'light', accent: '#91b09e', background: null, css: 'body { --platform: 1; }' }, { cookie: admin.cookie });
  assert.equal(changed.status, 200, changed.text);
  const css = await request('/studio/platform.css', { cookie: member.cookie });
  assert.equal(css.text, 'body { --platform: 1; }');
  assert.equal((await request('/studio/platform.css')).status === 200, false, 'signed-out visitors get nothing');
  // Studio's own pages wear the look before anyone signs in: only the mode
  // and accent, as colors, never the platform CSS.
  const theme = await request('/studio/theme.css');
  assert.equal(theme.status, 200);
  assert.equal(theme.headers['content-type'], 'text/css; charset=utf-8');
  assert.match(theme.text, /^:root\{color-scheme:light;/);
  assert.match(theme.text, /--focus:#[0-9a-f]{6};/);
  assert.doesNotMatch(theme.text, /--platform|@media/);
  const dashboardsPage = await request('/studio/dashboards', { cookie: member.cookie });
  assert.match(dashboardsPage.text, /<link rel="stylesheet" href="\/studio\/theme.css" id="studio-theme">/);
  // The Dashboards page frames each dashboard as its preview, from this
  // origin only, and can't be framed itself.
  assert.match(String(dashboardsPage.headers['content-security-policy']), /frame-src 'self'; frame-ancestors 'none'/);
  assert.deepEqual((await request('/home/studio/api/appearance', { cookie: member.cookie })).json.platform, { mode: 'light', accent: '#91b09e', background: null });
  // Switching the platform CSS off for one dashboard is an administrator's call.
  const appearance = (await request('/home/studio/api/appearance', { cookie: member.cookie })).json;
  const refused = await post('/home/studio/api/appearance', { revision: appearance.revision, config: { studioTheme: { platformCss: false } } }, { cookie: member.cookie });
  assert.equal(refused.status, 403);
  const accent = await post('/home/studio/api/appearance', { revision: appearance.revision, config: { studioTheme: { accent: '#81a8c8' } } }, { cookie: member.cookie });
  assert.equal(accent.status, 200, accent.text);
});

test('saving the platform look needs a recent sign-in, as a dashboard custom.css does', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const context = await setup(t);
  const { request, post } = context;
  const admin = await createAdmin(context);
  t.mock.timers.tick(30 * 60000);
  const platform = await request('/studio/api/platform', { cookie: admin.cookie });
  assert.equal(platform.status, 200, 'reading it needs no confirmation');
  const stale = await post('/studio/api/platform', { revision: platform.json.revision, mode: 'light', accent: '#91b09e', background: null, css: '' }, { cookie: admin.cookie });
  assert.equal(stale.status, 401);
  assert.equal(stale.json.code, 'REAUTH_REQUIRED');
  assert.equal((await request('/studio/api/platform', { cookie: admin.cookie })).json.revision, platform.json.revision, 'nothing was saved');
});

test('backups are for administrators, need a recent sign-in, download as files and stage a restart to restore', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  let restarts = 0;
  const context = await setup(t, { onRestoreStaged: () => { restarts++; } });
  const { request, post, stateDir } = context;
  const admin = await createAdmin(context);
  const member = await inviteMember(context, admin.cookie);
  assert.equal((await request('/studio/api/backups', { cookie: member.cookie })).status, 403);
  assert.equal((await post('/studio/api/backups', { action: 'create' }, { cookie: member.cookie })).status, 403);
  assert.equal((await request('/studio/api/backups')).status === 200, false, 'signed-out visitors get nothing');
  const made = await post('/studio/api/backups', { action: 'create' }, { cookie: admin.cookie });
  assert.equal(made.status, 200, made.text);
  const listed = await request('/studio/api/backups', { cookie: admin.cookie });
  assert.deepEqual(listed.json.backups.map(item => item.name), [made.json.name]);
  const file = await request('/studio/api/backups/file/' + made.json.name, { cookie: admin.cookie });
  assert.equal(file.status, 200);
  assert.equal(file.headers['content-type'], 'application/gzip');
  assert.match(file.headers['content-disposition'], /^attachment; filename="studio-backup-/);
  assert.equal((await request('/studio/api/backups/file/..%2Fauth%2Fauth.json', { cookie: admin.cookie })).status, 404);
  // Uploading needs the editor header like every other change.
  const raw = await fs.readFile(path.join(stateDir, 'studio-backups', made.json.name));
  assert.equal((await request('/studio/api/backups/upload', { method: 'POST', cookie: admin.cookie, body: raw, headers: { 'content-type': 'application/gzip', origin: ORIGIN } })).status, 403);
  const uploaded = await request('/studio/api/backups/upload', { method: 'POST', cookie: admin.cookie, body: raw, headers: { 'content-type': 'application/gzip', origin: ORIGIN, 'x-studio-request': '1' } });
  assert.equal(uploaded.status, 200, uploaded.text);
  assert.equal((await request('/studio/api/backups/upload', { method: 'POST', cookie: admin.cookie, body: 'nope', headers: { 'content-type': 'application/gzip', origin: ORIGIN, 'x-studio-request': '1' } })).status, 400);
  assert.equal((await post('/studio/api/backups', { action: 'restore', name: made.json.name }, { cookie: admin.cookie })).status, 400, 'a restore must be confirmed');
  const restore = await post('/studio/api/backups', { action: 'restore', name: made.json.name, confirmed: true }, { cookie: admin.cookie });
  assert.equal(restore.status, 202, restore.text);
  assert.equal(restore.json.restarting, true);
  assert.equal(restarts, 1);
  assert.equal(JSON.parse(await fs.readFile(path.join(stateDir, 'studio-restore.json'), 'utf8')).name, made.json.name);
  // Later, without a recent sign-in, only the list is open.
  t.mock.timers.tick(30 * 60000);
  assert.equal((await request('/studio/api/backups', { cookie: admin.cookie })).status, 200);
  for (const stale of [await post('/studio/api/backups', { action: 'create' }, { cookie: admin.cookie }), await request('/studio/api/backups/file/' + made.json.name, { cookie: admin.cookie }), await post('/studio/api/backups', { action: 'delete', name: made.json.name }, { cookie: admin.cookie })]) {
    assert.equal(stale.status, 401);
    assert.equal(stale.json.code, 'REAUTH_REQUIRED');
  }
});
