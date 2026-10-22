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
    async close() { closes++; },
  };
  const app = createStudioServer({ configDir, stateDir, rendererDir, rendererPool: pool, allowedHosts: HOST, buildRevision: BUILD });
  const port = await listen(app.server);
  t.after(async () => {
    beforeAcquire = undefined;
    await app.shutdown({ graceMs: 25 });
    for (const socket of peers) socket.destroy();
    for (const { native } of natives.values()) { native.closeAllConnections(); await new Promise(done => native.close(done)); }
    await fs.rm(root, { recursive: true, force: true });
  });
  const request = (target, { method = 'GET', body, headers = {} } = {}) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: target, method, agent: false, headers: { host: HOST, ...headers } }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('error', reject);
      res.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); let json; try { json = JSON.parse(text); } catch {} resolve({ status: res.statusCode, headers: res.headers, text, json }); });
    });
    req.on('error', reject); req.setTimeout(5000, () => req.destroy(new Error('Isolated dashboard request timed out'))); req.end(body);
  });
  const post = (url, value, headers = {}) => request(url, { method: 'POST', body: JSON.stringify(value), headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-studio-request': '1', ...headers } });
  const mutate = async change => post('/__studio/api/dashboards', { revision: (await request('/__studio/api/dashboards')).json.revision, ...change });
  const create = async (slug, sourceId) => { const result = await mutate({ action: 'create', name: slug, slug, ...(sourceId ? { sourceId } : {}) }); assert.equal(result.status, 200, result.text); return result.json.dashboard; };
  const state = async (slug = '') => { const result = await request(`${slug ? '/' + slug : ''}/__studio/api/state`); assert.equal(result.status, 200, result.text); return result.json; };
  return { ...app, root, configDir, stateDir, rendererDir, port, pool, acquisitions, drains, request, post, mutate, create, state, setBeforeAcquire(fn) { beforeAcquire = fn; }, get leases() { return leases; }, get releases() { return releases; }, get closes() { return closes; }, get handlerCount() { return app.dashboardHandlerCount; } };
}

test('all nine native files duplicate independently with their own revisions and history', async t => {
  const f = await fixture(t);
  const initial = await f.state();
  const edits = { servicesYaml: '# Root services\n- Apps:\n    - App:\n        href: https://app.example.test\n', bookmarksYaml: '# Links\n[]\n', widgetsYaml: '# Information\n[]\n', settingsYaml: 'title: Root\ntheme: dark\ncolor: purple\n', dockerYaml: '# Docker\n{}\n', kubernetesYaml: '# Kubernetes\n{}\n', proxmoxYaml: '# Proxmox\n{}\n', customCss: '.only-root { color: purple; }', customJs: 'window.onlyRoot = true;' };
  const saved = await f.post('/__studio/api/save', { revision: initial.revision, ...edits }); assert.equal(saved.status, 200, saved.text);
  const child = await f.create('family', 'default');
  const copied = await f.state('family');
  for (const [field, bytes] of Object.entries(edits)) assert.equal(copied[field], bytes, field);
  assert.deepEqual(copied.services.map(item => item.id), saved.json.services.map(item => item.id), 'A duplicated board keeps its internal stable identities in isolated storage.');
  const childSave = await f.post('/family/__studio/api/save', { revision: copied.revision, settingsYaml: 'title: Family\ntheme: light\ncolor: blue\n', customCss: '.family { color: blue; }', customJs: 'window.family = true;' });
  assert.equal(childSave.status, 200, childSave.text);
  assert.equal((await f.state()).settingsYaml, edits.settingsYaml);
  assert.equal((await f.request('/family/api/config')).json.id, child.id);
  assert.match((await f.request('/family/api/config')).json.settings, /Family/);
  assert.match((await f.request('/api/config')).json.settings, /Root/);
  const rootBackups = (await f.request('/__studio/api/backups')).json;
  const list = Array.isArray(rootBackups) ? rootBackups : rootBackups.backups;
  assert.ok(list.length);
  const foreign = await f.post('/family/__studio/api/restore', { revision: childSave.json.revision, backupId: list[0].id });
  assert.equal(foreign.status, 404, foreign.text);
  assert.notEqual(dashboardStateDir(f.stateDir, child.id), f.stateDir);
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
    [path.join(f.rendererDir, '.next', 'BUILD_ID'), '/__studio/application-ready', 503],
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
  const redirect = await f.request('/?view=1'); assert.equal(redirect.status, 307); assert.equal(redirect.headers.location, '/admin?view=1');
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
  assert.equal((await f.post('/family/__studio/api/save', { revision: current.revision, settingsYaml: 'title: Wrong\n' }, { origin: 'https://foreign.example.test' })).status, 403);
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
  assert.equal((await f.request('/__studio/ready')).status, 503);
  assert.equal((await f.request('/family/__studio/ready')).status, 200);
  const before = f.acquisitions.length;
  const health = await f.request('/__studio/application-ready'); assert.equal(health.status, 200, health.text);
  assert.equal(f.acquisitions.length, before, 'Application health does not acquire or parse a selected worker.');
  const asset = await f.request('/_next/static/chunks/shared.js'); assert.equal(asset.status, 200); assert.equal(asset.text, '/* immutable build */');
  assert.equal((await f.request('/homepage.ico')).text, 'native icon');
  assert.equal(f.acquisitions.length, before, 'Shared resources are independent of default configuration and workers.');
  assert.equal((await f.request('/_next/static/chunks/shared.js', { headers: { 'if-none-match': asset.headers.etag } })).status, 304);
  const head = await f.request('/_next/static/chunks/shared.js', { method: 'HEAD' }); assert.equal(head.text, ''); assert.equal(Number(head.headers['content-length']), asset.text.length);
  assert.equal((await fs.readdir(f.configDir)).some(name => name.includes('readiness')), false);
  assert.equal((await fs.readdir(f.stateDir)).some(name => name.includes('readiness')), false);
  await fs.unlink(path.join(f.rendererDir, '.next', 'BUILD_ID'));
  assert.equal((await f.request('/__studio/application-ready')).status, 503);
});

test('shared asset links and malformed registry fail closed without leaking paths', async t => {
  const f = await fixture(t); await f.initialization;
  const outside = path.join(f.root, 'private.txt'); await fs.writeFile(outside, 'private fixture');
  await fs.symlink(outside, path.join(f.rendererDir, 'public', 'homepage.ico.link'));
  await fs.unlink(path.join(f.rendererDir, 'public', 'homepage.ico')); await fs.symlink(outside, path.join(f.rendererDir, 'public', 'homepage.ico'));
  const result = await f.request('/homepage.ico'); assert.equal(result.status, 404); assert.doesNotMatch(result.text, /private fixture|studio-multi-http/);
  await fs.writeFile(path.join(f.configDir, DASHBOARD_REGISTRY_FILE), '{broken');
  assert.equal((await f.request('/__studio/application-ready')).status, 503);
  const robots = await f.request('/robots.txt'); assert.equal(robots.status, 503); assert.equal(robots.text, 'User-agent: *\nDisallow: /\n');
  assert.equal((await f.request('/__studio/live')).status, 200);
});

test('robots uses each resolved native setting without acquiring renderer workers', async t => {
  const f = await fixture(t); const child = await f.create('family');
  await fs.writeFile(path.join(f.configDir, 'settings.yaml'), 'disableIndexing: true\n');
  await fs.writeFile(path.join(dashboardConfigDir(f.configDir, child.id), 'settings.yaml'), 'disableIndexing: false\n');
  const before = f.acquisitions.length;
  const robots = await f.request('/robots.txt'); assert.equal(robots.status, 200); assert.match(robots.text, /Disallow: \/\n/); assert.match(robots.text, /Allow: \/family\$/);
  assert.equal(f.acquisitions.length, before);
  const head = await f.request('/robots.txt', { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(head.text, ''); assert.equal(Number(head.headers['content-length']), robots.text.length);
});

test('native upgrades preserve initial bytes and peer FIN releases the worker lease', async t => {
  const f = await fixture(t), child = await f.create('family');
  const socket = net.connect(f.port, '127.0.0.1'); await once(socket, 'connect');
  let received = ''; const ready = deferred();
  socket.on('data', data => { received += data.toString(); if (received.includes('CLIENT-HEAD')) ready.resolve(); });
  socket.write(`GET /family/api/socket HTTP/1.1\r\nHost: ${HOST}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\nCLIENT-HEAD`);
  await ready.promise;
  assert.match(received, /101 Switching Protocols/); assert.ok(received.includes('X-Native-Id: ' + child.id)); assert.match(received, /NATIVE-HEAD/);
  const closed = once(socket, 'close'); socket.write('FINISH'); await closed;
  assert.equal(f.leases, 0); assert.equal(f.releases, 1);
});

test('bounded shutdown closes upgraded sockets and closes the worker pool exactly once', async t => {
  const f = await fixture(t); await f.create('family');
  const socket = net.connect(f.port, '127.0.0.1'); await once(socket, 'connect');
  const received = once(socket, 'data');
  socket.write(`GET /family/api/socket HTTP/1.1\r\nHost: ${HOST}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`);
  await received;
  const closed = once(socket, 'close');
  const first = f.shutdown({ graceMs: 20 }), second = f.shutdown({ graceMs: 100 });
  assert.equal(first, second); await first; await closed;
  assert.equal(f.closes, 1); assert.equal(f.leases, 0);
});
