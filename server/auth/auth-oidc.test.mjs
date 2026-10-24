// Sign-in regression tests from the independent review of 23 October 2026,
// against a mock OIDC provider modelled on Authentik 2024.2 and later, which
// issues refresh tokens only when offline_access is requested.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { createStudioServer, NATIVE_PROTOCOL, UPSTREAM_COMMIT } from '../index.mjs';
import { base32Decode, hotp, totpStep } from './primitives.mjs';

const HOST = 'localhost:3001';
const ORIGIN = `http://${HOST}`;
const PASSWORD = 'correct horse battery staple';
const listen = async server => { await new Promise((r, j) => { server.once('error', j); server.listen(0, '127.0.0.1', r); }); return server.address().port; };
const close = async server => { server.closeAllConnections?.(); await new Promise(r => server.close(r)); };

async function mockProvider() {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  const state = { user: { sub: 'sub-1', preferred_username: 'alice', name: 'Alice', email: 'alice@example.test', email_verified: true, groups: ['studio-users'] }, codes: new Map(), refresh: new Map(), rotate: false, down: false, lastScope: null, refreshCalls: 0 };
  let issuer;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, issuer);
    const send = (status, value, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(value)); };
    if (url.pathname === '/.well-known/openid-configuration') return send(200, { issuer, authorization_endpoint: issuer + '/authorize', token_endpoint: issuer + '/token', userinfo_endpoint: issuer + '/userinfo', jwks_uri: issuer + '/jwks', end_session_endpoint: issuer + '/end', response_types_supported: ['code'], subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'], code_challenge_methods_supported: ['S256'], backchannel_logout_supported: true, backchannel_logout_session_supported: true });
    if (url.pathname === '/jwks') return send(200, { keys: [jwk] });
    if (url.pathname === '/authorize') {
      const p = url.searchParams; state.lastScope = p.get('scope'); state.lastPrompt = p.get('prompt'); state.lastMaxAge = p.get('max_age');
      const code = randomUUID();
      state.codes.set(code, { nonce: p.get('nonce'), challenge: p.get('code_challenge'), scope: p.get('scope'), user: structuredClone(state.user) });
      const back = new URL(p.get('redirect_uri')); back.searchParams.set('code', code); back.searchParams.set('state', p.get('state')); back.searchParams.set('iss', issuer);
      res.writeHead(302, { location: back.href }); return res.end();
    }
    if (url.pathname === '/userinfo') return send(200, { ...state.user });
    if (url.pathname === '/token') {
      let body = ''; for await (const c of req) body += c;
      const form = new URLSearchParams(body);
      const sid = 'sid-' + state.user.sub;
      const idToken = async (nonce, user) => new SignJWT({ nonce, groups: user.groups, preferred_username: user.preferred_username, name: user.name, email: user.email, email_verified: user.email_verified, sid, auth_time: state.authTime ?? Math.floor(Date.now() / 1000) }).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(issuer).setAudience('studio').setSubject(user.sub).setIssuedAt().setExpirationTime('5m').sign(privateKey);
      if (form.get('grant_type') === 'authorization_code') {
        const entry = state.codes.get(form.get('code')); state.codes.delete(form.get('code'));
        if (!entry || createHash('sha256').update(form.get('code_verifier')).digest('base64url') !== entry.challenge) return send(400, { error: 'invalid_grant' });
        const out = { access_token: randomUUID(), token_type: 'Bearer', expires_in: 300, id_token: await idToken(entry.nonce, entry.user) };
        if (entry.scope.split(' ').includes('offline_access')) { out.refresh_token = randomUUID(); state.refresh.set(out.refresh_token, entry.user.sub); }
        return send(200, out);
      }
      if (form.get('grant_type') === 'refresh_token') {
        state.refreshCalls++;
        if (state.down) return send(503, { error: 'temporarily_unavailable' }, { 'content-type': 'text/html' });
        const token = form.get('refresh_token');
        const seq = state.refreshCalls;
        await new Promise(r => setTimeout(r, 20 * seq));
        if (!state.refresh.has(token)) return send(400, { error: 'invalid_grant' });
        const out = { access_token: randomUUID(), token_type: 'Bearer', expires_in: 300 };
        if (state.rotate) { state.refresh.delete(token); out.refresh_token = randomUUID(); state.refresh.set(out.refresh_token, state.user.sub); }
        return send(200, out);
      }
      return send(400, { error: 'unsupported_grant_type' });
    }
    send(404, {});
  });
  const port = await listen(server);
  issuer = `http://127.0.0.1:${port}`;
  return { state, server, get issuer() { return issuer; }, privateKey };
}

async function setup(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-review-'));
  const configDir = path.join(directory, 'config'), stateDir = path.join(directory, 'state');
  await fs.mkdir(configDir);
  for (const [f, v] of [['services.yaml', '[]\n'], ['widgets.yaml', '[]\n'], ['settings.yaml', 'title: t\n'], ['bookmarks.yaml', '[]\n'], ['docker.yaml', '{}\n'], ['kubernetes.yaml', '{}\n'], ['proxmox.yaml', '{}\n']]) await fs.writeFile(path.join(configDir, f), v);
  const upstream = http.createServer((req, res) => {
    if (req.url === '/api/studio/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ protocolVersion: NATIVE_PROTOCOL, upstreamCommit: UPSTREAM_COMMIT, buildRevision: 'unreleased' })); }
    if (req.url === '/api/studio/sources') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ protocolVersion: NATIVE_PROTOCOL, upstreamCommit: UPSTREAM_COMMIT, sources: [], warnings: [] })); }
    res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>native</title>');
  });
  const upstreamPort = await listen(upstream);
  const provider = options.oidc === false ? null : await mockProvider();
  const mail = [];
  const app = createStudioServer({ configDir, stateDir, upstream: `http://127.0.0.1:${upstreamPort}`, allowedHosts: HOST, auth: 'on', publicOrigin: ORIGIN,
    ...(provider ? { oidcIssuer: provider.issuer, oidcClientId: 'studio', oidcClientSecret: 'secret', oidcAllowHttp: true } : {}),
    smtpHost: 'mail.test', smtpFrom: 'studio@test', mailTransport: { sendMail: async m => { mail.push(m); } }, ...options });
  const port = await listen(app.server);
  t.after(async () => { await close(app.server); await close(upstream); if (provider) await close(provider.server); await app.shutdown({ graceMs: 0 }).catch(() => {}); await fs.rm(directory, { recursive: true, force: true }); });
  function request(target, { method = 'GET', headers = {}, body, cookie } = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: target, method, agent: false, headers: { host: HOST, ...(cookie ? { cookie } : {}), ...headers } }, res => {
        const chunks = []; res.on('data', c => chunks.push(c));
        res.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); let json; try { json = JSON.parse(text); } catch {} resolve({ status: res.statusCode, headers: res.headers, text, json }); });
      });
      req.on('error', reject); req.end(body);
    });
  }
  const post = (target, value, { cookie } = {}) => request(target, { method: 'POST', cookie, body: JSON.stringify(value ?? {}), headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-studio-request': '1' } });
  return { request, post, provider, stateDir, mail };
}
const cookieOf = (response, name = 'studio_session') => [].concat(response.headers['set-cookie'] ?? []).map(i => i.split(';')[0]).find(i => i.startsWith(name + '=') && i.length > name.length + 1);
const code = secret => hotp(base32Decode(secret), totpStep());

async function enroll(ctx, started) {
  const totp = await ctx.post('/__studio/auth/enroll/totp/start', { token: started.json.token });
  await ctx.post('/__studio/auth/enroll/totp/confirm', { token: started.json.token, code: code(totp.json.secret) });
  const finished = await ctx.post('/__studio/auth/enroll/finish', { token: started.json.token });
  assert.equal(finished.status, 200, finished.text);
  return { cookie: cookieOf(finished), secret: totp.json.secret, backupCodes: finished.json.backupCodes };
}
const createAdmin = async ctx => enroll(ctx, await ctx.post('/__studio/auth/setup/start', { username: 'admin', password: PASSWORD }));
async function invite(ctx, adminCookie, username = 'member', extra = {}) {
  const invited = await ctx.post('/__studio/auth/admin/invite', { username, ...extra }, { cookie: adminCookie });
  assert.equal(invited.status, 200, invited.text);
  return { ...(await enroll(ctx, await ctx.post('/__studio/auth/invite/start', { invite: new URL(invited.json.link).hash.slice(1), password: PASSWORD }))), id: invited.json.user.id };
}
// Plain sign-in starts with GET; linking and confirming start with POST
// oidc/begin from a signed-in page.
async function oidcSignIn(ctx, { intent = 'signin', cookie } = {}) {
  let url, flow;
  if (intent === 'signin') {
    const start = await ctx.request('/__studio/auth/oidc/start', { cookie });
    assert.equal(start.status, 302, start.text);
    url = start.headers.location; flow = cookieOf(start, 'studio_flow');
  } else {
    const begin = await ctx.post('/__studio/auth/oidc/begin', { intent, next: '/__studio/account' }, { cookie });
    if (begin.status !== 200) return { response: begin, cookie: undefined };
    url = begin.json.url; flow = cookieOf(begin, 'studio_flow');
  }
  const auth = await fetch(url, { redirect: 'manual' });
  const back = new URL(auth.headers.get('location'));
  const done = await ctx.request(back.pathname + back.search, { cookie: [cookie, flow].filter(Boolean).join('; ') });
  return { response: done, cookie: cookieOf(done) };
}
// Linking: the provider step, then the confirmation on the account page.
async function link(ctx, cookie) {
  const flow = await oidcSignIn(ctx, { intent: 'link', cookie });
  if (flow.response.headers.location !== '/__studio/account?link=confirm') return { ...flow, confirmed: null };
  const confirmed = await ctx.post('/__studio/auth/account/link/confirm', {}, { cookie });
  assert.equal(confirmed.status, 200, confirmed.text);
  return { ...flow, confirmed, cookie: cookieOf(confirmed) ?? cookie };
}
const role = async (ctx, cookie) => (await ctx.request('/__studio/auth/account', { cookie })).json?.user?.role;
async function localSignIn(ctx, username, backupCode) {
  const step = await ctx.post('/__studio/auth/password', { username, password: PASSWORD });
  assert.equal(step.status, 200, step.text);
  const done = await ctx.post('/__studio/auth/second-factor', { token: step.json.token, method: 'backup', code: backupCode });
  assert.equal(done.status, 200, done.text);
  return cookieOf(done);
}
async function waitFor(check) {
  for (let index = 0; index < 100 && !check(); index++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(check());
}


test('provider sign-in requests offline_access by default, and leaving every allowed group ends the session at the re-check', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const ctx = await setup(t);
  const admin = await createAdmin(ctx);
  await ctx.post('/__studio/auth/admin/settings', { oidc: { adminGroups: ['studio-admins'], allowedGroups: ['studio-users'] } }, { cookie: admin.cookie });
  ctx.provider.state.user.groups = ['studio-admins', 'studio-users'];
  const sso = await oidcSignIn(ctx);
  assert.ok(sso.cookie, sso.response.text);
  assert.ok(ctx.provider.state.lastScope.split(' ').includes('offline_access'));
  assert.equal(await role(ctx, sso.cookie), 'admin');
  const overview = await ctx.request('/__studio/auth/admin/overview', { cookie: admin.cookie });
  assert.equal(overview.json.oidc.lastSignIn.refreshToken, true);
  ctx.provider.state.user.groups = ['studio-users'];
  t.mock.timers.tick(16 * 60000);
  assert.equal(await role(ctx, sso.cookie), 'member', 'the re-check applies the new groups');
  assert.equal(ctx.provider.state.refreshCalls, 1);
  ctx.provider.state.user.groups = [];
  t.mock.timers.tick(16 * 60000);
  assert.equal((await ctx.request('/__studio/auth/account', { cookie: sso.cookie })).status, 401);
});

test('without a refresh token, a provider session ends at its first re-check and settings say why', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const ctx = await setup(t, { oidcScopes: 'openid profile email' });
  const admin = await createAdmin(ctx);
  await ctx.post('/__studio/auth/admin/settings', { oidc: { adminGroups: [], allowedGroups: ['studio-users'] } }, { cookie: admin.cookie });
  const sso = await oidcSignIn(ctx);
  assert.ok(sso.cookie, sso.response.text);
  assert.equal((await ctx.request('/__studio/auth/admin/overview', { cookie: admin.cookie })).json.oidc.lastSignIn.refreshToken, false);
  t.mock.timers.tick(14 * 60000);
  assert.equal((await ctx.request('/__studio/auth/account', { cookie: sso.cookie })).status, 200);
  t.mock.timers.tick(2 * 60000);
  assert.equal((await ctx.request('/__studio/auth/account', { cookie: sso.cookie })).status, 401);
});

test('a provider outage keeps the session for one more interval, then ends it', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const ctx = await setup(t);
  const admin = await createAdmin(ctx);
  await ctx.post('/__studio/auth/admin/settings', { oidc: { adminGroups: [], allowedGroups: ['studio-users'] } }, { cookie: admin.cookie });
  const sso = await oidcSignIn(ctx);
  ctx.provider.state.down = true;
  t.mock.timers.tick(16 * 60000);
  assert.equal((await ctx.request('/__studio/auth/account', { cookie: sso.cookie })).status, 200);
  assert.equal((await ctx.request('/__studio/auth/account', { cookie: sso.cookie })).status, 200, 'no second call within the retry minute');
  assert.equal(ctx.provider.state.refreshCalls, 1);
  ctx.provider.state.down = false;
  t.mock.timers.tick(61000);
  assert.equal((await ctx.request('/__studio/auth/account', { cookie: sso.cookie })).status, 200);
  assert.equal(ctx.provider.state.refreshCalls, 2);
  ctx.provider.state.down = true;
  t.mock.timers.tick(15 * 60000 + 1000);
  assert.equal((await ctx.request('/__studio/auth/account', { cookie: sso.cookie })).status, 200);
  t.mock.timers.tick(15 * 60000);
  assert.equal((await ctx.request('/__studio/auth/account', { cookie: sso.cookie })).status, 401, 'past one extra interval the session ends');
});

test('a revoked refresh token ends the session at once', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const ctx = await setup(t);
  const admin = await createAdmin(ctx);
  await ctx.post('/__studio/auth/admin/settings', { oidc: { adminGroups: [], allowedGroups: ['studio-users'] } }, { cookie: admin.cookie });
  const sso = await oidcSignIn(ctx);
  ctx.provider.state.refresh.clear();
  t.mock.timers.tick(16 * 60000);
  assert.equal((await ctx.request('/__studio/auth/account', { cookie: sso.cookie })).status, 401);
});

test('provider administrator groups make a linked local account an administrator only in provider sessions', async t => {
  const ctx = await setup(t);
  const admin = await createAdmin(ctx);
  await ctx.post('/__studio/auth/admin/settings', { oidc: { adminGroups: ['studio-admins'], allowedGroups: [], autoCreate: false } }, { cookie: admin.cookie });
  const member = await invite(ctx, admin.cookie);
  ctx.provider.state.user.groups = ['studio-admins'];
  const linked = await link(ctx, member.cookie);
  assert.ok(linked.confirmed, linked.response.headers.location);
  const first = await oidcSignIn(ctx);
  assert.equal(await role(ctx, first.cookie), 'admin');
  assert.equal(await role(ctx, await localSignIn(ctx, 'member', member.backupCodes[0])), 'member', 'local sign-in never gets the provider role');
  ctx.provider.state.user.groups = [];
  const second = await oidcSignIn(ctx);
  assert.equal(await role(ctx, second.cookie), 'member');
  assert.equal(await role(ctx, await localSignIn(ctx, 'member', member.backupCodes[1])), 'member');
});

test('linking needs a recent sign-in, sends an alert, and unlinking or an admin reset removes the link', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const ctx = await setup(t);
  const admin = await createAdmin(ctx);
  await ctx.post('/__studio/auth/admin/settings', { oidc: { adminGroups: [], allowedGroups: [], autoCreate: false } }, { cookie: admin.cookie });
  const member = await invite(ctx, admin.cookie, 'member', { email: 'm@example.test' });
  t.mock.timers.tick(30 * 60000);
  ctx.provider.state.user = { sub: 'attacker', preferred_username: 'mallory', groups: [] };
  const stale = await oidcSignIn(ctx, { intent: 'link', cookie: member.cookie });
  assert.equal(stale.response.status, 401);
  assert.equal(stale.response.json.code, 'REAUTH_REQUIRED');
  assert.equal((await oidcSignIn(ctx)).response.headers.location, '/__studio/auth/sign-in?error=NO_ACCOUNT');

  const fresh = await localSignIn(ctx, 'member', member.backupCodes[0]);
  const mails = ctx.mail.length;
  const linked = await link(ctx, fresh);
  assert.ok(linked.confirmed, linked.response.headers.location);
  assert.equal(ctx.mail.length, mails + 1);
  assert.match(ctx.mail.at(-1).text, /linked/);
  const asMember = await oidcSignIn(ctx);
  assert.equal((await ctx.request('/__studio/auth/account', { cookie: asMember.cookie })).json.user.username, 'member');

  const unlinked = await ctx.post('/__studio/auth/account/unlink', {}, { cookie: fresh });
  assert.equal(unlinked.status, 200, unlinked.text);
  assert.equal(unlinked.json.user.linked, false);
  assert.equal((await ctx.request('/__studio/auth/account', { cookie: asMember.cookie })).status, 401, 'provider sessions end on unlink');
  assert.equal((await oidcSignIn(ctx)).response.headers.location, '/__studio/auth/sign-in?error=NO_ACCOUNT');

  // Linked again, then an administrator resets the account.
  assert.ok((await link(ctx, fresh)).confirmed);
  const adminCookie = await localSignIn(ctx, 'admin', admin.backupCodes[0]);
  const reset = await ctx.post('/__studio/auth/admin/reset', { id: member.id }, { cookie: adminCookie });
  assert.equal(reset.status, 200, reset.text);
  const stored = JSON.parse(await fs.readFile(path.join(ctx.stateDir, 'auth', 'auth.json'), 'utf8')).users.find(user => user.username === 'member');
  assert.equal(stored.oidc, null);
  await enroll(ctx, await ctx.post('/__studio/auth/invite/start', { invite: new URL(reset.json.link).hash.slice(1), password: PASSWORD + '!' }));
  assert.equal((await oidcSignIn(ctx)).response.headers.location, '/__studio/auth/sign-in?error=NO_ACCOUNT');

  // An administrator can unlink too.
  const relinker = await localSignIn(ctx, 'admin', admin.backupCodes[1]);
  const other = await invite(ctx, relinker, 'other');
  assert.ok((await link(ctx, other.cookie)).confirmed);
  const removed = await ctx.post('/__studio/auth/admin/unlink', { id: other.id }, { cookie: relinker });
  assert.equal(removed.status, 200, removed.text);
  assert.equal(removed.json.users.find(user => user.id === other.id).linked, false);
  assert.equal((await ctx.post('/__studio/auth/admin/unlink', { id: other.id }, { cookie: relinker })).json.code, 'NOT_LINKED');
});

test('the old GET link and confirm intents are refused', async t => {
  const ctx = await setup(t);
  const admin = await createAdmin(ctx);
  await ctx.post('/__studio/auth/admin/settings', { oidc: { adminGroups: [], allowedGroups: ['studio-users'] } }, { cookie: admin.cookie });
  const sso = await oidcSignIn(ctx);
  const start = await ctx.request('/__studio/auth/oidc/start?intent=link', { cookie: admin.cookie });
  assert.equal(start.status, 302);
  // A plain sign-in flow: completing it signs in, it does not link.
  const auth = await fetch(start.headers.location, { redirect: 'manual' });
  const back = new URL(auth.headers.get('location'));
  const done = await ctx.request(back.pathname + back.search, { cookie: [admin.cookie, cookieOf(start, 'studio_flow')].join('; ') });
  assert.notEqual(done.headers.location, '/__studio/account?linked=1');
  assert.ok(sso.cookie);
  assert.equal((await ctx.post('/__studio/auth/oidc/begin', { intent: 'signin' }, { cookie: admin.cookie })).status, 400);
});

test('parallel wrong passwords are throttled before any hashing work', async t => {
  const ctx = await setup(t, { oidc: false });
  await createAdmin(ctx);
  const results = await Promise.all(Array.from({ length: 20 }, () => ctx.post('/__studio/auth/password', { username: 'admin', password: 'wrong password here' })));
  const statuses = results.map(result => result.status);
  assert.ok(statuses.filter(status => status !== 429).length <= 5, statuses.join(','));
  assert.ok(statuses.includes(429));
});

test('parallel requests at the re-check share one refresh, so rotating tokens keep the session', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const ctx = await setup(t);
  const admin = await createAdmin(ctx);
  await ctx.post('/__studio/auth/admin/settings', { oidc: { adminGroups: [], allowedGroups: ['studio-users'] } }, { cookie: admin.cookie });
  ctx.provider.state.rotate = true;
  const sso = await oidcSignIn(ctx);
  t.mock.timers.tick(16 * 60000);
  const results = await Promise.all([1, 2, 3].map(() => ctx.request('/__studio/auth/account', { cookie: sso.cookie })));
  assert.deepEqual(results.map(result => result.status), [200, 200, 200]);
  assert.equal(ctx.provider.state.refreshCalls, 1);
  t.mock.timers.tick(16 * 60000);
  assert.equal((await ctx.request('/__studio/auth/account', { cookie: sso.cookie })).status, 200, 'the rotated token works at the next re-check');
  assert.equal(ctx.provider.state.refreshCalls, 2);
});

test('reset requests answer before the email is sent, and the email flows work', async t => {
  const ctx = await setup(t, { oidc: false });
  const admin = await createAdmin(ctx);
  await ctx.post('/__studio/auth/admin/settings', { emailCode: true }, { cookie: admin.cookie });
  const member = await invite(ctx, admin.cookie, 'member', { email: 'm@example.test' });
  const known = await ctx.post('/__studio/auth/recover/request', { identifier: 'member' });
  const unknown = await ctx.post('/__studio/auth/recover/request', { identifier: 'nobody' });
  assert.deepEqual(known.json, unknown.json);
  await waitFor(() => ctx.mail.some(item => /recover#/.test(item.text)));
  const link = ctx.mail.find(item => /recover#/.test(item.text)).text.match(/https?:\/\/\S+/)[0];
  const token = new URL(link).hash.slice(1);
  assert.equal((await ctx.post('/__studio/auth/recover/finish', { token, password: 'a brand new password', method: 'totp', code: '000000' })).status, 401);
  assert.equal((await ctx.post('/__studio/auth/recover/finish', { token, password: 'a brand new password', method: 'backup', code: member.backupCodes[1] })).status, 200);
  assert.equal((await ctx.post('/__studio/auth/recover/finish', { token, password: 'another new password', method: 'backup', code: member.backupCodes[2] })).status, 410);
  const step = await ctx.post('/__studio/auth/password', { username: 'member', password: 'a brand new password' });
  assert.ok(step.json.methods.includes('email'));
  await ctx.post('/__studio/auth/second-factor/email', { token: step.json.token });
  const emailed = ctx.mail.at(-1).text.match(/code is (\d{6})/)[1];
  assert.equal((await ctx.post('/__studio/auth/second-factor', { token: step.json.token, method: 'email', code: emailed })).status, 200);
});

test('the browser that started setup can resume it after a reload; others are told to wait', async t => {
  const ctx = await setup(t, { oidc: false });
  const started = await ctx.post('/__studio/auth/setup/start', { username: 'admin', password: PASSWORD });
  assert.equal(started.status, 200, started.text);
  const setupCookie = cookieOf(started, 'studio_setup');
  assert.ok(setupCookie);
  assert.match([].concat(started.headers['set-cookie']).find(item => item.startsWith('studio_setup=')), /HttpOnly/);
  assert.equal((await ctx.post('/__studio/auth/setup/resume', {})).status, 410);
  const resumed = await ctx.post('/__studio/auth/setup/resume', {}, { cookie: setupCookie });
  assert.equal(resumed.status, 200, resumed.text);
  assert.equal(resumed.json.token, started.json.token);
  const other = await ctx.post('/__studio/auth/setup/start', { username: 'someone', password: PASSWORD });
  assert.equal(other.json.code, 'SETUP_IN_PROGRESS');
  assert.match(other.json.error, /another browser or tab/);
  const finished = await enroll(ctx, resumed);
  assert.ok(finished.cookie);
  assert.equal((await ctx.post('/__studio/auth/setup/resume', {}, { cookie: setupCookie })).json.code, 'SETUP_DONE');
});

test('a manual administrator role on a provider account holds while no administrator groups are set', async t => {
  const ctx = await setup(t);
  const admin = await createAdmin(ctx);
  await ctx.post('/__studio/auth/admin/settings', { oidc: { adminGroups: [], allowedGroups: ['studio-users'] } }, { cookie: admin.cookie });
  const sso = await oidcSignIn(ctx);
  const id = (await ctx.request('/__studio/auth/account', { cookie: sso.cookie })).json.user.id;
  assert.equal((await ctx.post('/__studio/auth/admin/update', { id, role: 'admin' }, { cookie: admin.cookie })).status, 200);
  const again = await oidcSignIn(ctx);
  assert.equal(await role(ctx, again.cookie), 'admin');
  // Once groups are mapped, they decide.
  await ctx.post('/__studio/auth/admin/settings', { oidc: { adminGroups: ['studio-admins'] } }, { cookie: admin.cookie });
  assert.equal(await role(ctx, again.cookie), 'member');
});

test('signed-out admin API reads answer 401 so the page can ask for sign-in', async t => {
  const ctx = await setup(t, { oidc: false });
  await createAdmin(ctx);
  for (const target of ['/__studio/auth/admin/overview', '/__studio/auth/admin/audit']) {
    const response = await ctx.request(target);
    assert.equal(response.status, 401);
    assert.equal(response.json.code, 'AUTH_REQUIRED');
  }
});

test('back-channel logout ends the provider session', async t => {
  const ctx = await setup(t);
  const admin = await createAdmin(ctx);
  await ctx.post('/__studio/auth/admin/settings', { oidc: { adminGroups: [], allowedGroups: ['studio-users'] } }, { cookie: admin.cookie });
  const sso = await oidcSignIn(ctx);
  const token = await new SignJWT({ sid: 'sid-sub-1', events: { 'http://schemas.openid.net/event/backchannel-logout': {} }, jti: randomUUID() }).setProtectedHeader({ alg: 'RS256', kid: 'k1', typ: 'logout+jwt' }).setIssuer(ctx.provider.issuer).setAudience('studio').setSubject('sub-1').setIssuedAt().sign(ctx.provider.privateKey);
  const res = await ctx.request('/__studio/auth/oidc/backchannel-logout', { method: 'POST', body: 'logout_token=' + token, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(res.status, 200);
  assert.equal((await ctx.request('/__studio/auth/account', { cookie: sso.cookie })).status, 401);
});

test('the recovery command refuses to promote a provider account while administrator groups decide roles', async t => {
  const ctx = await setup(t);
  const admin = await createAdmin(ctx);
  await ctx.post('/__studio/auth/admin/settings', { oidc: { adminGroups: ['studio-admins'], allowedGroups: ['studio-users'] } }, { cookie: admin.cookie });
  await oidcSignIn(ctx);
  const { run } = await import('./cli.mjs');
  const env = { STUDIO_STATE_DIR: ctx.stateDir, STUDIO_PUBLIC_ORIGIN: ORIGIN };
  await assert.rejects(run(['recover', 'alice', '--promote'], env, { log() {} }), /groups decide their role/);
  const lines = [];
  await run(['list'], env, { log: line => lines.push(line) });
  assert.ok(lines.some(line => line.startsWith('alice\tmember\tsingle sign-on')), lines.join('\n'));
});

test('provider sign-in creates accounts only for people in an allowed or administrator group', async t => {
  const ctx = await setup(t);
  const admin = await createAdmin(ctx);
  const refused = '/__studio/auth/sign-in?error=NO_ACCOUNT';
  // Nothing listed: nobody new is created, even with auto-create on.
  await ctx.post('/__studio/auth/admin/settings', { oidc: { adminGroups: [], allowedGroups: [], autoCreate: true } }, { cookie: admin.cookie });
  assert.equal((await oidcSignIn(ctx)).response.headers.location, refused);
  // Listed groups the person isn't in: still nobody.
  await ctx.post('/__studio/auth/admin/settings', { oidc: { adminGroups: ['studio-admins'], allowedGroups: ['family'], autoCreate: true } }, { cookie: admin.cookie });
  assert.equal((await oidcSignIn(ctx)).response.headers.location, refused);
  const overview = await ctx.request('/__studio/auth/admin/overview', { cookie: admin.cookie });
  assert.equal(overview.json.users.length, 1);
  // An administrator group counts.
  ctx.provider.state.user.groups = ['studio-admins'];
  const created = await oidcSignIn(ctx);
  assert.ok(created.cookie, created.response.headers.location);
  assert.equal(await role(ctx, created.cookie), 'admin');
  // An existing account keeps signing in when the lists are cleared.
  await ctx.post('/__studio/auth/admin/settings', { oidc: { adminGroups: [], allowedGroups: [], autoCreate: true } }, { cookie: admin.cookie });
  ctx.provider.state.user.groups = [];
  assert.ok((await oidcSignIn(ctx)).cookie);
  // A different person, in an allowed group, with auto-create off: refused.
  await ctx.post('/__studio/auth/admin/settings', { oidc: { adminGroups: [], allowedGroups: ['family'], autoCreate: false } }, { cookie: admin.cookie });
  ctx.provider.state.user = { sub: 'sub-2', preferred_username: 'bob', name: 'Bob', email: 'bob@example.test', groups: ['family'] };
  assert.equal((await oidcSignIn(ctx)).response.headers.location, refused);
  // Turned back on, the allowed group creates the account.
  await ctx.post('/__studio/auth/admin/settings', { oidc: { adminGroups: [], allowedGroups: ['family'], autoCreate: true } }, { cookie: admin.cookie });
  assert.ok((await oidcSignIn(ctx)).cookie);
});

// ---- Linking, group mapping and the administrator seed (owner direction,
// 24 October 2026) ------------------------------------------------------------

const auditOf = async ctx => (await fs.readFile(path.join(ctx.stateDir, 'auth', 'audit.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));

test('a seeded administrator signs in once with the deployment password and must add a second step', async t => {
  const ctx = await setup(t, { adminUsername: 'Owner', adminPassword: PASSWORD, adminEmail: 'owner@example.test' });
  const state = await ctx.request('/__studio/auth/state');
  assert.equal(state.json.setupRequired, false, 'no open setup page while a seed is set');
  assert.equal((await ctx.post('/__studio/auth/setup/start', { username: 'intruder', password: PASSWORD })).json.code, 'SETUP_DONE');
  assert.equal((await ctx.post('/__studio/auth/password', { username: 'owner', password: 'wrong password here' })).status, 401);
  const step = await ctx.post('/__studio/auth/password', { username: 'owner', password: PASSWORD });
  assert.equal(step.status, 200, step.text);
  assert.equal(step.json.next, 'enroll');
  assert.equal(cookieOf(step), undefined, 'the password alone gives no session');
  const finishEarly = await ctx.post('/__studio/auth/enroll/finish', { token: step.json.token });
  assert.equal(finishEarly.json.code, 'FACTOR_REQUIRED');
  const done = await enroll(ctx, step);
  const account = await ctx.request('/__studio/auth/account', { cookie: done.cookie });
  assert.equal(account.json.user.role, 'admin');
  assert.equal(account.json.user.email, 'owner@example.test');
  // Set up now: the same password needs the second step like anyone else.
  const again = await ctx.post('/__studio/auth/password', { username: 'owner', password: PASSWORD });
  assert.equal(again.json.next, 'second-factor');
  assert.ok((await auditOf(ctx)).some(event => event.type === 'admin-seeded'));
});

test('the administrator seed is ignored once accounts exist, and bad seeds stop start-up', async t => {
  const { readAuthConfig } = await import('./config.mjs');
  const { createAuthService } = await import('./service.mjs');
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-seed-'));
  t.after(() => fs.rm(stateRoot, { recursive: true, force: true }));
  const make = env => createAuthService({ config: readAuthConfig({}, { STUDIO_PUBLIC_ORIGIN: ORIGIN, ...env }), stateRoot });
  const first = make({ STUDIO_ADMIN_USERNAME: 'owner', STUDIO_ADMIN_PASSWORD: PASSWORD });
  await first.initialize(); await first.close();
  const second = make({ STUDIO_ADMIN_USERNAME: 'someone-else', STUDIO_ADMIN_PASSWORD: PASSWORD + ' 2', STUDIO_ADMIN_EMAIL: 'x@example.test' });
  await second.initialize();
  const users = second.store.read().users;
  await second.close();
  assert.deepEqual(users.map(user => [user.username, user.email]), [['owner', null]], 'a later seed changes nothing');
  assert.throws(() => readAuthConfig({}, { STUDIO_PUBLIC_ORIGIN: ORIGIN, STUDIO_ADMIN_USERNAME: 'owner' }), /STUDIO_ADMIN_PASSWORD_FILE/);
  // The templates always mount the secret; the word off means no seed.
  const off = path.join(stateRoot, 'admin-password');
  await fs.writeFile(off, 'off\n');
  assert.equal(readAuthConfig({}, { STUDIO_PUBLIC_ORIGIN: ORIGIN, STUDIO_ADMIN_PASSWORD_FILE: off }).adminSeed, null);
  assert.throws(() => readAuthConfig({}, { STUDIO_PUBLIC_ORIGIN: ORIGIN, STUDIO_ADMIN_USERNAME: 'owner', STUDIO_ADMIN_PASSWORD_FILE: off }), /studio_admin_password/);
  assert.throws(() => readAuthConfig({}, { STUDIO_PUBLIC_ORIGIN: ORIGIN, STUDIO_ADMIN_USERNAME: 'owner', STUDIO_ADMIN_PASSWORD: 'short' }), /not accepted/);
  assert.throws(() => readAuthConfig({}, { STUDIO_PUBLIC_ORIGIN: ORIGIN, STUDIO_ADMIN_USERNAME: 'Bad Name!', STUDIO_ADMIN_PASSWORD: PASSWORD }), /STUDIO_ADMIN_USERNAME/);
});

test('deployment group lists are authoritative, and provider groups can be shared before anyone signs in', async t => {
  const ctx = await setup(t, { oidcAdminGroups: 'studio-admins', oidcAllowedGroups: 'family, friends' });
  const admin = await createAdmin(ctx);
  let overview = await ctx.request('/__studio/auth/admin/overview', { cookie: admin.cookie });
  assert.deepEqual(overview.json.settings.oidc.adminGroups, ['studio-admins']);
  assert.deepEqual(overview.json.settings.oidc.allowedGroups, ['family', 'friends']);
  assert.deepEqual(overview.json.deployment, { adminGroups: true, allowedGroups: true, adminSeed: false });
  const family = overview.json.groups.find(group => group.kind === 'idp' && group.name === 'family');
  assert.ok(family, 'listed groups exist before anyone signs in');
  const changed = await ctx.post('/__studio/auth/admin/settings', { oidc: { adminGroups: ['everyone'], allowedGroups: ['family', 'friends'], autoCreate: true } }, { cookie: admin.cookie });
  assert.equal(changed.status, 409);
  assert.equal(changed.json.code, 'SETTING_FROM_DEPLOYMENT');
  const same = await ctx.post('/__studio/auth/admin/settings', { oidc: { adminGroups: ['studio-admins'], allowedGroups: ['friends', 'family'], autoCreate: false } }, { cookie: admin.cookie });
  assert.equal(same.status, 200, same.text);
  assert.equal(same.json.settings.oidc.autoCreate, false);
  await ctx.post('/__studio/auth/admin/settings', { oidc: { autoCreate: true } }, { cookie: admin.cookie });
  // Another provider group added by name, then a dashboard shared with it.
  const added = await ctx.post('/__studio/auth/admin/group', { action: 'create', kind: 'idp', name: 'Media Fans' }, { cookie: admin.cookie });
  assert.equal(added.status, 200, added.text);
  assert.equal((await ctx.post('/__studio/auth/admin/group', { action: 'create', kind: 'idp', name: 'Media Fans' }, { cookie: admin.cookie })).json.code, 'GROUP_EXISTS');
  overview = await ctx.request('/__studio/auth/admin/overview', { cookie: admin.cookie });
  const dashboard = overview.json.dashboards[0];
  assert.ok(dashboard, 'a dashboard exists');
  const shared = await ctx.post('/__studio/auth/admin/grants', { dashboardId: dashboard.id, grants: [{ subject: 'group:' + family.id, level: 'view' }] }, { cookie: admin.cookie });
  assert.equal(shared.status, 200, shared.text);
  // The first sign-in of a family member lands on the shared dashboard.
  ctx.provider.state.user = { sub: 'kid', preferred_username: 'kid', name: 'Kid', groups: ['family'] };
  const kid = await oidcSignIn(ctx);
  assert.ok(kid.cookie, kid.response.headers.location);
  const list = await ctx.request('/__studio/auth/dashboards', { cookie: kid.cookie });
  assert.deepEqual(list.json.dashboards.map(entry => [entry.id, entry.level]), [[dashboard.id, 'view']]);
  assert.equal(await role(ctx, kid.cookie), 'member');
});

test('provider groups can be added by name only when single sign-on is set up', async t => {
  const ctx = await setup(t, { oidc: false });
  const admin = await createAdmin(ctx);
  assert.equal((await ctx.post('/__studio/auth/admin/group', { action: 'create', kind: 'idp', name: 'family' }, { cookie: admin.cookie })).json.code, 'OIDC_NOT_CONFIGURED');
});

test('linking from a provider session claims the local account, merges the provider-only account and takes the verified email', async t => {
  const ctx = await setup(t);
  const setupStart = await ctx.post('/__studio/auth/setup/start', { username: 'admin', password: PASSWORD, email: 'old@example.test' });
  const admin = await enroll(ctx, setupStart);
  await ctx.post('/__studio/auth/admin/settings', { oidc: { adminGroups: ['studio-admins'], allowedGroups: [] } }, { cookie: admin.cookie });
  ctx.provider.state.user = { sub: 'ben', preferred_username: 'ben', name: 'Ben', email: 'ben@sso.test', email_verified: true, groups: ['studio-admins'] };
  // Signed in through the provider first: a separate provider-only account.
  const sso = await oidcSignIn(ctx);
  assert.ok(sso.cookie, sso.response.headers.location);
  let overview = await ctx.request('/__studio/auth/admin/overview', { cookie: admin.cookie });
  const duplicate = overview.json.users.find(user => user.source === 'oidc');
  const dashboard = overview.json.dashboards[0];
  await ctx.post('/__studio/auth/admin/grants', { dashboardId: dashboard.id, grants: [{ subject: 'user:' + duplicate.id, level: 'arrange' }] }, { cookie: admin.cookie });

  // Without claiming the local account first, linking is refused.
  const early = await oidcSignIn(ctx, { intent: 'link', cookie: sso.cookie });
  assert.equal(early.response.json.code, 'CLAIM_REQUIRED');
  // A claim needs the local password and second step; a wrong one fails.
  assert.equal((await ctx.post('/__studio/auth/claim/password', { username: 'admin', password: 'not the password!' }, { cookie: sso.cookie })).status, 401);
  assert.equal((await ctx.post('/__studio/auth/claim/password', { username: 'admin', password: PASSWORD }, { cookie: admin.cookie })).json.code, 'NOT_PROVIDER_ACCOUNT');
  const claim = await ctx.post('/__studio/auth/claim/password', { username: 'admin', password: PASSWORD }, { cookie: sso.cookie });
  assert.equal(claim.status, 200, claim.text);
  const verified = await ctx.post('/__studio/auth/claim/second-factor', { token: claim.json.token, method: 'backup', code: admin.backupCodes[0] }, { cookie: sso.cookie });
  assert.equal(verified.status, 200, verified.text);
  assert.equal(verified.json.next, 'link');
  assert.equal(cookieOf(verified), undefined, 'claiming does not sign in as the local account');

  const linked = await oidcSignIn(ctx, { intent: 'link', cookie: sso.cookie });
  assert.equal(linked.response.headers.location, '/__studio/account?link=confirm');
  assert.equal(ctx.provider.state.lastPrompt, 'login', 'the provider is asked for a fresh sign-in');
  assert.equal(ctx.provider.state.lastMaxAge, '300');
  const pending = (await ctx.request('/__studio/auth/account', { cookie: sso.cookie })).json.pendingLink;
  assert.equal(pending.local.username, 'admin');
  assert.equal(pending.local.email, 'old@example.test');
  assert.equal(pending.provider.email, 'ben@sso.test');
  assert.equal(pending.merge.username, duplicate.username);
  assert.equal(pending.merge.shares, 1);

  const mails = ctx.mail.length;
  const confirmed = await ctx.post('/__studio/auth/account/link/confirm', {}, { cookie: sso.cookie });
  assert.equal(confirmed.status, 200, confirmed.text);
  const merged = cookieOf(confirmed);
  assert.ok(merged, 'the browser continues as the local account');
  const account = (await ctx.request('/__studio/auth/account', { cookie: merged })).json;
  assert.equal(account.user.username, 'admin');
  assert.equal(account.user.email, 'ben@sso.test');
  assert.equal(account.user.emailFromProvider, true);
  assert.equal(account.method, 'oidc');
  assert.equal((await ctx.request('/__studio/auth/account', { cookie: sso.cookie })).status, 401, 'the merged account’s session ended');
  assert.equal((await ctx.request('/__studio/auth/account', { cookie: admin.cookie })).status, 401, 'other sessions of the local account ended');
  assert.deepEqual(ctx.mail.slice(mails).map(mail => mail.to).sort(), ['ben@sso.test', 'old@example.test']);

  const local = await localSignIn(ctx, 'admin', admin.backupCodes[1]);
  overview = await ctx.request('/__studio/auth/admin/overview', { cookie: local });
  assert.equal(overview.json.users.length, 1, 'the provider-only account is gone');
  assert.deepEqual(overview.json.grants[dashboard.id], [{ subject: 'user:' + account.user.id, level: 'arrange' }]);
  // The password never changed, and the email can't be edited while linked.
  assert.equal((await ctx.post('/__studio/auth/account/profile', { displayName: 'Ben', email: 'elsewhere@example.test' }, { cookie: local })).json.code, 'EMAIL_FROM_PROVIDER');
  assert.equal((await ctx.post('/__studio/auth/admin/update', { id: account.user.id, email: 'elsewhere@example.test' }, { cookie: local })).json.code, 'EMAIL_FROM_PROVIDER');

  // Later sign-ins keep the email in step, but only with a verified email.
  ctx.provider.state.user.email = 'ben@new.test';
  assert.ok((await oidcSignIn(ctx)).cookie);
  ctx.provider.state.user = { ...ctx.provider.state.user, email: 'unverified@evil.test', email_verified: false };
  assert.ok((await oidcSignIn(ctx)).cookie);
  overview = await ctx.request('/__studio/auth/admin/overview', { cookie: local });
  assert.equal(overview.json.users[0].email, 'ben@new.test');
  assert.equal(overview.json.oidc.lastSignIn.emailUnverified, true);
  // Unlinked, the email is the person's own again.
  const fresh = await localSignIn(ctx, 'admin', admin.backupCodes[2]);
  await ctx.post('/__studio/auth/account/unlink', {}, { cookie: fresh });
  assert.equal((await ctx.post('/__studio/auth/account/profile', { displayName: 'Ben', email: 'mine@example.test' }, { cookie: fresh })).status, 200);
});

test('linking refuses a different provider account, a stale provider sign-in, an old local sign-in and an identity in use', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const ctx = await setup(t);
  const admin = await createAdmin(ctx);
  await ctx.post('/__studio/auth/admin/settings', { oidc: { adminGroups: [], allowedGroups: ['studio-users'] } }, { cookie: admin.cookie });
  const sso = await oidcSignIn(ctx);
  const claim = await ctx.post('/__studio/auth/claim/password', { username: 'admin', password: PASSWORD }, { cookie: sso.cookie });
  await ctx.post('/__studio/auth/claim/second-factor', { token: claim.json.token, method: 'backup', code: admin.backupCodes[0] }, { cookie: sso.cookie });
  // At the provider, someone signs in as a different account.
  const original = ctx.provider.state.user;
  ctx.provider.state.user = { ...original, sub: 'someone-else' };
  const mismatch = await oidcSignIn(ctx, { intent: 'link', cookie: sso.cookie });
  assert.equal(mismatch.response.headers.location, '/__studio/account?error=LINK_MISMATCH');
  ctx.provider.state.user = original;

  // A provider session older than five minutes doesn't count.
  const local = await localSignIn(ctx, 'admin', admin.backupCodes[1]);
  ctx.provider.state.authTime = Math.floor(Date.now() / 1000) - 600;
  const stale = await oidcSignIn(ctx, { intent: 'link', cookie: local });
  assert.equal(stale.response.headers.location, '/__studio/account?error=OIDC_FAILED');
  ctx.provider.state.authTime = undefined;

  // A local sign-in older than five minutes needs confirming again.
  t.mock.timers.tick(6 * 60000);
  const old = await oidcSignIn(ctx, { intent: 'link', cookie: local });
  assert.equal(old.response.json.code, 'REAUTH_REQUIRED');

  // Linked to one local account, the identity can't be linked to another.
  const member = await invite(ctx, await localSignIn(ctx, 'admin', admin.backupCodes[2]), 'member');
  ctx.provider.state.user = { ...original, sub: 'shared' };
  assert.ok((await link(ctx, member.cookie)).confirmed);
  const second = await oidcSignIn(ctx, { intent: 'link', cookie: await localSignIn(ctx, 'admin', admin.backupCodes[3]) });
  assert.equal(second.response.headers.location, '/__studio/account?error=IDENTITY_IN_USE');
  // A cancelled or expired confirmation links nothing.
  const otherMember = await invite(ctx, await localSignIn(ctx, 'admin', admin.backupCodes[4]), 'other');
  ctx.provider.state.user = { ...original, sub: 'third' };
  assert.equal((await oidcSignIn(ctx, { intent: 'link', cookie: otherMember.cookie })).response.headers.location, '/__studio/account?link=confirm');
  t.mock.timers.tick(6 * 60000);
  assert.equal((await ctx.post('/__studio/auth/account/link/confirm', {}, { cookie: otherMember.cookie })).json.code, 'FLOW_EXPIRED');
});

// Independent review of 24 October 2026, S1-S3.
test('linking never merges a provider-only account an administrator disabled', async t => {
  const ctx = await setup(t);
  const admin = await createAdmin(ctx);
  await ctx.post('/__studio/auth/admin/settings', { oidc: { adminGroups: [], allowedGroups: ['studio-users'] } }, { cookie: admin.cookie });
  ctx.provider.state.user = { sub: 'bob', preferred_username: 'bob', name: 'Bob', email: 'bob@sso.test', email_verified: true, groups: ['studio-users'] };
  assert.ok((await oidcSignIn(ctx)).cookie);
  let overview = await ctx.request('/__studio/auth/admin/overview', { cookie: admin.cookie });
  const ssoUser = overview.json.users.find(u => u.source === 'oidc');
  const dashboard = overview.json.dashboards[0];
  const member = await invite(ctx, admin.cookie, 'bobby');
  await ctx.post('/__studio/auth/admin/grants', { dashboardId: dashboard.id, grants: [{ subject: 'user:' + ssoUser.id, level: 'arrange' }, { subject: 'user:' + member.id, level: 'view' }] }, { cookie: admin.cookie });
  assert.equal((await ctx.post('/__studio/auth/admin/update', { id: ssoUser.id, disabled: true }, { cookie: admin.cookie })).status, 200);
  const linked = await link(ctx, member.cookie);
  assert.equal(linked.confirmed, null);
  assert.equal(linked.response.headers.location, '/__studio/account?error=LINK_TARGET_DISABLED');
  overview = await ctx.request('/__studio/auth/admin/overview', { cookie: admin.cookie });
  assert.equal(overview.json.users.find(u => u.id === ssoUser.id).disabled, true);
  assert.equal(overview.json.users.find(u => u.id === member.id).linked, false);
  assert.equal(overview.json.grants[dashboard.id].find(g => g.subject === 'user:' + member.id).level, 'view');
  assert.equal((await oidcSignIn(ctx)).cookie, undefined, 'the disabled identity still cannot sign in');
});

test('the link confirmation says when a merged account loses a manual administrator role', async t => {
  const ctx = await setup(t);
  const admin = await createAdmin(ctx);
  await ctx.post('/__studio/auth/admin/settings', { oidc: { adminGroups: [], allowedGroups: ['studio-users'] } }, { cookie: admin.cookie });
  ctx.provider.state.user = { sub: 'carol', preferred_username: 'carol', name: 'Carol', email: 'carol@sso.test', email_verified: true, groups: ['studio-users'] };
  await oidcSignIn(ctx);
  const overview = await ctx.request('/__studio/auth/admin/overview', { cookie: admin.cookie });
  const ssoUser = overview.json.users.find(u => u.source === 'oidc');
  assert.equal((await ctx.post('/__studio/auth/admin/update', { id: ssoUser.id, role: 'admin' }, { cookie: admin.cookie })).status, 200);
  const member = await invite(ctx, admin.cookie, 'carol-local');
  await oidcSignIn(ctx, { intent: 'link', cookie: member.cookie });
  const view = (await ctx.request('/__studio/auth/account', { cookie: member.cookie })).json.pendingLink;
  assert.equal(view.merge.losesAdmin, true);
  assert.equal((await ctx.post('/__studio/auth/account/link/confirm', {}, { cookie: member.cookie })).status, 200);
  assert.equal(await role(ctx, (await oidcSignIn(ctx)).cookie), 'member', 'privileges are not carried over');
});

test('claiming a local account with a backup code sends an alert', async t => {
  const ctx = await setup(t);
  const admin = await enroll(ctx, await ctx.post('/__studio/auth/setup/start', { username: 'admin', password: PASSWORD, email: 'admin@example.test' }));
  await ctx.post('/__studio/auth/admin/settings', { oidc: { adminGroups: [], allowedGroups: ['studio-users'] } }, { cookie: admin.cookie });
  const sso = await oidcSignIn(ctx);
  const before = ctx.mail.length;
  const claim = await ctx.post('/__studio/auth/claim/password', { username: 'admin', password: PASSWORD }, { cookie: sso.cookie });
  const done = await ctx.post('/__studio/auth/claim/second-factor', { token: claim.json.token, method: 'backup', code: admin.backupCodes[0] }, { cookie: sso.cookie });
  assert.equal(done.status, 200, done.text);
  await waitFor(() => ctx.mail.length > before);
  assert.equal(ctx.mail.at(-1).to, 'admin@example.test');
  assert.match(ctx.mail.at(-1).text, /backup code was used/);
});
