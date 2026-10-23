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
      const req = http.request({ host: '127.0.0.1', port, path: target, method, agent: false, headers: { host: HOST, ...(cookie ? { cookie } : {}), ...headers } }, res => {
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
  const started = await post('/__studio/auth/setup/start', { username: 'admin', displayName: 'Admin', password: PASSWORD });
  assert.equal(started.status, 200, started.text);
  const totp = await post('/__studio/auth/enroll/totp/start', { token: started.json.token });
  assert.match(totp.json.qr, /^data:image\/svg\+xml;base64,/);
  const confirmed = await post('/__studio/auth/enroll/totp/confirm', { token: started.json.token, code: currentCode(totp.json.secret) });
  assert.equal(confirmed.json.enrollment.complete, true);
  const finished = await post('/__studio/auth/enroll/finish', { token: started.json.token });
  assert.equal(finished.status, 200, finished.text);
  assert.equal(finished.json.backupCodes.length, 10);
  return { cookie: sessionCookie(finished), backupCodes: finished.json.backupCodes, request };
}

async function inviteMember({ post }, adminCookie, username = 'member') {
  const invited = await post('/__studio/auth/admin/invite', { username, displayName: 'Member' }, { cookie: adminCookie });
  assert.equal(invited.status, 200, invited.text);
  const invite = new URL(invited.json.link).hash.slice(1);
  assert.equal(new URL(invited.json.link).pathname, '/__studio/auth/enroll');
  const started = await post('/__studio/auth/invite/start', { invite, password: PASSWORD });
  assert.equal(started.status, 200, started.text);
  const totp = await post('/__studio/auth/enroll/totp/start', { token: started.json.token });
  await post('/__studio/auth/enroll/totp/confirm', { token: started.json.token, code: currentCode(totp.json.secret) });
  const finished = await post('/__studio/auth/enroll/finish', { token: started.json.token });
  assert.equal(finished.status, 200, finished.text);
  // The invitation works once.
  assert.equal((await post('/__studio/auth/invite/details', { invite })).status, 410);
  return { cookie: sessionCookie(finished), backupCodes: finished.json.backupCodes, invited: invited.json.user };
}

test('a fresh install sends everyone to first-administrator setup and locks every dashboard', async t => {
  const context = await setup(t);
  const { request, post } = context;
  const home = await request('/', { headers: html });
  assert.equal(home.status, 302);
  assert.equal(home.headers.location, '/__studio/auth/setup');
  const api = await request('/__studio/api/board');
  assert.equal(api.status, 401);
  assert.equal(api.json.code, 'SETUP_REQUIRED');
  assert.equal((await request('/api/anything')).status, 401);
  assert.equal(context.upstreamCalls.filter(call => call.url === '/api/anything').length, 0, 'nothing reaches the dashboard before setup');
  const state = await request('/__studio/auth/state');
  assert.equal(state.json.setupRequired, true);
  const page = await request('/__studio/auth/setup', { headers: html });
  assert.equal(page.status, 200);
  assert.match(String(page.headers['content-security-policy']), /script-src 'self'/);
  // A weak password is refused before anything is stored.
  const weak = await post('/__studio/auth/setup/start', { username: 'admin', password: 'short' });
  assert.equal(weak.status, 400);
  assert.equal(weak.json.code, 'WEAK_PASSWORD');
  // Setup can't finish without a second factor.
  const started = await post('/__studio/auth/setup/start', { username: 'admin', password: PASSWORD });
  const early = await post('/__studio/auth/enroll/finish', { token: started.json.token });
  assert.equal(early.json.code, 'FACTOR_REQUIRED');
  // A second browser cannot start setup at the same time.
  const second = await post('/__studio/auth/setup/start', { username: 'intruder', password: PASSWORD });
  assert.equal(second.status, 409);
  assert.equal(second.json.code, 'SETUP_IN_PROGRESS');
});

test('the first administrator signs in, sees everything, and setup closes for good', async t => {
  const context = await setup(t);
  const { request, post } = context;
  const admin = await createAdmin(context);
  const access = await request('/__studio/api/access', { cookie: admin.cookie });
  assert.equal(access.status, 200);
  assert.equal(access.json.level, 'admin');
  assert.equal(access.json.user.username, 'admin');
  assert.equal((await request('/__studio/api/state', { cookie: admin.cookie })).status, 200);
  const again = await post('/__studio/auth/setup/start', { username: 'second', password: PASSWORD });
  assert.equal(again.status, 409);
  assert.equal(again.json.code, 'SETUP_DONE');
  const signIn = await request('/__studio/auth/sign-in', { headers: html });
  assert.equal(signIn.status, 200, 'sign-in is available once setup is done');
  // The session cookie never reaches the dashboard renderer.
  await request('/api/native-call', { cookie: admin.cookie + '; other=1' });
  const forwarded = context.upstreamCalls.find(call => call.url === '/api/native-call');
  assert.ok(forwarded);
  assert.doesNotMatch(String(forwarded.headers.cookie ?? ''), /studio_session/);
  assert.match(String(forwarded.headers.cookie ?? ''), /other=1/);
});

test('members only reach dashboards shared with them, at the shared level', async t => {
  const context = await setup(t);
  const { request, post } = context;
  const admin = await createAdmin(context);
  const member = await inviteMember(context, admin.cookie);

  // Nothing shared yet: the home page explains, dashboards look missing.
  const home = await request('/', { cookie: member.cookie, headers: html });
  assert.equal(home.status, 200);
  assert.match(home.text, /No dashboards have been shared with you yet/);
  assert.equal((await request('/__studio/api/board', { cookie: member.cookie })).status, 404, 'an unshared dashboard looks like a missing one');
  const list = await request('/__studio/api/dashboards', { cookie: member.cookie });
  assert.deepEqual(list.json.dashboards, []);

  // Share the main dashboard to view.
  const shared = await post('/__studio/auth/admin/grants', { dashboardId: 'default', grants: [{ subject: 'user:' + member.invited.id, level: 'view' }] }, { cookie: admin.cookie });
  assert.equal(shared.status, 200, shared.text);
  const access = await request('/__studio/api/access', { cookie: member.cookie });
  assert.equal(access.json.level, 'view');
  assert.equal((await request('/__studio/api/board', { cookie: member.cookie })).status, 200);
  assert.equal((await request('/', { cookie: member.cookie, headers: html })).status, 200);
  const board = await request('/__studio/api/board', { cookie: member.cookie });
  const arrange = await post('/__studio/api/board', { revision: board.json.revision, board: board.json.board }, { cookie: member.cookie });
  assert.equal(arrange.status, 403);
  for (const target of ['/__studio/api/state', '/__studio/api/export', '/__studio/api/backups', '/__studio/ready']) {
    assert.equal((await request(target, { cookie: member.cookie })).status, 403, target);
  }
  assert.equal((await post('/__studio/api/save', { revision: board.json.revision }, { cookie: member.cookie })).status, 403);
  assert.equal((await request('/__studio/auth/admin/overview', { cookie: member.cookie })).status, 403);
  assert.equal((await request('/api/mcp', { cookie: member.cookie })).status, 403, 'the native MCP endpoint stays off with sign-in on');

  // Arrange allows the board and appearance, but still no raw configuration.
  await post('/__studio/auth/admin/grants', { dashboardId: 'default', grants: [{ subject: 'user:' + member.invited.id, level: 'arrange' }] }, { cookie: admin.cookie });
  const arranged = await post('/__studio/api/board', { revision: board.json.revision, board: board.json.board }, { cookie: member.cookie });
  assert.equal(arranged.status, 200, arranged.text);
  assert.equal(arranged.json.servicesYaml, undefined);
  const appearance = await request('/__studio/api/appearance', { cookie: member.cookie });
  assert.equal(appearance.status, 200, appearance.text);
  assert.equal((await request('/__studio/api/state', { cookie: member.cookie })).status, 403);

  // Disabling the account ends its sessions at once.
  const disabled = await post('/__studio/auth/admin/update', { id: member.invited.id, disabled: true }, { cookie: admin.cookie });
  assert.equal(disabled.status, 200, disabled.text);
  assert.equal((await request('/__studio/api/board', { cookie: member.cookie })).status, 401);
});

test('sign-in needs the password and a second factor, and failures stay generic', async t => {
  const context = await setup(t);
  const { request, post } = context;
  const admin = await createAdmin(context);
  const member = await inviteMember(context, admin.cookie);
  const wrong = await post('/__studio/auth/password', { username: 'member', password: 'not the password at all' });
  assert.equal(wrong.status, 401);
  const unknown = await post('/__studio/auth/password', { username: 'nobody', password: 'not the password at all' });
  assert.equal(unknown.status, 401);
  assert.equal(unknown.json.error, wrong.json.error, 'unknown accounts and wrong passwords look the same');
  const first = await post('/__studio/auth/password', { username: 'member', password: PASSWORD });
  assert.equal(first.status, 200, first.text);
  assert.equal(first.json.next, 'second-factor');
  assert.ok(first.json.methods.includes('totp') && first.json.methods.includes('backup'));
  assert.equal(first.headers['set-cookie'], undefined, 'a password alone never creates a session');
  const badCode = await post('/__studio/auth/second-factor', { token: first.json.token, method: 'backup', code: 'AAAAA-AAAAA' });
  assert.equal(badCode.status, 401);
  const good = await post('/__studio/auth/second-factor', { token: first.json.token, method: 'backup', code: member.backupCodes[0] });
  assert.equal(good.status, 200, good.text);
  assert.equal(good.json.backupCodesLeft, 9);
  const cookie = sessionCookie(good);
  assert.equal((await request('/__studio/auth/account', { cookie })).status, 200);
  // The same backup code never works twice.
  const again = await post('/__studio/auth/password', { username: 'member', password: PASSWORD });
  const reused = await post('/__studio/auth/second-factor', { token: again.json.token, method: 'backup', code: member.backupCodes[0] });
  assert.equal(reused.status, 401);
  // Signing out ends the session on the server.
  const out = await post('/__studio/auth/sign-out', {}, { cookie });
  assert.equal(out.status, 200);
  assert.equal((await request('/__studio/auth/account', { cookie })).status, 401);
});

test('auth pages accept cross-site navigation but sign-in actions do not', async t => {
  const context = await setup(t);
  const { request, post } = context;
  await createAdmin(context);
  const crossSite = { ...html, 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate' };
  assert.equal((await request('/__studio/auth/sign-in', { headers: crossSite })).status, 200, 'a bookmark or redirect lands on sign-in');
  assert.equal((await request('/__studio/auth/enroll', { headers: crossSite })).status, 200, 'an emailed invitation opens');
  const forged = await post('/__studio/auth/password', { username: 'admin', password: PASSWORD }, { headers: { 'sec-fetch-site': 'cross-site' } });
  assert.equal(forged.status, 403);
  const noHeader = await request('/__studio/auth/password', { method: 'POST', body: JSON.stringify({ username: 'admin', password: PASSWORD }), headers: { 'content-type': 'application/json', origin: ORIGIN } });
  assert.equal(noHeader.status, 403, 'state-changing requests need the editor header');
  const foreignOrigin = await post('/__studio/auth/password', { username: 'admin', password: PASSWORD }, { headers: { origin: 'https://evil.example' } });
  assert.equal(foreignOrigin.status, 403);
});

test('an unsafe next address after sign-in falls back to the home page', async t => {
  const context = await setup(t);
  const admin = await createAdmin(context);
  for (const next of ['//evil.example/', 'https://evil.example/', '/\\evil.example', '/__studio/auth/sign-out']) {
    const response = await context.request('/__studio/auth/sign-in?next=' + encodeURIComponent(next), { cookie: admin.cookie, headers: html });
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
  const api = await context.request('/__studio/api/board', { headers: { host: 'dashboard.example.test:3001' } });
  assert.equal(api.status, 503);
  assert.equal(api.json.code, 'HTTPS_REQUIRED');
  const ready = await context.request('/__studio/application-ready', { headers: { host: 'dashboard.example.test:3001' } });
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
  assert.equal(link.pathname, '/__studio/auth/recovery');
  const token = link.hash.slice(1);
  assert.equal((await context.post('/__studio/auth/recovery/redeem', { token: 'wrong' + token })).status, 410);
  const redeemed = await context.post('/__studio/auth/recovery/redeem', { token });
  assert.equal(redeemed.status, 200, redeemed.text);
  assert.doesNotMatch(String(redeemed.headers['set-cookie']), /Max-Age/, 'a recovery session ends with the browser');
  const cookie = sessionCookie(redeemed);
  const account = await context.request('/__studio/auth/account', { cookie });
  assert.equal(account.json.recovery, true);
  assert.equal(account.json.user.role, 'admin', '--promote made them an administrator');
  assert.equal(account.json.user.id, member.invited.id);
  assert.equal((await context.post('/__studio/auth/recovery/redeem', { token })).status, 410, 'the link works once');
  const listed = [];
  await run(['list'], { STUDIO_STATE_DIR: context.stateDir }, { log: line => listed.push(line) });
  assert.match(listed.join('\n'), /member\tadministrator\tlocal\tactive/);
});
