// Reads the sign-in configuration from options or the environment and
// refuses unsafe combinations at startup.
import { readFileSync } from 'node:fs';
import net from 'node:net';
import { deriveKey } from './primitives.mjs';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function secretValue(env, name) {
  const file = env[name + '_FILE'];
  if (file) {
    try { return readFileSync(file, 'utf8').trim(); }
    catch { throw new Error(`${name}_FILE could not be read. Check the secret mount.`); }
  }
  const value = env[name];
  return value === undefined || value === '' ? undefined : String(value);
}

function list(value) {
  return String(value ?? '').split(',').map(item => item.trim()).filter(Boolean);
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
  const clientSecret = options.oidcClientSecret ?? secretValue(env, 'STUDIO_OIDC_CLIENT_SECRET');
  let oidc = null;
  if (issuer || clientId || clientSecret) {
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
      password: options.smtpPassword ?? secretValue(env, 'STUDIO_SMTP_PASSWORD'),
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
  };
}
