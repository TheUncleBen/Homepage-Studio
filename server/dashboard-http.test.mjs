import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { constants } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createStudioServer, NATIVE_PROTOCOL, UPSTREAM_COMMIT } from './index.mjs';
import { dashboardConfigDir, dashboardStateDir, DASHBOARD_REGISTRY_FILE } from './dashboard-paths.mjs';
import { addressMainDashboard } from './fixtures/main-address.mjs';
// The main dashboard lives at /home. Its own addresses (native API, editor
// API, native data) move with it; Studio-wide addresses stay at the root.
const onPrimary = target => (/^\/(?:api\/|studio\/(?:api\/(?!dashboards|overview|platform|trusted-certificates)|catalog\.json|edit|settings)|_next\/(?!static\/))/.test(target) ? '/home' + target : target);


const HOST = 'dashboards.example.test:3000';
const ORIGIN = `http://${HOST}`;
const BUILD = 'controlled-platform-test';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function listen(server) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return server.address().port; }

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-multi-http-'));
  const configDir = path.join(root, 'config'), stateDir = path.join(root, 'state'), rendererDir = path.join(root, 'renderer');
  await fs.mkdir(path.join(rendererDir, '.next', 'static', 'chunks'), { recursive: true });
  await fs.mkdir(path.join(rendererDir, 'public'), { recursive: true });
  for (const [name, value] of [['server.js', '// native build fixture\n'], ['.next/BUILD_ID', BUILD], ['.next/build-manifest.json', '{}'], ['.next/static/chunks/shared.js', '/* immutable build */'], ['public/homepage.ico', 'native icon']]) await fs.writeFile(path.join(rendererDir, name), value);
  const natives = new Map(), peers = new Set(), acquisitions = [], drains = [];
  let leases = 0, releases = 0, closes = 0, beforeAcquire;
  const pool = {
    async acquire(entry, host) {
      acquisitions.push({ entry: structuredClone(entry), host });
      await beforeAcquire?.(entry);
      if (!natives.has(entry.id)) {
        const native = http.createServer(async (req, res) => {
          if (req.url === '/api/studio/health') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ protocolVersion: NATIVE_PROTOCOL, upstreamCommit: UPSTREAM_COMMIT, buildRevision: BUILD })); }
          if (req.url === '/api/studio/sources') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ protocolVersion: NATIVE_PROTOCOL, upstreamCommit: UPSTREAM_COMMIT, sources: [], warnings: [] })); }
          if (req.url === '/api/redirect') { res.writeHead(302, { location: '/api/destination?x=1#anchor', refresh: '0; url="/api/destination?x=1"' }); return res.end(); }
          if (req.url === '/api/external') { res.writeHead(302, { location: 'https://external.example.test/path', refresh: '5; url=https://external.example.test/path' }); return res.end(); }
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ id: entry.id, url: req.url, headers: req.headers, settings: await fs.readFile(path.join(dashboardConfigDir(configDir, entry.id), 'settings.yaml'), 'utf8') }));
        });
        native.on('upgrade', (req, socket, head) => {
          peers.add(socket); socket.once('close', () => peers.delete(socket));
          socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nX-Native-Id: ' + entry.id + '\r\n\r\nNATIVE-HEAD');
          if (head.length) socket.write(head);
          socket.on('data', data => { socket.write(data); if (data.toString().includes('FINISH')) socket.end(); });
          socket.on('error', () => {});
        });
        const port = await listen(native);
        natives.set(entry.id, { native, origin: new URL(`http://127.0.0.1:${port}`) });
      }
      leases++;
      let released = false;
      return { origin: natives.get(entry.id).origin, release() { if (!released) { released = true; leases--; releases++; } } };
    },
    async drain(id) { drains.push(id); },
    async drainAll() { drains.push('*'); },
    async close() { closes++; },
  };
  const app = createStudioServer({ configDir, stateDir, rendererDir, rendererPool: pool, allowedHosts: HOST, buildRevision: BUILD, auth: 'off', archiveSweepMs: 0 });
  const port = await listen(app.server);
  await addressMainDashboard({ port, host: HOST, origin: ORIGIN });
  drains.length = 0;
  t.after(async () => {
    beforeAcquire = undefined;
    await app.shutdown({ graceMs: 25 });
    for (const socket of peers) socket.destroy();
    for (const { native } of natives.values()) { native.closeAllConnections(); await new Promise(done => native.close(done)); }
    await fs.rm(root, { recursive: true, force: true });
  });
  const request = (target, { method = 'GET', body, headers = {} } = {}) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: onPrimary(target), method, agent: false, headers: { host: HOST, ...headers } }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('error', reject);
      res.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); let json; try { json = JSON.parse(text); } catch {} resolve({ status: res.statusCode, headers: res.headers, text, json }); });
    });
    req.on('error', reject); req.setTimeout(5000, () => req.destroy(new Error('Isolated dashboard request timed out'))); req.end(body);
  });
  const post = (url, value, headers = {}) => request(url, { method: 'POST', body: JSON.stringify(value), headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-studio-request': '1', ...headers } });
  const mutate = async change => post('/studio/api/dashboards', { revision: (await request('/studio/api/dashboards')).json.revision, ...change });
  const create = async (slug, sourceId) => { const result = await mutate({ action: 'create', name: slug, slug, ...(sourceId ? { sourceId } : {}) }); assert.equal(result.status, 200, result.text); return result.json.dashboard; };
  const state = async (slug = '') => { const result = await request(`${slug ? '/' + slug : ''}/studio/api/state`); assert.equal(result.status, 200, result.text); return result.json; };
  return { ...app, root, configDir, stateDir, rendererDir, port, pool, acquisitions, drains, request, post, mutate, create, state, setBeforeAcquire(fn) { beforeAcquire = fn; }, get leases() { return leases; }, get releases() { return releases; }, get closes() { return closes; }, get handlerCount() { return app.dashboardHandlerCount; } };
}

test('all nine native files duplicate independently with their own revisions and history', async t => {
  const f = await fixture(t);
  const initial = await f.state();
  const edits = { servicesYaml: '# Root services\n- Apps:\n    - App:\n        href: https://app.example.test\n', bookmarksYaml: '# Links\n[]\n', widgetsYaml: '# Information\n[]\n', settingsYaml: 'title: Root\ntheme: dark\ncolor: purple\n', dockerYaml: '# Docker\n{}\n', kubernetesYaml: '# Kubernetes\n{}\n', proxmoxYaml: '# Proxmox\n{}\n', customCss: '.only-root { color: purple; }', customJs: 'window.onlyRoot = true;' };
  const saved = await f.post('/studio/api/save', { revision: initial.revision, ...edits }); assert.equal(saved.status, 200, saved.text);
  const child = await f.create('family', 'default');
  const copied = await f.state('family');
  for (const [field, bytes] of Object.entries(edits)) assert.equal(copied[field], bytes, field);
  assert.deepEqual(copied.services.map(item => item.id), saved.json.services.map(item => item.id), 'A duplicated board keeps its internal stable identities in isolated storage.');
  const childSave = await f.post('/family/studio/api/save', { revision: copied.revision, settingsYaml: 'title: Family\ntheme: light\ncolor: blue\n', customCss: '.family { color: blue; }', customJs: 'window.family = true;' });
  assert.equal(childSave.status, 200, childSave.text);
  assert.equal((await f.state()).settingsYaml, edits.settingsYaml);
  assert.equal((await f.request('/family/api/config')).json.id, child.id);
  assert.match((await f.request('/family/api/config')).json.settings, /Family/);
  assert.match((await f.request('/api/config')).json.settings, /Root/);
  const rootBackups = (await f.request('/studio/api/backups')).json;
  const list = Array.isArray(rootBackups) ? rootBackups : rootBackups.backups;
  assert.ok(list.length);
  const foreign = await f.post('/family/studio/api/restore', { revision: childSave.json.revision, backupId: list[0].id });
  assert.equal(foreign.status, 404, foreign.text);
  assert.notEqual(dashboardStateDir(f.stateDir, child.id), f.stateDir);
});

test('a new dashboard can start from a template of links, a clock and the weather', async t => {
  const f = await fixture(t);
  const overview = await f.request('/studio/api/overview');
  assert.deepEqual(overview.json.starters.map(choice => choice.id), ['homelab', 'media', 'family']);
  const made = await f.mutate({ action: 'create', name: 'Family', slug: 'family', starter: 'family' });
  assert.equal(made.status, 200, made.text);
  const family = await f.state('family');
  assert.match(family.servicesYaml, /href: https:\/\/photos\.home\.arpa/);
  assert.doesNotMatch(family.servicesYaml, /widget:/, 'links only, so nothing needs a key');
  assert.match(family.widgetsYaml, /datetime/);
  assert.match(family.widgetsYaml, /openmeteo/);
  assert.doesNotMatch(family.widgetsYaml, /latitude/, 'the weather asks for a location');
  const board = (await f.request('/family/studio/api/board')).json.board;
  const top = board.panels.filter(panel => panel.kind === 'informationWidget');
  assert.deepEqual(top.map(panel => panel.rect), [{ x: 0, y: 0, w: 12, h: 2 }, { x: 12, y: 0, w: 12, h: 2 }]);
  const links = board.panels.filter(panel => panel.kind === 'service');
  assert.equal(links.length, 8);
  assert.ok(links.every(panel => panel.rect.y >= 2 && panel.behaviour?.status === 'off'), 'placeholder links start without a status check');
  for (const bad of [{ starter: 'nope' }, { starter: 'media', sourceId: 'default' }, { starter: 1 }]) {
    const refused = await f.mutate({ action: 'create', name: 'Bad', slug: 'bad', ...bad });
    assert.equal(refused.status, 400, JSON.stringify(bad));
  }
  assert.equal((await f.request('/studio/api/dashboards')).json.dashboards.length, 2, 'refused templates create nothing');
});

test('repeated invalid-source duplicates never allocate targets or retain handlers', async t => {
  const f = await fixture(t); await f.create('existing');
  const beforeConfig = await fs.readdir(path.join(f.configDir, 'dashboards'));
  const beforeState = await fs.readdir(path.join(f.stateDir, 'dashboards'));
  assert.equal(f.handlerCount, 2);
  const invalid = 'title: [invalid source\n';
  await fs.writeFile(path.join(f.configDir, 'settings.yaml'), invalid);
  for (let i = 0; i < 3; i++) {
    const failed = await f.mutate({ action: 'create', name: 'Failed copy', slug: 'failed-copy', sourceId: 'default' });
    assert.equal(failed.status, 422, failed.text);
    assert.equal(failed.json.code, 'INVALID_YAML');
  }
  assert.deepEqual(await fs.readdir(path.join(f.configDir, 'dashboards')), beforeConfig);
  assert.deepEqual(await fs.readdir(path.join(f.stateDir, 'dashboards')), beforeState);
  assert.equal(f.handlerCount, 2);
  assert.equal((await f.registry.read()).dashboards.length, 2);
  assert.equal(await fs.readFile(path.join(f.configDir, 'settings.yaml'), 'utf8'), invalid);
});

test('failed registry publication removes only the unpublished directories and handler', async t => {
  const f = await fixture(t); await f.state();
  const registryFile = path.join(f.configDir, DASHBOARD_REGISTRY_FILE);
  const beforeRegistry = await fs.readFile(registryFile);
  const beforeSettings = await fs.readFile(path.join(f.configDir, 'settings.yaml'));
  const rename = fs.rename;
  const fault = t.mock.method(fs, 'rename', async (...args) => {
    if (args[1] === registryFile) throw Object.assign(new Error('Synthetic registry publication failure'), { code: 'EIO' });
    return rename(...args);
  });
  let failed;
  try { failed = await f.mutate({ action: 'create', name: 'Failed copy', slug: 'failed-copy', sourceId: 'default' }); }
  finally { fault.mock.restore(); }
  assert.equal(failed.status, 500, failed.text);
  assert.deepEqual(await fs.readFile(registryFile), beforeRegistry);
  assert.deepEqual(await fs.readFile(path.join(f.configDir, 'settings.yaml')), beforeSettings);
  assert.deepEqual(await fs.readdir(path.join(f.configDir, 'dashboards')), []);
  assert.deepEqual(await fs.readdir(path.join(f.stateDir, 'dashboards')), []);
  assert.equal(f.handlerCount, 1);
});

test('an unexpected pre-existing target directory is never adopted or cleaned up', async t => {
  const f = await fixture(t); await f.state();
  const mkdir = fs.mkdir;
  let existing;
  const collision = t.mock.method(fs, 'mkdir', async (directory, options) => {
    if (!existing && path.dirname(directory) === path.join(f.stateDir, 'dashboards')) {
      existing = directory;
      await mkdir(directory, options);
      await fs.writeFile(path.join(directory, 'pre-existing.txt'), 'operator bytes');
      throw Object.assign(new Error('Synthetic UUID directory collision'), { code: 'EEXIST' });
    }
    return mkdir(directory, options);
  });
  let failed;
  try { failed = await f.mutate({ action: 'create', name: 'Collision', slug: 'collision' }); }
  finally { collision.mock.restore(); }
  assert.equal(failed.status, 500, failed.text);
  assert.equal(await fs.readFile(path.join(existing, 'pre-existing.txt'), 'utf8'), 'operator bytes');
  assert.deepEqual(await fs.readdir(path.join(f.configDir, 'dashboards')), []);
  assert.equal(f.handlerCount, 1);
  assert.equal((await f.registry.read()).dashboards.length, 1);
});

test('FIFO runtime files and shared assets fail promptly without waiting for a writer', async t => {
  const f = await fixture(t); await f.initialization;
  for (const [file, target, expected] of [
    [path.join(f.rendererDir, '.next', 'BUILD_ID'), '/studio/application-ready', 503],
    [path.join(f.rendererDir, 'public', 'homepage.ico'), '/homepage.ico', 404],
  ]) {
    await fs.unlink(file); execFileSync('mkfifo', [file]);
    const pending = f.request(target);
    let timer;
    const result = await Promise.race([pending, new Promise(resolve => { timer = setTimeout(() => resolve(null), 1500); })]);
    clearTimeout(timer);
    if (result === null) {
      // Release a regression's blocked FIFO open before failing the test, so
      // no filesystem thread or fixture shutdown can be left hanging.
      const writer = await fs.open(file, constants.O_WRONLY | constants.O_NONBLOCK);
      await writer.close(); await pending;
      assert.fail('A special file blocked an application request');
    }
    assert.equal(result.status, expected, result.text);
  }
});

test('rename, root redirect, archive and restore retain immutable dashboard files', async t => {
  const f = await fixture(t), child = await f.create('family');
  const changed = await f.mutate({ action: 'update', id: child.id, name: 'House', slug: 'house' }); assert.equal(changed.status, 200);
  assert.equal((await f.request('/family')).status, 404);
  assert.equal((await f.request('/house/api/config')).json.id, child.id);
  assert.deepEqual(f.drains, [child.id]);
  assert.equal((await f.mutate({ action: 'update', id: 'default', name: 'Admin', slug: 'admin' })).status, 200);
  // With sign-in off the bare address always opens the Dashboards page.
  const redirect = await f.request('/?view=1'); assert.equal(redirect.status, 307); assert.equal(redirect.headers.location, '/studio/dashboards');
  assert.equal((await f.request('/api/config')).status, 404);
  assert.equal((await f.request('/admin/api/config')).json.id, 'default');
  const stored = await fs.readFile(path.join(dashboardConfigDir(f.configDir, child.id), 'settings.yaml'));
  assert.equal((await f.mutate({ action: 'archive', id: child.id, confirmed: true })).status, 200);
  assert.equal((await f.request('/house')).status, 404);
  assert.deepEqual(await fs.readFile(path.join(dashboardConfigDir(f.configDir, child.id), 'settings.yaml')), stored);
  assert.equal((await f.mutate({ action: 'restore', id: child.id })).status, 200);
  assert.equal((await f.request('/house/api/config')).json.id, child.id);
});

test('native redirect metadata is scoped to the selected dashboard and external redirects stay intact', async t => {
  const f = await fixture(t); await f.create('family');
  const redirected = await f.request('/family/api/redirect');
  assert.equal(redirected.headers.location, '/family/api/destination?x=1#anchor');
  assert.equal(redirected.headers.refresh, '0; url="/family/api/destination?x=1"');
  assert.equal(redirected.headers['cache-control'], 'no-store');
  const external = await f.request('/family/api/external');
  assert.equal(external.headers.location, 'https://external.example.test/path');
  assert.equal(external.headers.refresh, '5; url=https://external.example.test/path');
});

test('forged routing headers, wrong hosts and foreign origins cannot change dashboard selection', async t => {
  const f = await fixture(t), child = await f.create('family');
  const response = await f.request('/family/api/config', { headers: { 'x-studio-dashboard-id': 'default', 'x-studio-base-path': '/', referer: ORIGIN + '/' } });
  assert.equal(response.json.id, child.id);
  assert.equal(response.json.headers['x-studio-dashboard-id'], undefined);
  assert.equal(response.json.headers['x-studio-base-path'], undefined);
  assert.equal((await f.request('/family/api/config', { headers: { host: 'wrong.example.test:3000' } })).status, 403);
  const current = await f.state('family');
  assert.equal((await f.post('/family/studio/api/save', { revision: current.revision, settingsYaml: 'title: Wrong\n' }, { origin: 'https://foreign.example.test' })).status, 403);
  for (const headers of [{ origin: 'https://foreign.example.test' }, { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' }]) {
    assert.equal((await f.request('/family/api/services/proxy?endpoint=Pause', { method: 'POST', body: 'ignored=1', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers } })).status, 403);
  }
  assert.equal((await f.request('/family/api/config', { headers: { origin: ORIGIN, 'sec-fetch-site': 'same-origin' } })).json.id, child.id);
  assert.equal((await f.state('family')).revision, current.revision);
});

test('a blocked older request cannot replace a newer slug descriptor', async t => {
  const f = await fixture(t), child = await f.create('family'), entered = deferred(), proceed = deferred();
  let held = false;
  f.setBeforeAcquire(async entry => { if (entry.id === child.id && entry.slug === 'family' && !held) { held = true; entered.resolve(); await proceed.promise; } });
  const older = f.request('/family/api/config');
  await entered.promise;
  assert.equal((await f.mutate({ action: 'update', id: child.id, name: 'House', slug: 'house' })).status, 200);
  assert.equal((await f.request('/house/api/config')).status, 200);
  proceed.resolve(); assert.equal((await older).status, 200);
  await f.request('/house/api/config');
  assert.deepEqual(f.acquisitions.slice(-3).map(item => item.entry.slug), ['family', 'house', 'house']);
});

test('broken default configuration cannot block global readiness, shared files or a healthy dashboard', async t => {
  const f = await fixture(t); await f.create('family');
  await fs.writeFile(path.join(f.configDir, 'settings.yaml'), 'title: [broken\n');
  assert.equal((await f.request('/studio/ready')).status, 503);
  assert.equal((await f.request('/family/studio/ready')).status, 200);
  const before = f.acquisitions.length;
  const health = await f.request('/studio/application-ready'); assert.equal(health.status, 200, health.text);
  assert.equal(f.acquisitions.length, before, 'Application health does not acquire or parse a selected worker.');
  const asset = await f.request('/_next/static/chunks/shared.js'); assert.equal(asset.status, 200); assert.equal(asset.text, '/* immutable build */');
  assert.equal((await f.request('/homepage.ico')).text, 'native icon');
  assert.equal(f.acquisitions.length, before, 'Shared resources are independent of default configuration and workers.');
  assert.equal((await f.request('/_next/static/chunks/shared.js', { headers: { 'if-none-match': asset.headers.etag } })).status, 304);
  const head = await f.request('/_next/static/chunks/shared.js', { method: 'HEAD' }); assert.equal(head.text, ''); assert.equal(Number(head.headers['content-length']), asset.text.length);
  assert.equal((await fs.readdir(f.configDir)).some(name => name.includes('readiness')), false);
  assert.equal((await fs.readdir(f.stateDir)).some(name => name.includes('readiness')), false);
  await fs.unlink(path.join(f.rendererDir, '.next', 'BUILD_ID'));
  assert.equal((await f.request('/studio/application-ready')).status, 503);
});

test('shared asset links and malformed registry fail closed without leaking paths', async t => {
  const f = await fixture(t); await f.initialization;
  const outside = path.join(f.root, 'private.txt'); await fs.writeFile(outside, 'private fixture');
  await fs.symlink(outside, path.join(f.rendererDir, 'public', 'homepage.ico.link'));
  await fs.unlink(path.join(f.rendererDir, 'public', 'homepage.ico')); await fs.symlink(outside, path.join(f.rendererDir, 'public', 'homepage.ico'));
  const result = await f.request('/homepage.ico'); assert.equal(result.status, 404); assert.doesNotMatch(result.text, /private fixture|studio-multi-http/);
  await fs.writeFile(path.join(f.configDir, DASHBOARD_REGISTRY_FILE), '{broken');
  assert.equal((await f.request('/studio/application-ready')).status, 503);
  const robots = await f.request('/robots.txt'); assert.equal(robots.status, 503); assert.equal(robots.text, 'User-agent: *\nDisallow: /\n');
  assert.equal((await f.request('/studio/live')).status, 200);
});

test('robots uses each resolved native setting without acquiring renderer workers', async t => {
  const f = await fixture(t); const child = await f.create('family');
  await fs.writeFile(path.join(f.configDir, 'settings.yaml'), 'disableIndexing: true\n');
  await fs.writeFile(path.join(dashboardConfigDir(f.configDir, child.id), 'settings.yaml'), 'disableIndexing: false\n');
  const before = f.acquisitions.length;
  const robots = await f.request('/robots.txt'); assert.equal(robots.status, 200); assert.match(robots.text, /Disallow: \/home\$\n/); assert.match(robots.text, /Disallow: \/home\/\n/); assert.match(robots.text, /^Allow: \/$/m); assert.doesNotMatch(robots.text, /Disallow: \/family(?:\$|\/\n)/);
  assert.equal(f.acquisitions.length, before);
  const head = await f.request('/robots.txt', { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(head.text, ''); assert.equal(Number(head.headers['content-length']), robots.text.length);
});

// Regression (N1): an upgrade used to lease a renderer slot and wait up to 60 s
// for the worker, so a few cross-site sockets starved other dashboards.
test('WebSocket upgrades are refused at once and never wait for or hold a renderer slot', async t => {
  const f = await fixture(t), child = await f.create('family');
  const before = f.acquisitions.length;
  const upgrade = async (target, extra = '') => {
    const socket = net.connect(f.port, '127.0.0.1'); await once(socket, 'connect');
    let received = ''; socket.on('data', data => { received += data.toString(); }); socket.on('error', () => {});
    const started = Date.now(), closed = once(socket, 'close');
    socket.write(`GET ${target} HTTP/1.1\r\nHost: ${HOST}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n${extra}\r\nCLIENT-HEAD`);
    await closed;
    return { received, elapsed: Date.now() - started };
  };
  const held = [];
  for (const target of ['/family/_next/webpack-hmr', '/_next/webpack-hmr', '/family/api/socket', '/api/socket', '/studio/api/state', '/missing/_next/webpack-hmr']) {
    for (const extra of ['', 'Origin: https://attacker.example.test\r\nSec-Fetch-Site: cross-site\r\n', `Origin: ${ORIGIN}\r\nSec-Fetch-Site: same-origin\r\n`]) held.push(upgrade(target, extra));
  }
  for (const { received, elapsed } of await Promise.all(held)) {
    assert.match(received, /^HTTP\/1\.1 404 Not Found\r\n/);
    assert.doesNotMatch(received, /101 Switching Protocols|NATIVE-HEAD|CLIENT-HEAD/);
    assert.ok(elapsed < 2000, `upgrade refusal took ${elapsed} ms`);
  }
  assert.equal(f.acquisitions.length, before, 'No upgrade asked the pool for a worker.');
  assert.equal(f.leases, 0);
  const page = await f.request('/family/api/config'); assert.equal(page.status, 200); assert.equal(page.json.id, child.id);
});

test('bounded shutdown closes open client connections and closes the worker pool exactly once', async t => {
  const f = await fixture(t); await f.create('family');
  const socket = net.connect(f.port, '127.0.0.1'); await once(socket, 'connect');
  socket.on('error', () => {});
  // An unfinished request keeps the connection open until the grace period ends.
  socket.write(`GET /family/api/config HTTP/1.1\r\nHost: ${HOST}\r\n`);
  await new Promise(resolve => setTimeout(resolve, 50));
  const closed = once(socket, 'close');
  const first = f.shutdown({ graceMs: 20 }), second = f.shutdown({ graceMs: 100 });
  assert.equal(first, second); await first; await closed;
  assert.equal(f.closes, 1); assert.equal(f.leases, 0);
});

test('browser navigation to an unavailable dashboard gets an accessible page; API callers keep JSON', async t => {
  const f = await fixture(t), child = await f.create('family');
  const html = { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' };
  assert.equal((await f.mutate({ action: 'update', id: child.id, name: 'House', slug: 'house' })).status, 200);
  const garage = await f.create('garage');
  assert.equal((await f.mutate({ action: 'archive', id: garage.id, confirmed: true })).status, 200);
  // /studio is the Dashboards page; a mistyped Studio page gets the page too.
  for (const target of ['/studio', '/studio/']) {
    const sent = await f.request(target, { headers: html });
    assert.equal(sent.status, 307, target);
    assert.equal(sent.headers.location, '/studio/dashboards', target);
  }
  for (const target of ['/family', '/family/settings?x=<script>', '/garage', '/no-such-dashboard', '/%3Cscript%3Ealert(1)', '/studio/no-such-page']) {
    const page = await f.request(target, { headers: html });
    assert.equal(page.status, 404, target);
    assert.equal(page.headers['content-type'], 'text/html; charset=utf-8', target);
    assert.equal(page.headers['cache-control'], 'no-store');
    assert.equal(page.headers['x-content-type-options'], 'nosniff');
    assert.equal(page.headers['x-frame-options'], 'SAMEORIGIN');
    assert.equal(page.headers['referrer-policy'], 'same-origin');
    assert.match(page.headers['content-security-policy'], /frame-ancestors 'self'/);
    assert.match(page.headers['content-security-policy'], /default-src 'none'/);
    assert.equal(Number(page.headers['content-length']), Buffer.byteLength(page.text));
    assert.match(page.text, /^<!doctype html>/);
    assert.match(page.text, /<html lang="en">/);
    assert.match(page.text, /<h1>This dashboard isn&#39;t available<\/h1>/);
    assert.match(page.text, /Error 404/);
    assert.match(page.text, /<a href="\/studio\/dashboards">Open Dashboards<\/a>/);
    assert.doesNotMatch(page.text, /<script|family|garage|no-such|alert/i, target);
  }
  const head = await f.request('/garage', { method: 'HEAD', headers: html });
  assert.equal(head.status, 404); assert.equal(head.headers['content-type'], 'text/html; charset=utf-8'); assert.equal(head.text, '');
  for (const [target, headers] of [['/family', {}], ['/family', { accept: 'application/json' }], ['/garage', { accept: '*/*' }], ['/family/api/config', html], ['/garage/studio/api/state', html]]) {
    const result = await f.request(target, { headers });
    assert.equal(result.status, 404, target);
    assert.match(result.headers['content-type'], /^application\/json/, target);
    assert.equal(result.json.code, 'DASHBOARD_NOT_FOUND', target);
  }
  const posted = await f.request('/family', { method: 'POST', headers: { ...html, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(posted.status, 404); assert.match(posted.headers['content-type'], /^application\/json/);
  assert.equal((await f.request('/house/api/config', { headers: html })).json.id, child.id);
});

test('a dashboard whose configuration does not load gets a 503 page in a browser, with the reason for people who can arrange it (UI review M1)', async t => {
  const f = await fixture(t), child = await f.create('family');
  // Broken while Studio was stopped: the next start can't load it.
  await fs.writeFile(path.join(dashboardStateDir(f.stateDir, child.id), 'state.json'), '{"version":3,"board":{"panels":"<b>x</b>"}}');
  const again = createStudioServer({ configDir: f.configDir, stateDir: f.stateDir, rendererDir: f.rendererDir, rendererPool: f.pool, allowedHosts: HOST, buildRevision: BUILD, auth: 'off', archiveSweepMs: 0 });
  const port = await listen(again.server);
  t.after(() => again.shutdown({ graceMs: 25 }));
  const request = (target, accept) => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: target, agent: false, headers: { host: HOST, accept } }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); let json; try { json = JSON.parse(text); } catch {} resolve({ status: res.statusCode, headers: res.headers, text, json }); });
    }).on('error', reject);
  });
  const page = await request('/family', 'text/html,application/xhtml+xml');
  assert.equal(page.status, 503, page.text);
  assert.equal(page.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(page.headers['cache-control'], 'no-store');
  assert.match(page.headers['content-security-policy'], /default-src 'none'/);
  assert.match(page.text, /<h1>This dashboard can&#39;t load right now<\/h1>/);
  assert.match(page.text, /Error 503/);
  assert.match(page.text, /<p class="detail">[^<]+<\/p>/);
  assert.doesNotMatch(page.text, /<script|<b>/i);
  for (const [target, accept] of [['/family/api/config', 'text/html'], ['/family', 'application/json']]) {
    const result = await request(target, accept);
    assert.equal(result.status, 503, target);
    assert.equal(result.json?.code, 'CONFIG_NOT_READY', target);
  }
});

test('saved widgets: saved from a dashboard, listed without settings, placed on another with their connection', async t => {
  const f = await fixture(t);
  await f.create('family');
  const connection = await f.post('/studio/api/connections', { action: 'add', name: 'Firewall', url: 'https://fw.example.test', key: 'connection-secret' });
  assert.equal(connection.status, 200, connection.text);
  const id = connection.json.connection.id;
  let current = await f.state();
  const added = await f.post('/studio/api/service-widget', { revision: current.revision, action: 'add', newService: { name: 'Edge' }, service: { href: 'https://fw.example.test' }, type: 'pfsense', config: { url: `{{STUDIO_CONNECTION_${id}_URL}}`, key: `{{STUDIO_CONNECTION_${id}_KEY}}`, version: 2, wan: 'igb0' } });
  assert.equal(added.status, 200, added.text);
  const panel = added.json.board.panels.find(item => item.kind === 'serviceWidget');
  const looked = await f.post('/studio/api/board', { revision: added.json.revision, board: { ...added.json.board, panels: added.json.board.panels.map(item => item.id === panel.id ? { ...item, look: { corners: 'round' } } : item) } });
  assert.equal(looked.status, 200, looked.text);
  const saved = await f.post('/studio/api/library', { action: 'add', kind: 'widget', scope: 'everyone', name: 'Edge firewall', panelId: panel.id });
  assert.equal(saved.status, 200, saved.text);
  // Just me needs Studio sign-in, which is off here.
  const personal = await f.post('/studio/api/library', { action: 'add', kind: 'widget', scope: 'me', name: 'Mine', panelId: panel.id });
  assert.equal(personal.status, 400);
  const listed = await f.request('/family/studio/api/library');
  assert.equal(listed.status, 200, listed.text);
  assert.deepEqual(listed.json.scopes, ['dashboard', 'everyone']);
  assert.deepEqual(listed.json.widgets.map(item => [item.name, item.type, item.scope]), [['Edge firewall', 'pfsense', 'everyone']]);
  assert.doesNotMatch(listed.text, /connection-secret|igb0|STUDIO_CONNECTION/);
  const family = await f.state('family');
  const placed = await f.post('/family/studio/api/library/use', { scope: 'everyone', id: saved.json.entry.id, revision: family.revision, pageId: 'home' });
  assert.equal(placed.status, 200, placed.text);
  const copy = placed.json.serviceWidgets.find(item => item.type === 'pfsense');
  assert.equal(copy.config.wan, 'igb0');
  assert.equal(copy.config.key, `{{STUDIO_CONNECTION_${id}_KEY}}`);
  assert.equal(placed.json.services.find(item => item.id === copy.serviceId).config.href, 'https://fw.example.test');
  assert.deepEqual(placed.json.board.panels.find(item => item.id === copy.id).look, { corners: 'round' });
  const theirs = await f.request('/family/studio/api/connections');
  assert.deepEqual(theirs.json.connections.map(item => [item.id, item.name, item.has.key]), [[id, 'Firewall', true]]);
  // Placing it again makes a second, independent widget with its own name.
  const again = await f.post('/family/studio/api/library/use', { scope: 'everyone', id: saved.json.entry.id, revision: placed.json.revision, pageId: 'home' });
  assert.equal(again.status, 200, again.text);
  assert.deepEqual(again.json.services.map(item => item.name).sort(), ['Edge', 'Edge 2']);
});

test('an archived dashboard is deleted for good when its name is typed, and its address becomes free', async t => {
  const f = await fixture(t);
  const child = await f.create('garden');
  const childState = dashboardStateDir(f.stateDir, child.id);
  assert.equal((await f.mutate({ action: 'delete', id: child.id, confirmName: 'garden' })).status, 400, 'only an archived dashboard');
  assert.equal((await f.mutate({ action: 'archive', id: child.id, confirmed: true })).status, 200);
  let overview = (await f.request('/studio/api/overview')).json;
  const archived = overview.dashboards.find(item => item.id === child.id);
  assert.equal(overview.archiveRetention, 30);
  assert.equal(Date.parse(archived.deletesAt) - Date.parse(archived.archivedAt), 30 * 24 * 60 * 60 * 1000);
  assert.equal((await f.mutate({ action: 'delete', id: child.id, confirmName: 'Garden' })).status, 400, 'the exact name');
  assert.equal((await f.mutate({ action: 'expire' })).status, 400, 'expiry is never a request');
  const deleted = await f.mutate({ action: 'delete', id: child.id, confirmName: 'garden' });
  assert.equal(deleted.status, 200, deleted.text);
  assert.ok(!deleted.json.registry.dashboards.some(item => item.id === child.id));
  await assert.rejects(fs.stat(dashboardConfigDir(f.configDir, child.id)), { code: 'ENOENT' });
  await assert.rejects(fs.stat(childState), { code: 'ENOENT' });
  // The address is free again.
  await f.create('garden');
  // Never keeps archives until someone deletes them; the default is not stored.
  assert.equal((await f.mutate({ action: 'retention', days: 'never' })).status, 200);
  overview = (await f.request('/studio/api/overview')).json;
  assert.equal(overview.archiveRetention, 'never');
  assert.equal((await f.mutate({ action: 'retention', days: 14 })).status, 400);
  assert.equal((await f.mutate({ action: 'retention', days: 30 })).status, 200);
  const registryFile = JSON.parse(await fs.readFile(path.join(f.configDir, DASHBOARD_REGISTRY_FILE), 'utf8'));
  assert.equal(Object.hasOwn(registryFile, 'archiveRetention'), false);
});

// Option audit against 6a93f66: an integration widget's Docker container was
// set on its service's own tile, which round 4 folded into the widget. It is
// changed with the widget again.
test('an integration widget keeps its Docker server and container', async t => {
  const f = await fixture(t);
  const current = await f.state();
  const added = await f.post('/studio/api/service-widget', { revision: current.revision, action: 'add', newService: { name: 'Media' }, service: { href: 'https://media.example.test', server: 'my-docker', container: 'jellyfin' }, type: 'jellyfin', config: { url: 'https://media.example.test', key: 'k' } });
  assert.equal(added.status, 200, added.text);
  const widget = added.json.serviceWidgets.find(item => item.type === 'jellyfin');
  const service = added.json.services.find(item => item.id === widget.serviceId);
  assert.equal(service.config.server, 'my-docker');
  assert.equal(service.config.container, 'jellyfin');
  const cleared = await f.post('/studio/api/service-widget', { revision: added.json.revision, action: 'update', id: widget.id, service: { server: null, container: null }, config: {} });
  assert.equal(cleared.status, 200, cleared.text);
  const after = cleared.json.services.find(item => item.id === widget.serviceId);
  assert.equal(after.config.server, undefined);
  assert.equal(after.config.container, undefined);
  const refused = await f.post('/studio/api/service-widget', { revision: cleared.json.revision, action: 'update', id: widget.id, service: { showStats: true }, config: {} });
  assert.equal(refused.status, 422);
  assert.match(refused.text, /Docker container can change with it/);
});

// Security review of 1a936b1 (H1): adding or removing a trusted certificate
// once waited on itself for ever. Through the real server and its onChange.
test('a trusted certificate is added, listed and removed, and workers start again each time', async t => {
  const f = await fixture(t);
  const ca = await fs.readFile(new URL('./fixtures/example-ca.pem', import.meta.url), 'utf8');
  const bundle = path.join(f.stateDir, 'trusted-certificates.pem');
  const added = await f.post('/studio/api/trusted-certificates', { action: 'add', pem: ca });
  assert.equal(added.status, 200, added.text);
  assert.equal(added.json.certificates.length, 1);
  assert.equal(added.json.certificates[0].source, 'added');
  assert.equal(added.json.certificates[0].pem, undefined);
  assert.ok(f.drains.includes('*'));
  assert.equal(await fs.readFile(bundle, 'utf8'), ca.replace(/\r\n/g, '\n').trim() + '\n');
  const listed = await f.request('/studio/api/trusted-certificates');
  assert.equal(listed.status, 200, listed.text);
  assert.deepEqual(listed.json.certificates.map(entry => entry.id), [added.json.certificates[0].id]);
  f.drains.length = 0;
  const removed = await f.post('/studio/api/trusted-certificates', { action: 'remove', id: added.json.certificates[0].id });
  assert.equal(removed.status, 200, removed.text);
  assert.deepEqual(removed.json.certificates, []);
  assert.deepEqual(f.drains, ['*']);
  await assert.rejects(fs.access(bundle));
  // The queue is free again: another add answers too.
  const again = await f.post('/studio/api/trusted-certificates', { action: 'add', pem: ca });
  assert.equal(again.status, 200, again.text);
});

// Security review of 1a936b1 (L2): a Docker secret or variable reference is
// only filled in for the address a saved widget already sends it to.
test('Test connection only fills in a secret reference for the address it is saved with', async t => {
  const f = await fixture(t);
  const current = await f.state();
  const saved = await f.post('/studio/api/service-widget', { revision: current.revision, action: 'add', newService: { name: 'Media' }, service: { href: 'https://media.example.test' }, type: 'jellyfin', config: { url: 'https://media.example.test', key: '{{HOMEPAGE_FILE_JELLYFIN_KEY}}' } });
  assert.equal(saved.status, 200, saved.text);
  const elsewhere = await f.post('/studio/api/connection-test', { widget: { type: 'jellyfin', url: 'https://collector.example.test', key: '{{HOMEPAGE_FILE_JELLYFIN_KEY}}' } });
  assert.equal(elsewhere.status, 200, elsewhere.text);
  assert.equal(elsewhere.json.kind, 'address');
  assert.match(elsewhere.json.message, /only sent to the address it is saved with/);
  const variable = await f.post('/studio/api/connection-test', { widget: { type: 'jellyfin', url: 'https://collector.example.test', key: '{{HOMEPAGE_VAR_KEY}}' } });
  assert.equal(variable.json.kind, 'address');
  // A reference inside the address is held to the same rule.
  for (const url of ['https://collector.example.test/{{HOMEPAGE_FILE_DB_PASSWORD}}', 'https://{{HOMEPAGE_VAR_SECRET}}.collector.example.test/']) {
    const inAddress = await f.post('/studio/api/connection-test', { widget: { type: 'customapi', url } });
    assert.equal(inAddress.json.kind, 'address', url);
  }
  const own = await f.post('/studio/api/connection-test', { widget: { type: 'jellyfin', url: 'https://media.example.test', key: '{{HOMEPAGE_FILE_JELLYFIN_KEY}}' } });
  assert.equal(own.status, 200, own.text);
  assert.notEqual(own.json.kind, 'address');
  const typed = await f.post('/studio/api/connection-test', { widget: { type: 'jellyfin', url: 'https://collector.example.test', key: 'typed-in' } });
  assert.notEqual(typed.json.kind, 'address');
});
