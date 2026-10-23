import http from 'node:http';
import https from 'node:https';
import fs, { readFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConfigStore, ConfigError, MAX_IMPORT_BYTES } from './config.mjs';
import { BoardError } from './board.mjs';
import { createDiscoveryClient, DiscoveryError } from './discovery.mjs';
import { createDashboardRegistry, resolveDashboardRoute } from './dashboards.mjs';
import { DashboardError, dashboardConfigDir, dashboardStateDir, dashboardBasePath } from './dashboard-paths.mjs';
import { createRendererPool, RendererError } from './renderer-pool.mjs';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import zlib from 'node:zlib';
import { serveSharedAsset, acceptedEncodings, etagMatches } from './static-assets.mjs';
import { checkApplicationReadiness } from './application-health.mjs';
import { renderRobotsPolicy } from './indexing-policy.mjs';

const base = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const studioVersion = (await readFile(join(base, 'VERSION'), 'utf8')).trim();
if (!studioVersion) throw new Error('VERSION must identify this Studio build.');
const hopHeaders = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
export const NATIVE_PROTOCOL = 1;
export const UPSTREAM_COMMIT = '51cc1684f9f34a7877ed462b8f94c9cc687b4dde';
// Native API routes use Next.js's default 1 MB body parser; this cap only bounds
// what the controller buffers before it asks for a worker.
export const NATIVE_BODY_LIMIT = 4 * 1024 * 1024;
const NATIVE_BODY_TIMEOUT_MS = 30000;
// Response headers the controller owns. A native response cannot replace them.
const CONTROLLER_HEADERS = ['x-frame-options', 'x-content-type-options', 'referrer-policy'];

// STUDIO_FRAME_ANCESTORS replaces the default `frame-ancestors 'self'` list.
// Unset or blank keeps the default. Each whitespace-separated entry must be
// 'self' or an exact http(s) origin; anything else stops startup.
export function parseFrameAncestors(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  return text.split(/\s+/).map(token => {
    if (token === "'self'") return token;
    let url;
    try { url = /^https?:\/\//i.test(token) && !token.includes('*') ? new URL(token) : undefined; } catch { /* Rejected below. */ }
    if (!url || url.username || url.password || url.pathname !== '/' || url.search || url.hash || !/^https?:\/\/[^/?#]+\/?$/i.test(token)) {
      throw new Error(`STUDIO_FRAME_ANCESTORS entry "${token}" is not 'self' or an exact http(s) origin such as https://home.example.test:8123.`);
    }
    return url.origin;
  });
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
  if (/^\/(?:[^/]+\/)?(?:api|__studio)(?:\/|$)/.test(path)) return false;
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
<p>Its address may have changed, or it may have been archived. Open the main dashboard, then choose the dashboard you need from its dashboard list.</p>
<a href="/">Open the main dashboard</a>
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

// Receive a proxied native request body before a worker lease is taken, so a
// slow or stalled upload cannot hold a renderer slot.
function readNativeBody(req, { limit = NATIVE_BODY_LIMIT, timeoutMs = NATIVE_BODY_TIMEOUT_MS } = {}) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let length = 0, done = false;
    const finish = (error, value) => {
      if (done) return; done = true;
      clearTimeout(timer);
      req.off('data', data); req.off('end', end); req.off('error', failed); req.off('aborted', aborted); req.off('close', aborted);
      if (error) { req.pause(); reject(error); } else resolveBody(value);
    };
    const fail = (message, status, code) => finish(Object.assign(new Error(message), { status, code, closeConnection: true }));
    const data = chunk => {
      length += chunk.length;
      if (length > limit) fail(`This request exceeds the ${limit / (1024 * 1024)} MiB dashboard request limit.`, 413, 'REQUEST_TOO_LARGE');
      else chunks.push(chunk);
    };
    const end = () => finish(undefined, Buffer.concat(chunks));
    const failed = error => finish(error);
    const aborted = () => finish(Object.assign(new Error('The request was cancelled.'), { status: 400, code: 'REQUEST_ABORTED' }));
    const timer = setTimeout(() => fail('The request body was not received in time. Retry the action.', 408, 'REQUEST_BODY_TIMEOUT'), timeoutMs);
    req.on('data', data); req.once('end', end); req.once('error', failed); req.once('aborted', aborted); req.once('close', aborted);
  });
}

async function readBody(req, maxBytes = 2 * 1024 * 1024) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) {
    throw Object.assign(new Error('Send JSON when saving changes.'), { status: 415 });
  }
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
    const editor = req.url.startsWith('/__studio/');
    if (editor || req.url.startsWith('/api/')) {
      if (['cross-site', 'same-site'].includes(req.headers['sec-fetch-site'])) throw Object.assign(new Error('Open this request from your dashboard.'), { status: 403 });
      if (req.headers.origin) {
        let origin;
        try { origin = new URL(req.headers.origin); } catch { throw Object.assign(new Error('Invalid request origin.'), { status: 403 }); }
        const expectedOrigin = publicOrigin?.origin || `http://${host}`;
        if (origin.origin !== expectedOrigin || origin.host.toLowerCase() !== host) throw Object.assign(new Error('Open the editor from your dashboard.'), { status: 403 });
      }
      if (editor && !['GET', 'HEAD'].includes(req.method) && req.headers['x-studio-request'] !== '1') throw Object.assign(new Error('The save request is missing its editor header.'), { status: 403 });
    }
  }

  async function proxy(req, res, dashboard) {
    if (res.destroyed || req.aborted) return;
    const basePath = dashboardBasePath(dashboard);
    const host = String(req.headers.host).toLowerCase();
    const hasBody = req.headers['transfer-encoding'] !== undefined || Number(req.headers['content-length'] || 0) > 0;
    const body = hasBody ? await readNativeBody(req, { timeoutMs: options.nativeBodyTimeoutMs }) : undefined;
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
    const headers = Object.fromEntries(Object.entries(headersWithoutHop(req.headers)).filter(([key]) => !key.startsWith('x-studio-')));
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
      if ((path === '/__studio/health' || path === '/__studio/live') && req.method === 'GET') return json(res, 200, { status: 'ok', check: 'liveness', version: studioVersion });
      if (path === '/__studio/ready' && req.method === 'GET') return await readiness(req, res, dashboard);
      if (path === '/__studio/config-ready' && req.method === 'GET') return await readiness(req, res, dashboard, true);
      if (!path.startsWith('/__studio/')) await prepareNative();
      if (path === '/__studio/catalog.json' && ['GET', 'HEAD'].includes(req.method)) return await serveCatalog(req, res);
      const saveChange = path === '/__studio/api/save' && req.method === 'POST' ? await readBody(req) : undefined;
      // Complete board replacements must validate against newly discovered
      // membership. Structured/native-file edits use their revision-checked
      // local sources and retained discovery identities, without a provider wait.
      if ((req.method === 'GET' && ['/__studio/api/state', '/__studio/api/board', '/__studio/api/export'].includes(path)) ||
          (req.method === 'POST' && (path === '/__studio/api/board' || (saveChange && Object.hasOwn(saveChange, 'board'))))) {
        await store.refreshDiscovery(String(req.headers.host).toLowerCase(), dashboard);
      }
      if (path === '/__studio/api/state' && req.method === 'GET') return json(res, 200, await store.load());
      if (path === '/__studio/api/board' && req.method === 'GET') return json(res, 200, await store.loadBoard());
      if (path === '/__studio/api/board' && req.method === 'POST') return json(res, 200, await store.saveBoard(await readBody(req)));
      if (path === '/__studio/api/export' && req.method === 'GET') return json(res, 200, await store.exportCurrent());
      if (path === '/__studio/api/backups' && req.method === 'GET') return json(res, 200, await store.listBackups());
      if (path.startsWith('/__studio/api/backups/') && req.method === 'GET') return json(res, 200, await store.exportBackup(path.slice('/__studio/api/backups/'.length)));
      if (path === '/__studio/api/restore' && req.method === 'POST') return json(res, 200, await store.restoreBackup(await readBody(req)));
      if (path === '/__studio/api/import' && req.method === 'POST') return json(res, 200, await store.importArchive(await readBody(req, MAX_IMPORT_BYTES)));
      if (path === '/__studio/api/save' && req.method === 'POST') return json(res, 200, await store.save(saveChange));
      if (path === '/__studio/api/service' && req.method === 'POST') return json(res, 200, await store.mutateService(await readBody(req)));
      if (path === '/__studio/api/info-widget' && req.method === 'POST') return json(res, 200, await store.mutateInfoWidget(await readBody(req)));
      if (path === '/__studio/api/service-widget' && req.method === 'POST') return json(res, 200, await store.mutateServiceWidget(await readBody(req)));
      if (path === '/__studio/api/bookmark' && req.method === 'POST') return json(res, 200, await store.mutateBookmark(await readBody(req)));
      if (path === '/__studio/api/settings' && req.method === 'POST') return json(res, 200, await store.mutateSettings(await readBody(req)));
      if (path === '/__studio/api/discovery-visibility' && req.method === 'POST') return json(res, 200, await store.mutateDiscoveryVisibility(await readBody(req)));
      if (path.startsWith('/__studio/')) return json(res, 404, { error: 'This editor endpoint does not exist.' });
      await proxy(req, res, dashboard);
    } catch (error) {
      const status = Number(error.status || error.statusCode) || 500;
      if (error.closeConnection && !res.headersSent) res.setHeader('connection', 'close');
      json(res, status, { error: status < 500 || error instanceof ConfigError || error instanceof BoardError || error instanceof DiscoveryError || error instanceof RendererError ? error.message : 'The editor could not read or save its configuration. Check the configuration and state volume permissions.', code: error.code || 'EDITOR_ERROR',
        // ConfigError details are structured and source-free (file names, YAML error codes and positions, limits),
        // so editors can point at the failing line without the response ever echoing configuration text.
        details: error instanceof ConfigError ? error.details : undefined });
      if (status >= 500) console.error('Editor request failed:', error.code || error.name);
    }
  }

  async function upgrade(req, socket, head, dashboard) {
    checkRequest(req);
    if (req.url.startsWith('/__studio/')) { socket.destroy(); return; }
    await prepareNative();
    if (socket.destroyed) return;
    const lease = await acquireNative(String(req.headers.host).toLowerCase(), dashboard);
    let released = false;
    const release = () => { if (!released) { released = true; lease.release(); } };
    let request, upstreamSocket;
    const abandon = () => { request?.destroy(); upstreamSocket?.destroy(); release(); };
    socket.once('close', abandon);
    socket.once('error', abandon);
    socket.once('end', () => upstreamSocket?.end());
    if (socket.destroyed) { abandon(); return; }
    const upstream = lease.origin;
    const transport = upstream.protocol === 'https:' ? https : http;
    const headers = Object.fromEntries(Object.entries(req.headers).filter(([key]) => !key.startsWith('x-studio-')));
    try { request = transport.request(upstream, { method: req.method, path: req.url, headers, timeout: 60000 }); }
    catch (error) { abandon(); throw error; }
    request.on('upgrade', (response, peer, upstreamHead) => {
      upstreamSocket = peer;
      if (socket.destroyed) { abandon(); return; }
      const lines = ['HTTP/1.1 ' + response.statusCode + ' ' + response.statusMessage];
      for (let i = 0; i < response.rawHeaders.length; i += 2) lines.push(response.rawHeaders[i] + ': ' + response.rawHeaders[i + 1]);
      socket.write(lines.join('\r\n') + '\r\n\r\n');
      if (upstreamHead.length) socket.write(upstreamHead);
      if (head.length) peer.write(head);
      peer.pipe(socket).pipe(peer);
      peer.once('close', () => { socket.destroy(); release(); });
      peer.once('end', () => socket.end());
      peer.once('error', () => socket.destroy());
    });
    request.on('response', response => { response.resume(); socket.destroy(); release(); });
    request.on('error', () => { socket.destroy(); release(); });
    request.on('timeout', () => request.destroy(new Error('Native upgrade timed out')));
    request.end();
  }
  return { handle, upgrade, checkRequest, store, initialization };
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
  rendererPool ||= createRendererPool({ configRoot, appRoot: rendererDir, allowedHosts: options.allowedHosts, buildRevision: options.buildRevision });
  const handlers = new Map();
  const unpublished = new Map();
  let rendererClosed, applicationClosing = false;
  const closeRenderer = () => (rendererClosed ||= Promise.resolve().then(() => rendererPool.close?.()));
  function forDashboard(entry) {
    let handler = handlers.get(entry.id);
    if (!handler) {
      handler = createDashboardHandlers({ ...options, rendererPool, configDir: dashboardConfigDir(configRoot, entry.id), stateDir: dashboardStateDir(stateRoot, entry.id) });
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
    let archive;
    if (source) {
      const sourceHandler = forDashboard(source);
      await sourceHandler.initialization;
      archive = await sourceHandler.store.exportCurrent();
    }
    const owned = isNew ? await allocateDashboard(entry) : null;
    const target = forDashboard(entry);
    if (owned) owned.handler = target;
    if (!(await target.initialization).ok) await target.store.initialize();
    if (archive) {
      const current = await target.store.load();
      await target.store.importArchive({ revision: current.revision, archive });
    }
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
  const server = http.createServer(async (req, res) => {
    for (const [name, value] of Object.entries(responseHeaders)) res.setHeader(name, value);
    try {
      original.checkRequest(req);
      const path = req.url.split('?')[0];
      if (['/__studio/live', '/__studio/health'].includes(path)) return await original.handle(req, res);
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
      const manifest = await prepareRegistry();
      if (path === '/__studio/application-ready') {
        if (req.method !== 'GET') return json(res, 405, { error: 'Use GET to check application readiness.' });
        if (applicationClosing) throw new DashboardError('The application is shutting down.', 'APPLICATION_SHUTTING_DOWN', 503);
        const checks = await checkApplicationReadiness({ configRoot, stateRoot, rendererDir });
        return json(res, 200, { status: 'ready', version: studioVersion, checks, buildRevision: options.buildRevision ?? process.env.STUDIO_BUILD_REVISION ?? 'unreleased', nativeProtocol: NATIVE_PROTOCOL, upstreamCommit: UPSTREAM_COMMIT });
      }
      if (path === '/__studio/api/dashboards') {
        if (req.method === 'GET') return json(res, 200, manifest);
        if (req.method !== 'POST') return json(res, 405, { error: 'Use GET or POST for dashboard management.' });
        const result = await registry.mutate(await readBody(req));
        unpublished.delete(result.dashboard.id);
        forDashboard(result.dashboard);
        const previous = manifest.dashboards.find(entry => entry.id === result.dashboard.id);
        if (previous && (previous.slug !== result.dashboard.slug || previous.archived !== result.dashboard.archived)) {
          try { await rendererPool.drain?.(result.dashboard.id); }
          catch (error) { console.error('Dashboard worker cleanup failed:', error.code || error.name); }
        }
        return json(res, 200, result);
      }
      if (['/__studio/ready', '/__studio/config-ready'].includes(path)) {
        const primary = manifest.dashboards.find(entry => entry.id === 'default');
        return await forDashboard(primary).handle(req, res, primary);
      }
      const route = resolveDashboardRoute(manifest, req.url);
      if (route.redirect) { res.writeHead(307, { location: route.redirect, 'cache-control': 'no-store' }); return res.end(); }
      req.url = route.path;
      if (route.shared) return await serveSharedAsset(req, res, rendererDir);
      return await forDashboard(route.dashboard).handle(req, res, route.dashboard);
    } catch (error) {
      if (error instanceof DashboardError && error.code === 'DASHBOARD_NOT_FOUND' && wantsHtmlPage(req)) return unavailablePage(req, res, Number(error.status) || 404);
      const diagnostic = req.url.split('?')[0].startsWith('/__studio/api/');
      const status = error instanceof ConfigError && !diagnostic ? 503 : Number(error.status || error.statusCode) || 500;
      json(res, status, { error: error instanceof DashboardError || error instanceof ConfigError || status < 500 ? error.message : 'The dashboard could not be opened. Check the application logs and persistent storage.', code: error.code || 'DASHBOARD_ERROR' });
    }
  });
  const connections = new Set();
  server.on('connection', socket => { connections.add(socket); socket.once('close', () => connections.delete(socket)); });
  server.on('upgrade', async (req, socket, head) => {
    try {
      original.checkRequest(req);
      const route = resolveDashboardRoute(await prepareRegistry(), req.url);
      if (route.redirect || route.shared) { socket.destroy(); return; }
      req.url = route.path;
      await forDashboard(route.dashboard).upgrade(req, socket, head, route.dashboard);
    } catch (error) {
      if (socket.destroyed) return;
      const requested = Number(error.status || error.statusCode);
      const status = [400, 403, 404].includes(requested) ? requested : 503;
      const reason = { 400: 'Bad Request', 403: 'Forbidden', 404: 'Not Found', 503: 'Service Unavailable' }[status];
      socket.end('HTTP/1.1 ' + status + ' ' + reason + '\r\nConnection: close\r\n\r\n');
    }
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
        await closeRenderer();
      } finally { clearTimeout(timer); }
    })();
    return shutdownResult;
  }
  return { server, store: original.store, registry, initialization, rendererPool, shutdown, get dashboardHandlerCount() { return handlers.size; } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  const { server, initialization, shutdown } = createStudioServer();
  const startup = await initialization;
  if (!startup.ok) console.error('Studio configuration startup requires attention:', startup.code);
  server.listen(port, '0.0.0.0', () => console.log('Homepage Studio listening on port ' + port));
  let closing = false;
  const close = () => {
    if (closing) return; closing = true;
    shutdown().then(() => process.exit(0), error => { console.error('Application shutdown failed:', error.code || error.name); process.exit(1); });
  };
  process.on('SIGINT', close); process.on('SIGTERM', close);
}
