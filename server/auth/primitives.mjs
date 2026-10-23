// Small, well-specified building blocks for sign-in. Everything here uses
// node:crypto primitives; WebAuthn and OIDC use their reviewed libraries.
import { createHash, createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual, createCipheriv, createDecipheriv, hkdfSync } from 'node:crypto';

// OWASP Password Storage Cheat Sheet minimum for scrypt: N=2^17, r=8, p=1.
// One hash needs 128 * N * r = 128 MiB, so hashing is limited to two at once.
export const SCRYPT = { N: 2 ** 17, r: 8, p: 1, keyLength: 32, saltLength: 16 };
const SCRYPT_MAXMEM = 256 * 1024 * 1024;
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

let hashing = 0;
const waiting = [];
async function withHashSlot(task) {
  if (hashing >= 2) await new Promise(resolve => waiting.push(resolve));
  hashing++;
  try { return await task(); } finally { hashing--; waiting.shift()?.(); }
}
function scrypt(password, salt, { N, r, p, keyLength }) {
  return new Promise((resolve, reject) => scryptCallback(password, salt, keyLength, { N, r, p, maxmem: SCRYPT_MAXMEM }, (error, key) => error ? reject(error) : resolve(key)));
}

export function normalizePassword(password) {
  return typeof password === 'string' ? password.normalize('NFKC') : '';
}

// A short bundled deny-list of the most common choices that pass the length
// rule. It is not a breach corpus; it stops the obvious ones.
const COMMON = new Set(['123456789012', '1234567890123', 'qwertyuiopas', 'passwordpassword', 'password1234', 'password12345', 'iloveyou1234', 'administrator', 'letmeinletmein', 'welcome12345', 'qwerty123456', 'aaaaaaaaaaaa', 'homepagestudio', 'changemechangeme']);
export function passwordProblem(password) {
  const value = normalizePassword(password);
  const length = [...value].length;
  if (length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  if (COMMON.has(value.toLowerCase()) || /^(.)\1+$/u.test(value)) return 'That password is too common. Choose another.';
  return null;
}

export async function hashPassword(password) {
  const salt = randomBytes(SCRYPT.saltLength);
  const key = await withHashSlot(() => scrypt(normalizePassword(password), salt, SCRYPT));
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

// A fixed hash compared when the account does not exist, so a missing
// account costs the same time as a wrong password.
let dummyHash;
export async function verifyPassword(password, stored) {
  dummyHash ||= hashPassword('studio-placeholder-password');
  const encoded = typeof stored === 'string' ? stored : await dummyHash;
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  if (![N, r, p].every(Number.isSafeInteger) || N > 2 ** 20 || r > 16 || p > 4) return false;
  const salt = Buffer.from(parts[4], 'base64url'), expected = Buffer.from(parts[5], 'base64url');
  const key = await withHashSlot(() => scrypt(normalizePassword(password), salt, { N, r, p, keyLength: expected.length }));
  return typeof stored === 'string' && key.length === expected.length && timingSafeEqual(key, expected);
}

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const tokenHash = token => createHash('sha256').update(String(token)).digest('base64url');
export function safeEqual(a, b) {
  const left = Buffer.from(String(a)), right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

// RFC 4648 base32 for authenticator-app keys.
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(buffer) {
  let bits = 0, value = 0, output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { output += BASE32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}
export function base32Decode(text) {
  const clean = String(text).toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0, value = 0;
  const bytes = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error('Invalid base32');
    value = (value << 5) | index; bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(bytes);
}

// RFC 4226 HOTP / RFC 6238 TOTP: HMAC-SHA1, 6 digits, 30-second steps.
export const TOTP_STEP_SECONDS = 30;
export function hotp(secret, counter, digits = 6, algorithm = 'sha1') {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac(algorithm, secret).update(message).digest();
  const offset = digest[digest.length - 1] & 15;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(code).padStart(digits, '0');
}
export const totpStep = (now = Date.now()) => Math.floor(now / 1000 / TOTP_STEP_SECONDS);
// Returns the matched step, or null. Steps at or below lastStep are rejected
// so one code cannot be used twice.
export function verifyTotp(secret, code, { now = Date.now(), window = 1, lastStep = -1 } = {}) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code.replace(/\s/g, ''))) return null;
  const clean = code.replace(/\s/g, '');
  const current = totpStep(now);
  for (let step = current - window; step <= current + window; step++) {
    if (step > lastStep && safeEqual(hotp(secret, step), clean)) return step;
  }
  return null;
}
export function totpUri({ secret, account, issuer }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${base32Encode(secret)}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${TOTP_STEP_SECONDS}`;
}

// Backup codes: 10 codes of 10 Crockford base32 characters (50 bits each).
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function backupCode() {
  const bytes = randomBytes(10);
  let code = '';
  for (const byte of bytes) code += CROCKFORD[byte & 31];
  return code.slice(0, 5) + '-' + code.slice(5);
}
export function normalizeBackupCode(code) {
  return String(code ?? '').toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
}
export const backupCodeHash = code => tokenHash('backup:' + normalizeBackupCode(code));

// Email one-time codes: 6 digits, compared by hash.
export function emailCode() {
  const value = randomBytes(4).readUInt32BE(0) % 1000000;
  return String(value).padStart(6, '0');
}

// AES-256-GCM for TOTP secrets when an operator supplies a key file.
export function deriveKey(material) {
  return Buffer.from(hkdfSync('sha256', material, Buffer.from('homepage-studio-auth'), Buffer.from('totp-secret-v1'), 32));
}
export function sealSecret(secret, key) {
  if (!key) return { plain: secret.toString('base64url') };
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(secret), cipher.final()]);
  return { iv: iv.toString('base64url'), data: data.toString('base64url'), tag: cipher.getAuthTag().toString('base64url') };
}
export function openSecret(sealed, key) {
  if (sealed?.plain) return Buffer.from(sealed.plain, 'base64url');
  if (!key) throw Object.assign(new Error('This TOTP secret is encrypted, but STUDIO_AUTH_KEY_FILE is not available.'), { code: 'AUTH_KEY_MISSING' });
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(sealed.data, 'base64url')), decipher.final()]);
}
