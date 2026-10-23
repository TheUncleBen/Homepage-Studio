// Sign-in, sessions, enrolment, recovery and administration. HTTP parsing
// lives in routes.mjs; this module owns the rules and the stored data.
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import {
  hashPassword, verifyPassword, passwordProblem, randomToken, tokenHash, safeEqual, verifyTotp, totpUri,
  base32Encode, backupCode, backupCodeHash, emailCode, sealSecret, openSecret,
} from './primitives.mjs';
import { createAuthStore, AuthError, DEFAULT_POLICY } from './store.mjs';
import { dashboardLevel, effectivePolicy, userGroupIds, validGrantList, GRANT_LEVELS } from './access.mjs';
import { createPasskeys } from './webauthn.mjs';
import { createMailer, messages } from './mail.mjs';
import { createOidc } from './oidc.mjs';

const MINUTE = 60000;
const PENDING_TTL = 10 * MINUTE;
const SETUP_TTL = 30 * MINUTE;
const INVITE_HOURS = 72;
const RECOVERY_MINUTES = 30;
const EMAIL_CODE_MINUTES = 10;
const BACKUP_CODE_COUNT = 10;
const MAX_FACTOR_ATTEMPTS = 5;
const TOUCH_INTERVAL = MINUTE;
const COOKIE_MAX_SECONDS = 400 * 24 * 60 * 60;
export const RECOVERY_FILE = 'recovery.json';

const USERNAME = /^[a-z0-9][a-z0-9._@-]{0,63}$/;
const fail = (message, code, status = 400) => { throw new AuthError(message, code, status); };
const genericSignInFailure = () => fail("Those details didn't work. Check them and try again.", 'SIGN_IN_FAILED', 401);

function cleanText(value, max, label, { optional = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (optional) return null;
    fail(`Enter ${label}.`, 'INVALID_FIELD');
  }
  if (typeof value !== 'string') fail(`Enter ${label} as text.`, 'INVALID_FIELD');
  const text = value.trim().normalize('NFC');
  if (!text || text.length > max || /[\u0000-\u001f\u007f]/.test(text)) fail(`Enter ${label} of 1 to ${max} characters.`, 'INVALID_FIELD');
  return text;
}
export function normalizeUsername(value) {
  const name = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!USERNAME.test(name)) fail('Use a username of 1 to 64 lowercase letters, numbers, dots, hyphens, underscores or @, starting with a letter or number.', 'INVALID_USERNAME');
  return name;
}
function cleanEmail(value) {
  const email = cleanText(value, 254, 'an email address', { optional: true });
  if (email !== null && !/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(email)) fail('Enter a valid email address.', 'INVALID_EMAIL');
  return email;
}

// Exponential delay after repeated failures, never a permanent lockout, so
// an attacker cannot lock the real owner out.
function createThrottle(now) {
  const entries = new Map();
  const FREE = 5, MAX_DELAY = 15 * MINUTE;
  return {
    check(keys) {
      const time = now();
      for (const key of keys) {
        const entry = entries.get(key);
        if (entry && entry.until > time) {
          const seconds = Math.ceil((entry.until - time) / 1000);
          throw Object.assign(new AuthError(`Too many attempts. Wait ${seconds < 60 ? seconds + ' seconds' : Math.ceil(seconds / 60) + ' minutes'} and try again.`, 'TOO_MANY_ATTEMPTS', 429), { retryAfter: seconds });
        }
      }
    },
    failure(keys) {
      const time = now();
      for (const key of keys) {
        const entry = entries.get(key) ?? { count: 0, until: 0 };
        entry.count++;
        if (entry.count >= FREE) entry.until = time + Math.min(MAX_DELAY, 1000 * 2 ** (entry.count - FREE));
        entry.seen = time;
        entries.set(key, entry);
      }
      if (entries.size > 10000) for (const [key, entry] of entries) if (time - entry.seen > MAX_DELAY) entries.delete(key);
    },
    success(keys) { for (const key of keys) entries.delete(key); },
  };
}

export function publicUser(user, data) {
  return {
    id: user.id, username: user.username, displayName: user.displayName, email: user.email ?? null,
    role: user.role, disabled: Boolean(user.disabled), source: user.source, createdAt: user.createdAt,
    status: user.status, groupIds: user.groupIds ?? [], oidcGroups: user.oidcGroups ?? [], policyId: user.policyId ?? null,
    linked: Boolean(user.oidc),
    factors: {
      password: Boolean(user.password), totp: Boolean(user.totp),
      passkeys: (user.passkeys ?? []).map(passkey => ({ id: passkey.id, name: passkey.name, createdAt: passkey.createdAt, lastUsedAt: passkey.lastUsedAt ?? null })),
      backupCodesLeft: (user.backupCodes ?? []).filter(code => !code.used).length,
    },
    effectiveGroups: data ? userGroupIds(data, user) : undefined,
  };
}

// Local accounts must keep a complete multi-factor sign-in: a passkey, or a
// password together with TOTP. Identity-provider-only accounts have no
// local factors.
function hasCompleteLocalFactors(user) {
  return (user.passkeys?.length ?? 0) > 0 || (Boolean(user.password) && Boolean(user.totp));
}

function activeAdmins(data) {
  return data.users.filter(user => user.role === 'admin' && !user.disabled && user.status === 'active');
}

export function createAuthService({ config, stateRoot, now = () => Date.now(), listDashboards = async () => [] }) {
  const store = createAuthStore({ stateRoot });
  const passkeys = createPasskeys(config);
  const mailer = createMailer(config.smtp);
  const oidc = createOidc(config.oidc, config);
  const throttle = createThrottle(now);
  const pending = new Map();

  function putPending(value, ttl = PENDING_TTL) {
    const token = randomToken();
    pending.set(tokenHash(token), { ...value, expiresAt: now() + ttl });
    if (pending.size > 5000) for (const [key, entry] of pending) if (entry.expiresAt <= now()) pending.delete(key);
    return token;
  }
  function takePending(token, kind, { keep = false } = {}) {
    const key = tokenHash(String(token ?? ''));
    const entry = pending.get(key);
    if (!entry || entry.kind !== kind || entry.expiresAt <= now()) {
      pending.delete(key);
      fail('This step has expired. Start again.', 'FLOW_EXPIRED', 410);
    }
    if (!keep) pending.delete(key);
    return entry;
  }
  const findUser = (data, id) => data.users.find(user => user.id === id);

  async function notify(user, event) {
    if (!mailer || !user.email) return;
    try { await mailer.send({ to: user.email, ...messages.alert({ name: user.displayName || user.username, event }) }); }
    catch (error) { console.error('Security alert email failed:', error.code || error.name); }
  }

  // ---- Sessions -----------------------------------------------------------

  function clientIp(req) {
    const remote = String(req.socket?.remoteAddress ?? '').replace(/^::ffff:/, '');
    if (!config.trustedProxies || !remote) return remote;
    const family = remote.includes(':') ? 'ipv6' : 'ipv4';
    if (!config.trustedProxies.check(remote, family)) return remote;
    // Walk X-Forwarded-For from the right, skipping trusted proxies.
    const chain = String(req.headers['x-forwarded-for'] ?? '').split(',').map(part => part.trim().replace(/^::ffff:/, '')).filter(Boolean);
    for (let index = chain.length - 1; index >= 0; index--) {
      const address = chain[index];
      if (!config.trustedProxies.check(address, address.includes(':') ? 'ipv6' : 'ipv4')) return address;
    }
    return chain[0] ?? remote;
  }

  function readCookie(req, name) {
    for (const part of String(req.headers.cookie ?? '').split(';')) {
      const index = part.indexOf('=');
      if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
    }
    return null;
  }
  function cookie(name, value, { maxAge, path = '/' } = {}) {
    return [`${name}=${value}`, `Path=${path}`, 'HttpOnly', 'SameSite=Lax', ...(config.secure ? ['Secure'] : []), ...(maxAge !== undefined ? [`Max-Age=${maxAge}`] : [])].join('; ');
  }
  function appendCookie(res, value) {
    const current = res.getHeader('set-cookie');
    res.setHeader('set-cookie', [].concat(current ?? [], value));
  }
  const clearSessionCookie = res => appendCookie(res, cookie(config.cookieName, '', { maxAge: 0 }));

  async function createSession(req, res, user, { method, remember = true, recovery = false, oidcState = null }) {
    const data = store.read();
    const policy = effectivePolicy(data, user);
    const token = randomToken();
    const time = now();
    const persistent = Boolean(remember && policy.persistent);
    const session = {
      id: tokenHash(token), userId: user.id, createdAt: time, lastSeenAt: time, authAt: time,
      method, persistent, recovery, ip: clientIp(req), userAgent: String(req.headers['user-agent'] ?? '').slice(0, 200),
      oidc: oidcState,
    };
    if (policy.maxSessions) {
      const mine = store.sessions.all().filter(item => item.userId === user.id).sort((a, b) => a.lastSeenAt - b.lastSeenAt);
      const excess = mine.length - policy.maxSessions + 1;
      if (excess > 0) { const remove = new Set(mine.slice(0, excess).map(item => item.id)); await store.sessions.remove(item => remove.has(item.id)); }
    }
    await store.sessions.put(session);
    const maxAge = persistent ? Math.min(COOKIE_MAX_SECONDS, policy.absoluteMinutes ? policy.absoluteMinutes * 60 : COOKIE_MAX_SECONDS) : undefined;
    appendCookie(res, cookie(config.cookieName, token, { maxAge }));
    return session;
  }

  // Fresh credentials for an existing session: a new token, so a token
  // observed before re-authentication stops working.
  async function refreshSession(res, session, fields = {}) {
    const token = randomToken();
    const next = { ...session, ...fields, id: tokenHash(token), authAt: now(), lastSeenAt: now() };
    await store.sessions.remove(item => item.id === session.id);
    await store.sessions.put(next);
    const data = store.read();
    const user = findUser(data, session.userId);
    const policy = effectivePolicy(data, user);
    const maxAge = next.persistent ? Math.min(COOKIE_MAX_SECONDS, policy.absoluteMinutes ? Math.max(1, Math.floor((next.createdAt + policy.absoluteMinutes * MINUTE - now()) / 1000)) : COOKIE_MAX_SECONDS) : undefined;
    appendCookie(res, cookie(config.cookieName, token, { maxAge }));
    return next;
  }

  function sessionExpired(session, policy, time) {
    if (policy.absoluteMinutes && session.createdAt + policy.absoluteMinutes * MINUTE <= time) return true;
    if (policy.idleMinutes && session.lastSeenAt + policy.idleMinutes * MINUTE <= time) return true;
    return false;
  }

  // Identity-provider sessions re-check groups with the refresh token.
  async function recheckProvider(session, user) {
    if (!oidc || session.method !== 'oidc' || !session.oidc?.refresh) return session;
    if ((session.oidc.nextCheckAt ?? 0) > now()) return session;
    let refreshToken;
    try { refreshToken = openSecret(session.oidc.refresh, config.key).toString('utf8'); } catch { return null; }
    let result;
    try { result = await oidc.refresh(refreshToken, user.oidc?.subject); }
    catch { store.sessions.touch(session.id, { oidc: { ...session.oidc, nextCheckAt: now() + MINUTE } }); return session; }
    if (!result) return null;
    const allowed = applyProviderGroups(store.read(), user, result.groups).allowed;
    if (!allowed) return null;
    await store.mutate(data => {
      const target = findUser(data, user.id);
      if (!target) return;
      const outcome = applyProviderGroups(data, target, result.groups);
      Object.assign(target, outcome.user);
      for (const name of result.groups) ensureIdpGroup(data, name);
    });
    const updated = { ...session.oidc, refresh: sealSecret(Buffer.from(result.refreshToken), config.key), nextCheckAt: now() + oidc.refreshMinutes * MINUTE };
    store.sessions.touch(session.id, { oidc: updated });
    return { ...session, oidc: updated };
  }

  async function principal(req) {
    if (!store.ready) return null;
    const token = readCookie(req, config.cookieName);
    if (!token || token.length > 100) return null;
    let session = store.sessions.get(tokenHash(token));
    if (!session) return null;
    let data = store.read();
    let user = findUser(data, session.userId);
    const time = now();
    if (!user || user.disabled || user.status !== 'active') { await store.sessions.remove(item => item.id === session.id); return null; }
    let policy = effectivePolicy(data, user);
    if (sessionExpired(session, policy, time)) { await store.sessions.remove(item => item.id === session.id); return null; }
    // Local sign-in turned off ends local sessions, except a recovery session.
    if (!data.settings.localSignIn && session.method === 'local' && !session.recovery) { await store.sessions.remove(item => item.id === session.id); return null; }
    session = await recheckProvider(session, user);
    if (!session) {
      const id = tokenHash(token);
      await store.sessions.remove(item => item.id === id);
      await audit('session-ended', { userId: user.id, reason: 'provider' }, req);
      return null;
    }
    data = store.read(); user = findUser(data, session.userId); policy = effectivePolicy(data, user);
    if (!user || user.disabled) return null;
    if (time - session.lastSeenAt >= TOUCH_INTERVAL) store.sessions.touch(session.id, { lastSeenAt: time });
    return {
      user, session, policy,
      level: dashboardId => dashboardLevel(data, user, dashboardId),
      fresh: () => time - session.authAt <= policy.stepUpMinutes * MINUTE,
    };
  }

  async function audit(type, fields = {}, req) {
    await store.audit({ type, ...fields, ...(req ? { ip: clientIp(req) } : {}) });
  }

  // ---- Provider groups and roles -----------------------------------------

  function ensureIdpGroup(data, name) {
    if (data.groups.some(group => group.kind === 'idp' && group.name === name)) return;
    if (data.groups.length >= 200) return;
    data.groups.push({ id: randomUUID(), kind: 'idp', name, policyId: null });
  }
  // Computes role and allowed status from provider groups. Provider groups
  // decide the role for provider accounts; a linked local account keeps its
  // own role unless the provider maps it to administrator.
  function applyProviderGroups(data, user, groups) {
    const settings = data.settings.oidc;
    const set = new Set(groups);
    const allowed = !settings.allowedGroups.length || settings.allowedGroups.some(name => set.has(name)) || (settings.adminGroups.length > 0 && settings.adminGroups.some(name => set.has(name)));
    const mappedAdmin = settings.adminGroups.some(name => set.has(name));
    let role = user.role;
    if (mappedAdmin) role = 'admin';
    else if (user.source === 'oidc') role = 'member';
    return { allowed, user: { ...user, oidcGroups: groups, role } };
  }

  // ---- Shared factor checks ----------------------------------------------

  async function checkSecondFactor(user, entry, body, req) {
    const method = body?.method;
    if (method === 'totp') {
      if (!user.totp) genericSignInFailure();
      const step = verifyTotp(openSecret(user.totp.secret, config.key), String(body.code ?? ''), { now: now(), lastStep: user.totp.lastStep ?? -1 });
      if (step === null) return null;
      return data => { const target = findUser(data, user.id); target.totp.lastStep = step; };
    }
    if (method === 'backup') {
      const hash = backupCodeHash(body.code);
      const match = (user.backupCodes ?? []).find(code => !code.used && safeEqual(code.hash, hash));
      if (!match) return null;
      return data => {
        const target = findUser(data, user.id);
        const code = target.backupCodes.find(item => item.hash === match.hash);
        if (!code || code.used) genericSignInFailure();
        code.used = true;
      };
    }
    if (method === 'email') {
      if (!entry?.emailCode || entry.emailCode.expiresAt <= now()) fail('That code has expired. Send a new one.', 'CODE_EXPIRED', 410);
      if (!safeEqual(entry.emailCode.hash, tokenHash('email:' + String(body.code ?? '').trim()))) return null;
      entry.emailCode = null;
      return () => {};
    }
    if (method === 'passkey') {
      if (!entry?.challenge) fail('Start the passkey step again.', 'FLOW_EXPIRED', 410);
      const passkey = (user.passkeys ?? []).find(item => item.id === body.response?.id);
      if (!passkey) return null;
      const { newCounter } = await passkeys.verifyAuthentication(body.response, entry.challenge, passkey);
      entry.challenge = null;
      return data => { const target = findUser(data, user.id).passkeys.find(item => item.id === passkey.id); target.counter = newCounter; target.lastUsedAt = now(); };
    }
    fail('Choose a sign-in method.', 'INVALID_METHOD');
  }

  function secondFactorMethods(data, user) {
    return [
      ...(user.totp ? ['totp'] : []),
      ...(user.passkeys?.length ? ['passkey'] : []),
      ...((user.backupCodes ?? []).some(code => !code.used) ? ['backup'] : []),
      ...(data.settings.emailCode && mailer && user.email ? ['email'] : []),
    ];
  }

  function requireLocalSignIn(data) {
    if (!data.settings.localSignIn) fail('Local sign-in is turned off. Use single sign-on.', 'LOCAL_SIGN_IN_DISABLED', 403);
  }

  // ---- Sign-in ------------------------------------------------------------

  async function passwordStep(req, body, { intent = 'signin', current } = {}) {
    const data = store.read();
    if (intent === 'signin') requireLocalSignIn(data);
    const username = intent === 'reauth' ? current.user.username : (typeof body?.username === 'string' ? body.username.trim().toLowerCase() : '');
    const keys = ['ip:' + clientIp(req), 'user:' + username];
    throttle.check(keys);
    const user = data.users.find(item => item.username === username);
    const ok = await verifyPassword(String(body?.password ?? ''), user?.password);
    if (!ok || !user || user.disabled || user.status !== 'active') {
      throttle.failure(keys);
      await audit('sign-in-failed', { username: username.slice(0, 64), step: 'password' }, req);
      genericSignInFailure();
    }
    const methods = secondFactorMethods(data, user);
    if (!methods.length) {
      throttle.failure(keys);
      fail('This account has no second sign-in step. Ask an administrator to reset it.', 'NO_SECOND_FACTOR', 401);
    }
    const token = putPending({ kind: 'second-factor', intent, userId: user.id, sessionId: current?.session.id, remember: body?.remember !== false, attempts: 0, keys });
    return { next: 'second-factor', token, methods };
  }

  async function secondFactorPasskeyOptions(body) {
    const entry = takePending(body?.token, 'second-factor', { keep: true });
    const user = findUser(store.read(), entry.userId);
    if (!user?.passkeys?.length) fail('This account has no passkey.', 'NO_PASSKEY');
    const options = await passkeys.authenticationOptions(user.passkeys);
    entry.challenge = options.challenge;
    return { options };
  }

  async function sendEmailCode(body) {
    const entry = takePending(body?.token, 'second-factor', { keep: true });
    const data = store.read();
    const user = findUser(data, entry.userId);
    if (!data.settings.emailCode || !mailer || !user?.email) fail('Email codes are not available for this account.', 'EMAIL_CODE_UNAVAILABLE');
    if (entry.emailCode?.sentAt && now() - entry.emailCode.sentAt < MINUTE) fail('A code was just sent. Wait a minute before asking for another.', 'TOO_MANY_ATTEMPTS', 429);
    const code = emailCode();
    entry.emailCode = { hash: tokenHash('email:' + code), expiresAt: now() + EMAIL_CODE_MINUTES * MINUTE, sentAt: now() };
    try { await mailer.send({ to: user.email, ...messages.code({ name: user.displayName || user.username, code, minutes: EMAIL_CODE_MINUTES }) }); }
    catch (error) { console.error('Sign-in code email failed:', error.code || error.name); fail("The code couldn't be sent. Use another method or try again later.", 'EMAIL_FAILED', 502); }
    return { sent: true };
  }

  async function secondFactorStep(req, res, body, current) {
    const entry = takePending(body?.token, 'second-factor', { keep: true });
    throttle.check(entry.keys);
    const data = store.read();
    const user = findUser(data, entry.userId);
    if (!user || user.disabled || user.status !== 'active') genericSignInFailure();
    if (entry.intent === 'signin') requireLocalSignIn(data);
    if (entry.intent === 'reauth' && current?.session.id !== entry.sessionId) fail('Start again from this browser.', 'FLOW_EXPIRED', 410);
    let apply;
    try { apply = await checkSecondFactor(user, entry, body, req); }
    catch (error) { if (error.code === 'PASSKEY_INVALID') apply = null; else throw error; }
    if (!apply) {
      throttle.failure(entry.keys);
      entry.attempts++;
      if (entry.attempts >= MAX_FACTOR_ATTEMPTS) pending.delete(tokenHash(body.token));
      await audit('sign-in-failed', { userId: user.id, step: body?.method }, req);
      fail("That code didn't work. Check it and try again.", 'SIGN_IN_FAILED', 401);
    }
    pending.delete(tokenHash(body.token));
    await store.mutate(apply);
    throttle.success(entry.keys);
    if (entry.intent === 'reauth') {
      await refreshSession(res, current.session);
      await audit('reauthenticated', { userId: user.id, method: body.method }, req);
      return { ok: true };
    }
    await createSession(req, res, user, { method: 'local', remember: entry.remember });
    await audit('signed-in', { userId: user.id, method: 'password+' + body.method }, req);
    if (body.method === 'backup') await notify(store.read().users.find(item => item.id === user.id), 'A backup code was used to sign in. Generate new codes if you are running low.');
    return { ok: true, backupCodesLeft: findUser(store.read(), user.id).backupCodes.filter(code => !code.used).length };
  }

  async function passkeyOptions({ intent = 'signin', current } = {}) {
    const data = store.read();
    if (intent === 'signin') requireLocalSignIn(data);
    const user = intent === 'reauth' ? findUser(data, current.user.id) : null;
    if (intent === 'reauth' && !user?.passkeys?.length) fail('This account has no passkey.', 'NO_PASSKEY');
    const options = await passkeys.authenticationOptions(user ? user.passkeys : undefined);
    const token = putPending({ kind: 'passkey', intent, challenge: options.challenge, sessionId: current?.session.id }, 5 * MINUTE);
    return { token, options };
  }

  async function passkeyStep(req, res, body, current) {
    const entry = takePending(body?.token, 'passkey');
    const keys = ['ip:' + clientIp(req)];
    throttle.check(keys);
    const data = store.read();
    if (entry.intent === 'signin') requireLocalSignIn(data);
    if (entry.intent === 'reauth' && current?.session.id !== entry.sessionId) fail('Start again from this browser.', 'FLOW_EXPIRED', 410);
    const credentialId = body?.response?.id;
    const user = typeof credentialId === 'string' ? data.users.find(item => (item.passkeys ?? []).some(passkey => passkey.id === credentialId)) : null;
    if (!user || user.disabled || user.status !== 'active' || (entry.intent === 'reauth' && user.id !== current.user.id)) {
      throttle.failure(keys);
      await audit('sign-in-failed', { step: 'passkey' }, req);
      fail("That passkey isn't registered here.", 'SIGN_IN_FAILED', 401);
    }
    const passkey = user.passkeys.find(item => item.id === credentialId);
    let verified;
    try { verified = await passkeys.verifyAuthentication(body.response, entry.challenge, passkey); }
    catch (error) { throttle.failure(keys); await audit('sign-in-failed', { userId: user.id, step: 'passkey' }, req); throw error; }
    await store.mutate(draft => { const target = findUser(draft, user.id).passkeys.find(item => item.id === passkey.id); target.counter = verified.newCounter; target.lastUsedAt = now(); });
    throttle.success(keys);
    if (entry.intent === 'reauth') { await refreshSession(res, current.session); await audit('reauthenticated', { userId: user.id, method: 'passkey' }, req); return { ok: true }; }
    await createSession(req, res, user, { method: 'local', remember: body?.remember !== false });
    await audit('signed-in', { userId: user.id, method: 'passkey' }, req);
    return { ok: true };
  }

  async function signOut(req, res, current) {
    clearSessionCookie(res);
    if (!current) return { ok: true };
    await store.sessions.remove(item => item.id === current.session.id);
    await audit('signed-out', { userId: current.user.id }, req);
    let logoutUrl = null;
    if (oidc && current.session.method === 'oidc' && current.session.oidc?.idToken) {
      let idToken;
      try { idToken = openSecret(current.session.oidc.idToken, config.key).toString('utf8'); } catch { idToken = undefined; }
      logoutUrl = await oidc.logoutUrl(idToken, new URL('/__studio/auth/sign-in?signedOut=1', config.origin).href);
    }
    return { ok: true, logoutUrl };
  }

  // ---- Enrolment (first administrator and invitations) -------------------

  function enrollmentView(entry) {
    return { username: entry.username, displayName: entry.displayName, hasTotp: Boolean(entry.totp?.confirmed), passkeys: entry.passkeys.map(item => ({ id: item.id, name: item.name })), complete: Boolean(entry.passkeys.length || entry.totp?.confirmed) };
  }

  let setupClaim = null;
  async function startSetup(req, body) {
    const data = store.read();
    if (data.users.length) fail('Studio is already set up. Sign in instead.', 'SETUP_DONE', 409);
    // Owner decision D6 (23 Oct 2026): the first visitor creates the
    // administrator, without a setup code. One browser at a time.
    if (setupClaim && setupClaim.expiresAt > now() && pending.has(setupClaim.key)) fail('Someone else is setting up Studio right now. Try again in a few minutes.', 'SETUP_IN_PROGRESS', 409);
    const username = normalizeUsername(body?.username);
    const displayName = cleanText(body?.displayName ?? username, 100, 'a display name');
    const email = cleanEmail(body?.email);
    const problem = passwordProblem(body?.password);
    if (problem) fail(problem, 'WEAK_PASSWORD');
    const token = putPending({ kind: 'enroll', purpose: 'setup', username, displayName, email, passwordHash: await hashPassword(body.password), passkeys: [], webauthnUserId: randomBytes(32).toString('base64url') }, SETUP_TTL);
    setupClaim = { key: tokenHash(token), expiresAt: now() + SETUP_TTL };
    await audit('setup-started', { username }, req);
    return { token, enrollment: enrollmentView(takePending(token, 'enroll', { keep: true })) };
  }

  function inviteFor(data, token, purpose) {
    const hash = tokenHash(String(token ?? ''));
    const invite = data.invites.find(item => safeEqual(item.tokenHash, hash) && item.purpose === purpose && item.expiresAt > now());
    if (!invite) fail('This link has expired or was already used. Ask an administrator for a new one.', 'INVITE_INVALID', 410);
    return invite;
  }

  async function inviteDetails(body) {
    const data = store.read();
    const invite = inviteFor(data, body?.invite, 'enroll');
    const user = findUser(data, invite.userId);
    if (!user || user.disabled) fail('This link has expired or was already used. Ask an administrator for a new one.', 'INVITE_INVALID', 410);
    return { username: user.username, displayName: user.displayName, localSignIn: data.settings.localSignIn, oidc: oidc ? { name: oidc.name } : null };
  }

  async function startInvite(req, body) {
    const data = store.read();
    const invite = inviteFor(data, body?.invite, 'enroll');
    const user = findUser(data, invite.userId);
    if (!user || user.disabled) fail('This link has expired or was already used. Ask an administrator for a new one.', 'INVITE_INVALID', 410);
    requireLocalSignIn(data);
    const problem = passwordProblem(body?.password);
    if (problem) fail(problem, 'WEAK_PASSWORD');
    const displayName = body?.displayName === undefined ? user.displayName : cleanText(body.displayName, 100, 'a display name');
    const token = putPending({ kind: 'enroll', purpose: 'invite', inviteHash: invite.tokenHash, userId: user.id, username: user.username, displayName, email: user.email, passwordHash: await hashPassword(body.password), passkeys: [], webauthnUserId: user.webauthnUserId }, SETUP_TTL);
    return { token, enrollment: enrollmentView(takePending(token, 'enroll', { keep: true })) };
  }

  async function enrollTotpStart(body) {
    const entry = takePending(body?.token, 'enroll', { keep: true });
    const secret = randomBytes(20);
    entry.totp = { secret, confirmed: false };
    return { secret: base32Encode(secret), uri: totpUri({ secret, account: entry.username, issuer: config.rpName }) };
  }
  async function enrollTotpConfirm(body) {
    const entry = takePending(body?.token, 'enroll', { keep: true });
    if (!entry.totp) fail('Start authenticator setup again.', 'FLOW_EXPIRED', 410);
    const step = verifyTotp(entry.totp.secret, String(body?.code ?? ''), { now: now() });
    if (step === null) fail("That code didn't match. Check the time on your phone and try the newest code.", 'TOTP_INVALID');
    entry.totp.confirmed = true;
    entry.totp.lastStep = step;
    return { enrollment: enrollmentView(entry) };
  }
  async function enrollPasskeyOptions(body) {
    const entry = takePending(body?.token, 'enroll', { keep: true });
    const options = await passkeys.registrationOptions({ username: entry.username, displayName: entry.displayName, webauthnUserId: entry.webauthnUserId, passkeys: entry.passkeys });
    entry.challenge = options.challenge;
    return { options };
  }
  async function enrollPasskeyVerify(body) {
    const entry = takePending(body?.token, 'enroll', { keep: true });
    if (!entry.challenge) fail('Start the passkey step again.', 'FLOW_EXPIRED', 410);
    const credential = await passkeys.verifyRegistration(body?.response, entry.challenge);
    entry.challenge = null;
    if (store.read().users.some(user => (user.passkeys ?? []).some(passkey => passkey.id === credential.id))) fail('That passkey is already registered.', 'PASSKEY_EXISTS', 409);
    entry.passkeys.push({ ...credential, name: cleanText(body?.name ?? 'Passkey', 60, 'a passkey name'), createdAt: now(), lastUsedAt: null });
    return { enrollment: enrollmentView(entry) };
  }

  function newBackupCodes() {
    const codes = Array.from({ length: BACKUP_CODE_COUNT }, backupCode);
    return { codes, stored: codes.map(code => ({ hash: backupCodeHash(code), used: false })) };
  }

  async function finishEnrollment(req, res, body) {
    const entry = takePending(body?.token, 'enroll', { keep: true });
    if (!entry.passkeys.length && !entry.totp?.confirmed) fail('Add an authenticator app or a passkey first.', 'FACTOR_REQUIRED');
    const backup = newBackupCodes();
    const factors = {
      password: entry.passwordHash,
      totp: entry.totp?.confirmed ? { secret: sealSecret(entry.totp.secret, config.key), lastStep: entry.totp.lastStep ?? -1, createdAt: now() } : null,
      passkeys: entry.passkeys,
      backupCodes: backup.stored,
    };
    const user = await store.mutate(data => {
      if (entry.purpose === 'setup') {
        if (data.users.length) fail('Studio was set up by someone else. Sign in instead.', 'SETUP_DONE', 409);
        const created = {
          id: randomUUID(), username: entry.username, displayName: entry.displayName, email: entry.email, role: 'admin', status: 'active',
          disabled: false, source: 'local', createdAt: now(), groupIds: [], oidcGroups: [], policyId: null, oidc: null,
          webauthnUserId: entry.webauthnUserId, ...factors,
        };
        data.users.push(created);
        data.setupCompletedAt = now();
        return created;
      }
      const invite = data.invites.find(item => item.tokenHash === entry.inviteHash);
      const target = findUser(data, entry.userId);
      if (!invite || invite.expiresAt <= now() || !target || target.disabled) fail('This link has expired or was already used. Ask an administrator for a new one.', 'INVITE_INVALID', 410);
      data.invites = data.invites.filter(item => item !== invite);
      Object.assign(target, factors, { status: 'active', displayName: entry.displayName });
      return target;
    });
    pending.delete(tokenHash(body.token));
    if (entry.purpose === 'setup') setupClaim = null;
    await createSession(req, res, user, { method: 'local' });
    await audit(entry.purpose === 'setup' ? 'setup-completed' : 'enrolled', { userId: user.id }, req);
    return { ok: true, backupCodes: backup.codes };
  }

  // ---- Recovery -----------------------------------------------------------

  async function requestRecovery(req, body) {
    const data = store.read();
    const keys = ['ip:' + clientIp(req), 'recover'];
    throttle.check(keys.slice(0, 1));
    throttle.failure(keys.slice(0, 1));
    const lookup = typeof body?.identifier === 'string' ? body.identifier.trim().toLowerCase() : '';
    const user = data.users.find(item => item.status === 'active' && !item.disabled && item.source === 'local' && (item.username === lookup || (item.email && item.email.toLowerCase() === lookup)));
    // Same answer whether or not the account exists.
    const answer = { ok: true, message: mailer ? 'If that account has an email address, a reset link is on its way.' : 'Email is not set up here. Ask an administrator to reset your account.' };
    if (!mailer || !user?.email || !data.settings.localSignIn) return answer;
    const token = randomToken();
    await store.mutate(draft => {
      draft.invites = draft.invites.filter(item => !(item.userId === user.id && item.purpose === 'recover'));
      draft.invites.push({ tokenHash: tokenHash(token), userId: user.id, purpose: 'recover', expiresAt: now() + RECOVERY_MINUTES * MINUTE, createdAt: now() });
    });
    const link = new URL(`/__studio/auth/recover#${token}`, config.origin).href;
    try { await mailer.send({ to: user.email, ...messages.recovery({ name: user.displayName || user.username, link, minutes: RECOVERY_MINUTES }) }); }
    catch (error) { console.error('Recovery email failed:', error.code || error.name); }
    await audit('recovery-requested', { userId: user.id }, req);
    return answer;
  }

  async function recoveryDetails(body) {
    const data = store.read();
    const invite = inviteFor(data, body?.token, 'recover');
    const user = findUser(data, invite.userId);
    if (!user) fail('This link has expired or was already used.', 'INVITE_INVALID', 410);
    const methods = secondFactorMethods(data, user).filter(method => method !== 'email');
    let options = null;
    if (methods.includes('passkey')) {
      options = await passkeys.authenticationOptions(user.passkeys);
      pending.set('recover:' + invite.tokenHash, { kind: 'recover-passkey', challenge: options.challenge, expiresAt: now() + 5 * MINUTE });
    }
    return { username: user.username, methods, passkeyOptions: options };
  }

  async function finishRecovery(req, res, body) {
    const data = store.read();
    const invite = inviteFor(data, body?.token, 'recover');
    const user = findUser(data, invite.userId);
    if (!user || user.disabled) fail('This link has expired or was already used.', 'INVITE_INVALID', 410);
    const keys = ['ip:' + clientIp(req), 'user:' + user.username];
    throttle.check(keys);
    const problem = passwordProblem(body?.password);
    if (problem) fail(problem, 'WEAK_PASSWORD');
    if (body?.method === 'email') fail('Use your authenticator app, passkey or a backup code.', 'INVALID_METHOD');
    const entry = body?.method === 'passkey' ? pending.get('recover:' + invite.tokenHash) : {};
    if (body?.method === 'passkey' && (!entry || entry.expiresAt <= now())) fail('Start again from the link.', 'FLOW_EXPIRED', 410);
    let apply;
    try { apply = await checkSecondFactor(user, entry, body, req); } catch (error) { if (error.code === 'PASSKEY_INVALID') apply = null; else throw error; }
    if (!apply) { throttle.failure(keys); await audit('recovery-failed', { userId: user.id }, req); fail("That didn't work. Check it and try again.", 'SIGN_IN_FAILED', 401); }
    const passwordHash = await hashPassword(body.password);
    await store.mutate(draft => {
      apply(draft);
      const target = findUser(draft, user.id);
      target.password = passwordHash;
      draft.invites = draft.invites.filter(item => item.tokenHash !== invite.tokenHash);
    });
    pending.delete('recover:' + invite.tokenHash);
    await store.sessions.remove(item => item.userId === user.id);
    throttle.success(keys);
    await createSession(req, res, findUser(store.read(), user.id), { method: 'local' });
    await audit('password-reset', { userId: user.id, via: 'email' }, req);
    await notify(user, 'Your password was reset using an emailed link. Other signed-in devices were signed out.');
    return { ok: true };
  }

  // Command-line recovery: `studio-auth recover` writes a one-time link into
  // the auth folder. Redeeming it signs in as that user, even with local
  // sign-in turned off. It needs shell access to the container.
  async function redeemRecovery(req, res, body) {
    const file = join(store.directory, RECOVERY_FILE);
    let request;
    try {
      const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      try { request = JSON.parse(await handle.readFile('utf8')); } finally { await handle.close(); }
    } catch { fail('This recovery link has expired or was already used. Run the recovery command again.', 'RECOVERY_INVALID', 410); }
    const keys = ['ip:' + clientIp(req)];
    throttle.check(keys);
    if (!request || typeof request.tokenHash !== 'string' || !(request.expiresAt > now()) || !safeEqual(request.tokenHash, tokenHash(String(body?.token ?? '')))) {
      throttle.failure(keys);
      fail('This recovery link has expired or was already used. Run the recovery command again.', 'RECOVERY_INVALID', 410);
    }
    await fs.unlink(file).catch(() => {});
    const user = await store.mutate(data => {
      const target = findUser(data, request.userId);
      if (!target) fail('That account no longer exists. Run the recovery command again.', 'RECOVERY_INVALID', 410);
      target.disabled = false;
      if (request.promote) target.role = 'admin';
      if (target.status !== 'active') target.status = 'active';
      return target;
    });
    await createSession(req, res, user, { method: 'local', recovery: true, remember: false });
    await audit('recovery-used', { userId: user.id, promoted: Boolean(request.promote) }, req);
    await notify(user, 'Someone used the command-line recovery link to sign in to your account.');
    return { ok: true };
  }

  // ---- Account ------------------------------------------------------------

  function requireFresh(current) {
    if (!current.fresh()) throw new AuthError('Confirm it’s you to continue.', 'REAUTH_REQUIRED', 401);
  }
  function accountView(current) {
    const data = store.read();
    const user = findUser(data, current.user.id);
    const sessions = store.sessions.all().filter(item => item.userId === user.id).map(item => ({
      id: item.id.slice(0, 16), current: item.id === current.session.id, createdAt: item.createdAt, lastSeenAt: item.lastSeenAt,
      method: item.method, userAgent: item.userAgent, ip: item.ip,
    }));
    return {
      user: publicUser(user, data), policy: effectivePolicy(data, user), sessions,
      fresh: current.fresh(), recovery: Boolean(current.session.recovery), method: current.session.method,
      localSignIn: data.settings.localSignIn, oidc: oidc ? { name: oidc.name } : null, email: Boolean(mailer),
      groups: data.groups.filter(group => userGroupIds(data, user).includes(group.id)).map(group => ({ id: group.id, name: group.name, kind: group.kind })),
    };
  }
  async function changeUser(current, change, event) {
    await store.mutate(data => {
      const user = findUser(data, current.user.id);
      change(user, data);
      if (user.source === 'local' && !hasCompleteLocalFactors(user)) fail('Keep a passkey, or a password with an authenticator app, so you can still sign in.', 'FACTOR_REQUIRED');
    });
    if (event) await audit(event, { userId: current.user.id });
  }
  const account = {
    view: current => accountView(current),
    async profile(current, body) {
      const displayName = cleanText(body?.displayName, 100, 'a display name');
      const email = body?.email === undefined ? undefined : cleanEmail(body.email);
      if (email !== undefined && email !== (current.user.email ?? null)) requireFresh(current);
      await changeUser(current, user => { user.displayName = displayName; if (email !== undefined) user.email = email; }, 'profile-changed');
      return accountView(await refreshed(current));
    },
    async password(current, body) {
      requireFresh(current);
      const problem = passwordProblem(body?.password);
      if (problem) fail(problem, 'WEAK_PASSWORD');
      const hash = await hashPassword(body.password);
      await changeUser(current, user => { user.password = hash; }, 'password-changed');
      await store.sessions.remove(item => item.userId === current.user.id && item.id !== current.session.id);
      await notify(current.user, 'Your password was changed. Other signed-in devices were signed out.');
      return { ok: true };
    },
    async totpStart(current) {
      requireFresh(current);
      const secret = randomBytes(20);
      const token = putPending({ kind: 'account-totp', userId: current.user.id, secret });
      return { token, secret: base32Encode(secret), uri: totpUri({ secret, account: current.user.username, issuer: config.rpName }) };
    },
    async totpConfirm(current, body) {
      requireFresh(current);
      const entry = takePending(body?.token, 'account-totp', { keep: true });
      if (entry.userId !== current.user.id) fail('Start again.', 'FLOW_EXPIRED', 410);
      const step = verifyTotp(entry.secret, String(body?.code ?? ''), { now: now() });
      if (step === null) fail("That code didn't match. Check the time on your phone and try the newest code.", 'TOTP_INVALID');
      pending.delete(tokenHash(body.token));
      await changeUser(current, user => { user.totp = { secret: sealSecret(entry.secret, config.key), lastStep: step, createdAt: now() }; }, 'totp-added');
      await notify(current.user, 'An authenticator app was set up for your account.');
      return accountView(await refreshed(current));
    },
    async totpRemove(current) {
      requireFresh(current);
      await changeUser(current, user => { user.totp = null; }, 'totp-removed');
      await notify(current.user, 'The authenticator app was removed from your account.');
      return accountView(await refreshed(current));
    },
    async passkeyOptions(current) {
      requireFresh(current);
      const user = findUser(store.read(), current.user.id);
      if (!user.webauthnUserId) await store.mutate(data => { findUser(data, user.id).webauthnUserId = randomBytes(32).toString('base64url'); });
      const fresh = findUser(store.read(), current.user.id);
      const options = await passkeys.registrationOptions(fresh);
      const token = putPending({ kind: 'account-passkey', userId: fresh.id, challenge: options.challenge }, 5 * MINUTE);
      return { token, options };
    },
    async passkeyVerify(current, body) {
      requireFresh(current);
      const entry = takePending(body?.token, 'account-passkey');
      if (entry.userId !== current.user.id) fail('Start again.', 'FLOW_EXPIRED', 410);
      const credential = await passkeys.verifyRegistration(body?.response, entry.challenge);
      const name = cleanText(body?.name ?? 'Passkey', 60, 'a passkey name');
      await changeUser(current, (user, data) => {
        if (data.users.some(item => (item.passkeys ?? []).some(passkey => passkey.id === credential.id))) fail('That passkey is already registered.', 'PASSKEY_EXISTS', 409);
        if ((user.passkeys ?? []).length >= 20) fail('You can register up to 20 passkeys.', 'PASSKEY_LIMIT');
        user.passkeys = [...(user.passkeys ?? []), { ...credential, name, createdAt: now(), lastUsedAt: null }];
      }, 'passkey-added');
      await notify(current.user, `A passkey named "${name}" was added to your account.`);
      return accountView(await refreshed(current));
    },
    async passkeyRename(current, body) {
      const name = cleanText(body?.name, 60, 'a passkey name');
      await changeUser(current, user => { const passkey = (user.passkeys ?? []).find(item => item.id === body?.id); if (!passkey) fail('That passkey no longer exists.', 'NOT_FOUND', 404); passkey.name = name; });
      return accountView(await refreshed(current));
    },
    async passkeyRemove(current, body) {
      requireFresh(current);
      await changeUser(current, user => {
        const before = (user.passkeys ?? []).length;
        user.passkeys = (user.passkeys ?? []).filter(item => item.id !== body?.id);
        if (user.passkeys.length === before) fail('That passkey no longer exists.', 'NOT_FOUND', 404);
      }, 'passkey-removed');
      await notify(current.user, 'A passkey was removed from your account.');
      return accountView(await refreshed(current));
    },
    async backupCodes(current) {
      requireFresh(current);
      const backup = newBackupCodes();
      await changeUser(current, user => { user.backupCodes = backup.stored; }, 'backup-codes-regenerated');
      await notify(current.user, 'New backup codes were generated. The old ones no longer work.');
      return { backupCodes: backup.codes };
    },
    async revokeSessions(current, body) {
      const target = body?.id;
      const removed = await store.sessions.remove(item => item.userId === current.user.id && item.id !== current.session.id && (target === 'others' || (String(target).length >= 16 && item.id.startsWith(String(target)))));
      await audit('sessions-revoked', { userId: current.user.id, count: removed });
      return accountView(current);
    },
  };
  async function refreshed(current) {
    const data = store.read();
    const user = findUser(data, current.user.id);
    return { ...current, user };
  }

  // ---- Administration -----------------------------------------------------

  function requireAdmin(current, { fresh = true } = {}) {
    if (current?.user.role !== 'admin') fail('Only administrators can do this.', 'FORBIDDEN', 403);
    if (fresh) requireFresh(current);
  }
  function guardAdmins(data) {
    if (!activeAdmins(data).length) fail('Studio needs at least one active administrator. Make someone else an administrator first.', 'LAST_ADMIN', 409);
  }
  function inviteLink(token) { return new URL(`/__studio/auth/enroll#${token}`, config.origin).href; }
  async function issueInvite(data, user, createdBy) {
    const token = randomToken();
    data.invites = data.invites.filter(item => !(item.userId === user.id && item.purpose === 'enroll'));
    data.invites.push({ tokenHash: tokenHash(token), userId: user.id, purpose: 'enroll', expiresAt: now() + INVITE_HOURS * 60 * MINUTE, createdAt: now(), createdBy });
    return token;
  }
  async function sendInvite(user, link) {
    if (!mailer || !user.email) return false;
    try { await mailer.send({ to: user.email, ...messages.invite({ name: user.displayName || user.username, link, hours: INVITE_HOURS }) }); return true; }
    catch (error) { console.error('Invitation email failed:', error.code || error.name); return false; }
  }
  function policyFields(body) {
    const minutes = (value, label, min, max) => {
      if (value === null) return null;
      if (!Number.isInteger(value) || value < min || value > max) fail(`${label} must be a whole number of minutes from ${min} to ${max}, or never.`, 'INVALID_POLICY');
      return value;
    };
    const stepUp = body?.stepUpMinutes;
    if (!Number.isInteger(stepUp) || stepUp < 5 || stepUp > 60) fail('The confirmation window must be 5 to 60 minutes.', 'INVALID_POLICY');
    const max = body?.maxSessions;
    if (max !== null && (!Number.isInteger(max) || max < 1 || max > 50)) fail('Concurrent sessions must be 1 to 50, or unlimited.', 'INVALID_POLICY');
    return {
      name: cleanText(body?.name, 60, 'a policy name'),
      idleMinutes: minutes(body?.idleMinutes ?? null, 'Idle timeout', 5, 90 * 24 * 60),
      absoluteMinutes: minutes(body?.absoluteMinutes ?? null, 'Maximum session length', 60, 365 * 24 * 60),
      persistent: body?.persistent === true,
      stepUpMinutes: stepUp,
      maxSessions: max,
    };
  }
  const admin = {
    async overview(current) {
      requireAdmin(current, { fresh: false });
      const data = store.read();
      const dashboards = await listDashboards();
      const sessions = store.sessions.all();
      return {
        users: data.users.map(user => ({ ...publicUser(user, data), sessionCount: sessions.filter(item => item.userId === user.id).length, lastSeenAt: Math.max(0, ...sessions.filter(item => item.userId === user.id).map(item => item.lastSeenAt)) || null, invitePending: data.invites.some(item => item.userId === user.id && item.purpose === 'enroll') })),
        groups: data.groups.map(group => ({ ...group, memberCount: data.users.filter(user => userGroupIds(data, user).includes(group.id)).length })),
        policies: data.policies,
        settings: data.settings,
        grants: data.grants,
        dashboards: dashboards.map(entry => ({ id: entry.id, name: entry.name, slug: entry.slug, archived: entry.archived })),
        oidc: oidc ? { name: oidc.name, redirectUri: oidc.redirectUri, backchannelLogoutUri: new URL('/__studio/auth/oidc/backchannel-logout', config.origin).href } : null,
        email: Boolean(mailer), keyConfigured: Boolean(config.key), fresh: current.fresh(), currentUserId: current.user.id,
        canDisableLocal: canDisableLocal(data, current),
      };
    },
    async invite(current, body) {
      requireAdmin(current);
      const username = normalizeUsername(body?.username);
      const displayName = cleanText(body?.displayName ?? username, 100, 'a display name');
      const email = cleanEmail(body?.email);
      const role = body?.role === 'admin' ? 'admin' : 'member';
      let token, user;
      await store.mutate(async data => {
        if (data.users.some(item => item.username === username)) fail('That username is taken.', 'USERNAME_TAKEN', 409);
        user = { id: randomUUID(), username, displayName, email, role, status: 'invited', disabled: false, source: 'local', createdAt: now(), groupIds: [], oidcGroups: [], policyId: null, oidc: null, webauthnUserId: randomBytes(32).toString('base64url'), password: null, totp: null, passkeys: [], backupCodes: [] };
        data.users.push(user);
        token = await issueInvite(data, user, current.user.id);
      });
      const link = inviteLink(token);
      const emailed = body?.sendEmail === true ? await sendInvite(user, link) : false;
      await audit('user-invited', { userId: user.id, by: current.user.id, role });
      return { user: publicUser(user), link, emailed, expiresInHours: INVITE_HOURS };
    },
    async update(current, body) {
      requireAdmin(current);
      await store.mutate(data => {
        const user = findUser(data, body?.id);
        if (!user) fail('That user no longer exists.', 'NOT_FOUND', 404);
        if (body.displayName !== undefined) user.displayName = cleanText(body.displayName, 100, 'a display name');
        if (body.email !== undefined) user.email = cleanEmail(body.email);
        if (body.role !== undefined) {
          if (!['admin', 'member'].includes(body.role)) fail('Choose Administrator or Member.', 'INVALID_ROLE');
          if (user.source === 'oidc' && data.settings.oidc.adminGroups.length && body.role !== user.role) fail(`${oidc?.name ?? 'The identity provider'} groups decide this account's role.`, 'ROLE_FROM_PROVIDER', 409);
          user.role = body.role;
        }
        if (body.disabled !== undefined) user.disabled = body.disabled === true;
        if (body.groupIds !== undefined) {
          const local = new Set(data.groups.filter(group => group.kind === 'local').map(group => group.id));
          if (!Array.isArray(body.groupIds) || body.groupIds.some(id => !local.has(id))) fail('Choose existing local groups.', 'INVALID_GROUP');
          user.groupIds = [...new Set(body.groupIds)];
        }
        if (body.policyId !== undefined) {
          if (body.policyId !== null && !data.policies.some(policy => policy.id === body.policyId)) fail('Choose an existing policy.', 'INVALID_POLICY');
          user.policyId = body.policyId;
        }
        guardAdmins(data);
      });
      if (body.disabled === true) await store.sessions.remove(item => item.userId === body.id);
      await audit('user-updated', { userId: body.id, by: current.user.id, fields: Object.keys(body).filter(key => key !== 'id') });
      return admin.overview(current);
    },
    async reset(current, body) {
      requireAdmin(current);
      let token, user;
      await store.mutate(async data => {
        user = findUser(data, body?.id);
        if (!user) fail('That user no longer exists.', 'NOT_FOUND', 404);
        if (user.source !== 'local') fail('This account signs in through single sign-on and has no local factors.', 'NOT_LOCAL', 409);
        Object.assign(user, { password: null, totp: null, passkeys: [], backupCodes: [], status: 'invited' });
        guardAdmins(data);
        token = await issueInvite(data, user, current.user.id);
      });
      await store.sessions.remove(item => item.userId === user.id);
      const link = inviteLink(token);
      const emailed = body?.sendEmail === true ? await sendInvite(user, link) : false;
      await audit('user-reset', { userId: user.id, by: current.user.id });
      return { link, emailed, expiresInHours: INVITE_HOURS };
    },
    async remove(current, body) {
      requireAdmin(current);
      if (body?.id === current.user.id) fail("You can't delete your own account.", 'SELF_DELETE', 409);
      await store.mutate(data => {
        const before = data.users.length;
        data.users = data.users.filter(user => user.id !== body?.id);
        if (data.users.length === before) fail('That user no longer exists.', 'NOT_FOUND', 404);
        data.invites = data.invites.filter(item => item.userId !== body.id);
        for (const id of Object.keys(data.grants)) data.grants[id] = data.grants[id].filter(grant => grant.subject !== 'user:' + body.id);
        guardAdmins(data);
      });
      await store.sessions.remove(item => item.userId === body.id);
      await audit('user-deleted', { userId: body.id, by: current.user.id });
      return admin.overview(current);
    },
    async revokeUserSessions(current, body) {
      requireAdmin(current);
      const removed = await store.sessions.remove(item => item.userId === body?.userId && item.id !== current.session.id);
      await audit('sessions-revoked', { userId: body?.userId, by: current.user.id, count: removed });
      return admin.overview(current);
    },
    async group(current, body) {
      requireAdmin(current);
      await store.mutate(data => {
        if (body?.action === 'create') {
          const name = cleanText(body.name, 60, 'a group name');
          if (data.groups.some(group => group.kind === 'local' && group.name.toLowerCase() === name.toLowerCase())) fail('A group with that name exists.', 'GROUP_EXISTS', 409);
          data.groups.push({ id: randomUUID(), kind: 'local', name, policyId: null });
          return;
        }
        const group = data.groups.find(item => item.id === body?.id);
        if (!group) fail('That group no longer exists.', 'NOT_FOUND', 404);
        if (body.action === 'update') {
          if (body.name !== undefined) {
            if (group.kind === 'idp') fail('Provider groups are named by the identity provider.', 'GROUP_READ_ONLY', 409);
            group.name = cleanText(body.name, 60, 'a group name');
          }
          if (body.policyId !== undefined) {
            if (body.policyId !== null && !data.policies.some(policy => policy.id === body.policyId)) fail('Choose an existing policy.', 'INVALID_POLICY');
            group.policyId = body.policyId;
          }
        } else if (body.action === 'delete') {
          data.groups = data.groups.filter(item => item.id !== group.id);
          for (const user of data.users) user.groupIds = (user.groupIds ?? []).filter(id => id !== group.id);
          for (const id of Object.keys(data.grants)) data.grants[id] = data.grants[id].filter(grant => grant.subject !== 'group:' + group.id);
        } else fail('Choose a group action.', 'INVALID_ACTION');
      });
      await audit('group-changed', { action: body?.action, groupId: body?.id, by: current.user.id });
      return admin.overview(current);
    },
    async policy(current, body) {
      requireAdmin(current);
      await store.mutate(data => {
        if (body?.action === 'create') { data.policies.push({ id: randomUUID(), ...policyFields(body) }); return; }
        const policy = data.policies.find(item => item.id === body?.id);
        if (!policy) fail('That policy no longer exists.', 'NOT_FOUND', 404);
        if (body.action === 'update') Object.assign(policy, policyFields(body));
        else if (body.action === 'delete') {
          if (policy.id === 'default') fail('The default policy cannot be deleted.', 'DEFAULT_POLICY', 409);
          data.policies = data.policies.filter(item => item.id !== policy.id);
          for (const user of data.users) if (user.policyId === policy.id) user.policyId = null;
          for (const group of data.groups) if (group.policyId === policy.id) group.policyId = null;
        } else fail('Choose a policy action.', 'INVALID_ACTION');
      });
      await audit('policy-changed', { action: body?.action, policyId: body?.id, by: current.user.id });
      return admin.overview(current);
    },
    async settings(current, body) {
      requireAdmin(current);
      await store.mutate(data => {
        const next = structuredClone(data.settings);
        if (body?.emailCode !== undefined) next.emailCode = body.emailCode === true;
        if (body?.oidc !== undefined) {
          const names = (value, label) => {
            if (!Array.isArray(value) || value.length > 50 || value.some(name => typeof name !== 'string' || !name.trim() || name.length > 200)) fail(`List ${label} as group names.`, 'INVALID_SETTINGS');
            return [...new Set(value.map(name => name.trim()))];
          };
          next.oidc = { adminGroups: names(body.oidc.adminGroups ?? [], 'administrator groups'), allowedGroups: names(body.oidc.allowedGroups ?? [], 'allowed groups'), autoCreate: body.oidc.autoCreate !== false };
        }
        if (body?.localSignIn !== undefined) {
          next.localSignIn = body.localSignIn !== false;
          if (!next.localSignIn && !canDisableLocal({ ...data, settings: next }, current)) {
            fail(`Before turning off local sign-in, sign in through ${oidc?.name ?? 'single sign-on'} as an administrator whose provider group is listed under administrator groups.`, 'LOCAL_SIGN_IN_REQUIRED', 409);
          }
        }
        data.settings = next;
      });
      await audit('settings-changed', { by: current.user.id, fields: Object.keys(body ?? {}) });
      return admin.overview(current);
    },
    async grants(current, body) {
      requireAdmin(current);
      const dashboards = await listDashboards();
      if (!dashboards.some(entry => entry.id === body?.dashboardId)) fail('That dashboard no longer exists.', 'NOT_FOUND', 404);
      await store.mutate(data => {
        if (!validGrantList(body.grants, data)) fail(`Share with existing users or groups, at ${GRANT_LEVELS.join(' or ')} level, once each.`, 'INVALID_GRANTS');
        data.grants[body.dashboardId] = body.grants.map(grant => ({ subject: grant.subject, level: grant.level }));
      });
      await audit('access-changed', { dashboardId: body.dashboardId, by: current.user.id, count: body.grants.length });
      return { grants: store.read().grants[body.dashboardId] };
    },
    async audit(current) { requireAdmin(current, { fresh: false }); return { events: await store.readAudit(500) }; },
  };

  function canDisableLocal(data, current) {
    if (!oidc || current.session.method !== 'oidc') return false;
    const user = findUser(data, current.user.id);
    return Boolean(user && data.settings.oidc.adminGroups.some(name => (user.oidcGroups ?? []).includes(name)));
  }

  // Copies the access list when a dashboard is duplicated with "copy access".
  async function copyGrants(fromId, toId) {
    await store.mutate(data => { data.grants[toId] = structuredClone(data.grants[fromId] ?? []); });
  }

  // ---- Single sign-on -----------------------------------------------------

  async function oidcStart(res, { intent = 'signin', next = '/', current } = {}) {
    if (!oidc) fail('Single sign-on is not configured.', 'OIDC_NOT_CONFIGURED', 404);
    const flow = await oidc.start();
    const id = randomToken();
    pending.set('oidc:' + tokenHash(id), { kind: 'oidc', ...flow, intent, next: safeNext(next), sessionId: current?.session.id, userId: current?.user.id, expiresAt: now() + PENDING_TTL });
    appendCookie(res, cookie(config.flowCookieName, id, { maxAge: 600 }));
    return flow.url;
  }

  async function oidcCallback(req, res, current) {
    const id = readCookie(req, config.flowCookieName);
    appendCookie(res, cookie(config.flowCookieName, '', { maxAge: 0 }));
    const key = 'oidc:' + tokenHash(String(id ?? ''));
    const flow = pending.get(key);
    pending.delete(key);
    if (!flow || flow.expiresAt <= now()) fail('This sign-in took too long or was started in another browser. Try again.', 'FLOW_EXPIRED', 410);
    const result = await oidc.finish(new URL(req.url, config.origin), flow);
    let data = store.read();
    const findLinked = draft => draft.users.find(user => user.oidc && user.oidc.issuer === result.issuer && user.oidc.subject === result.subject);
    if (flow.intent === 'link') {
      if (!current || current.session.id !== flow.sessionId) fail('Start linking again from your account page.', 'FLOW_EXPIRED', 410);
      const other = findLinked(data);
      if (other && other.id !== current.user.id) fail('That identity is already linked to another Studio account.', 'IDENTITY_IN_USE', 409);
      await store.mutate(draft => { const user = findUser(draft, current.user.id); user.oidc = { issuer: result.issuer, subject: result.subject }; user.oidcGroups = result.groups; for (const name of result.groups) ensureIdpGroup(draft, name); });
      await audit('identity-linked', { userId: current.user.id }, req);
      return '/__studio/account?linked=1';
    }
    let user = findLinked(data);
    if (!user && !data.settings.oidc.autoCreate) {
      await audit('sign-in-failed', { step: 'oidc', reason: 'no-account' }, req);
      fail('There is no Studio account for you yet. Ask an administrator to invite you.', 'NO_ACCOUNT', 403);
    }
    const draftUser = user ?? { role: 'member', source: 'oidc' };
    const outcome = applyProviderGroups(data, draftUser, result.groups);
    if (!outcome.allowed) {
      await audit('sign-in-failed', { step: 'oidc', reason: 'group', userId: user?.id }, req);
      fail(`Your ${oidc.name} account isn't in a group allowed to use this Studio.`, 'GROUP_NOT_ALLOWED', 403);
    }
    if (user && (user.disabled || user.status !== 'active')) { await audit('sign-in-failed', { step: 'oidc', reason: 'disabled', userId: user.id }, req); fail('This account is disabled.', 'ACCOUNT_DISABLED', 403); }
    if (flow.intent === 'reauth') {
      if (!current || current.session.id !== flow.sessionId || !user || user.id !== current.user.id) fail('Confirm with the same account you are signed in with.', 'REAUTH_MISMATCH', 403);
    }
    user = await store.mutate(draft => {
      for (const name of result.groups) ensureIdpGroup(draft, name);
      let target = findLinked(draft);
      if (!target) {
        let username = normalizeCandidate(result.username ?? result.email ?? 'user');
        const base = username;
        for (let index = 2; draft.users.some(item => item.username === username); index++) username = (base.slice(0, 58) + '-' + index);
        target = { id: randomUUID(), username, displayName: (result.name ?? username).slice(0, 100), email: result.email ?? null, role: 'member', status: 'active', disabled: false, source: 'oidc', createdAt: now(), groupIds: [], oidcGroups: [], policyId: null, oidc: { issuer: result.issuer, subject: result.subject }, password: null, totp: null, passkeys: [], backupCodes: [], webauthnUserId: randomBytes(32).toString('base64url') };
        draft.users.push(target);
      }
      const applied = applyProviderGroups(draft, target, result.groups).user;
      target.oidcGroups = applied.oidcGroups;
      target.role = applied.role;
      if (target.source === 'oidc') { if (result.name) target.displayName = result.name.slice(0, 100); if (result.email) target.email = result.email; }
      return target;
    });
    const oidcState = {
      refresh: result.refreshToken ? sealSecret(Buffer.from(result.refreshToken), config.key) : null,
      idToken: result.idToken ? sealSecret(Buffer.from(result.idToken), config.key) : null,
      sid: result.sid ?? null, subject: result.subject, nextCheckAt: now() + oidc.refreshMinutes * MINUTE,
    };
    if (flow.intent === 'reauth') {
      await refreshSession(res, current.session, { method: 'oidc', oidc: oidcState });
      await audit('reauthenticated', { userId: user.id, method: 'oidc' }, req);
      return flow.next;
    }
    await createSession(req, res, user, { method: 'oidc', oidcState });
    await audit('signed-in', { userId: user.id, method: 'oidc' }, req);
    return flow.next;
  }

  async function backchannelLogout(body) {
    if (!oidc) fail('Single sign-on is not configured.', 'OIDC_NOT_CONFIGURED', 404);
    let claims;
    try { claims = await oidc.verifyLogoutToken(String(body?.logout_token ?? '')); }
    catch { fail('Invalid logout token.', 'INVALID_LOGOUT_TOKEN', 400); }
    const data = store.read();
    const user = data.users.find(item => item.oidc && item.oidc.issuer === claims.issuer && (!claims.subject || item.oidc.subject === claims.subject));
    const removed = await store.sessions.remove(item => item.method === 'oidc' && (claims.sid ? item.oidc?.sid === claims.sid : item.userId === user?.id));
    await audit('provider-logout', { userId: user?.id, count: removed });
    return { ok: true };
  }

  function normalizeCandidate(value) {
    const cleaned = String(value).toLowerCase().replace(/[^a-z0-9._@-]/g, '-').replace(/^[^a-z0-9]+/, '').slice(0, 64);
    return USERNAME.test(cleaned) ? cleaned : 'user';
  }

  function safeNext(next) {
    const value = typeof next === 'string' ? next : '/';
    // Same-origin paths only: no scheme, no protocol-relative or backslash tricks.
    if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\') || /[\u0000-\u001f]/.test(value) || value.startsWith('/__studio/auth/')) return '/';
    return value.slice(0, 2000);
  }

  function state(current) {
    const data = store.ready ? store.read() : null;
    return {
      ready: store.ready,
      setupRequired: data ? data.users.length === 0 : false,
      setupInProgress: Boolean(setupClaim && setupClaim.expiresAt > now() && pending.has(setupClaim.key)),
      localSignIn: data?.settings.localSignIn ?? true,
      oidc: oidc ? { name: oidc.name } : null,
      recoveryEmail: Boolean(mailer),
      signedIn: Boolean(current),
      user: current ? { displayName: current.user.displayName, username: current.user.username, role: current.user.role } : null,
    };
  }

  return {
    config, store, initialize: () => store.initialize(), close: () => store.close(),
    get ready() { return store.ready; },
    setupRequired: () => store.ready && store.read().users.length === 0,
    principal, clientIp, audit, state, safeNext, readCookie, clearSessionCookie,
    passwordStep, secondFactorStep, secondFactorPasskeyOptions, sendEmailCode, passkeyOptions, passkeyStep, signOut,
    startSetup, inviteDetails, startInvite, enrollTotpStart, enrollTotpConfirm, enrollPasskeyOptions, enrollPasskeyVerify, finishEnrollment,
    requestRecovery, recoveryDetails, finishRecovery, redeemRecovery,
    account, admin, copyGrants, oidcStart, oidcCallback, backchannelLogout,
    dashboardLevel: (current, id) => current ? current.level(id) : 'none',
    hasOidc: Boolean(oidc), hasMail: Boolean(mailer),
  };
}

export { AuthError, DEFAULT_POLICY };
