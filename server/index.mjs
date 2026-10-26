import http from 'node:http';
import https from 'node:https';
import fs, { readFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConfigStore, ConfigError, MAX_IMPORT_BYTES } from './config.mjs';
import { BoardError } from './board.mjs';
import { createDiscoveryClient, DiscoveryError } from './discovery.mjs';
import { createDashboardRegistry, resolveDashboardRoute, sharedPublic } from './dashboards.mjs';
import { DashboardError, dashboardConfigDir, dashboardStateDir, dashboardBasePath, suggestedDashboardSlug } from './dashboard-paths.mjs';
import { createRendererPool, RendererError } from './renderer-pool.mjs';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import zlib from 'node:zlib';
import { serveSharedAsset, acceptedEncodings, etagMatches } from './static-assets.mjs';
import { checkApplicationReadiness } from './application-health.mjs';
import { renderRobotsPolicy } from './indexing-policy.mjs';
import { readAuthConfig } from './auth/config.mjs';
import { readDeploymentName, brandFile, sendBrandFile } from './branding.mjs';
import { createLogoStore } from './dashboard-logo.mjs';
import { createPlatformStore, PlatformError, studioThemeCss } from './platform.mjs';
import { createBackupStore, applyPendingRestore, studioRoots, MAX_BACKUP_BYTES } from './backups.mjs';
import { createAuthService } from './auth/service.mjs';
import { createAuthRoutes, isAuthPath, isPublicAuthPath, isAuthNavigation, sendStudioAsset, sendStudioPage } from './auth/routes.mjs';
import { atLeast, requiredLevel } from './auth/access.mjs';

const base = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const studioVersion = (await readFile(join(base, 'VERSION'), 'utf8')).trim();
if (!studioVersion) throw new Error('VERSION must identify this Studio build.');
const hopHeaders = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
export const NATIVE_PROTOCOL = 1;
export const UPSTREAM_COMMIT = '51cc1684f9f34a7877ed462b8f94c9cc687b4dde';
// Native API routes use Next.js's default body parser limit ('1mb', which
// Next.js reads as 1 MiB); no Homepage route raises it. The controller buffers a
// native body before it asks for a worker, so it applies the same limit.
export const NATIVE_BODY_LIMIT = 1024 * 1024;
// All native bodies being received or forwarded at once share this budget, so
// many concurrent uploads cannot grow controller memory without bound.
export const NATIVE_BODY_BUDGET = 32 * 1024 * 1024;
const NATIVE_BODY_TIMEOUT_MS = 30000;
const NATIVE_BODY_RETRY_AFTER_SECONDS = 5;
// Response headers the controller owns. A native response cannot replace them.
// X-Powered-By is dropped as well, so a native response never advertises its framework.
const CONTROLLER_HEADERS = ['x-frame-options', 'x-content-type-options', 'referrer-policy', 'x-powered-by'];

// STUDIO_FRAME_ANCESTORS adds origins to the default `frame-ancestors 'self'`
// list. 'self' always stays, because Studio's own pages frame dashboards for
// their previews. Unset or blank keeps the default. Each whitespace-separated
// entry must be 'self' (quoted, or bare because .env files and shells drop the
// quotes) or an exact http(s) origin; anything else stops startup.
export function parseFrameAncestors(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  return [...new Set(["'self'", ...text.split(/\s+/).map(token => {
    if (token === "'self'" || token === 'self') return "'self'";
    let url;
    try { url = /^https?:\/\//i.test(token) && !token.includes('*') ? new URL(token) : undefined; } catch { /* Rejected below. */ }
    // WHATWG URL keeps characters such as ; ' and _ in a host. Only DNS names,
    // IPv4 and bracketed IPv6 literals may reach the policy header.
    const hostname = url?.hostname ?? '';
    const plainHost = /^[a-z0-9.-]+$/.test(hostname) || /^\[[0-9a-f:.]+\]$/.test(hostname);
    if (!url || !plainHost || url.username || url.password || url.pathname !== '/' || url.search || url.hash || !/^https?:\/\/[^/?#]+\/?$/i.test(token)) {
      throw new Error(`STUDIO_FRAME_ANCESTORS entry "${token}" is not 'self' or an exact http(s) origin such as https://home.example.test:8123.`);
    }
    return url.origin;
  })])];
}

export function securityHeaders(frameAncestors) {
  const sources = frameAncestors ?? ["'self'"];
  return {
    'content-security-policy': `frame-ancestors ${sources.join(' ')}`,
    // X-Frame-Options cannot name several origins, so only the default sends it.
    ...(frameAncestors ? {} : { 'x-frame-options': 'SAMEORIGIN' }),
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'same-origin',
  };
}

function headersWithoutHop(headers) {
  const removed = new Set([...hopHeaders, ...String(headers.connection || '').split(',').map(s => s.trim().toLowerCase())]);
  return Object.fromEntries(Object.entries(headers).filter(([key]) => !removed.has(key.toLowerCase())));
}

function json(res, code, value) {
  if (res.destroyed || res.writableEnded) return;
  const data = JSON.stringify(value);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-length': Buffer.byteLength(data) });
  res.end(data);
}

// Browsers navigating to a missing, renamed-away or archived dashboard get a
// readable page; API and fetch callers keep the JSON error body. No request
// text is reflected and the page runs no script.
const UNAVAILABLE_PAGE_POLICY = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
function wantsHtmlPage(req) {
  if (!['GET', 'HEAD'].includes(req.method)) return false;
  const path = String(req.url || '').split('?')[0];
  // Editor and native API routes, at the root or under a dashboard address.
  if (/^\/(?:[^/]+\/)?(?:api|studio)(?:\/|$)/.test(path)) return false;
  return String(req.headers.accept || '').split(',').some(entry => entry.trim().toLowerCase().split(';')[0] === 'text/html');
}
function renderUnavailablePage(status) {
  const code = Number(status) === 410 ? 410 : 404;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Dashboard unavailable</title>
<style>
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; background: #111115; color: #eeecf1; font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { width: 100%; max-width: 30rem; padding: 28px 24px; background: #1b1a20; border: 1px solid #34303b; border-radius: 12px; }
.status { margin: 0 0 8px; color: #b4aebc; font-size: 0.875rem; letter-spacing: 0.04em; text-transform: uppercase; }
h1 { margin: 0 0 12px; font-size: 1.375rem; line-height: 1.3; font-weight: 600; }
p { margin: 0 0 20px; color: #b4aebc; }
a { display: inline-block; padding: 10px 16px; border-radius: 8px; background: #685870; color: #ffffff; text-decoration: none; font-weight: 600; }
a:hover { background: #77697e; }
a:focus-visible { outline: 3px solid #b299be; outline-offset: 3px; }
</style>
</head>
<body>
<main>
<p class="status">Error ${code}</p>
<h1>This dashboard isn&#39;t available</h1>
<p>Its address may have changed, or it may have been archived. Choose the dashboard you need on the Dashboards page.</p>
<a href="/studio/dashboards">Open Dashboards</a>
</main>
</body>
</html>
`;
}
function unavailablePage(req, res, status) {
  if (res.destroyed || res.writableEnded) return;
  const page = renderUnavailablePage(status);
  const policy = res.getHeader('content-security-policy');
  res.writeHead(status === 410 ? 410 : 404, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-length': Buffer.byteLength(page), 'content-security-policy': [].concat(policy ?? [], UNAVAILABLE_PAGE_POLICY), vary: 'Accept' });
  res.end(req.method === 'HEAD' ? undefined : page);
}

function nativeLocation(location, { basePath, upstream, host, requestPath }) {
  if (!basePath || typeof location !== 'string') return location;
  let target;
  try { target = new URL(location, new URL(requestPath, upstream)); } catch { return location; }
  if (!['http:', 'https:'].includes(target.protocol) || (target.origin !== upstream.origin && target.host.toLowerCase() !== host)) return location;
  const path = target.pathname;
  const scoped = path === basePath || path.startsWith(basePath + '/') ? path : basePath + (path === '/' ? '' : path);
  return scoped + target.search + target.hash;
}
function nativeRefresh(value, context) {
  if (typeof value !== 'string') return value;
  const match = value.match(/^(\s*\d+(?:\.\d+)?\s*;\s*url\s*=\s*)(?:"([^"]*)"|'([^']*)'|(.*))$/i);
  if (!match) return value;
  const url = match[2] ?? match[3] ?? match[4].trim();
  const quote = match[2] !== undefined ? '"' : match[3] !== undefined ? "'" : '';
  return match[1] + quote + nativeLocation(url, context) + quote;
}

function createByteBudget(limit) {
  let used = 0;
  return {
    get used() { return used; },
    // Reserves bytes and returns a release function, or null when they do not fit.
    reserve(bytes) {
      if (used + bytes > limit) return null;
      used += bytes;
      let released = false;
      return () => { if (!released) { released = true; used -= bytes; } };
    },
  };
}

function bodyBudgetExceeded() {
  return Object.assign(new Error('Studio is receiving too many dashboard requests at once. Retry shortly.'), { status: 503, code: 'REQUEST_BODY_BUDGET_EXCEEDED', closeConnection: true, retryAfter: NATIVE_BODY_RETRY_AFTER_SECONDS });
}
function bodyTooLarge(limit) {
  return Object.assign(new Error(`This request exceeds the ${limit / (1024 * 1024)} MiB dashboard request limit.`), { status: 413, code: 'REQUEST_TOO_LARGE', closeConnection: true });
}
function declaredLength(req) {
  if (req.headers['transfer-encoding'] !== undefined) return undefined;
  const length = Number(req.headers['content-length'] || 0);
  return Number.isSafeInteger(length) && length >= 0 ? length : undefined;
}

// Answers `Expect: 100-continue` only once the request is known to be
// acceptable, just before its body is read.
const CONTINUE = Symbol('continue');
function continueBody(req) { req[CONTINUE]?.(); }

// Receive a proxied native request body before a worker lease is taken, so a
// slow or stalled upload cannot hold a renderer slot. Bytes are reserved from
// the shared budget (the declared length at once, chunked bodies as they
// arrive) and stay reserved until the caller releases them.
function readNativeBody(req, budget, { limit = NATIVE_BODY_LIMIT, timeoutMs = NATIVE_BODY_TIMEOUT_MS } = {}) {
  const declared = declaredLength(req);
  if (declared > limit) return Promise.reject(bodyTooLarge(limit));
  const releases = [];
  const releaseAll = () => { for (const release of releases.splice(0)) release(); };
  let reserved = 0;
  const reserve = bytes => {
    const release = budget.reserve(bytes);
    if (!release) return false;
    releases.push(release); reserved += bytes;
    return true;
  };
  if (declared && !reserve(declared)) return Promise.reject(bodyBudgetExceeded());
  continueBody(req);
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let length = 0, done = false;
    const finish = (error, value) => {
      if (done) return; done = true;
      clearTimeout(timer);
      req.off('data', data); req.off('end', end); req.off('error', failed); req.off('aborted', aborted); req.off('close', aborted);
      if (error) { releaseAll(); req.pause(); reject(error); } else resolveBody({ body: value, release: releaseAll });
    };
    const data = chunk => {
      length += chunk.length;
      if (length > limit) return finish(bodyTooLarge(limit));
      if (length > reserved && !reserve(length - reserved)) return finish(bodyBudgetExceeded());
      chunks.push(chunk);
    };
    const end = () => finish(undefined, Buffer.concat(chunks));
    const failed = error => finish(error);
    const aborted = () => finish(Object.assign(new Error('The request was cancelled.'), { status: 400, code: 'REQUEST_ABORTED' }));
    const timer = setTimeout(() => finish(Object.assign(new Error('The request body was not received in time. Retry the action.'), { status: 408, code: 'REQUEST_BODY_TIMEOUT', closeConnection: true })), timeoutMs);
    req.on('data', data); req.once('end', end); req.once('error', failed); req.once('aborted', aborted); req.once('close', aborted);
  });
}

async function readBody(req, maxBytes = 2 * 1024 * 1024) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) {
    throw Object.assign(new Error('Send JSON when saving changes.'), { status: 415 });
  }
  continueBody(req);
  let length = 0;
  const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > maxBytes) throw Object.assign(new Error(`This request exceeds the ${maxBytes / (1024 * 1024)} MiB ${maxBytes === MAX_IMPORT_BYTES ? 'dashboard import' : 'configuration'} limit.`), { status: 413 });
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('The request body is not valid JSON.'), { status: 400 }); }
  if (!value || Array.isArray(value) || typeof value !== 'object') throw Object.assign(new Error('Expected a configuration object.'), { status: 400 });
  return value;
}

// The widget catalog is part of the image and does not change while the
// process runs. Read, hash and compress it once; browsers revalidate with the
// strong per-encoding ETag instead of downloading it again.
const gzip = promisify(zlib.gzip), brotli = promisify(zlib.brotliCompress);
let catalogVariants;
function loadCatalogVariants() {
  catalogVariants ||= (async () => {
    const identity = await readFile(join(base, 'public', 'catalog.json'));
    const hash = createHash('sha256').update(identity).digest('base64url').slice(0, 32);
    const [gz, br] = await Promise.all([
      gzip(identity, { level: 9 }),
      brotli(identity, { params: { [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT, [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: identity.length } }),
    ]);
    const variant = (encoding, body) => ({ encoding, body, etag: `"${hash}-${encoding}"` });
    return new Map([['identity', variant('identity', identity)], ['gzip', variant('gzip', gz)], ['br', variant('br', br)]]);
  })();
  // A failed read is retried on the next request rather than cached.
  catalogVariants.catch(() => { catalogVariants = undefined; });
  return catalogVariants;
}

async function serveCatalog(req, res) {
  const variants = await loadCatalogVariants();
  const encoding = acceptedEncodings(req.headers['accept-encoding'])[0];
  if (!encoding) { res.writeHead(406, { 'cache-control': 'no-store', vary: 'Accept-Encoding' }); return res.end(); }
  const { body, etag } = variants.get(encoding);
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff', vary: 'Accept-Encoding', etag };
  if (encoding !== 'identity') headers['content-encoding'] = encoding;
  if (etagMatches(req.headers['if-none-match'], etag)) { res.writeHead(304, headers); return res.end(); }
  headers['content-length'] = body.length;
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}

const APPEARANCE_KEYS = ['theme', 'studioTheme'];
const boardView = result => ({ revision: result.revision, configurationRevision: result.configurationRevision, board: result.board, discoveredSources: result.discoveredSources, hiddenDiscoveredIds: result.hiddenDiscoveredIds, warnings: result.warnings });

function createDashboardHandlers(options = {}) {
  const configDir = resolve(options.configDir || process.env.HOMEPAGE_CONFIG_DIR || join(base, 'config'));
  const stateDir = resolve(options.stateDir || process.env.STUDIO_STATE_DIR || join(base, 'state'));
  const acquireNative = (host, dashboard) => options.rendererPool.acquire(dashboard, host);
  const allowedHosts = (options.allowedHosts || process.env.HOMEPAGE_ALLOWED_HOSTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!allowedHosts.length || allowedHosts.includes('*')) throw new Error('Set HOMEPAGE_ALLOWED_HOSTS to the actual local hostname:port used to open the dashboard.');
  const externalOrigin = options.publicOrigin || process.env.STUDIO_PUBLIC_ORIGIN;
  let publicOrigin;
  if (externalOrigin) {
    publicOrigin = new URL(externalOrigin);
    if (!['http:', 'https:'].includes(publicOrigin.protocol) || publicOrigin.username || publicOrigin.password || publicOrigin.pathname !== '/' || publicOrigin.search || publicOrigin.hash || !allowedHosts.includes(publicOrigin.host.toLowerCase())) {
      throw new Error('STUDIO_PUBLIC_ORIGIN must be the exact HTTP(S) dashboard origin, with a host present in HOMEPAGE_ALLOWED_HOSTS.');
    }
  }
  const backupRetention = options.backupRetention ?? (process.env.STUDIO_BACKUP_RETENTION === undefined ? undefined : Number(process.env.STUDIO_BACKUP_RETENTION));
  const logo = createLogoStore({ stateDir });
  const store = createConfigStore({ configDir, stateDir, backupRetention, discoveryReader: async (host, dashboard) => {
    const lease = await acquireNative(host, dashboard);
    try { return await createDiscoveryClient({ upstream: lease.origin.href }).read(host); }
    finally { lease.release(); }
  } });
  const buildRevision = options.buildRevision ?? process.env.STUDIO_BUILD_REVISION ?? 'unreleased';
  let initialized = false;
  // Start recovery immediately, rather than waiting for the first editor read.
  // Keep a failed startup inspectable through liveness and editor diagnostics.
  const initialization = store.initialize().then(
    () => { initialized = true; return { ok: true }; },
    (error) => ({ ok: false, code: error.code || 'CONFIG_NOT_READY' }),
  );

  async function prepareNative() {
    await initialization;
    try {
      if (!initialized) { await store.initialize(); initialized = true; }
      await store.prepareForNative();
    } catch (error) {
      if (error instanceof ConfigError && error.code === 'RECOVERY_REQUIRED') throw error;
      throw new ConfigError('Homepage configuration is not ready. Check the editor configuration and storage before loading the dashboard.', 'CONFIG_NOT_READY', 503);
    }
  }

  async function checkNativeHttp(host, dashboard) {
    const lease = await acquireNative(host, dashboard);
    const upstream = lease.origin;
    const transport = upstream.protocol === 'https:' ? https : http;
    try { return await new Promise((resolveHealth, reject) => {
      let timer;
      const finish = (error, value) => { clearTimeout(timer); error ? reject(error) : resolveHealth(value); };
      const request = transport.request(upstream, { method: 'GET', path: '/api/studio/health', headers: { host } }, response => {
        let body = '';
        response.on('data', chunk => {
          body += chunk.toString('utf8');
          if (Buffer.byteLength(body) > 1024) request.destroy(new Error('Unexpected Homepage health response'));
        });
        response.on('error', finish);
        response.on('end', () => {
          let health;
          try { health = JSON.parse(body); } catch { /* Invalid bridge response. */ }
          const valid = response.statusCode === 200 && health?.protocolVersion === NATIVE_PROTOCOL && health?.upstreamCommit === UPSTREAM_COMMIT && health?.buildRevision === buildRevision;
          finish(valid ? undefined : new Error('The native renderer does not match this application build.'), health);
        });
      });
      request.on('error', finish);
      timer = setTimeout(() => request.destroy(new Error('Homepage health check timed out')), 3000);
      request.end();
    }); } finally { lease.release(); }
  }

  async function readiness(req, res, dashboard, configurationOnly = false) {
    let persistence;
    try {
      await initialization;
      if (!initialized) { await store.initialize(); initialized = true; }
      persistence = await store.checkReadiness();
    }
    catch (error) {
      return json(res, 503, {
        status: 'not_ready', code: error.code || 'STORAGE_NOT_READY',
        error: error instanceof ConfigError || error instanceof BoardError ? error.message : 'Configuration or state storage is not writable.',
        checks: { configurationAndStorage: 'failed', nativeHttp: 'not_checked' },
      });
    }
    if (configurationOnly) return json(res, 200, { status: 'ready', checks: { configurationAndStorage: 'ok', nativeHttp: 'not_checked' } });
    try { await checkNativeHttp(String(req.headers.host).toLowerCase(), dashboard); }
    catch {
      return json(res, 503, {
        status: 'not_ready', code: 'HOMEPAGE_UNREACHABLE',
        error: 'The native renderer is unavailable or does not match this Studio build. Check the application logs, storage and allowed hostname.',
        checks: { configurationAndStorage: 'ok', nativeHttp: 'failed' },
      });
    }
    return json(res, 200, {
      status: 'ready', version: studioVersion, backupRetention: persistence.backupRetention,
      checks: { configurationAndStorage: 'ok', nativeHttp: 'ok' },
      nativeProtocol: NATIVE_PROTOCOL, upstreamCommit: UPSTREAM_COMMIT, buildRevision,
    });
  }

  function checkRequest(req) {
    const host = String(req.headers.host || '').toLowerCase();
    if (!allowedHosts.includes(host)) throw Object.assign(new Error('This dashboard address is not in HOMEPAGE_ALLOWED_HOSTS.'), { status: 403 });
    if (!req.url.startsWith('/') || req.url.startsWith('//')) throw Object.assign(new Error('Unsupported request target.'), { status: 400 });
    // Native integrations can perform actions as well as read data (for example
    // media playback controls and configured custom-API requests). Protect their
    // explicit routes too; CORS does not stop a foreign site's simple POST.
    const editor = req.url.startsWith('/studio/');
    if ((editor || req.url.startsWith('/api/')) && !isAuthNavigation(req.method, req.url.split('?')[0])) {
      if (['cross-site', 'same-site'].includes(req.headers['sec-fetch-site'])) throw Object.assign(new Error('Open this request from your dashboard.'), { status: 403 });
      if (req.headers.origin) {
        let origin;
        try { origin = new URL(req.headers.origin); } catch { throw Object.assign(new Error('Invalid request origin.'), { status: 403 }); }
        const expectedOrigin = publicOrigin?.origin || `http://${host}`;
        if (origin.origin !== expectedOrigin || origin.host.toLowerCase() !== host) throw Object.assign(new Error('Open the editor from your dashboard.'), { status: 403 });
      }
      // The identity provider posts back-channel logout server to server, as
      // a form without the editor header; its signed logout token is checked.
      const backchannel = req.url === '/studio/auth/oidc/backchannel-logout' && req.method === 'POST';
      if (editor && !backchannel && !['GET', 'HEAD'].includes(req.method) && req.headers['x-studio-request'] !== '1') throw Object.assign(new Error('The save request is missing its editor header.'), { status: 403 });
    }
  }

  async function proxy(req, res, dashboard) {
    if (res.destroyed || req.aborted) return;
    const basePath = dashboardBasePath(dashboard);
    const host = String(req.headers.host).toLowerCase();
    const hasBody = req.headers['transfer-encoding'] !== undefined || Number(req.headers['content-length'] || 0) > 0;
    const received = hasBody ? await readNativeBody(req, options.nativeBodyBudget, { timeoutMs: options.nativeBodyTimeoutMs }) : undefined;
    const body = received?.body;
    // The buffered body counts against the shared budget until the response ends.
    if (received) { if (res.closed) received.release(); else res.once('close', received.release); }
    if (res.destroyed || req.aborted) return;
    const lease = await acquireNative(host, dashboard);
    const upstream = lease.origin;
    const transport = upstream.protocol === 'https:' ? https : http;
    let released = false;
    const release = () => { if (!released) { released = true; lease.release(); } };
    let upstreamRequest, upstreamResponse;
    const abandon = () => { upstreamRequest?.destroy(); upstreamResponse?.destroy(); release(); };
    res.once('finish', release); res.once('close', abandon); req.once('aborted', abandon);
    if (res.destroyed || req.aborted) { abandon(); return; }
    // The controller already received the body, so the worker must not be
    // asked to send 100 Continue.
    const headers = Object.fromEntries(Object.entries(headersWithoutHop(req.headers)).filter(([key]) => !key.startsWith('x-studio-') && key.toLowerCase() !== 'expect'));
    // Studio sign-in cookies never reach the native runtime.
    if (headers.cookie && options.privateCookies?.length) {
      const kept = String(headers.cookie).split(';').map(part => part.trim()).filter(part => part && !options.privateCookies.includes(part.split('=')[0].trim()));
      if (kept.length) headers.cookie = kept.join('; '); else delete headers.cookie;
    }
    if (body) headers['content-length'] = String(body.length);
    try {
      upstreamRequest = transport.request(upstream, { method: req.method, path: req.url, headers, timeout: 60000 }, response => {
        upstreamResponse = response;
        if (res.destroyed || req.aborted) { abandon(); return; }
        const responseHeaders = headersWithoutHop(response.headers);
        const context = { basePath, upstream, host, requestPath: req.url };
        if (responseHeaders.location) responseHeaders.location = nativeLocation(responseHeaders.location, context);
        if (responseHeaders.refresh) responseHeaders.refresh = nativeRefresh(responseHeaders.refresh, context);
        responseHeaders['cache-control'] = 'no-store';
        for (const key of CONTROLLER_HEADERS) delete responseHeaders[key];
        // A native policy stays in force; the controller's frame-ancestors
        // policy is added as a separate header, and browsers enforce both.
        if (responseHeaders['content-security-policy'] && res.hasHeader('content-security-policy')) {
          responseHeaders['content-security-policy'] = [].concat(responseHeaders['content-security-policy'], res.getHeader('content-security-policy'));
        }
        res.writeHead(response.statusCode || 502, responseHeaders);
        response.on('error', () => res.destroy()); response.on('aborted', () => res.destroy());
        response.pipe(res);
      });
    } catch (error) { abandon(); throw error; }
    upstreamRequest.on('timeout', () => upstreamRequest.destroy(new Error('Upstream timeout')));
    upstreamRequest.on('error', () => {
      if (!res.destroyed) {
        if (!res.headersSent) json(res, 502, { error: 'This dashboard renderer is temporarily unavailable. Retry after checking the application logs.' });
        else res.destroy();
      }
      release();
    });
    upstreamRequest.end(body);
  }

  async function handle(req, res, dashboard) {
    try {
      checkRequest(req);
      const path = req.url.split('?')[0];
      if ((path === '/studio/health' || path === '/studio/live') && req.method === 'GET') return json(res, 200, { status: 'ok', check: 'liveness', version: studioVersion });
      if (path === '/studio/ready' && req.method === 'GET') return await readiness(req, res, dashboard);
      if (path === '/studio/config-ready' && req.method === 'GET') return await readiness(req, res, dashboard, true);
      if (!path.startsWith('/studio/')) await prepareNative();
      if (path === '/studio/catalog.json' && ['GET', 'HEAD'].includes(req.method)) return await serveCatalog(req, res);
      const saveChange = path === '/studio/api/save' && req.method === 'POST' ? await readBody(req) : undefined;
      // Complete board replacements must validate against newly discovered
      // membership. Structured/native-file edits use their revision-checked
      // local sources and retained discovery identities, without a provider wait.
      if ((req.method === 'GET' && ['/studio/api/state', '/studio/api/board', '/studio/api/export'].includes(path)) ||
          (req.method === 'POST' && (path === '/studio/api/board' || (saveChange && Object.hasOwn(saveChange, 'board'))))) {
        await store.refreshDiscovery(String(req.headers.host).toLowerCase(), dashboard);
      }
      if (path === '/studio/api/state' && req.method === 'GET') return json(res, 200, await store.load());
      if (path === '/studio/api/board' && req.method === 'GET') return json(res, 200, await store.loadBoard());
      if (path === '/studio/api/board' && req.method === 'POST') return json(res, 200, await store.saveBoard(await readBody(req)));
      if (path === '/studio/api/export' && req.method === 'GET') return json(res, 200, await store.exportCurrent());
      if (path === '/studio/api/backups' && req.method === 'GET') return json(res, 200, await store.listBackups());
      if (path.startsWith('/studio/api/backups/') && req.method === 'GET') return json(res, 200, await store.exportBackup(path.slice('/studio/api/backups/'.length)));
      if (path === '/studio/api/restore' && req.method === 'POST') return json(res, 200, await store.restoreBackup(await readBody(req)));
      if (path === '/studio/api/import' && req.method === 'POST') return json(res, 200, await store.importArchive(await readBody(req, MAX_IMPORT_BYTES)));
      if (path === '/studio/api/save' && req.method === 'POST') return json(res, 200, await store.save(saveChange));
      if (path === '/studio/api/service' && req.method === 'POST') return json(res, 200, await store.mutateService(await readBody(req)));
      if (path === '/studio/api/info-widget' && req.method === 'POST') return json(res, 200, await store.mutateInfoWidget(await readBody(req)));
      if (path === '/studio/api/service-widget' && req.method === 'POST') return json(res, 200, await store.mutateServiceWidget(await readBody(req)));
      if (path === '/studio/api/bookmark' && req.method === 'POST') return json(res, 200, await store.mutateBookmark(await readBody(req)));
      if (path === '/studio/api/settings' && req.method === 'POST') return json(res, 200, await store.mutateSettings(await readBody(req)));
      // These two are open to people who may arrange a dashboard, so they answer
      // with the board only, never the configuration files.
      if (path === '/studio/api/discovery-visibility' && req.method === 'POST') return json(res, 200, boardView(await store.mutateDiscoveryVisibility(await readBody(req))));
      // Appearance only: the display mode and Studio theme keys of settings.yaml,
      // for people allowed to arrange a dashboard but not to read its settings.
      if (path === '/studio/api/appearance' && req.method === 'GET') {
        const current = await store.load();
        const settings = current.settingsConfig || {};
        // The platform defaults show what each "use platform default" means.
        const defaults = await options.platform?.read().catch(() => null);
        return json(res, 200, { revision: current.revision, settings: Object.fromEntries(APPEARANCE_KEYS.filter(key => Object.hasOwn(settings, key)).map(key => [key, settings[key]])), platform: defaults ? { mode: defaults.mode, accent: defaults.accent, background: defaults.background } : null });
      }
      if (path === '/studio/api/appearance' && req.method === 'POST') {
        const change = await readBody(req);
        const config = change.config;
        const validTheme = value => value === null || value === 'dark' || value === 'light';
        const validStudio = value => value === null || (value && typeof value === 'object' && !Array.isArray(value) && JSON.stringify(value).length <= 4096);
        if (!config || typeof config !== 'object' || Array.isArray(config) || Object.keys(config).some(key => !APPEARANCE_KEYS.includes(key)) || (Object.hasOwn(config, 'theme') && !validTheme(config.theme)) || (Object.hasOwn(config, 'studioTheme') && !validStudio(config.studioTheme))) {
          throw Object.assign(new Error('Only the display mode and Studio appearance can be changed here.'), { status: 400, code: 'APPEARANCE_ONLY' });
        }
        // Switching off the platform CSS is a CSS change, for administrators only.
        if (Object.hasOwn(config, 'studioTheme')) {
          const current = (await store.load()).settingsConfig?.studioTheme;
          if (config.studioTheme?.platformCss !== (current && typeof current === 'object' ? current.platformCss : undefined)) throw Object.assign(new Error('Only an administrator can switch the platform CSS off or on.'), { status: 403, code: 'APPEARANCE_ONLY' });
        }
        return json(res, 200, boardView(await store.mutateSettings({ revision: change.revision, config })));
      }
      // The dashboard's logo (or the Studio logo), for its top bar and tab.
      if (path === '/studio/logo' && ['GET', 'HEAD'].includes(req.method)) {
        const own = await logo.read();
        if (!own) return await sendBrandFile(req, res, 'logo.svg');
        res.writeHead(200, { 'content-type': own.type, 'content-length': own.bytes.length, 'cache-control': 'no-cache', etag: '"' + own.version + '"', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" });
        return res.end(req.method === 'HEAD' ? undefined : own.bytes);
      }
      if (path === '/studio/api/logo' && req.method === 'POST') {
        const change = await readBody(req, 512 * 1024);
        if (Object.keys(change).some(key => !['image', 'reset'].includes(key)) || (change.reset === true) === (change.image !== undefined)) throw Object.assign(new Error('Send an image or reset the logo.'), { status: 400, code: 'INVALID_LOGO' });
        return json(res, 200, { logo: change.reset ? await logo.remove() : await logo.save(change.image) });
      }
      if (path.startsWith('/studio/')) return json(res, 404, { error: 'This editor endpoint does not exist.' });
      await proxy(req, res, dashboard);
    } catch (error) {
      const status = Number(error.status || error.statusCode) || 500;
      if (error.closeConnection && !res.headersSent) res.setHeader('connection', 'close');
      if (error.retryAfter && !res.headersSent) res.setHeader('retry-after', String(error.retryAfter));
      json(res, status, { error: status < 500 || error instanceof ConfigError || error instanceof BoardError || error instanceof DiscoveryError || error instanceof RendererError ? error.message : 'The editor could not read or save its configuration. Check the configuration and state volume permissions.', code: error.code || 'EDITOR_ERROR',
        // ConfigError details are structured and source-free (file names, YAML error codes and positions, limits),
        // so editors can point at the failing line without the response ever echoing configuration text.
        details: error instanceof ConfigError ? error.details : undefined });
      // Load shedding (503 with Retry-After) is expected under a burst; do not log each refusal.
      if (status >= 500 && !error.retryAfter) console.error('Editor request failed:', error.code || error.name);
    }
  }

  return { handle, checkRequest, store, logo, initialization };
}

export function createStudioServer(options = {}) {
  const configRoot = resolve(options.configDir || process.env.HOMEPAGE_CONFIG_DIR || join(base, 'config'));
  const stateRoot = resolve(options.stateDir || process.env.STUDIO_STATE_DIR || join(base, 'state'));
  const rendererDir = options.rendererDir || process.env.STUDIO_RENDERER_DIR || join(base, 'homepage', '.next', 'standalone');
  let rendererPool = options.rendererPool;
  // Explicit test injection only; production uses this image's internal workers.
  if (!rendererPool && options.upstream) {
    const origin = new URL(options.upstream);
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('The injected renderer must be an HTTP(S) origin.');
    rendererPool = { acquire: async () => ({ origin, release() {} }), drain: async () => {}, close: async () => {} };
  }
  const responseHeaders = securityHeaders(parseFrameAncestors(options.frameAncestors ?? process.env.STUDIO_FRAME_ANCESTORS));
  // Prepare the compressed catalog before the first editor opens; errors surface on request.
  loadCatalogVariants().catch(() => {});
  const nativeBodyBudget = createByteBudget(NATIVE_BODY_BUDGET);
  rendererPool ||= createRendererPool({ configRoot, appRoot: rendererDir, allowedHosts: options.allowedHosts, buildRevision: options.buildRevision });
  // Studio sign-in (owner direction, 23 Oct 2026). On by default; STUDIO_AUTH=off
  // returns to external access control only.
  const deploymentName = readDeploymentName(options.deploymentName ?? process.env.STUDIO_DEPLOYMENT_NAME);
  const authConfig = readAuthConfig(options);
  let registryForAuth;
  const auth = authConfig.enabled && !authConfig.blocked ? createAuthService({ config: authConfig, stateRoot, listDashboards: async () => (await registryForAuth()).dashboards, mailAccent: async () => (await platform.read()).accent }) : null;
  // Administration's name for the deployment, else STUDIO_DEPLOYMENT_NAME.
  const siteName = () => (auth?.ready ? auth.siteName() : deploymentName);
  const platform = createPlatformStore({ configRoot });
  const backups = createBackupStore({ configRoot, stateRoot, buildRevision: options.buildRevision ?? process.env.STUDIO_BUILD_REVISION });
  const authRoutes = auth ? createAuthRoutes(auth, { listDashboards: async () => (await registryForAuth()).dashboards }) : null;
  const privateCookies = auth ? [authConfig.cookieName, authConfig.flowCookieName, authConfig.setupCookieName] : [];
  const handlers = new Map();
  const unpublished = new Map();
  let rendererClosed, applicationClosing = false;
  const closeRenderer = () => (rendererClosed ||= Promise.resolve().then(() => rendererPool.close?.()));
  function forDashboard(entry) {
    let handler = handlers.get(entry.id);
    if (!handler) {
      handler = createDashboardHandlers({ ...options, platform, rendererPool, nativeBodyBudget, privateCookies, configDir: dashboardConfigDir(configRoot, entry.id), stateDir: dashboardStateDir(stateRoot, entry.id) });
      handlers.set(entry.id, handler);
    }
    // Only immutable-id storage is retained. Each request carries its own
    // registry descriptor; a stale request cannot overwrite a newer slug.
    return handler;
  }
  const original = forDashboard({ id: 'default', slug: '', name: 'Main dashboard', archived: false });
  async function requireRealDirectory(directory) {
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(directory) !== resolve(directory)) throw new DashboardError('Dashboard storage must use real directories without symbolic links.', 'UNSAFE_DASHBOARD_STORAGE', 503);
  }
  async function allocateDashboard(entry) {
    // Existing registries can become ready before the default store finishes
    // creating the shared state root. Its parse result does not gate siblings.
    await original.initialization;
    const owned = { directories: [], handler: null };
    unpublished.set(entry.id, owned);
    for (const [root, directory, mode] of [[configRoot, dashboardConfigDir(configRoot, entry.id), 0o750], [stateRoot, dashboardStateDir(stateRoot, entry.id), 0o700]]) {
      await requireRealDirectory(root);
      const parent = dirname(directory);
      try { await fs.mkdir(parent, { mode }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      await requireRealDirectory(parent);
      // Exclusive creation establishes ownership. Never adopt or later remove
      // a pre-existing directory, even on an unexpected UUID collision.
      await fs.mkdir(directory, { mode });
      owned.directories.push(directory);
    }
    return owned;
  }
  const registry = createDashboardRegistry({ configRoot, prepareDashboard: async (entry, source, { isNew = false } = {}) => {
    let archive, logo;
    if (source) {
      const sourceHandler = forDashboard(source);
      await sourceHandler.initialization;
      archive = await sourceHandler.store.exportCurrent();
      logo = await sourceHandler.logo.read();
    }
    const owned = isNew ? await allocateDashboard(entry) : null;
    const target = forDashboard(entry);
    if (owned) owned.handler = target;
    if (!(await target.initialization).ok) await target.store.initialize();
    if (archive) {
      const current = await target.store.load();
      await target.store.importArchive({ revision: current.revision, archive });
    }
    // A duplicate keeps the source's logo too.
    if (logo) await target.logo.save(`data:${logo.type};base64,${logo.bytes.toString('base64')}`);
  }, cleanupDashboard: async entry => {
    if (entry.id === 'default') throw new DashboardError('The original dashboard cannot be removed.', 'DEFAULT_DASHBOARD_REQUIRED');
    const owned = unpublished.get(entry.id);
    if (!owned) return;
    try {
      await owned.handler?.initialization;
      if (owned.handler && handlers.get(entry.id) === owned.handler) handlers.delete(entry.id);
      for (const directory of owned.directories) {
        try { await requireRealDirectory(directory); }
        catch (error) { if (error.code === 'ENOENT') continue; throw error; }
        await fs.rm(directory, { recursive: true, force: true });
      }
    } finally { unpublished.delete(entry.id); }
  } });
  let registryReady = false;
  const initialization = registry.initialize().then(
    () => { registryReady = true; return { ok: true }; },
    error => ({ ok: false, code: error.code || 'DASHBOARDS_NOT_READY' }),
  );
  async function prepareRegistry() {
    await initialization;
    if (!registryReady) { await registry.initialize(); registryReady = true; }
    return registry.read();
  }
  registryForAuth = prepareRegistry;
  if (authConfig.blocked) console.error('Sign-in is locked:', authConfig.blocked);
  const authInitialization = auth ? auth.initialize().then(() => ({ ok: true }), error => { console.error('Sign-in storage is unavailable:', error.code || error.name); return { ok: false, code: error.code }; }) : Promise.resolve({ ok: true });

  // ---- Sign-in gate ---------------------------------------------------------
  function wantsNavigation(req) {
    return ['GET', 'HEAD'].includes(req.method) && String(req.headers.accept || '').split(',').some(entry => entry.trim().toLowerCase().split(';')[0] === 'text/html')
      && (!/^\/(?:[^/]+\/)?(?:api|studio)\//.test(String(req.url).split('?')[0]) || /^\/(?:[^/]+\/)?studio\/(?:edit|settings)$/.test(String(req.url).split('?')[0]));
  }
  // The sign-in pages refuse to be framed, so a signed-out dashboard inside
  // another site (for example a Home Assistant panel) gets this page instead
  // of a blocked frame: sign in in a new tab, then reload the frame.
  const FRAMED_SIGN_IN = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Sign in to Studio</title><style>:root{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;background:#111115;color:#eeecf1;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}main{max-width:30rem;padding:28px 24px;background:#1b1a20;border:1px solid #34303b;border-radius:12px}h1{margin:0 0 12px;font-size:1.375rem;font-weight:600}p{margin:0 0 20px;color:#b4aebc}a{display:inline-block;margin:0 8px 8px 0;padding:10px 16px;border-radius:8px;background:#685870;color:#fff;text-decoration:none;font-weight:600}a.quiet{background:transparent;border:1px solid #4a4452}a:focus-visible{outline:3px solid #b299be;outline-offset:3px}</style></head><body><main><h1>Sign in to see this dashboard</h1><p>Sign in to Studio in a new tab, then come back and reload.</p><a href="SIGN_IN" target="_blank" rel="noopener">Sign in in a new tab</a><a class="quiet" href="">Reload</a></main></body></html>`;
  const escapeAttribute = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  function framedSignIn(req, res) {
    const next = String(req.url);
    const signIn = escapeAttribute(new URL('/studio/auth/sign-in?next=' + encodeURIComponent(next), authConfig.origin).href);
    const page = FRAMED_SIGN_IN.replace('SIGN_IN', () => signIn);
    const policy = res.getHeader('content-security-policy');
    res.writeHead(401, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(page), 'content-security-policy': [].concat(policy ?? [], UNAVAILABLE_PAGE_POLICY) });
    return res.end(req.method === 'HEAD' ? undefined : page);
  }
  function toSignIn(req, res, code, status = 401) {
    if (wantsNavigation(req) && code !== 'SETUP_REQUIRED' && req.headers['sec-fetch-dest'] === 'iframe') return framedSignIn(req, res);
    if (wantsNavigation(req)) {
      res.writeHead(302, { location: code === 'SETUP_REQUIRED' ? '/studio/auth/setup' : '/studio/auth/sign-in?next=' + encodeURIComponent(req.url), 'cache-control': 'no-store', 'content-length': 0 });
      return res.end();
    }
    return json(res, status, { error: code === 'SETUP_REQUIRED' ? 'Studio needs its first administrator. Open Studio in a browser to set it up.' : 'Sign in to continue.', code });
  }
  const isLoopback = address => /^(?:127\.|::1$|::ffff:127\.)/.test(String(address ?? ''));
  function authBlocked(req, res) {
    if (pathOf(req) === '/studio/application-ready' && req.method === 'GET') return json(res, 200, { status: 'ready' });
    if (wantsNavigation(req)) {
      const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>HTTPS needed</title><style>:root{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;background:#111115;color:#eeecf1;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}main{max-width:34rem;padding:28px 24px;background:#1b1a20;border:1px solid #34303b;border-radius:12px}h1{margin:0 0 12px;font-size:1.375rem;font-weight:600}p{margin:0 0 12px;color:#b4aebc}code{color:#eeecf1}</style></head><body><main><h1>Studio needs HTTPS before anyone can sign in</h1><p>Sign-in is on, but this address uses plain HTTP. Passkeys and secure sign-in cookies only work over HTTPS, so no dashboard is shown until that is fixed.</p><p>Put Studio behind an HTTPS reverse proxy and set <code>STUDIO_PUBLIC_ORIGIN</code> to the https:// address, or set <code>STUDIO_AUTH=off</code> if another layer already controls who can open Studio. See docs/AUTHENTICATION.md.</p></main></body></html>`;
      const policy = res.getHeader('content-security-policy');
      res.writeHead(503, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '300', 'content-length': Buffer.byteLength(page), 'content-security-policy': [].concat(policy ?? [], UNAVAILABLE_PAGE_POLICY) });
      return res.end(req.method === 'HEAD' ? undefined : page);
    }
    return json(res, 503, { error: authConfig.blocked, code: 'HTTPS_REQUIRED' });
  }
  const pathOf = req => String(req.url).split('?')[0];
  const STUDIO_PAGES = new Map([['/studio/edit', '/studio-edit'], ['/studio/settings', '/studio-settings']]);
  const NATIVE_STUDIO_PAGE = /^\/(?:studio-(?:edit|settings)(?:\/|$)|_next\/data\/[^/]+\/studio-(?:edit|settings)\.json$)/;
  function forbidden(res, message = 'Your account does not have access to this.') {
    return json(res, 403, { error: message, code: 'FORBIDDEN' });
  }
  async function handleRequest(req, res) {
    for (const [name, value] of Object.entries(responseHeaders)) res.setHeader(name, value);
    try {
      original.checkRequest(req);
      const path = req.url.split('?')[0];
      if (['/studio/live', '/studio/health'].includes(path)) return await original.handle(req, res);
      const brand = brandFile(path);
      if (brand) return await sendBrandFile(req, res, brand);
      // Studio's own pages follow the platform display mode and accent. The
      // sign-in page needs it before anyone signs in; it holds two colors.
      if (path === '/studio/theme.css' && ['GET', 'HEAD'].includes(req.method)) {
        const css = studioThemeCss(await platform.read().catch(() => undefined));
        res.writeHead(200, { 'content-type': 'text/css; charset=utf-8', 'content-length': Buffer.byteLength(css), 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
        return res.end(req.method === 'HEAD' ? undefined : css);
      }
      if (path === '/robots.txt') {
        if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'Use GET or HEAD for the crawl policy.' });
        let status = 200, content;
        try {
          content = await renderRobotsPolicy(await prepareRegistry(), entry => forDashboard(entry).store.readIndexingPolicy());
        } catch {
          status = 503; content = 'User-agent: *\nDisallow: /\n';
        }
        res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(content), 'x-content-type-options': 'nosniff', ...(status === 503 ? { 'retry-after': '60' } : {}) });
        return res.end(req.method === 'HEAD' ? undefined : content);
      }
      if (authConfig.blocked) return authBlocked(req, res);
      let current = null;
      if (auth) {
        await authInitialization;
        if (auth.ready) current = await auth.principal(req);
        if (isAuthPath(path)) {
          if (!auth.ready) return json(res, 503, { error: 'Sign-in storage is unavailable. Check the application logs and the state volume.', code: 'AUTH_STORAGE_UNAVAILABLE' });
          return await authRoutes.handle(req, res, current);
        }
      }
      const manifest = await prepareRegistry();
      if (path === '/studio/application-ready') {
        if (req.method !== 'GET') return json(res, 405, { error: 'Use GET to check application readiness.' });
        if (applicationClosing) throw new DashboardError('The application is shutting down.', 'APPLICATION_SHUTTING_DOWN', 503);
        const checks = await checkApplicationReadiness({ configRoot, stateRoot, rendererDir });
        if (auth && !auth.ready) return json(res, 503, { status: 'not_ready', code: 'AUTH_STORAGE_UNAVAILABLE' });
        // With sign-in on, only administrators and the container's own health
        // check (loopback inside the container) see build details.
        if (auth && current?.user.role !== 'admin' && !isLoopback(req.socket.remoteAddress)) return json(res, 200, { status: 'ready' });
        return json(res, 200, { status: 'ready', version: studioVersion, checks, buildRevision: options.buildRevision ?? process.env.STUDIO_BUILD_REVISION ?? 'unreleased', nativeProtocol: NATIVE_PROTOCOL, upstreamCommit: UPSTREAM_COMMIT });
      }
      if (auth) {
        // Fail closed: unreadable sign-in data never means open access.
        if (!auth.ready) return json(res, 503, { error: 'Sign-in storage is unavailable. Check the application logs and the state volume.', code: 'AUTH_STORAGE_UNAVAILABLE' });
        if (!current) {
          // Immutable build assets carry no configuration and are needed by the
          // sign-in page. Every other address asks for sign-in first, so an
          // anonymous visitor cannot tell which dashboard addresses exist.
          const pathname = path;
          if (sharedPublic(pathname) && ['GET', 'HEAD'].includes(req.method)) {
            const route = resolveDashboardRoute(manifest, req.url);
            if (route.shared) { req.url = route.path; return await serveSharedAsset(req, res, rendererDir); }
          }
          return toSignIn(req, res, auth.setupRequired() ? 'SETUP_REQUIRED' : 'AUTH_REQUIRED');
        }
      }
      const isAdmin = !auth || current.user.role === 'admin';
      if (path === '/studio/api/dashboards') {
        if (req.method === 'GET') {
          if (isAdmin) return json(res, 200, manifest);
          return json(res, 200, { ...manifest, dashboards: manifest.dashboards.filter(entry => !entry.archived && current.level(entry.id) !== 'none') });
        }
        if (req.method !== 'POST') return json(res, 405, { error: 'Use GET or POST for dashboard management.' });
        if (!isAdmin) return forbidden(res, 'Only administrators can manage dashboards.');
        const change = await readBody(req);
        // "Copy access" is a sign-in option, not a registry field.
        const copyAccess = change.copyAccess === true;
        delete change.copyAccess;
        const result = await registry.mutate(change);
        if (auth && copyAccess && change.action === 'create' && change.sourceId) await auth.copyGrants(change.sourceId, result.dashboard.id);
        unpublished.delete(result.dashboard.id);
        forDashboard(result.dashboard);
        const previous = manifest.dashboards.find(entry => entry.id === result.dashboard.id);
        if (previous && (previous.slug !== result.dashboard.slug || previous.archived !== result.dashboard.archived)) {
          try { await rendererPool.drain?.(result.dashboard.id); }
          catch (error) { console.error('Dashboard worker cleanup failed:', error.code || error.name); }
        }
        return json(res, 200, result);
      }
      if (['/studio/ready', '/studio/config-ready'].includes(path)) {
        if (!isAdmin) return forbidden(res);
        const primary = manifest.dashboards.find(entry => entry.id === 'default');
        return await forDashboard(primary).handle(req, res, primary);
      }
      // The Dashboards page lists what this person can open, with the actions
      // their level allows. It works with sign-in on or off.
      if (path === '/studio/api/overview') {
        if (req.method !== 'GET') return json(res, 405, { error: 'Use GET for the dashboard list.' });
        const level = entry => (auth ? current.level(entry.id) : 'admin');
        // A main dashboard without an address can't be opened yet, so only
        // administrators see it (and are asked to choose the address).
        const listed = manifest.dashboards.filter(entry => (isAdmin || (!entry.archived && entry.slug)) && level(entry) !== 'none');
        const primary = manifest.dashboards.find(entry => entry.id === 'default');
        return json(res, 200, {
          deploymentName: siteName(),
          mainNeedsAddress: isAdmin && !primary.slug,
          suggestedSlug: isAdmin ? suggestedDashboardSlug(manifest.dashboards) : undefined,
          authEnabled: Boolean(auth),
          user: auth ? { displayName: current.user.displayName, username: current.user.username, role: current.user.role, defaultDashboardId: current.user.defaultDashboardId ?? null } : null,
          landingId: auth ? current.landing(manifest.dashboards) : null,
          revision: isAdmin ? manifest.revision : undefined,
          dashboards: await Promise.all(listed.map(async entry => ({
            id: entry.id, name: entry.name, slug: entry.slug, path: dashboardBasePath(entry) || null, archived: entry.archived, level: level(entry),
            lastChanged: await forDashboard(entry).store.lastChanged().catch(() => null),
            audience: isAdmin && auth ? auth.audience(entry.id) : undefined,
          }))),
        });
      }
      // The platform default look: administrators change it in Administration
      // → Appearance; every dashboard page loads its CSS.
      if (path === '/studio/platform.css' && ['GET', 'HEAD'].includes(req.method)) {
        const css = await platform.readCss();
        res.writeHead(200, { 'content-type': 'text/css; charset=utf-8', 'content-length': Buffer.byteLength(css), 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
        return res.end(req.method === 'HEAD' ? undefined : css);
      }
      if (path === '/studio/api/platform') {
        if (!isAdmin) return forbidden(res, 'Only administrators can change the platform appearance.');
        if (req.method === 'GET') return json(res, 200, await platform.read());
        if (req.method !== 'POST') return json(res, 405, { error: 'Use GET or POST for the platform appearance.' });
        // Platform CSS reaches every dashboard, so saving it needs a recent
        // sign-in, as a dashboard's own custom.css does.
        if (auth && !current.fresh()) return json(res, 401, { error: 'Confirm it’s you to continue.', code: 'REAUTH_REQUIRED' });
        return json(res, 200, await platform.update(await readBody(req)));
      }
      // Full backups (server/backups.mjs), for administrators. Everything but
      // the list needs a recent sign-in: a backup holds every secret Studio has.
      if (path === '/studio/api/backups' || path.startsWith('/studio/api/backups/')) {
        if (!isAdmin) return forbidden(res, 'Only administrators can manage backups.');
        if (path === '/studio/api/backups' && req.method === 'GET') return json(res, 200, { backups: await backups.list() });
        if (auth && !current.fresh()) return json(res, 401, { error: 'Confirm it’s you to continue.', code: 'REAUTH_REQUIRED' });
        if (path.startsWith('/studio/api/backups/file/') && req.method === 'GET') {
          const name = decodeURIComponent(path.slice('/studio/api/backups/file/'.length));
          const bytes = await backups.read(name);
          res.writeHead(200, { 'content-type': 'application/gzip', 'content-length': bytes.length, 'content-disposition': `attachment; filename="${name}"`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
          return res.end(bytes);
        }
        if (path === '/studio/api/backups/upload' && req.method === 'POST') {
          continueBody(req);
          const chunks = [];
          let length = 0;
          for await (const chunk of req) {
            length += chunk.length;
            if (length > MAX_BACKUP_BYTES) return json(res, 413, { error: `A backup can be at most ${MAX_BACKUP_BYTES / (1024 * 1024)} MiB.`, code: 'BACKUP_TOO_LARGE' });
            chunks.push(chunk);
          }
          return json(res, 200, await backups.upload(Buffer.concat(chunks)));
        }
        if (path !== '/studio/api/backups' || req.method !== 'POST') return json(res, 405, { error: 'Use GET or POST for backups.' });
        const change = await readBody(req);
        if (change.action === 'create') return json(res, 200, await backups.create());
        if (change.action === 'delete') { await backups.remove(change.name); return json(res, 200, { backups: await backups.list() }); }
        if (change.action === 'restore') {
          if (change.confirmed !== true) return json(res, 400, { error: 'Confirm the restore first.', code: 'CONFIRMATION_REQUIRED' });
          const staged = await backups.stageRestore(change.name);
          console.log(`Studio restore: ${staged.name} staged${current?.user ? ' by ' + current.user.username : ''}; restarting to apply it.`);
          json(res, 202, { ...staged, restarting: Boolean(options.onRestoreStaged) });
          options.onRestoreStaged?.();
          return;
        }
        return json(res, 400, { error: 'Unknown backup action.', code: 'INVALID_BACKUP_ACTION' });
      }
      if (!auth && ['/studio/dashboards', '/studio/admin'].includes(path) && ['GET', 'HEAD'].includes(req.method)) return sendStudioPage(res, path.slice('/studio/'.length), siteName());
      if (!auth && req.method === 'GET' && path.startsWith('/studio/auth/assets/')) return await sendStudioAsset(res, path);
      // The bare address: the person's landing dashboard, or the Dashboards page.
      if (path === '/' && ['GET', 'HEAD'].includes(req.method)) {
        const landing = auth ? manifest.dashboards.find(entry => entry.id === current.landing(manifest.dashboards)) : null;
        const target = landing && dashboardBasePath(landing) ? dashboardBasePath(landing) + req.url.slice(1) : '/studio/dashboards';
        res.writeHead(307, { location: target, 'cache-control': 'no-store', 'content-length': 0 });
        return res.end();
      }
      const route = resolveDashboardRoute(manifest, req.url);
      // Until the main dashboard has an address, an administrator opening a
      // dashboard page is sent to the Dashboards page, which asks for it.
      if (isAdmin && !manifest.dashboards.find(entry => entry.id === 'default').slug && !route.shared && ['GET', 'HEAD'].includes(req.method) && !/^\/(?:api|studio\/api)\//.test(route.path) && String(req.headers.accept || '').includes('text/html')) {
        res.writeHead(303, { location: '/studio/dashboards', 'cache-control': 'no-store', 'content-length': 0 });
        return res.end();
      }
      if (route.redirect) { res.writeHead(307, { location: route.redirect, 'cache-control': 'no-store' }); return res.end(); }
      req.url = route.path;
      if (route.shared) return await serveSharedAsset(req, res, rendererDir);
      const local = route.path.split('?')[0];
      const level = auth ? current.level(route.dashboard.id) : 'admin';
      // A dashboard you can't open looks exactly like one that doesn't exist.
      if (level === 'none') throw new DashboardError('That dashboard is unavailable. Its address may have changed or it may be archived.', 'DASHBOARD_NOT_FOUND', 404);
      if (local === '/studio/api/access' && req.method === 'GET') {
        return json(res, 200, { authEnabled: Boolean(auth), deploymentName: siteName(), level, dashboard: { id: route.dashboard.id, name: route.dashboard.name, logo: await forDashboard(route.dashboard).logo.info() }, user: auth ? { displayName: current.user.displayName, username: current.user.username, role: current.user.role } : null });
      }
      // The editor and settings pages open from the Dashboards page. They are
      // native pages behind Studio addresses; their native addresses stay closed
      // so the live dashboard is the only page at a dashboard's own address.
      if (STUDIO_PAGES.has(local)) {
        if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'Use GET to open this page.' });
        if (!atLeast(level, requiredLevel('GET', local).level)) { res.writeHead(303, { location: dashboardBasePath(route.dashboard) || '/', 'cache-control': 'no-store', 'content-length': 0 }); return res.end(); }
        req.url = STUDIO_PAGES.get(local) + route.path.slice(local.length);
        return await forDashboard(route.dashboard).handle(req, res, route.dashboard);
      }
      if (NATIVE_STUDIO_PAGE.test(local)) throw new DashboardError('That dashboard is unavailable. Its address may have changed or it may be archived.', 'DASHBOARD_NOT_FOUND', 404);
      if (auth) {
        const required = requiredLevel(req.method, local);
        if (required.level === 'blocked') return forbidden(res, 'This endpoint is turned off while Studio sign-in is on.');
        if (!atLeast(level, required.level)) return forbidden(res, required.level === 'admin' ? 'Only administrators can do this.' : 'You can view this dashboard but not change it.');
        if (required.stepUp && !current.fresh()) return json(res, 401, { error: 'Confirm it’s you to continue.', code: 'REAUTH_REQUIRED' });
      }
      return await forDashboard(route.dashboard).handle(req, res, route.dashboard);
    } catch (error) {
      if (error instanceof DashboardError && error.code === 'DASHBOARD_NOT_FOUND' && wantsHtmlPage(req)) return unavailablePage(req, res, Number(error.status) || 404);
      // Editor API requests for any dashboard keep their diagnostic status.
      const diagnostic = /^\/(?:[^/]+\/)?studio\/api\//.test(req.url.split('?')[0]);
      const status = error instanceof ConfigError && !diagnostic ? 503 : Number(error.status || error.statusCode) || 500;
      json(res, status, { error: error instanceof DashboardError || error instanceof ConfigError || error instanceof PlatformError || status < 500 ? error.message : 'The dashboard could not be opened. Check the application logs and persistent storage.', code: error.code || 'DASHBOARD_ERROR' });
    }
  }
  const server = http.createServer(handleRequest);
  // With this listener Node no longer sends 100 Continue by itself. A request
  // gets it only when a handler is about to read its body, so an oversized or
  // over-budget upload is refused before the client sends it.
  server.on('checkContinue', (req, res) => {
    let continued = false;
    req[CONTINUE] = () => { if (!continued && !res.headersSent && !res.destroyed) { continued = true; res.writeContinue(); } };
    return handleRequest(req, res);
  });
  const connections = new Set();
  server.on('connection', socket => { connections.add(socket); socket.once('close', () => connections.delete(socket)); });
  // No browser-facing route upgrades: Homepage's production build serves no
  // WebSocket (webpack-hmr exists only in `next dev`), and the TrueNAS widget's
  // WebSocket is an outbound connection from the worker. Refuse every upgrade
  // on the raw socket before routing, so it can never wait for or hold a
  // renderer slot. Without this listener Node would hand the request to the
  // ordinary handler instead.
  server.on('upgrade', (req, socket) => {
    socket.on('error', () => {});
    socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nCache-Control: no-store\r\nContent-Length: 0\r\n\r\n', () => socket.destroy());
  });
  server.on('close', () => {
    if (!applicationClosing) void closeRenderer().catch(error => console.error('Renderer shutdown failed:', error.code || error.name));
  });
  let shutdownResult;
  function shutdown({ graceMs = 10000 } = {}) {
    if (shutdownResult) return shutdownResult;
    if (!Number.isInteger(graceMs) || graceMs < 0 || graceMs > 30000) throw new Error('Shutdown grace must be an integer from 0 to 30000 milliseconds.');
    applicationClosing = true;
    shutdownResult = (async () => {
      // HTTP close completion can precede upgraded-socket close handlers. Wait
      // for those handlers as well so every proxy lease is released before the
      // pool finishes and the process reports shutdown complete.
      const socketsClosed = Promise.all([...connections].map(socket => new Promise(resolveClosed => {
        if (socket.closed) resolveClosed(); else socket.once('close', resolveClosed);
      })));
      const timer = setTimeout(() => { for (const socket of connections) socket.destroy(); server.closeAllConnections(); }, graceMs);
      timer.unref();
      try {
        await new Promise((resolveClose, reject) => server.close(error => {
          if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') reject(error); else resolveClose();
        }));
        await socketsClosed;
        // Start-up work can still be writing to the state folder.
        await Promise.all([initialization, authInitialization]);
        await closeRenderer();
        await auth?.close();
      } finally { clearTimeout(timer); }
    })();
    return shutdownResult;
  }
  return { server, store: original.store, registry, initialization, rendererPool, shutdown, get dashboardHandlerCount() { return handlers.size; }, get nativeBodyBytesInFlight() { return nativeBodyBudget.used; } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  // A restore staged in Administration → Backups (or with server/backups.mjs)
  // is applied before anything reads the volumes.
  await applyPendingRestore({ ...studioRoots(), buildRevision: process.env.STUDIO_BUILD_REVISION });
  let restart = () => {};
  const { server, initialization, shutdown } = createStudioServer({ onRestoreStaged: () => restart() });
  const startup = await initialization;
  if (!startup.ok) console.error('Studio configuration startup requires attention:', startup.code);
  server.listen(port, '0.0.0.0', () => console.log('Homepage Studio listening on port ' + port));
  let closing = false;
  const close = () => {
    if (closing) return; closing = true;
    shutdown().then(() => process.exit(0), error => { console.error('Application shutdown failed:', error.code || error.name); process.exit(1); });
  };
  process.on('SIGINT', close); process.on('SIGTERM', close);
  // After a restore is staged the process ends, once the reply has gone out;
  // the container's restart policy starts it again and the restore applies.
  restart = () => setTimeout(close, 500);
}
