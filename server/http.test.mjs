import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync, gunzipSync, brotliDecompressSync } from 'node:zlib';
import { createStudioServer, NATIVE_PROTOCOL, UPSTREAM_COMMIT } from './index.mjs';
import { createConfigStore, MAX_IMPORT_BYTES } from './config.mjs';
import { addressMainDashboard, seedMainAddress } from './fixtures/main-address.mjs';
// The main dashboard lives at /home. Its own addresses (native API, editor
// API, native data) move with it; Studio-wide addresses stay at the root.
const onPrimary = target => (/^\/(?:api\/|studio\/(?:api\/(?!dashboards|overview)|catalog\.json|edit|settings)|_next\/(?!static\/))/.test(target) ? '/home' + target : target);


const HOST = 'dashboard.example.test:3001';
const ORIGIN = `http://${HOST}`;

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
}

async function close(server) {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
}

async function setup(t, serverOptions = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'homepage-studio-http-'));
  const configDir = path.join(directory, 'config');
  const stateDir = path.join(directory, 'state');
  await fs.mkdir(configDir);
  await fs.writeFile(path.join(configDir, 'services.yaml'), '# Original services\n[]\n');
  await fs.writeFile(path.join(configDir, 'widgets.yaml'), '[]\n');
  await fs.writeFile(path.join(configDir, 'settings.yaml'), 'title: Original dashboard\n');
  await fs.writeFile(path.join(configDir, 'bookmarks.yaml'), '[]\n');
  for (const file of ['docker.yaml', 'kubernetes.yaml', 'proxmox.yaml']) await fs.writeFile(path.join(configDir, file), '{}\n');
  await fs.writeFile(path.join(configDir, 'custom.css'), '/* Existing theme */\n.existing { color: rebeccapurple; }');
  await fs.writeFile(path.join(configDir, 'custom.js'), 'window.existingHomepageScript = true; // preserve existing behavior');
  const upstreamCalls = [];
  const compressed = gzipSync('Native Homepage resource\u0000binary bytes');
  const upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const echo = { method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') };
    upstreamCalls.push(echo);
    if (req.url === '/api/studio/health') {
      res.writeHead(serverOptions.nativeHealthStatus ?? 200, { 'content-type': 'application/json' });
      return res.end(serverOptions.nativeHealthBody ?? JSON.stringify({ protocolVersion: NATIVE_PROTOCOL, upstreamCommit: UPSTREAM_COMMIT, buildRevision: serverOptions.buildRevision ?? 'unreleased' }));
    }
    if (req.url === '/api/studio/sources') {
      await serverOptions.beforeNativeDiscovery?.();
      res.writeHead(serverOptions.nativeDiscoveryStatus ?? 200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ protocolVersion: NATIVE_PROTOCOL, upstreamCommit: UPSTREAM_COMMIT, sources: serverOptions.nativeDiscoveredSources ?? [], warnings: [] }));
    }
    if (req.url.split('?')[0] === '/api/config/custom.css' || req.url.split('?')[0] === '/api/config/custom.js') {
      const name = req.url.split('?')[0].endsWith('.css') ? 'custom.css' : 'custom.js';
      const body = await fs.readFile(path.join(configDir, name));
      res.writeHead(200, { 'content-type': name.endsWith('.css') ? 'text/css' : 'application/javascript', 'content-length': body.length, 'cache-control': 'no-store' });
      return res.end(req.method === 'HEAD' ? undefined : body);
    }
    if (req.url === '/api/native-config') return res.end(await fs.readFile(path.join(configDir, 'services.yaml'), 'utf8'));
    if (req.url === '/api/native.gz') {
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-encoding': 'gzip', 'content-length': compressed.length, etag: '"native-etag"' });
      return res.end(compressed);
    }
    if (req.url === '/api/native-missing') {
      res.writeHead(404, { 'content-type': 'application/json' });
      return res.end('{"native":"missing"}');
    }
    res.writeHead(207, {
      'content-type': 'application/json',
      'x-native-header': 'preserved',
      'x-upstream-hop': 'must-not-forward',
      connection: 'close, x-upstream-hop',
      'set-cookie': ['native-one=1; Path=/; HttpOnly', 'native-two=2; Path=/; SameSite=Lax'],
    });
    res.end(JSON.stringify(echo));
  });
  const upstreamPort = await listen(upstream);
  // Fixtures that break storage before startup get the main dashboard's
  // address written ahead; the others set it through the API.
  if (serverOptions.beforeServer) await seedMainAddress(configDir);
  await serverOptions.beforeServer?.({ configDir, stateDir });
  const { server, store, initialization } = createStudioServer({ configDir, stateDir, upstream: `http://127.0.0.1:${upstreamPort}`, allowedHosts: HOST, auth: 'off', ...serverOptions });
  const port = await listen(server);
  if (!serverOptions.beforeServer) await addressMainDashboard({ port, host: HOST, origin: serverOptions.publicOrigin ?? ORIGIN });
  t.after(async () => {
    await close(server);
    await close(upstream);
    await initialization;
    await fs.rm(directory, { recursive: true, force: true });
  });

  function request(target, { method = 'GET', headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: onPrimary(target), method, agent: false, headers: { host: HOST, ...headers } }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('error', reject);
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          const text = buffer.toString('utf8');
          let json;
          try { json = JSON.parse(text); } catch {}
          resolve({ status: res.statusCode, headers: res.headers, buffer, text, json });
        });
      });
      req.on('error', reject);
      req.setTimeout(5000, () => req.destroy(new Error('The isolated HTTP test request timed out.')));
      req.end(body);
    });
  }
  const post = (target, value, extra = {}) => request(target, {
    method: 'POST',
    body: JSON.stringify(value),
    ...extra,
    headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-studio-request': '1', ...extra.headers },
  });
  return { request, post, store, configDir, stateDir, upstream, upstreamCalls, compressed, initialization };
}

test('native requests preserve method, query, body, Host, credentials and response metadata', async (t) => {
  const { request, upstreamCalls } = await setup(t);
  const body = '{"native":"payload","number":42}';
  const response = await request('/api/native-action?query=a%2Fb&count=2', {
    method: 'POST', body,
    headers: {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
      authorization: 'Bearer test-native-token',
      cookie: 'native-session=test-value',
      'x-browser-hop': 'must-not-forward',
      connection: 'close, x-browser-hop',
    },
  });
  assert.equal(response.status, 207);
  assert.equal(response.json.method, 'POST');
  assert.equal(response.json.url, '/api/native-action?query=a%2Fb&count=2');
  assert.equal(response.json.body, body);
  assert.equal(response.json.headers.host, HOST);
  assert.equal(response.json.headers.authorization, 'Bearer test-native-token');
  assert.equal(response.json.headers.cookie, 'native-session=test-value');
  assert.equal(response.json.headers['x-browser-hop'], undefined);
  assert.equal(response.headers['x-native-header'], 'preserved');
  assert.equal(response.headers['x-upstream-hop'], undefined);
  assert.deepEqual(response.headers['set-cookie'], ['native-one=1; Path=/; HttpOnly', 'native-two=2; Path=/; SameSite=Lax']);
  assert.equal(upstreamCalls.length, 1);
});

test('native compressed bytes and native error status pass through unchanged', async (t) => {
  const { request, compressed } = await setup(t);
  const binary = await request('/api/native.gz');
  assert.deepEqual(binary.buffer, compressed);
  assert.equal(binary.headers['content-encoding'], 'gzip');
  assert.equal(binary.headers.etag, '"native-etag"');
  const missing = await request('/api/native-missing');
  assert.equal(missing.status, 404);
  assert.deepEqual(missing.json, { native: 'missing' });
});

test('native custom CSS and JS pass through unchanged without injecting the legacy editor', async (t) => {
  const { request, upstreamCalls, configDir } = await setup(t);
  const css = await request('/api/config/custom.css?fresh=1');
  assert.equal(css.status, 200);
  assert.match(css.headers['content-type'], /^text\/css/);
  assert.equal(css.text, await fs.readFile(path.join(configDir, 'custom.css'), 'utf8'));
  assert.equal(css.headers['cache-control'], 'no-store');
  const js = await request('/api/config/custom.js');
  assert.equal(js.status, 200);
  const original = await fs.readFile(path.join(configDir, 'custom.js'), 'utf8');
  assert.equal(js.text, original);
  assert.match(js.headers['content-type'], /javascript/);
  const head = await request('/api/config/custom.js', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.buffer.length, 0);
  assert.equal(Number(head.headers['content-length']), js.buffer.length);
  assert.equal(upstreamCalls.length, 3, 'The native renderer owns custom assets and Studio React UI.');
});

test('Host allowlist matches the exact hostname and port on both native and editor routes', async (t) => {
  const { request, upstreamCalls } = await setup(t);
  for (const host of ['dashboard.example.test', 'dashboard.example.test:3000', 'other.example.test:3001', `${HOST}.attacker.test`]) {
    for (const target of ['/', '/studio/api/state']) {
      const result = await request(target, { headers: { host } });
      assert.equal(result.status, 403, `${target} must reject Host ${host}`);
    }
  }
  assert.equal(upstreamCalls.length, 0);
  assert.equal((await request('/studio/health', { headers: { host: HOST.toUpperCase() } })).status, 200);
});

test('editor reads reject cross-site, malformed, opaque and wrong-host origins', async (t) => {
  const { request } = await setup(t);
  for (const headers of [
    { origin: 'http://other.example.test:3001' },
    { origin: 'http://dashboard.example.test:3000' },
    { origin: 'null' },
    { origin: 'not-an-origin' },
    { origin: `ftp://${HOST}` },
    { 'sec-fetch-site': 'cross-site' },
    { origin: ORIGIN, 'sec-fetch-site': 'cross-site' },
  ]) assert.equal((await request('/studio/api/state', { headers })).status, 403);
  assert.equal((await request('/studio/api/state', { headers: { origin: ORIGIN, 'sec-fetch-site': 'same-origin' } })).status, 200);
  assert.equal((await request('/studio/api/state')).status, 200, 'Direct local clients without Origin are intentionally permitted.');
});

test('a same-host origin with a different scheme is not treated as same-origin', async (t) => {
  const { request } = await setup(t);
  const response = await request('/studio/api/state', { headers: { origin: `https://${HOST}`, 'x-forwarded-proto': 'https' } });
  assert.equal(response.status, 403);
});

test('native integration requests reject foreign browser contexts before dispatching an action', async (t) => {
  const { request, upstreamCalls } = await setup(t);
  const target = '/api/services/proxy?group=Media&service=Server&endpoint=Pause';
  for (const method of ['GET', 'POST']) for (const headers of [
    { origin: 'http://unrelated.example.test' },
    { origin: 'null' },
    { origin: 'not-an-origin' },
    { origin: `https://${HOST}` },
    { 'sec-fetch-site': 'cross-site' },
    { 'sec-fetch-site': 'same-site' },
    { origin: ORIGIN, 'sec-fetch-site': 'cross-site' },
  ]) {
    const response = await request(target, { method, headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: method === 'POST' ? 'ignored=1' : undefined });
    assert.equal(response.status, 403);
  }
  assert.equal(upstreamCalls.length, 0, 'Rejected media actions must never contact the native renderer.');
  assert.equal((await request(target, { method: 'POST', headers: { origin: ORIGIN, 'sec-fetch-site': 'same-origin' } })).status, 207);
  assert.equal((await request(target)).status, 207, 'Direct local clients without browser Origin remain supported.');
});

test('an explicitly configured public HTTPS origin works without trusting forwarded protocol headers', async (t) => {
  const { request, post } = await setup(t, { publicOrigin: `https://${HOST}` });
  const initial = await request('/studio/api/state', { headers: { origin: `https://${HOST}`, 'x-forwarded-proto': 'http' } });
  assert.equal(initial.status, 200);
  assert.equal((await request('/studio/api/state', { headers: { origin: ORIGIN, 'x-forwarded-proto': 'https' } })).status, 403);
  const saved = await post('/studio/api/save', { revision: initial.json.revision, settingsYaml: 'title: TLS proxy dashboard\n' }, { headers: { origin: `https://${HOST}` } });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.settingsYaml, 'title: TLS proxy dashboard\n');
});

test('write header is required and invalid requests do not modify configuration', async (t) => {
  const { request } = await setup(t);
  const initial = (await request('/studio/api/state')).json;
  for (const header of [undefined, 'true', '0']) {
    const headers = { 'content-type': 'application/json', origin: ORIGIN };
    if (header !== undefined) headers['x-studio-request'] = header;
    const result = await request('/studio/api/save', { method: 'POST', headers, body: JSON.stringify({ revision: initial.revision, settingsYaml: 'title: Must not be saved\n' }) });
    assert.equal(result.status, 403);
  }
  assert.equal((await request('/studio/api/state')).json.revision, initial.revision);
});

test('JSON content type and body validation return practical errors without writing', async (t) => {
  const { request } = await setup(t);
  const initial = (await request('/studio/api/state')).json;
  for (const [body, contentType, status] of [
    ['revision=something', 'application/x-www-form-urlencoded', 415],
    ['not-json', 'application/json', 400],
    ['[]', 'application/json', 400],
    ['null', 'application/json', 400],
  ]) {
    const result = await request('/studio/api/save', { method: 'POST', headers: { 'content-type': contentType, origin: ORIGIN, 'x-studio-request': '1' }, body });
    assert.equal(result.status, status);
    assert.equal(result.headers['cache-control'], 'no-store');
  }
  assert.equal((await request('/studio/api/state')).json.revision, initial.revision);
});

test('oversized JSON receives HTTP 413 and leaves state untouched', async (t) => {
  const { request } = await setup(t);
  const before = (await request('/studio/api/state')).json;
  const body = JSON.stringify({ revision: before.revision, servicesYaml: ' '.repeat(2 * 1024 * 1024 + 1024) });
  const result = await request('/studio/api/save', {
    method: 'POST', body,
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), origin: ORIGIN, 'x-studio-request': '1' },
  });
  assert.equal(result.status, 413);
  assert.equal((await request('/studio/api/state')).json.revision, before.revision);
});

test('complete dashboard import accepts JSON escaping overhead and retains the ordinary mutation request limit', async (t) => {
  const { request, post, store } = await setup(t);
  const before = (await request('/studio/api/state')).json;
  const archive = (await request('/studio/api/export')).json;
  // A valid native text file below 2 MiB can exceed 2 MiB once JSON-escaped.
  const css = `/*${'"'.repeat(1100 * 1024)}*/`;
  archive.files['custom.css'] = css;
  const value = { revision: before.revision, archive };
  assert.ok(Buffer.byteLength(css) < 2 * 1024 * 1024);
  assert.ok(Buffer.byteLength(JSON.stringify(value)) > 2 * 1024 * 1024);
  const ordinary = await post('/studio/api/save', { revision: before.revision, customCss: css });
  assert.equal(ordinary.status, 413);
  assert.equal((await store.listBackups()).length, 0);
  for (const headers of [
    { origin: 'https://other.example.test' },
    { 'x-studio-request': '' },
    { host: 'other.example.test' },
  ]) assert.equal((await post('/studio/api/import', value, { headers })).status, 403);
  assert.equal((await store.listBackups()).length, 0);
  const result = await post('/studio/api/import', value);
  assert.equal(result.status, 200);
  assert.equal(result.json.customCss, css);
  assert.equal(result.headers['cache-control'], 'no-store');
  assert.deepEqual(result.json.board, before.board);
  assert.equal((await store.listBackups()).length, 1);
  assert.equal((await post('/studio/api/import', value)).status, 409);
});

test('dashboard import rejects its aggregate request limit before creating a snapshot', async (t) => {
  const { request, store } = await setup(t);
  const before = (await request('/studio/api/state')).json;
  const body = JSON.stringify({ revision: before.revision, archive: { padding: 'x'.repeat(MAX_IMPORT_BYTES) } });
  const result = await request('/studio/api/import', {
    method: 'POST', body,
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), origin: ORIGIN, 'x-studio-request': '1' },
  });
  assert.equal(result.status, 413);
  assert.match(result.json.error, /40 MiB dashboard import limit/);
  assert.equal((await store.load()).revision, before.revision);
  assert.equal((await store.listBackups()).length, 0);
});

test('HTTP state, native service and info-widget mutations, stale revisions, backups and restore work end to end', async (t) => {
  const { request, post, upstreamCalls } = await setup(t);
  const before = (await request('/studio/api/state')).json;
  assert.equal(before.services.length, 0);
  let result = await post('/studio/api/service', {
    revision: before.revision, action: 'add', name: 'Portainer', group: ['Infrastructure', 'Containers'],
    config: { href: 'https://portainer.example.test', widget: { type: 'portainer', url: 'http://portainer.internal', env: 1, key: '{{HOMEPAGE_FILE_PORTAINER_KEY}}' } },
  });
  assert.equal(result.status, 200);
  assert.equal(result.json.services[0].name, 'Portainer');
  const tile = result.json.services[0];
  assert.deepEqual(tile.groupPath, ['Infrastructure', 'Containers']);
  const stale = await post('/studio/api/save', { revision: before.revision, settingsYaml: 'title: Stale edit\n' });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.code, 'REVISION_CONFLICT');
  assert.equal(stale.json.details.currentRevision, result.json.revision);
  result = await post('/studio/api/service', { revision: result.json.revision, action: 'update', id: tile.id, name: 'Container management', config: { description: 'Native integration' } });
  assert.equal(result.status, 200);
  assert.equal(result.json.services[0].id, tile.id);
  assert.equal(result.json.services[0].config.widget.key, '{{HOMEPAGE_FILE_PORTAINER_KEY}}');
  result = await post('/studio/api/info-widget', { revision: result.json.revision, action: 'add', type: 'datetime', config: { text_size: 'xl' } });
  assert.equal(result.status, 200);
  assert.equal(result.json.infoWidgets[0].type, 'datetime');
  result = await post('/studio/api/save', { revision: result.json.revision, layout: { version: 1, items: { [tile.id]: { x: 1, y: 3, w: 5, h: 4 } } } });
  assert.equal(result.status, 200);
  assert.deepEqual(result.json.layout.items[tile.id], { x: 1, y: 3, w: 5, h: 4 });
  const invalid = await post('/studio/api/save', { revision: result.json.revision, servicesYaml: '- broken: [unterminated' });
  assert.equal(invalid.status, 422);
  assert.equal(invalid.json.code, 'INVALID_YAML');
  assert.equal(invalid.json.details.file, 'services.yaml');
  assert.ok(invalid.json.details.errors.length > 0);
  for (const detail of invalid.json.details.errors) {
    assert.deepEqual(Object.keys(detail).sort(), ['code', 'column', 'line']);
    assert.ok(Number.isInteger(detail.line) && Number.isInteger(detail.column));
  }
  const secretSource = '- Secret:\n    - App:\n        href: https://app.example.test\n        widget: { type: customapi, key: inline-secret-value, url: [unterminated\n';
  const secretInvalid = await post('/studio/api/save', { revision: result.json.revision, servicesYaml: secretSource });
  assert.equal(secretInvalid.status, 422);
  assert.equal(secretInvalid.json.code, 'INVALID_YAML');
  assert.ok(secretInvalid.json.details.errors[0].line >= 1);
  assert.doesNotMatch(JSON.stringify(secretInvalid.json), /inline-secret-value|unterminated|app\.example\.test/, 'YAML error responses must carry positions only, never source text.');
  assert.equal((await request('/studio/api/state')).json.revision, result.json.revision);
  const backups = await request('/studio/api/backups');
  assert.equal(backups.status, 200);
  assert.equal(backups.json.length, 4);
  assert.ok(backups.json.every((backup) => !('before' in backup)), 'Listing must return metadata rather than raw backup credentials.');
  const first = backups.json.find((backup) => backup.revision === before.revision);
  const restored = await post('/studio/api/restore', { revision: result.json.revision, backupId: first.id });
  assert.equal(restored.status, 200);
  assert.equal(restored.json.servicesYaml, before.servicesYaml);
  assert.deepEqual(restored.json.services, []);
  assert.deepEqual(restored.json.infoWidgets, []);
  assert.deepEqual(restored.json.layout, before.layout);
  assert.equal((await request('/studio/api/backups')).json.length, 5);
  assert.ok(upstreamCalls.length > 0);
  assert.ok(upstreamCalls.every((call) => call.method === 'GET' && call.url === '/api/studio/sources'), 'Editor mutations may read safe discovery metadata but must not invoke native mutation/integration endpoints.');
});

test('unknown editor endpoints are local 404s and do not fall through to Homepage', async (t) => {
  const { request, post, upstreamCalls } = await setup(t);
  assert.equal((await request('/studio/not-a-route')).status, 404);
  assert.equal((await post('/studio/api/not-a-route', {})).status, 404);
  assert.equal((await request('/studio/api/state', { method: 'DELETE', headers: { 'x-studio-request': '1', origin: ORIGIN } })).status, 404);
  assert.equal(upstreamCalls.length, 0);
});

test('a stopped native upstream produces a useful 502 while editor state remains available', async (t) => {
  const { request, upstream } = await setup(t);
  await close(upstream);
  const response = await request('/home');
  assert.equal(response.status, 502);
  assert.match(response.json.error, /dashboard renderer is temporarily unavailable/);
  assert.equal((await request('/studio/api/state')).status, 200);
});

test('a recovery-required response preserves safe recovery guidance and the external edit', async (t) => {
  const { request, post, configDir, stateDir } = await setup(t);
  const initial = (await request('/studio/api/state')).json;
  const saved = await post('/studio/api/save', { revision: initial.revision, settingsYaml: 'title: Intended change\n' });
  assert.equal(saved.status, 200);
  const [backup] = (await request('/studio/api/backups')).json;
  await fs.writeFile(path.join(configDir, 'settings.yaml'), 'title: External change after interruption\n');
  await fs.writeFile(path.join(stateDir, 'transaction.json'), JSON.stringify({ version: 1, backupId: backup.id }));
  const response = await request('/studio/api/state');
  assert.equal(response.status, 503);
  assert.equal(response.json.code, 'RECOVERY_REQUIRED');
  assert.match(response.json.error, /interrupted|recovery|external file edits/i);
  assert.doesNotMatch(response.json.error, /volume permissions/i);
  assert.equal(await fs.readFile(path.join(configDir, 'settings.yaml'), 'utf8'), 'title: External change after interruption\n');
});

test('the first native request after restart cannot observe an interrupted multi-file transaction', async (t) => {
  let before;
  const { request, stateDir, upstreamCalls } = await setup(t, {
    beforeServer: async (options) => {
      const store = createConfigStore(options);
      before = await store.load();
      await store.save({ revision: before.revision, servicesYaml: '- Partially updated: []\n', settingsYaml: 'title: After\n' });
      const [backup] = await store.listBackups();
      await fs.writeFile(path.join(options.configDir, 'settings.yaml'), before.settingsYaml);
      await fs.writeFile(path.join(options.stateDir, 'transaction.json'), JSON.stringify({ version: 1, backupId: backup.id }));
    },
  });
  // No editor/state/readiness request is allowed to trigger recovery first.
  const native = await request('/api/native-config');
  assert.equal(native.status, 200);
  assert.equal(native.text, before.servicesYaml);
  assert.equal(upstreamCalls.length, 1);
  await assert.rejects(fs.access(path.join(stateDir, 'transaction.json')), { code: 'ENOENT' });
  assert.equal((await request('/studio/api/state')).json.revision, before.revision);
});

test('an unresolved startup recovery blocks HTTP and WebSocket proxy traffic while liveness stays available', async (t) => {
  const { request, configDir, stateDir, upstreamCalls } = await setup(t, {
    beforeServer: async (options) => {
      const store = createConfigStore(options);
      const before = await store.load();
      await store.save({ revision: before.revision, settingsYaml: 'title: Intended\n' });
      const [backup] = await store.listBackups();
      await fs.writeFile(path.join(options.configDir, 'settings.yaml'), 'title: External change\n');
      await fs.writeFile(path.join(options.stateDir, 'transaction.json'), JSON.stringify({ version: 1, backupId: backup.id }));
    },
  });
  const native = await request('/api/native-config');
  assert.equal(native.status, 503);
  assert.equal(native.json.code, 'RECOVERY_REQUIRED');
  // WebSocket upgrades are refused outright and never reach the native renderer.
  assert.equal((await request('/api/socket', { headers: { connection: 'Upgrade', upgrade: 'websocket' } })).status, 404);
  assert.equal((await request('/studio/live')).status, 200);
  const readiness = await request('/studio/ready');
  assert.equal(readiness.status, 503);
  assert.equal(readiness.json.code, 'RECOVERY_REQUIRED');
  assert.equal(upstreamCalls.length, 0);
  assert.equal(await fs.readFile(path.join(configDir, 'settings.yaml'), 'utf8'), 'title: External change\n');
  await fs.access(path.join(stateDir, 'transaction.json'));
});

test('readiness verifies the matching native bridge while liveness remains independent', async (t) => {
  const { request, upstream, upstreamCalls } = await setup(t, { backupRetention: 3 });
  const ready = await request('/studio/ready');
  assert.equal(ready.status, 200);
  const expectedVersion = (await fs.readFile(new URL('../VERSION', import.meta.url), 'utf8')).trim();
  assert.equal(ready.json.version, expectedVersion);
  assert.deepEqual(ready.json.checks, { configurationAndStorage: 'ok', nativeHttp: 'ok' });
  assert.equal(ready.json.nativeProtocol, NATIVE_PROTOCOL);
  assert.equal(ready.json.upstreamCommit, UPSTREAM_COMMIT);
  assert.equal(ready.json.buildRevision, 'unreleased');
  assert.equal(ready.json.backupRetention, 3);
  assert.equal(upstreamCalls[0].url, '/api/studio/health');
  assert.equal(upstreamCalls[0].headers.host, HOST);
  await close(upstream);
  const unavailable = await request('/studio/ready');
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.json.code, 'HOMEPAGE_UNREACHABLE');
  const health = await request('/studio/health');
  assert.equal(health.json.check, 'liveness');
  assert.equal(health.json.version, expectedVersion);
  assert.equal((await request('/studio/api/state')).status, 200);
});

test('invalid startup YAML is unready and blocks native access; correcting it restores service without restarting Studio', async (t) => {
  const { request, configDir, upstreamCalls } = await setup(t, {
    beforeServer: ({ configDir }) => fs.writeFile(path.join(configDir, 'services.yaml'), '- invalid: [\n'),
  });
  assert.equal((await request('/studio/live')).status, 200);
  assert.equal((await request('/studio/api/state')).status, 422);
  const ready = await request('/studio/ready');
  assert.equal(ready.status, 503);
  assert.equal(ready.json.code, 'INVALID_YAML');
  assert.equal((await request('/api/native-config')).status, 503);
  assert.equal(upstreamCalls.length, 0);
  await fs.writeFile(path.join(configDir, 'services.yaml'), '[]\n');
  assert.equal((await request('/api/native-config')).text, '[]\n');
  assert.equal((await request('/studio/ready')).status, 200);
});

test('readiness verifies actual storage writes, leaves no probe files, and surfaces permission failures', async (t) => {
  const { request, configDir, stateDir, upstreamCalls, initialization } = await setup(t);
  await initialization;
  const open = fs.open;
  fs.open = async (file, ...args) => {
    if (String(file).startsWith(path.join(stateDir, '.homepage-studio-'))) throw Object.assign(new Error('Injected read-only state storage'), { code: 'EACCES' });
    return open.call(fs, file, ...args);
  };
  try {
    const ready = await request('/studio/ready');
    assert.equal(ready.status, 503);
    assert.equal(ready.json.code, 'EACCES');
    assert.equal((await request('/studio/live')).status, 200);
    assert.equal(upstreamCalls.length, 0, 'Do not query native readiness with failed persistence.');
  } finally { fs.open = open; }
  assert.equal((await request('/studio/ready')).status, 200);
  for (const directory of [configDir, stateDir, path.join(stateDir, 'backups')]) {
    assert.ok((await fs.readdir(directory)).every((name) => !name.startsWith('.homepage-studio-')), 'Readiness must clean its own temporary probes.');
  }
});

test('an arbitrary upstream 200 response is not mistaken for the native Homepage health response', async (t) => {
  const { request } = await setup(t, { nativeHealthBody: '<html>Proxy fallback</html>' });
  const ready = await request('/studio/ready');
  assert.equal(ready.status, 503);
  assert.equal(ready.json.code, 'HOMEPAGE_UNREACHABLE');
  assert.equal((await request('/studio/live')).status, 200);
});

test('configuration readiness can start the renderer without depending on native readiness', async (t) => {
  const { request, upstream, upstreamCalls } = await setup(t);
  await close(upstream);
  const ready = await request('/studio/config-ready');
  assert.equal(ready.status, 200);
  assert.deepEqual(ready.json.checks, { configurationAndStorage: 'ok', nativeHttp: 'not_checked' });
  assert.deepEqual(upstreamCalls, []);
  assert.equal((await request('/studio/ready')).status, 503);
});

test('native readiness rejects mismatched protocol, pinned source, and build revision', async (t) => {
  for (const mismatch of [{ protocolVersion: 2 }, { upstreamCommit: 'another-source' }, { buildRevision: 'another-build' }]) {
    await t.test(Object.keys(mismatch)[0], async (t) => {
      const health = { protocolVersion: NATIVE_PROTOCOL, upstreamCommit: UPSTREAM_COMMIT, buildRevision: 'unreleased', ...mismatch };
      const { request } = await setup(t, { nativeHealthBody: JSON.stringify(health) });
      assert.equal((await request('/studio/config-ready')).status, 200);
      assert.equal((await request('/studio/ready')).status, 503);
    });
  }
});

test('independent content, board, settings and private export endpoints work together with revision protection', async (t) => {
  const { request, post } = await setup(t);
  let state = (await request('/studio/api/state')).json;
  let result = await post('/studio/api/service-widget', { revision: state.revision, action: 'add', newService: { name: 'Media', group: 'Home' }, type: 'jellyfin', config: { url: 'http://media.example.test', key: 'synthetic-secret' } });
  assert.equal(result.status, 200);
  state = result.json;
  result = await post('/studio/api/bookmark', { revision: state.revision, action: 'add', group: 'Reading', name: 'Docs', config: { href: 'https://gethomepage.dev' } });
  assert.equal(result.status, 200);
  state = result.json;
  result = await post('/studio/api/settings', { revision: state.revision, config: { title: 'Home' } });
  assert.equal(result.status, 200);
  const board = (await request('/studio/api/board')).json;
  assert.equal(board.board.panels.length, 2);
  assert.doesNotMatch(JSON.stringify(board), /synthetic-secret|media\.example/);
  board.board.stacks.push({ id: 'stack', panelIds: board.board.panels.map((p) => p.id), rect: { x: 0, y: 0, w: 6, h: 5 }, playback: { mode: 'automatic', manualHoldMs: 30000 } });
  result = await post('/studio/api/board', board);
  assert.equal(result.status, 200);
  assert.equal(result.json.board.stacks[0].playback.manualHoldMs, 30000);
  assert.equal((await post('/studio/api/board', board)).status, 409);
  const backup = (await request('/studio/api/backups')).json[0];
  assert.equal(Object.keys((await request(`/studio/api/backups/${backup.id}`)).json.before).length, 10);
  assert.equal(Object.keys((await request('/studio/api/export')).json.files).length, 10);
  assert.equal((await request('/studio/api/export', { headers: { origin: 'https://unrelated.example' } })).status, 403);
});

test('discovered panels use read-only native metadata and explicit revision-protected hide/restore', async (t) => {
  const id = 'discovered-service-0123456789abcdef01234567';
  const source = { id, kind: 'service', title: 'Discovered service', group: 'Lab', nativeLocator: { discovered: true, discoveryId: id, serviceId: id, groupPath: ['Lab'], name: 'Discovered service', origin: 'docker' } };
  const { request, post, store, upstreamCalls, initialization } = await setup(t, { nativeDiscoveredSources: [source] });
  await initialization;
  assert.equal(upstreamCalls.length, 0);
  assert.equal((await request('/studio/config-ready')).status, 200);
  assert.equal(upstreamCalls.length, 0);
  const loaded = await request('/studio/api/state', { headers: { cookie: 'private-session=synthetic-only', authorization: 'Bearer synthetic-only' } });
  assert.equal(loaded.status, 200);
  assert.equal(loaded.json.board.panels[0].id, id);
  assert.equal(loaded.json.discoveredSources[0].available, true);
  assert.equal((await store.listBackups()).length, 0);
  const lookup = upstreamCalls[0];
  assert.equal(lookup.url, '/api/studio/sources');
  assert.equal(lookup.headers.host, HOST);
  assert.equal(lookup.headers.cookie, undefined);
  assert.equal(lookup.headers.authorization, undefined);
  const hidden = await post('/studio/api/discovery-visibility', { revision: loaded.json.revision, id, hidden: true });
  assert.equal(hidden.status, 200);
  assert.deepEqual(hidden.json.board.panels, []);
  assert.deepEqual(hidden.json.hiddenDiscoveredIds, [id]);
  assert.equal(hidden.json.discoveredSources.length, 1);
  // Arrange-level actions answer with the board only, never configuration files.
  assert.equal(hidden.json.servicesYaml, undefined);
  const stale = await post('/studio/api/discovery-visibility', { revision: loaded.json.revision, id, hidden: false });
  assert.equal(stale.status, 409);
  const invalid = await post('/studio/api/discovery-visibility', { revision: hidden.json.revision, id, hidden: 'false' });
  assert.equal(invalid.status, 400);
  const shown = await post('/studio/api/discovery-visibility', { revision: hidden.json.revision, id, hidden: false });
  assert.equal(shown.status, 200);
  assert.equal(shown.json.board.panels[0].id, id);
  assert.deepEqual(shown.json.hiddenDiscoveredIds, []);
});

test('structured configuration writes and restore complete while an explicit discovery read is held', async t => {
  const id = 'discovered-service-0123456789abcdef01234567';
  const source = { id, kind: 'service', title: 'Discovered service', group: 'Lab', nativeLocator: { discovered: true, discoveryId: id, serviceId: id, groupPath: ['Lab'], name: 'Discovered service', origin: 'docker' } };
  const entered = Promise.withResolvers(), released = Promise.withResolvers();
  let hold = false;
  const { request, post, store, upstreamCalls } = await setup(t, {
    nativeDiscoveredSources: [source],
    beforeNativeDiscovery: async () => { if (hold) { entered.resolve(); await released.promise; } },
  });
  let state = (await request('/studio/api/state')).json;
  const original = state;
  hold = true;
  const refresh = request('/studio/api/board');
  async function write(endpoint, change) {
    let timer;
    try {
      const result = await Promise.race([
        post(`/studio/api/${endpoint}`, { revision: state.revision, ...change }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${endpoint} waited for the held provider`)), 2000); }),
      ]);
      assert.equal(result.status, 200, result.text); state = result.json;
      return result;
    } finally { clearTimeout(timer); }
  }
  try {
    await entered.promise;
    await write('settings', { config: { title: 'Immediate local change' } });
    await write('service', { action: 'add', name: 'Local service', group: 'Services', config: { href: 'https://service.example.test' } });
    await write('info-widget', { action: 'add', type: 'greeting', config: { text: 'Hello' } });
    await write('service-widget', { action: 'add', newService: { name: 'Media', group: 'Services' }, type: 'jellyfin', config: { url: 'http://media.example.test', key: 'synthetic-only' } });
    await write('bookmark', { action: 'add', name: 'Docs', group: 'Reading', config: { href: 'https://docs.example.test' } });
    await write('discovery-visibility', { id, hidden: true });
    await write('save', { customCss: '.review { color: rebeccapurple; }' });
    const backup = (await store.listBackups()).find(value => value.revision === original.revision);
    await write('restore', { backupId: backup.id });
    assert.equal(state.settingsConfig.title, original.settingsConfig.title);
    assert.equal(upstreamCalls.filter(call => call.url === '/api/studio/sources').length, 2, 'Only the two explicit reads invoke discovery.');
  } finally { hold = false; released.resolve(); await refresh; }
});

test('both complete-board save routes await fresh membership and reject an omitted discovery arrival', async t => {
  const source = number => {
    const id = `discovered-service-${String(number).padStart(24, '0')}`;
    return { id, kind: 'service', title: `Discovered ${number}`, group: 'Lab', nativeLocator: { discovered: true, discoveryId: id, serviceId: id, groupPath: ['Lab'], name: `Discovered ${number}`, origin: 'docker' } };
  };
  const options = { nativeDiscoveredSources: [source(1)] };
  const { request, post, store } = await setup(t, options);
  const before = (await request('/studio/api/state')).json;
  options.nativeDiscoveredSources = [source(1), source(2)];
  for (const endpoint of ['board', 'save']) {
    const entered = Promise.withResolvers(), released = Promise.withResolvers();
    options.beforeNativeDiscovery = async () => { entered.resolve(); await released.promise; };
    let settled = false;
    const pending = post(`/studio/api/${endpoint}`, { revision: before.revision, board: before.board }).then(value => { settled = true; return value; });
    try {
      await entered.promise;
      assert.equal(settled, false, 'The board cannot commit before its source membership refresh.');
    } finally { released.resolve(); }
    const result = await pending;
    assert.equal(result.status, 422, result.text);
    assert.equal((await store.load()).revision, before.revision);
    assert.equal((await store.listBackups()).length, 0);
  }
});

test('the widget catalog is compressed, revalidated by strong ETag and never proxied', async (t) => {
  const { request, upstreamCalls } = await setup(t);
  const original = await fs.readFile(new URL('../public/catalog.json', import.meta.url));
  const plain = await request('/studio/catalog.json');
  assert.equal(plain.status, 200);
  assert.deepEqual(plain.buffer, original);
  assert.equal(plain.headers['content-encoding'], undefined);
  assert.equal(plain.headers['content-type'], 'application/json; charset=utf-8');
  assert.equal(plain.headers['cache-control'], 'no-cache');
  assert.equal(plain.headers.vary, 'Accept-Encoding');
  assert.equal(plain.headers['x-content-type-options'], 'nosniff');
  assert.equal(plain.headers['content-security-policy'], "frame-ancestors 'self'");
  assert.equal(Number(plain.headers['content-length']), original.length);
  assert.match(plain.headers.etag, /^"[A-Za-z0-9_-]{32}-identity"$/);

  const br = await request('/studio/catalog.json', { headers: { 'accept-encoding': 'gzip, deflate, br' } });
  assert.equal(br.headers['content-encoding'], 'br');
  assert.deepEqual(brotliDecompressSync(br.buffer), original);
  assert.ok(br.buffer.length < original.length / 5, `brotli catalog is ${br.buffer.length} bytes`);
  assert.equal(Number(br.headers['content-length']), br.buffer.length);
  const gz = await request('/studio/catalog.json', { headers: { 'accept-encoding': 'gzip, br;q=0.5' } });
  assert.equal(gz.headers['content-encoding'], 'gzip');
  assert.deepEqual(gunzipSync(gz.buffer), original);
  const etags = new Set([plain.headers.etag, br.headers.etag, gz.headers.etag]);
  assert.equal(etags.size, 3, 'Each encoding is a distinct representation.');
  assert.equal(new Set([...etags].map(tag => tag.replace(/-(?:identity|gzip|br)"$/, ''))).size, 1, 'All encodings share one content hash.');
  assert.equal((await request('/studio/catalog.json', { headers: { 'accept-encoding': 'br' } })).headers.etag, br.headers.etag, 'The ETag is stable across requests.');

  const head = await request('/studio/catalog.json', { method: 'HEAD', headers: { 'accept-encoding': 'br' } });
  assert.equal(head.status, 200);
  assert.equal(head.buffer.length, 0);
  assert.equal(head.headers.etag, br.headers.etag);
  assert.equal(Number(head.headers['content-length']), br.buffer.length);

  const revalidated = await request('/studio/catalog.json', { headers: { 'accept-encoding': 'br', 'if-none-match': `"other", ${br.headers.etag}` } });
  assert.equal(revalidated.status, 304);
  assert.equal(revalidated.buffer.length, 0);
  assert.equal(revalidated.headers.etag, br.headers.etag);
  assert.equal(revalidated.headers['cache-control'], 'no-cache');
  assert.equal(revalidated.headers['content-encoding'], 'br');
  const headRevalidated = await request('/studio/catalog.json', { method: 'HEAD', headers: { 'if-none-match': plain.headers.etag } });
  assert.equal(headRevalidated.status, 304);
  const otherEncoding = await request('/studio/catalog.json', { headers: { 'accept-encoding': 'gzip', 'if-none-match': br.headers.etag } });
  assert.equal(otherEncoding.status, 200, 'A Brotli validator does not validate the gzip representation.');
  assert.deepEqual(gunzipSync(otherEncoding.buffer), original);

  const refused = await request('/studio/catalog.json', { headers: { 'accept-encoding': 'identity;q=0' } });
  assert.equal(refused.status, 406);
  assert.equal((await request('/studio/catalog.json', { method: 'DELETE', headers: { origin: ORIGIN, 'x-studio-request': '1' } })).status, 404);
  assert.equal(upstreamCalls.length, 0);
});

test('each editor endpoint records its own fixed snapshot action code and never request text', async (t) => {
  const id = 'discovered-service-0123456789abcdef01234567';
  const source = { id, kind: 'service', title: 'Discovered service', group: 'Lab', nativeLocator: { discovered: true, discoveryId: id, serviceId: id, groupPath: ['Lab'], name: 'Discovered service', origin: 'docker' } };
  const { request, post, stateDir, initialization } = await setup(t, { nativeDiscoveredSources: [source] });
  await initialization;
  let revision = (await request('/studio/api/state')).json.revision;
  const recorded = [];
  async function expectAction(target, body, action) {
    const response = await post(target, { revision, ...body });
    assert.equal(response.status, 200, `${target} ${response.text}`);
    revision = response.json.revision;
    const [latest] = (await request('/studio/api/backups')).json;
    assert.equal(latest.action, action, target);
    recorded.push(latest.id);
    return response.json;
  }
  let state = await expectAction('/studio/api/discovery-visibility', { id, hidden: true }, 'discovered-panel-hidden');
  state = await expectAction('/studio/api/discovery-visibility', { id, hidden: false }, 'discovered-panel-shown');
  state = await expectAction('/studio/api/service', { action: 'add', name: 'Router admin', group: 'Lab', config: { href: 'https://router.example.test' }, snapshotAction: 'arbitrary text' }, 'service-added');
  const service = state.services.find((entry) => entry.name === 'Router admin');
  state = await expectAction('/studio/api/service', { action: 'update', id: service.id, config: { description: 'Edited' } }, 'service-edited');
  state = await expectAction('/studio/api/service-widget', { action: 'add', serviceId: service.id, type: 'customapi', config: { url: 'http://api.example.test' } }, 'service-widget-added');
  const widget = state.serviceWidgets[0];
  state = await expectAction('/studio/api/service-widget', { action: 'update', id: widget.id, type: 'customapi', config: { url: 'http://api2.example.test' } }, 'service-widget-edited');
  state = await expectAction('/studio/api/service-widget', { action: 'delete', id: widget.id }, 'service-widget-deleted');
  state = await expectAction('/studio/api/info-widget', { action: 'add', type: 'datetime', config: {} }, 'info-widget-added');
  const info = state.infoWidgets[0];
  state = await expectAction('/studio/api/info-widget', { action: 'update', id: info.id, config: { format: { timeStyle: 'short' } } }, 'info-widget-edited');
  state = await expectAction('/studio/api/info-widget', { action: 'delete', id: info.id }, 'info-widget-deleted');
  state = await expectAction('/studio/api/bookmark', { action: 'add', group: 'Reading', name: 'Docs', config: { href: 'https://docs.example.test' } }, 'bookmark-added');
  const bookmark = state.bookmarks[0];
  state = await expectAction('/studio/api/bookmark', { action: 'update', id: bookmark.id, config: { abbr: 'DO' } }, 'bookmark-edited');
  state = await expectAction('/studio/api/bookmark', { action: 'delete', id: bookmark.id }, 'bookmark-deleted');
  state = await expectAction('/studio/api/settings', { config: { title: 'Renamed dashboard' } }, 'settings-saved');
  state = await expectAction('/studio/api/save', { customCss: '/* edited */', action: 'Free text from the request' }, 'files-saved');
  const board = structuredClone(state.board);
  board.panels[0].rect = { ...board.panels[0].rect, x: board.panels[0].rect.x + 1 };
  state = await expectAction('/studio/api/board', { board }, 'arrangement-saved');
  state = await expectAction('/studio/api/service', { action: 'delete', id: service.id }, 'service-deleted');
  state = await expectAction('/studio/api/restore', { backupId: recorded[0] }, 'snapshot-restored');
  const archive = (await request('/studio/api/export')).json;
  await expectAction('/studio/api/import', { archive }, 'dashboard-imported');
  // Snapshot files and listings carry only fixed codes, never request strings.
  const names = await fs.readdir(path.join(stateDir, 'backups'));
  assert.equal(names.length, recorded.length);
  for (const name of names) {
    const stored = JSON.parse(await fs.readFile(path.join(stateDir, 'backups', name), 'utf8'));
    assert.match(stored.action, /^[a-z][a-z-]+$/);
  }
  const listed = JSON.stringify((await request('/studio/api/backups')).json);
  assert.ok(!listed.includes('Free text') && !listed.includes('arbitrary text'));
});
