import test from 'node:test';
import assert from 'node:assert/strict';
import { hotp, verifyTotp, base32Encode, base32Decode, hashPassword, verifyPassword, passwordProblem, backupCodeHash, backupCode, deriveKey, sealSecret, openSecret, safeEqual } from './primitives.mjs';
import { requiredLevel, dashboardLevel, effectivePolicy, validGrantList } from './access.mjs';
import { readAuthConfig, parseTrustedProxies } from './config.mjs';
import { emptyAuthData } from './store.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// RFC 6238 appendix B, SHA-1 secret "12345678901234567890". The RFC lists
// 8-digit codes; Studio uses the last 6 digits of the same values.
test('TOTP matches the RFC 6238 SHA-1 test vectors', () => {
  const secret = Buffer.from('12345678901234567890');
  const vectors = [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']];
  for (const [seconds, code] of vectors) {
    assert.equal(hotp(secret, Math.floor(seconds / 30), 8), code, `T=${seconds}`);
    assert.equal(verifyTotp(secret, code.slice(2), { now: seconds * 1000, window: 0 }), Math.floor(seconds / 30));
  }
});

test('TOTP accepts one step of clock drift and refuses a replayed step', () => {
  const secret = Buffer.from('12345678901234567890');
  const now = 1111111111 * 1000;
  const step = Math.floor(now / 30000);
  assert.equal(verifyTotp(secret, hotp(secret, step - 1), { now }), step - 1);
  assert.equal(verifyTotp(secret, hotp(secret, step + 1), { now }), step + 1);
  assert.equal(verifyTotp(secret, hotp(secret, step - 2), { now }), null);
  assert.equal(verifyTotp(secret, hotp(secret, step), { now, lastStep: step }), null, 'a code already used cannot be used again');
  assert.equal(verifyTotp(secret, 'abcdef', { now }), null);
  assert.equal(verifyTotp(secret, undefined, { now }), null);
});

test('base32 round-trips authenticator secrets', () => {
  for (const length of [1, 5, 10, 20, 32]) {
    const bytes = Buffer.from(Array.from({ length }, (_, index) => (index * 37 + 11) & 255));
    assert.deepEqual(base32Decode(base32Encode(bytes)), bytes);
  }
  assert.equal(base32Encode(Buffer.from('foobar')), 'MZXW6YTBOI');
});

test('passwords hash with scrypt, verify, and refuse weak choices', async () => {
  const stored = await hashPassword('correct horse battery staple');
  assert.match(stored, /^scrypt\$131072\$8\$1\$/);
  assert.equal(await verifyPassword('correct horse battery staple', stored), true);
  assert.equal(await verifyPassword('correct horse battery stapl', stored), false);
  assert.equal(await verifyPassword('anything', undefined), false, 'a missing account never verifies');
  assert.equal(await verifyPassword('anything', 'plain-text'), false);
  // Compatibility characters normalize the same way at signup and sign-in.
  const composed = await hashPassword('ｆｕｌｌｗｉｄｔｈ ｐａｓｓ');
  assert.equal(await verifyPassword('fullwidth pass', composed), true);
  assert.ok(passwordProblem('short'));
  assert.ok(passwordProblem('passwordpassword'));
  assert.ok(passwordProblem('aaaaaaaaaaaaaaaa'));
  assert.ok(passwordProblem('x'.repeat(129)));
  assert.equal(passwordProblem('a long and unusual passphrase'), null);
});

test('backup codes ignore case, spaces and look-alike characters', () => {
  const code = backupCode();
  assert.match(code, /^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
  assert.equal(backupCodeHash(code.toLowerCase().replace('-', ' ')), backupCodeHash(code));
  assert.equal(backupCodeHash('O0IL1-AAAAA'), backupCodeHash('00111AAAAA'));
});

test('sealed secrets need the key and detect tampering', () => {
  const key = deriveKey(Buffer.from('operator key material'));
  const secret = Buffer.from('authenticator seed');
  const sealed = sealSecret(secret, key);
  assert.equal(sealed.plain, undefined);
  assert.deepEqual(openSecret(sealed, key), secret);
  assert.throws(() => openSecret(sealed, null), /STUDIO_AUTH_KEY/);
  assert.throws(() => openSecret({ ...sealed, data: Buffer.from('tampered!').toString('base64url') }, key));
  assert.throws(() => openSecret(sealed, deriveKey(Buffer.from('another key'))));
  assert.deepEqual(openSecret(sealSecret(secret, null), null), secret);
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
});

test('access levels default to administrator for anything not listed', () => {
  assert.deepEqual(requiredLevel('GET', '/'), { level: 'view' });
  assert.deepEqual(requiredLevel('POST', '/api/services/proxy'), { level: 'view' });
  assert.deepEqual(requiredLevel('GET', '/api/mcp'), { level: 'blocked' });
  assert.deepEqual(requiredLevel('GET', '/__studio/api/board'), { level: 'view' });
  assert.deepEqual(requiredLevel('POST', '/__studio/api/board'), { level: 'arrange' });
  assert.deepEqual(requiredLevel('POST', '/__studio/api/discovery-visibility'), { level: 'arrange' });
  assert.deepEqual(requiredLevel('POST', '/__studio/api/appearance'), { level: 'arrange' });
  assert.deepEqual(requiredLevel('GET', '/__studio/api/state'), { level: 'admin', stepUp: false });
  assert.deepEqual(requiredLevel('POST', '/__studio/api/service'), { level: 'admin', stepUp: false });
  assert.deepEqual(requiredLevel('POST', '/__studio/api/save'), { level: 'admin', stepUp: true });
  assert.deepEqual(requiredLevel('GET', '/__studio/api/export'), { level: 'admin', stepUp: true });
  assert.deepEqual(requiredLevel('GET', '/__studio/api/backups/one.json'), { level: 'admin', stepUp: true });
  assert.deepEqual(requiredLevel('GET', '/__studio/api/something-new'), { level: 'admin', stepUp: false });
});

function sample() {
  const data = emptyAuthData();
  data.users.push({ id: 'u1', role: 'member', groupIds: ['g1'], oidcGroups: ['family'], policyId: null });
  data.users.push({ id: 'u2', role: 'admin', groupIds: [], oidcGroups: [] });
  data.groups.push({ id: 'g1', kind: 'local', name: 'Kids', policyId: 'short' });
  data.groups.push({ id: 'g2', kind: 'idp', name: 'family', policyId: 'medium' });
  data.policies.push({ id: 'short', name: 'Short', idleMinutes: 60, absoluteMinutes: null, persistent: false, stepUpMinutes: 10, maxSessions: 3 });
  data.policies.push({ id: 'medium', name: 'Medium', idleMinutes: 1440, absoluteMinutes: 10080, persistent: true, stepUpMinutes: 30, maxSessions: null });
  data.grants.default = [{ subject: 'group:g2', level: 'view' }, { subject: 'user:u1', level: 'arrange' }];
  data.grants.other = [{ subject: 'group:g1', level: 'view' }];
  return data;
}

test('dashboard levels take the best grant across the person and their groups', () => {
  const data = sample();
  assert.equal(dashboardLevel(data, data.users[0], 'default'), 'arrange');
  assert.equal(dashboardLevel(data, data.users[0], 'other'), 'view');
  assert.equal(dashboardLevel(data, data.users[0], 'missing'), 'none');
  assert.equal(dashboardLevel(data, data.users[1], 'missing'), 'admin');
  assert.equal(dashboardLevel(data, { ...data.users[0], disabled: true }, 'default'), 'none');
  // A provider group with the same name as a local group grants nothing to
  // people who only belong to the local one.
  assert.equal(dashboardLevel(data, { id: 'u3', role: 'member', groupIds: [], oidcGroups: ['Kids'] }, 'other'), 'none');
});

test('session policy: personal wins, otherwise the strictest group values', () => {
  const data = sample();
  const policy = effectivePolicy(data, data.users[0]);
  assert.equal(policy.idleMinutes, 60);
  assert.equal(policy.absoluteMinutes, 10080, 'a finite limit is stricter than never');
  assert.equal(policy.persistent, false);
  assert.equal(policy.stepUpMinutes, 10);
  assert.equal(policy.maxSessions, 3);
  assert.equal(effectivePolicy(data, { ...data.users[0], policyId: 'medium' }).idleMinutes, 1440);
  assert.equal(effectivePolicy(data, data.users[1]).id, 'default');
});

test('grant lists only name existing subjects at view or arrange, once each', () => {
  const data = sample();
  assert.equal(validGrantList([{ subject: 'user:u1', level: 'view' }], data), true);
  assert.equal(validGrantList([{ subject: 'user:u1', level: 'admin' }], data), false);
  assert.equal(validGrantList([{ subject: 'user:nobody', level: 'view' }], data), false);
  assert.equal(validGrantList([{ subject: 'user:u1', level: 'view' }, { subject: 'user:u1', level: 'arrange' }], data), false);
  assert.equal(validGrantList([{ subject: 'user:u1', level: 'view', extra: true }], data), false);
  assert.equal(validGrantList('nope', data), false);
});

test('sign-in configuration requires HTTPS except on localhost', () => {
  assert.deepEqual(readAuthConfig({}, { STUDIO_AUTH: 'off' }), { enabled: false });
  assert.throws(() => readAuthConfig({}, { STUDIO_AUTH: 'maybe' }), /STUDIO_AUTH/);
  assert.throws(() => readAuthConfig({}, {}), /STUDIO_PUBLIC_ORIGIN/);
  assert.match(readAuthConfig({}, { STUDIO_PUBLIC_ORIGIN: 'http://studio.example.test' }).blocked, /https/);
  const local = readAuthConfig({}, { STUDIO_PUBLIC_ORIGIN: 'http://localhost:3000' });
  assert.equal(local.secure, false);
  assert.equal(local.cookieName, 'studio_session');
  const secure = readAuthConfig({}, { STUDIO_PUBLIC_ORIGIN: 'https://studio.example.test' });
  assert.equal(secure.cookieName, '__Host-studio_session');
  assert.equal(secure.rpID, 'studio.example.test');
  assert.throws(() => readAuthConfig({}, { STUDIO_PUBLIC_ORIGIN: 'https://studio.example.test', STUDIO_OIDC_ISSUER: 'https://id.example.test' }), /together/);
  assert.throws(() => readAuthConfig({}, { STUDIO_PUBLIC_ORIGIN: 'https://studio.example.test', STUDIO_OIDC_ISSUER: 'http://id.example.test', STUDIO_OIDC_CLIENT_ID: 'a', STUDIO_OIDC_CLIENT_SECRET: 'b' }), /https/);
  assert.throws(() => parseTrustedProxies('10.0.0.0/40'), /prefix/);
  assert.throws(() => parseTrustedProxies('proxy.local'), /not an IP/);
  assert.equal(parseTrustedProxies('10.0.0.0/8, 172.16.0.1').check('10.1.2.3', 'ipv4'), true);
  assert.equal(parseTrustedProxies(''), null);
});

test('secrets come from mounted files, and an unused optional one says off', t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'studio-secrets-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const secret = (name, text) => { const file = path.join(directory, name); writeFileSync(file, text); return file; };
  const origin = 'https://studio.example.test';
  const key = secret('key', 'k'.repeat(48) + '\n');
  const off = secret('off', 'off\n');
  const empty = secret('empty', '');
  const client = secret('client', ' client-secret \n');
  const mail = secret('mail', 'mail-password');
  // The default stack: key set, single sign-on and email unused.
  const plain = readAuthConfig({}, { STUDIO_PUBLIC_ORIGIN: origin, STUDIO_AUTH_KEY_FILE: key, STUDIO_OIDC_CLIENT_SECRET_FILE: off, STUDIO_SMTP_PASSWORD_FILE: secret('OFF', 'OFF') });
  assert.ok(plain.key);
  assert.equal(plain.oidc, null);
  assert.equal(plain.smtp, null);
  // The file wins over the plain variable.
  assert.deepEqual(readAuthConfig({}, { STUDIO_PUBLIC_ORIGIN: origin, STUDIO_AUTH_KEY_FILE: key, STUDIO_AUTH_KEY: 'other' }).key, plain.key);
  // The encryption key can't be turned off or left empty through its file.
  assert.throws(() => readAuthConfig({}, { STUDIO_PUBLIC_ORIGIN: origin, STUDIO_AUTH_KEY_FILE: off }), /STUDIO_AUTH_KEY_FILE .*required/);
  assert.throws(() => readAuthConfig({}, { STUDIO_PUBLIC_ORIGIN: origin, STUDIO_AUTH_KEY_FILE: empty }), /STUDIO_AUTH_KEY_FILE .*required/);
  assert.throws(() => readAuthConfig({}, { STUDIO_PUBLIC_ORIGIN: origin, STUDIO_AUTH_KEY_FILE: path.join(directory, 'missing') }), /could not be read/);
  // Single sign-on and email read their secrets, trimmed.
  const sso = readAuthConfig({}, { STUDIO_PUBLIC_ORIGIN: origin, STUDIO_AUTH_KEY_FILE: key, STUDIO_OIDC_ISSUER: 'https://id.example.test/application/o/studio/', STUDIO_OIDC_CLIENT_ID: 'studio', STUDIO_OIDC_CLIENT_SECRET_FILE: client, STUDIO_SMTP_HOST: 'smtp.example.test', STUDIO_SMTP_FROM: 'studio@example.test', STUDIO_SMTP_USER: 'studio', STUDIO_SMTP_PASSWORD_FILE: mail });
  assert.equal(sso.oidc.clientSecret, 'client-secret');
  assert.equal(sso.smtp.password, 'mail-password');
  // Email without a password (an unauthenticated relay) is allowed.
  assert.equal(readAuthConfig({}, { STUDIO_PUBLIC_ORIGIN: origin, STUDIO_SMTP_HOST: 'smtp.example.test', STUDIO_SMTP_FROM: 'studio@example.test', STUDIO_SMTP_PASSWORD_FILE: off }).smtp.password, undefined);
  // Single sign-on set up while its secret still says off names the secret.
  assert.throws(() => readAuthConfig({}, { STUDIO_PUBLIC_ORIGIN: origin, STUDIO_OIDC_ISSUER: 'https://id.example.test/', STUDIO_OIDC_CLIENT_ID: 'studio', STUDIO_OIDC_CLIENT_SECRET_FILE: off }), /STUDIO_OIDC_CLIENT_SECRET_FILE .*says off/);
  // With sign-in off no secret is read at all.
  assert.deepEqual(readAuthConfig({}, { STUDIO_AUTH: 'off', STUDIO_AUTH_KEY_FILE: path.join(directory, 'missing') }), { enabled: false });
});

test('the [hidden] attribute always hides, whatever a component class sets', async () => {
  // A badge or action row with its own display rule used to stay visible when
  // hidden, so Dashboard access always said "Unsaved changes".
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(new URL('./ui/app.css', import.meta.url), 'utf8');
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/);
});
