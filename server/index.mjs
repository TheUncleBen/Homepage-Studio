import http from 'node:http';
import https from 'node:https';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConfigStore, ConfigError } from './config.mjs';
import { BoardError } from './board.mjs';
import { createDiscoveryClient, DiscoveryError } from './discovery.mjs';

const base = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const studioVersion = (await readFile(join(base, 'VERSION'), 'utf8')).trim();
if (!studioVersion) throw new Error('VERSION must identify this Studio build.');
const hopHeaders = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
export const NATIVE_PROTOCOL = 1;
export const UPSTREAM_COMMIT = '51cc1684f9f34a7877ed462b8f94c9cc687b4dde';

function headersWithoutHop(headers) {
  const removed = new Set([...hopHeaders, ...String(headers.connection || '').split(',').map(s => s.trim().toLowerCase())]);
  return Object.fromEntries(Object.entries(headers).filter(([key]) => !removed.has(key.toLowerCase())));
}

function json(res, code, value) {
  const data = JSON.stringify(value);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-length': Buffer.byteLength(data) });
  res.end(data);
}

async function readBody(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) {
    throw Object.assign(new Error('Send JSON when saving changes.'), { status: 415 });
  }
  let length = 0;
  const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 2 * 1024 * 1024) throw Object.assign(new Error('This request exceeds the 2 MiB configuration limit.'), { status: 413 });
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('The request body is not valid JSON.'), { status: 400 }); }
  if (!value || Array.isArray(value) || typeof value !== 'object') throw Object.assign(new Error('Expected a configuration object.'), { status: 400 });
  return value;
}

export function createStudioServer(options = {}) {
  const configDir = resolve(options.configDir || process.env.HOMEPAGE_CONFIG_DIR || join(base, 'config'));
  const stateDir = resolve(options.stateDir || process.env.STUDIO_STATE_DIR || join(base, 'state'));
  const upstream = new URL(options.upstream || process.env.HOMEPAGE_UPSTREAM || 'http://homepage:3000');
  if (!['http:', 'https:'].includes(upstream.protocol) || upstream.username || upstream.password || upstream.pathname !== '/') throw new Error('HOMEPAGE_UPSTREAM must be an HTTP(S) origin such as http://homepage:3000.');
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
  const transport = upstream.protocol === 'https:' ? https : http;
  const backupRetention = options.backupRetention ?? (process.env.STUDIO_BACKUP_RETENTION === undefined ? undefined : Number(process.env.STUDIO_BACKUP_RETENTION));
  const discovery = createDiscoveryClient({ upstream: upstream.href });
  const store = createConfigStore({ configDir, stateDir, backupRetention, discoveryReader: (host) => discovery.read(host) });
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

  function checkNativeHttp(host) {
    return new Promise((resolve, reject) => {
      let timer;
      const finish = (error, value) => { clearTimeout(timer); error ? reject(error) : resolve(value); };
      const request = transport.request(upstream, { method: 'GET', path: '/api/studio/health', headers: { host } }, (response) => {
        let body = '';
        response.on('data', (chunk) => {
          body += chunk.toString('utf8');
          if (Buffer.byteLength(body) > 1024) request.destroy(new Error('Unexpected Homepage health response'));
        });
        response.on('error', finish);
        response.on('end', () => {
          let health;
          try { health = JSON.parse(body); } catch { /* Invalid bridge response. */ }
          const valid = response.statusCode === 200 && health?.protocolVersion === NATIVE_PROTOCOL && health?.upstreamCommit === UPSTREAM_COMMIT && health?.buildRevision === buildRevision;
          finish(valid ? undefined : new Error('Homepage Studio native bridge does not match this companion.'), health);
        });
      });
      request.on('error', finish);
      timer = setTimeout(() => request.destroy(new Error('Homepage health check timed out')), 3000);
      request.end();
    });
  }

  async function readiness(req, res, configurationOnly = false) {
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
    try { await checkNativeHttp(String(req.headers.host).toLowerCase()); }
    catch {
      return json(res, 503, {
        status: 'not_ready', code: 'HOMEPAGE_UNREACHABLE',
        error: 'The native renderer is unavailable or does not match this Studio build. Check both image versions, network and allowed hostname.',
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
    if (req.url.startsWith('/__studio/')) {
      if (req.headers['sec-fetch-site'] === 'cross-site') throw Object.assign(new Error('Open the editor from your dashboard.'), { status: 403 });
      if (req.headers.origin) {
        let origin;
        try { origin = new URL(req.headers.origin); } catch { throw Object.assign(new Error('Invalid request origin.'), { status: 403 }); }
        const expectedOrigin = publicOrigin?.origin || `http://${host}`;
        if (origin.origin !== expectedOrigin || origin.host.toLowerCase() !== host) throw Object.assign(new Error('Open the editor from your dashboard.'), { status: 403 });
      }
      if (!['GET', 'HEAD'].includes(req.method) && req.headers['x-studio-request'] !== '1') throw Object.assign(new Error('The save request is missing its editor header.'), { status: 403 });
    }
  }

  async function asset(req, res, name, contentType) {
    const text = await readFile(join(base, 'public', name), 'utf8');
    res.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-length': Buffer.byteLength(text) });
    res.end(req.method === 'HEAD' ? undefined : text);
  }

  function proxy(req, res) {
    const headers = headersWithoutHop(req.headers);
    // Preserve the browser's Host: Homepage validates that same explicit allowlist.
    const upstreamRequest = transport.request(upstream, { method: req.method, path: req.url, headers, timeout: 60000 }, upstreamResponse => {
      res.writeHead(upstreamResponse.statusCode || 502, headersWithoutHop(upstreamResponse.headers));
      upstreamResponse.pipe(res);
      upstreamResponse.on('error', () => res.destroy());
    });
    upstreamRequest.on('timeout', () => upstreamRequest.destroy(new Error('Upstream timeout')));
    upstreamRequest.on('error', () => {
      if (!res.headersSent) json(res, 502, { error: 'Homepage is not reachable yet. Check that both containers are running on the same Docker network.' });
      else res.destroy();
    });
    req.on('aborted', () => upstreamRequest.destroy());
    req.pipe(upstreamRequest);
  }

  const server = http.createServer(async (req, res) => {
    try {
      checkRequest(req);
      const path = req.url.split('?')[0];
      if ((path === '/__studio/health' || path === '/__studio/live') && req.method === 'GET') return json(res, 200, { status: 'ok', check: 'liveness', version: studioVersion });
      if (path === '/__studio/ready' && req.method === 'GET') return await readiness(req, res);
      if (path === '/__studio/config-ready' && req.method === 'GET') return await readiness(req, res, true);
      if (!path.startsWith('/__studio/')) await prepareNative();
      if (path === '/__studio/catalog.json' && req.method === 'GET') return await asset(req, res, 'catalog.json', 'application/json; charset=utf-8');
      if ((req.method === 'GET' && ['/__studio/api/state', '/__studio/api/board', '/__studio/api/export'].includes(path)) ||
          (req.method === 'POST' && ['/__studio/api/board', '/__studio/api/save', '/__studio/api/restore', '/__studio/api/service', '/__studio/api/info-widget', '/__studio/api/service-widget', '/__studio/api/bookmark', '/__studio/api/settings', '/__studio/api/discovery-visibility'].includes(path))) {
        await store.refreshDiscovery(String(req.headers.host).toLowerCase());
      }
      if (path === '/__studio/api/state' && req.method === 'GET') return json(res, 200, await store.load());
      if (path === '/__studio/api/board' && req.method === 'GET') return json(res, 200, await store.loadBoard());
      if (path === '/__studio/api/board' && req.method === 'POST') return json(res, 200, await store.saveBoard(await readBody(req)));
      if (path === '/__studio/api/export' && req.method === 'GET') return json(res, 200, await store.exportCurrent());
      if (path === '/__studio/api/backups' && req.method === 'GET') return json(res, 200, await store.listBackups());
      if (path.startsWith('/__studio/api/backups/') && req.method === 'GET') return json(res, 200, await store.exportBackup(path.slice('/__studio/api/backups/'.length)));
      if (path === '/__studio/api/restore' && req.method === 'POST') return json(res, 200, await store.restoreBackup(await readBody(req)));
      if (path === '/__studio/api/save' && req.method === 'POST') return json(res, 200, await store.save(await readBody(req)));
      if (path === '/__studio/api/service' && req.method === 'POST') return json(res, 200, await store.mutateService(await readBody(req)));
      if (path === '/__studio/api/info-widget' && req.method === 'POST') return json(res, 200, await store.mutateInfoWidget(await readBody(req)));
      if (path === '/__studio/api/service-widget' && req.method === 'POST') return json(res, 200, await store.mutateServiceWidget(await readBody(req)));
      if (path === '/__studio/api/bookmark' && req.method === 'POST') return json(res, 200, await store.mutateBookmark(await readBody(req)));
      if (path === '/__studio/api/settings' && req.method === 'POST') return json(res, 200, await store.mutateSettings(await readBody(req)));
      if (path === '/__studio/api/discovery-visibility' && req.method === 'POST') return json(res, 200, await store.mutateDiscoveryVisibility(await readBody(req)));
      if (path.startsWith('/__studio/')) return json(res, 404, { error: 'This editor endpoint does not exist.' });
      proxy(req, res);
    } catch (error) {
      const status = Number(error.status || error.statusCode) || 500;
      json(res, status, { error: status < 500 || error instanceof ConfigError || error instanceof BoardError || error instanceof DiscoveryError ? error.message : 'The editor could not read or save its configuration. Check the configuration and state volume permissions.', code: error.code || 'EDITOR_ERROR' });
      if (status >= 500) console.error('Editor request failed:', error.code || error.name);
    }
  });

  server.on('upgrade', async (req, socket, head) => {
    try { checkRequest(req); } catch { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
    if (req.url.startsWith('/__studio/')) { socket.destroy(); return; }
    try { await prepareNative(); }
    catch { socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'); return; }
    if (socket.destroyed) return;
    const request = transport.request(upstream, { method: req.method, path: req.url, headers: req.headers });
    request.on('upgrade', (response, upstreamSocket, upstreamHead) => {
      const lines = [`HTTP/1.1 ${response.statusCode} ${response.statusMessage}`];
      for (const [key, value] of Object.entries(response.headers)) lines.push(`${key}: ${Array.isArray(value) ? value.join(', ') : value}`);
      socket.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (upstreamHead.length) socket.write(upstreamHead);
      if (head.length) upstreamSocket.write(head);
      upstreamSocket.pipe(socket).pipe(upstreamSocket);
      upstreamSocket.on('error', () => socket.destroy());
      socket.on('error', () => upstreamSocket.destroy());
    });
    request.on('response', response => { response.resume(); socket.destroy(); });
    request.on('error', () => socket.destroy());
    request.end();
  });

  return { server, store, initialization };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3001);
  const { server, initialization } = createStudioServer();
  const startup = await initialization;
  if (!startup.ok) console.error('Studio configuration startup requires attention:', startup.code);
  server.listen(port, '0.0.0.0', () => console.log(`Homepage Eggplant Studio listening on port ${port}`));
  const close = () => server.close(() => process.exit(0));
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
}
