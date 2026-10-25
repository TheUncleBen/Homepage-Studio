// HTTP surface for sign-in, account and administration under /studio/auth/,
// plus the /studio/account and /studio/admin pages. The controller has
// already checked Host, Origin, Fetch Metadata and the editor write header.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import qrcode from 'qrcode-generator';
import { AuthError } from './store.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const MAX_BODY = 64 * 1024;

// Pages that need no session; everything else in the auth UI does.
const PUBLIC_PAGES = new Set(['/studio/auth/sign-in', '/studio/auth/setup', '/studio/auth/enroll', '/studio/auth/recover', '/studio/auth/recovery']);
const SIGNED_IN_PAGES = new Set(['/studio/dashboards', '/studio/account', '/studio/admin']);
export const AUTH_PAGE_POLICY = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-src 'self'; frame-ancestors 'none'";

let assets;
async function loadAssets() {
  assets ||= (async () => {
    // The package does not export package.json; resolve its entry (script/index.js)
    // and step up to the package root for the prebuilt browser bundle.
    const webauthn = await readFile(join(dirname(require.resolve('@simplewebauthn/browser')), '..', 'dist', 'bundle', 'index.umd.min.js'));
    return new Map([
      ['/studio/auth/assets/app.js', { body: await readFile(join(here, 'ui', 'app.js')), type: 'text/javascript; charset=utf-8' }],
      ['/studio/auth/assets/app.css', { body: await readFile(join(here, 'ui', 'app.css')), type: 'text/css; charset=utf-8' }],
      ['/studio/auth/assets/webauthn.js', { body: webauthn, type: 'text/javascript; charset=utf-8' }],
    ]);
  })();
  assets.catch(() => { assets = undefined; });
  return assets;
}

const escapeHtml = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function shell(page, name) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(name)}</title>
<link rel="icon" href="/studio/brand/logo.svg" type="image/svg+xml">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="apple-touch-icon" href="/studio/brand/apple-touch-icon.png">
<link rel="stylesheet" href="/studio/auth/assets/app.css">
<link rel="stylesheet" href="/studio/theme.css" id="studio-theme">
<script src="/studio/auth/assets/webauthn.js" defer></script>
<script src="/studio/auth/assets/app.js" defer></script>
</head>
<body data-page="${page}" data-deployment-name="${escapeHtml(name)}">
<main id="app" class="auth-main" aria-live="polite"><p class="auth-loading">Loading…</p></main>
</body>
</html>
`;
}

// The Dashboards page and its assets also run with sign-in off, served by
// the controller without the sign-in routes.
export async function sendStudioAsset(res, path) {
  const asset = (await loadAssets()).get(path);
  if (!asset) return json(res, 404, { error: 'Not found.' });
  return send(res, 200, asset.body, { 'content-type': asset.type, 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
}
export function sendStudioPage(res, page, name) {
  return send(res, 200, shell(page, name), { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': [].concat(res.getHeader('content-security-policy') ?? [], AUTH_PAGE_POLICY) });
}

function send(res, status, body, headers) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { 'content-length': Buffer.byteLength(body), ...headers });
  res.end(body);
}
export function json(res, status, value) {
  send(res, status, JSON.stringify(value), { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
}
function redirect(res, location) {
  res.writeHead(302, { location, 'cache-control': 'no-store', 'content-length': 0 });
  res.end();
}

async function readJson(req) {
  const type = String(req.headers['content-type'] ?? '');
  const form = /^application\/x-www-form-urlencoded(?:;|$)/i.test(type);
  if (!form && !/^application\/json(?:;|$)/i.test(type)) throw new AuthError('Send JSON.', 'UNSUPPORTED_MEDIA', 415);
  let length = 0;
  const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > MAX_BODY) throw new AuthError('This request is too large.', 'REQUEST_TOO_LARGE', 413);
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (form) return Object.fromEntries(new URLSearchParams(text));
  if (!text) return {};
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('shape');
    return value;
  } catch { throw new AuthError('The request body is not valid JSON.', 'INVALID_JSON', 400); }
}

function qrSvg(text) {
  const code = qrcode(0, 'M');
  code.addData(text);
  code.make();
  return 'data:image/svg+xml;base64,' + Buffer.from(code.createSvgTag({ cellSize: 4, margin: 4, scalable: true })).toString('base64');
}

export function isAuthPath(path) {
  return path.startsWith('/studio/auth/') || SIGNED_IN_PAGES.has(path);
}

// Pages and redirects a person can reach by following a link from another
// site: an emailed invitation, a bookmark redirect, or the identity
// provider's return. They only render a page or redirect.
export function isAuthNavigation(method, path) {
  return ['GET', 'HEAD'].includes(method) && (PUBLIC_PAGES.has(path) || SIGNED_IN_PAGES.has(path) || path === '/studio/auth/oidc/start' || path === '/studio/auth/oidc/callback');
}

// Paths a request may reach while signed out.
export function isPublicAuthPath(path) {
  return PUBLIC_PAGES.has(path) || path.startsWith('/studio/auth/assets/') || path === '/studio/auth/state' || /^\/studio\/auth\/(password|second-factor(\/passkey|\/email)?|passkey\/(options|verify)|setup\/(start|resume)|invite\/(details|start)|enroll\/(totp\/start|totp\/confirm|passkey\/options|passkey\/verify|finish)|recover\/(request|details|finish)|recovery\/redeem|oidc\/(start|callback|backchannel-logout)|sign-out)$/.test(path);
}

export function createAuthRoutes(auth, { listDashboards }) {
  async function handle(req, res, current) {
    const url = new URL(req.url, auth.config.origin);
    const path = url.pathname;
    const method = req.method;
    try {
      if (method === 'GET' && path.startsWith('/studio/auth/assets/')) return await sendStudioAsset(res, path);
      if (method === 'GET' && (PUBLIC_PAGES.has(path) || SIGNED_IN_PAGES.has(path))) {
        if (SIGNED_IN_PAGES.has(path) && !current) return redirect(res, '/studio/auth/sign-in?next=' + encodeURIComponent(path + url.search));
        if (path === '/studio/admin' && current.user.role !== 'admin') return redirect(res, '/studio/account');
        if (path === '/studio/auth/sign-in' && current && !url.searchParams.has('reauth')) return redirect(res, auth.safeNext(url.searchParams.get('next')));
        if (auth.setupRequired() && path === '/studio/auth/sign-in') return redirect(res, '/studio/auth/setup');
        return sendStudioPage(res, path.split('/').pop(), auth.siteName());
      }
      if (method === 'GET' && path === '/studio/auth/state') return json(res, 200, auth.state(current));
      // Plain sign-in can start from a link. Confirming and linking change an
      // existing session, so they start with a same-origin POST (oidc/begin).
      if (method === 'GET' && path === '/studio/auth/oidc/start') {
        return redirect(res, await auth.oidcStart(res, { intent: 'signin', next: url.searchParams.get('next') ?? '/' }));
      }
      if (method === 'GET' && path === '/studio/auth/oidc/callback') {
        try { return redirect(res, await auth.oidcCallback(req, res, current)); }
        catch (error) {
          const code = error instanceof AuthError ? error.code : 'OIDC_FAILED';
          // Someone already signed in was linking or confirming: show the
          // problem on their account page.
          return redirect(res, (current ? '/studio/account?error=' : '/studio/auth/sign-in?error=') + encodeURIComponent(code));
        }
      }
      if (method === 'GET' && path === '/studio/auth/account') {
        if (!current) return json(res, 401, { error: 'Sign in first.', code: 'AUTH_REQUIRED' });
        return json(res, 200, auth.account.view(current));
      }
      if (method === 'GET' && path === '/studio/auth/dashboards') {
        if (!current) return json(res, 401, { error: 'Sign in first.', code: 'AUTH_REQUIRED' });
        const dashboards = (await listDashboards()).filter(entry => !entry.archived && entry.slug).map(entry => ({ id: entry.id, name: entry.name, slug: entry.slug, level: current.level(entry.id) })).filter(entry => entry.level !== 'none');
        return json(res, 200, { dashboards });
      }
      if (method === 'GET' && path.startsWith('/studio/auth/admin/') && !current) return json(res, 401, { error: 'Sign in first.', code: 'AUTH_REQUIRED' });
      if (method === 'GET' && path === '/studio/auth/admin/overview') return json(res, 200, await auth.admin.overview(current));
      if (method === 'GET' && path === '/studio/auth/admin/audit') return json(res, 200, await auth.admin.audit(current));
      if (method !== 'POST') return json(res, 404, { error: 'This sign-in endpoint does not exist.', code: 'NOT_FOUND' });

      const body = await readJson(req);
      const signedIn = () => { if (!current) throw new AuthError('Sign in first.', 'AUTH_REQUIRED', 401); return current; };
      const routes = {
        '/studio/auth/password': () => auth.passwordStep(req, body),
        '/studio/auth/second-factor': () => auth.secondFactorStep(req, res, body, current),
        '/studio/auth/second-factor/passkey': () => auth.secondFactorPasskeyOptions(body),
        '/studio/auth/second-factor/email': () => auth.sendEmailCode(body),
        '/studio/auth/passkey/options': () => auth.passkeyOptions(),
        '/studio/auth/passkey/verify': () => auth.passkeyStep(req, res, body, current),
        '/studio/auth/sign-out': () => auth.signOut(req, res, current),
        '/studio/auth/setup/start': () => auth.startSetup(req, res, body),
        '/studio/auth/setup/resume': () => auth.resumeSetup(req),
        '/studio/auth/invite/details': () => auth.inviteDetails(body),
        '/studio/auth/invite/start': () => auth.startInvite(req, body),
        '/studio/auth/enroll/totp/start': async () => { const result = await auth.enrollTotpStart(body); return { ...result, qr: qrSvg(result.uri) }; },
        '/studio/auth/enroll/totp/confirm': () => auth.enrollTotpConfirm(body),
        '/studio/auth/enroll/passkey/options': () => auth.enrollPasskeyOptions(body),
        '/studio/auth/enroll/passkey/verify': () => auth.enrollPasskeyVerify(body),
        '/studio/auth/enroll/finish': () => auth.finishEnrollment(req, res, body),
        '/studio/auth/recover/request': () => auth.requestRecovery(req, body),
        '/studio/auth/recover/details': () => auth.recoveryDetails(body),
        '/studio/auth/recover/finish': () => auth.finishRecovery(req, res, body),
        '/studio/auth/recovery/redeem': () => auth.redeemRecovery(req, res, body),
        '/studio/auth/oidc/backchannel-logout': () => auth.backchannelLogout(body),
        '/studio/auth/oidc/begin': async () => {
          if (!['reauth', 'link'].includes(body?.intent)) throw new AuthError('Choose what to confirm.', 'INVALID_INTENT', 400);
          return { url: await auth.oidcStart(res, { intent: body.intent, next: typeof body.next === 'string' ? body.next : '/studio/account', current: signedIn() }) };
        },
        '/studio/auth/reauth/password': () => auth.passwordStep(req, body, { intent: 'reauth', current: signedIn() }),
        '/studio/auth/reauth/second-factor': () => auth.secondFactorStep(req, res, body, signedIn()),
        '/studio/auth/reauth/passkey/options': () => auth.passkeyOptions({ intent: 'reauth', current: signedIn() }),
        '/studio/auth/reauth/passkey/verify': () => auth.passkeyStep(req, res, body, signedIn()),
        '/studio/auth/account/profile': () => auth.account.profile(signedIn(), body),
        '/studio/auth/account/password': () => auth.account.password(signedIn(), body),
        '/studio/auth/account/totp/start': async () => { const result = await auth.account.totpStart(signedIn()); return { ...result, qr: qrSvg(result.uri) }; },
        '/studio/auth/account/totp/confirm': () => auth.account.totpConfirm(signedIn(), body),
        '/studio/auth/account/totp/remove': () => auth.account.totpRemove(signedIn()),
        '/studio/auth/account/passkey/options': () => auth.account.passkeyOptions(signedIn()),
        '/studio/auth/account/passkey/verify': () => auth.account.passkeyVerify(signedIn(), body),
        '/studio/auth/account/passkey/rename': () => auth.account.passkeyRename(signedIn(), body),
        '/studio/auth/account/passkey/remove': () => auth.account.passkeyRemove(signedIn(), body),
        '/studio/auth/account/backup-codes': () => auth.account.backupCodes(signedIn()),
        '/studio/auth/account/sessions/revoke': () => auth.account.revokeSessions(signedIn(), body),
        '/studio/auth/account/unlink': () => auth.account.unlink(signedIn()),
        '/studio/auth/account/default-dashboard': () => auth.account.defaultDashboard(signedIn(), body),
        '/studio/auth/account/link/confirm': () => auth.account.linkConfirm(req, res, signedIn()),
        '/studio/auth/account/link/cancel': () => auth.account.linkCancel(signedIn()),
        '/studio/auth/claim/password': () => auth.passwordStep(req, body, { intent: 'claim', current: signedIn() }),
        '/studio/auth/claim/second-factor': () => auth.secondFactorStep(req, res, body, signedIn()),
        '/studio/auth/claim/passkey/options': () => auth.passkeyOptions({ intent: 'claim', current: signedIn() }),
        '/studio/auth/claim/passkey/verify': () => auth.passkeyStep(req, res, body, signedIn()),
        '/studio/auth/admin/invite': () => auth.admin.invite(signedIn(), body),
        '/studio/auth/admin/update': () => auth.admin.update(signedIn(), body),
        '/studio/auth/admin/reset': () => auth.admin.reset(signedIn(), body),
        '/studio/auth/admin/unlink': () => auth.admin.unlink(signedIn(), body),
        '/studio/auth/admin/delete': () => auth.admin.remove(signedIn(), body),
        '/studio/auth/admin/sessions/revoke': () => auth.admin.revokeUserSessions(signedIn(), body),
        '/studio/auth/admin/group': () => auth.admin.group(signedIn(), body),
        '/studio/auth/admin/policy': () => auth.admin.policy(signedIn(), body),
        '/studio/auth/admin/settings': () => auth.admin.settings(signedIn(), body),
        '/studio/auth/admin/grants': () => auth.admin.grants(signedIn(), body),
      };
      const route = routes[path];
      if (!route) return json(res, 404, { error: 'This sign-in endpoint does not exist.', code: 'NOT_FOUND' });
      if (path.startsWith('/studio/auth/admin/')) signedIn();
      return json(res, 200, await route());
    } catch (error) {
      const known = error instanceof AuthError;
      const status = known ? error.status : 500;
      if (error.retryAfter && !res.headersSent) res.setHeader('retry-after', String(error.retryAfter));
      if (!known) console.error('Sign-in request failed:', error.code || error.name);
      return json(res, status, { error: known ? error.message : 'Sign-in failed unexpectedly. Check the application logs.', code: known ? error.code : 'AUTH_FAILED' });
    }
  }
  return { handle };
}
