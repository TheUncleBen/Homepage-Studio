// Reads the sign-in configuration from options or the environment and
// refuses unsafe combinations at startup.
import { readFileSync } from 'node:fs';
import net from 'node:net';
import { deriveKey, passwordProblem } from './primitives.mjs';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

// The deployment templates mount every secret, so an optional one that isn't
// used holds the word off (Docker refuses empty secrets).
function secretValue(env, name, { optional = false } = {}) {
  const file = env[name + '_FILE'];
  if (file) {
    let text;
    try { text = readFileSync(file, 'utf8').trim(); }
    catch { throw new Error(`${name}_FILE could not be read. Check the secret mount.`); }
    const unused = text === '' || text.toLowerCase() === 'off';
    if (unused && optional) return undefined;
    if (unused) throw new Error(`${name}_FILE (${file}) is empty or says off. This secret is required: put long random text in it.`);
    return text;
  }
  const value = env[name];
  return value === undefined || value === '' ? undefined : String(value);
}

function list(value) {
  return String(value ?? '').split(',').map(item => item.trim()).filter(Boolean);
}

// Provider group names set by the deployment. Unset or empty means the
// administration page decides; otherwise the deployment does, and the page
// shows the list read-only.
function groupList(value, name) {
  if (value === undefined) return null;
  const names = [...new Set(Array.isArray(value) ? value.map(item => String(item).trim()).filter(Boolean) : list(value))];
  if (names.length > 50 || names.some(item => item.length > 200)) throw new Error(`${name} takes up to 50 comma-separated group names of up to 200 characters.`);
  return names;
}

// Owner decision L1 (24 Oct 2026): the first administrator can be seeded
// once from the deployment. It is read only while Studio has no accounts.
function adminSeed(options, env) {
  const username = options.adminUsername ?? env.STUDIO_ADMIN_USERNAME;
  const password = options.adminPassword ?? secretValue(env, 'STUDIO_ADMIN_PASSWORD', { optional: true });
  const email = options.adminEmail ?? env.STUDIO_ADMIN_EMAIL;
  if (!username && !password && !email) return null;
  if (!username || !password) throw new Error('Seeding the first administrator needs STUDIO_ADMIN_USERNAME and its password in the studio_admin_password secret (STUDIO_ADMIN_PASSWORD_FILE) together. Leave the username empty and put off in the secret to skip seeding.');
  const name = String(username).trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._@-]{0,63}$/.test(name)) throw new Error('STUDIO_ADMIN_USERNAME must be 1 to 64 lowercase letters, numbers, dots, hyphens, underscores or @, starting with a letter or number.');
  const problem = passwordProblem(password);
  if (problem) throw new Error(`STUDIO_ADMIN_PASSWORD is not accepted: ${problem}`);
  if (email && !/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(String(email).trim())) throw new Error('STUDIO_ADMIN_EMAIL must be an email address.');
  return { username: name, password, email: email ? String(email).trim() : null };
}

export function parseTrustedProxies(value) {
  const blocks = new net.BlockList();
  let count = 0;
  for (const entry of list(value)) {
    const [address, prefix] = entry.split('/');
    const family = net.isIPv4(address) ? 'ipv4' : net.isIPv6(address) ? 'ipv6' : null;
    if (!family) throw new Error(`STUDIO_TRUSTED_PROXIES entry "${entry}" is not an IP address or CIDR range.`);
    if (prefix === undefined) blocks.addAddress(address, family);
    else {
      const bits = Number(prefix);
      if (!Number.isInteger(bits) || bits < 0 || bits > (family === 'ipv4' ? 32 : 128)) throw new Error(`STUDIO_TRUSTED_PROXIES entry "${entry}" has an invalid prefix length.`);
      blocks.addSubnet(address, bits, family);
    }
    count++;
  }
  return count ? blocks : null;
}

export function readAuthConfig(options = {}, rawEnv = process.env) {
  // Deployment templates pass optional settings as empty strings; treat those
  // as unset.
  const env = Object.fromEntries(Object.entries(rawEnv).filter(([, value]) => value !== ''));
  const mode = String(options.auth ?? env.STUDIO_AUTH ?? 'on').toLowerCase();
  if (!['on', 'off'].includes(mode)) throw new Error('STUDIO_AUTH must be "on" or "off".');
  if (mode === 'off') return { enabled: false };
  const originText = options.publicOrigin ?? env.STUDIO_PUBLIC_ORIGIN;
  if (!originText) throw new Error('Sign-in needs STUDIO_PUBLIC_ORIGIN, the exact https:// address people use to open Studio. Set STUDIO_AUTH=off only if another layer controls access.');
  const origin = new URL(originText);
  const local = LOCAL_HOSTS.has(origin.hostname.toLowerCase());
  // Owner decision D5 (23 Oct 2026): sign-in requires HTTPS, except a
  // loopback address used for testing.
  // An upgraded deployment on plain HTTP starts locked rather than crash
  // looping: every page explains the fix and no dashboard is served.
  if (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && local)) {
    return { enabled: true, blocked: 'Sign-in requires an https:// STUDIO_PUBLIC_ORIGIN. Passkeys and secure cookies do not work over plain HTTP. Put Studio behind HTTPS (for example a TLS reverse proxy) and update STUDIO_PUBLIC_ORIGIN, or set STUDIO_AUTH=off if another layer already controls access.' };
  }
  const secure = origin.protocol === 'https:';
  const keyMaterial = secretValue(env, 'STUDIO_AUTH_KEY');
  const issuer = options.oidcIssuer ?? env.STUDIO_OIDC_ISSUER;
  const clientId = options.oidcClientId ?? env.STUDIO_OIDC_CLIENT_ID;
  const clientSecret = options.oidcClientSecret ?? secretValue(env, 'STUDIO_OIDC_CLIENT_SECRET', { optional: true });
  let oidc = null;
  if (issuer || clientId || clientSecret) {
    if (!clientSecret && env.STUDIO_OIDC_CLIENT_SECRET_FILE) throw new Error(`Single sign-on is set up (STUDIO_OIDC_ISSUER or STUDIO_OIDC_CLIENT_ID), but STUDIO_OIDC_CLIENT_SECRET_FILE (${env.STUDIO_OIDC_CLIENT_SECRET_FILE}) is empty or says off. Put the provider's client secret in that Docker secret.`);
    if (!issuer || !clientId || !clientSecret) throw new Error('Single sign-on needs STUDIO_OIDC_ISSUER, STUDIO_OIDC_CLIENT_ID and STUDIO_OIDC_CLIENT_SECRET (or STUDIO_OIDC_CLIENT_SECRET_FILE) together.');
    const issuerUrl = new URL(issuer);
    if (issuerUrl.protocol !== 'https:' && !(options.oidcAllowHttp || env.STUDIO_OIDC_ALLOW_HTTP === 'true')) throw new Error('STUDIO_OIDC_ISSUER must be an https:// address.');
    oidc = {
      issuer: issuerUrl,
      clientId,
      clientSecret,
      name: options.oidcName ?? env.STUDIO_OIDC_NAME ?? 'Authentik',
      scopes: options.oidcScopes ?? env.STUDIO_OIDC_SCOPES ?? 'openid profile email offline_access',
      groupsClaim: options.oidcGroupsClaim ?? env.STUDIO_OIDC_GROUPS_CLAIM ?? 'groups',
      allowHttp: issuerUrl.protocol === 'http:',
      refreshMinutes: Number(env.STUDIO_OIDC_REFRESH_MINUTES ?? 15),
      // Owner decision L5 (24 Oct 2026): optional, and authoritative while set.
      adminGroups: groupList(options.oidcAdminGroups ?? env.STUDIO_OIDC_ADMIN_GROUPS, 'STUDIO_OIDC_ADMIN_GROUPS'),
      allowedGroups: groupList(options.oidcAllowedGroups ?? env.STUDIO_OIDC_ALLOWED_GROUPS, 'STUDIO_OIDC_ALLOWED_GROUPS'),
    };
    if (!Number.isInteger(oidc.refreshMinutes) || oidc.refreshMinutes < 1 || oidc.refreshMinutes > 1440) throw new Error('STUDIO_OIDC_REFRESH_MINUTES must be a whole number from 1 to 1440.');
  }
  const smtpHost = options.smtpHost ?? env.STUDIO_SMTP_HOST;
  let smtp = null;
  if (smtpHost) {
    const from = options.smtpFrom ?? env.STUDIO_SMTP_FROM;
    if (!from) throw new Error('Email needs STUDIO_SMTP_FROM, the sender address.');
    const port = Number(options.smtpPort ?? env.STUDIO_SMTP_PORT ?? 587);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('STUDIO_SMTP_PORT must be a port number.');
    smtp = {
      host: smtpHost, port, from,
      secure: String(options.smtpSecure ?? env.STUDIO_SMTP_SECURE ?? (port === 465)).toLowerCase() === 'true',
      user: options.smtpUser ?? env.STUDIO_SMTP_USER,
      password: options.smtpPassword ?? secretValue(env, 'STUDIO_SMTP_PASSWORD', { optional: true }),
      transport: options.mailTransport,
    };
  }
  return {
    enabled: true,
    origin: origin.origin,
    rpID: origin.hostname,
    rpName: options.rpName ?? 'Homepage Studio',
    secure,
    cookieName: secure ? '__Host-studio_session' : 'studio_session',
    flowCookieName: secure ? '__Host-studio_flow' : 'studio_flow',
    setupCookieName: secure ? '__Host-studio_setup' : 'studio_setup',
    key: keyMaterial ? deriveKey(Buffer.from(keyMaterial)) : null,
    trustedProxies: parseTrustedProxies(options.trustedProxies ?? env.STUDIO_TRUSTED_PROXIES),
    oidc,
    smtp,
    adminSeed: adminSeed(options, env),
  };
}
