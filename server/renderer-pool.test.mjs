import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRendererPool } from './renderer-pool.mjs';
import { dashboardConfigDir } from './dashboard-paths.mjs';

const host = 'dashboard.test';
const revision = 'qualified-build';
const worker = `
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const configDir = process.env.HOMEPAGE_CONFIG_DIR;
const cached = JSON.parse(fs.readFileSync(path.join(configDir, 'fixture.json'), 'utf8'));
fs.writeFileSync(path.join(configDir, 'pid'), String(process.pid));
let cookie = '';
if (cached.ignoreTerm) process.on('SIGTERM', () => {});
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/studio/health') {
    if (cached.silent) return;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({protocolVersion: 1, upstreamCommit: '51cc1684f9f34a7877ed462b8f94c9cc687b4dde', buildRevision: cached.badBuild ? 'wrong-build' : process.env.STUDIO_BUILD_REVISION, dashboardId: process.env.STUDIO_DASHBOARD_ID, dashboardBasePath: process.env.STUDIO_DASHBOARD_BASE_PATH, rendererInstance: cached.badContext ? 'another-worker' : process.env.STUDIO_RENDERER_INSTANCE}));
  } else if (url.pathname === '/crash') {
    res.end('{}'); setImmediate(() => process.exit(19));
  } else {
    if (url.searchParams.has('cookie')) cookie = url.searchParams.get('cookie');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({pid: process.pid, id: process.env.STUDIO_DASHBOARD_ID, basePath: process.env.STUDIO_DASHBOARD_BASE_PATH, configDir, cached, cookie, auth: process.env.HOMEPAGE_AUTH_ENABLED, mcpWrite: process.env.HOMEPAGE_MCP_ALLOW_WRITE, hostname: process.env.HOSTNAME, allowedHosts: process.env.HOMEPAGE_ALLOWED_HOSTS, requestHost: req.headers.host}));
  }
});
setTimeout(() => server.listen(Number(process.env.PORT), process.env.HOSTNAME), cached.startMs || 0);
`;

async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-renderer-pool-'));
  const configRoot = path.join(root, 'config');
  const appRoot = path.join(root, 'runtime');
  await fs.mkdir(configRoot);
  await fs.mkdir(appRoot);
  const workerScript = path.join(appRoot, 'worker.mjs');
  await fs.writeFile(workerScript, worker);
  const pool = createRendererPool({ configRoot, appRoot, workerScript, allowedHosts: host, buildRevision: revision, startupMs: 2500, idleMs: 10000, ...options });
  t.after(async () => { await pool.close(); await fs.rm(root, { recursive: true, force: true }); });
  const entry = async (slug, value = {}, id = randomUUID()) => {
    const descriptor = { id, name: slug || 'Main', slug, archived: false };
    const configDir = dashboardConfigDir(configRoot, id);
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(path.join(configDir, 'fixture.json'), JSON.stringify(value));
    return descriptor;
  };
  return { root, appRoot, configRoot, workerScript, pool, entry };
}

function request(origin, pathname = '/state') {
  return new Promise((resolve, reject) => {
    const req = http.get(new URL(pathname, origin), { headers: { host }, timeout: 1000 }, res => {
      const chunks = [];
      res.on('data', data => chunks.push(data));
      res.once('error', reject);
      res.once('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (error) { reject(error); }
      });
    });
    req.once('error', reject);
    req.once('timeout', () => req.destroy(new Error('Fixture request timed out')));
  });
}

async function until(condition, timeout = 3000) {
  const deadline = Date.now() + timeout;
  while (!(await condition())) {
    if (Date.now() >= deadline) assert.fail('Timed out waiting for worker lifecycle transition');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
const rejectsCode = (promise, code) => assert.rejects(promise, error => error.code === code);
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };

test('isolates real child configuration, process caches and cookies while sharing one dashboard worker', async t => {
  const f = await fixture(t, { workerEnv: { HOMEPAGE_AUTH_ENABLED: 'true', HOMEPAGE_MCP_ALLOW_WRITE: 'true' } });
  const alpha = await f.entry('alpha', { service: 'same-label', credential: 'alpha-value' });
  const beta = await f.entry('beta', { service: 'same-label', credential: 'beta-value' });
  const [a1, a2, b] = await Promise.all([f.pool.acquire(alpha, host), f.pool.acquire(alpha, host), f.pool.acquire(beta, host)]);
  assert.equal(a1.origin.href, a2.origin.href);
  assert.notEqual(a1.origin.href, b.origin.href);
  const aState = await request(a1.origin, '/state?cookie=alpha-session');
  const bState = await request(b.origin);
  assert.notEqual(aState.pid, bState.pid);
  assert.equal(aState.cached.credential, 'alpha-value');
  assert.equal(bState.cached.credential, 'beta-value');
  assert.equal(bState.cookie, '');
  assert.equal((await request(a2.origin)).cookie, 'alpha-session');
  assert.equal(aState.configDir, dashboardConfigDir(f.configRoot, alpha.id));
  assert.equal(aState.id, alpha.id);
  assert.equal(aState.basePath, '/alpha');
  assert.equal(aState.auth, 'false');
  assert.equal(aState.mcpWrite, 'false');
  assert.equal(aState.hostname, '127.0.0.1');
  assert.equal(aState.allowedHosts, host);
  assert.equal(aState.requestHost, host);
  await fs.writeFile(path.join(aState.configDir, 'fixture.json'), JSON.stringify({ credential: 'new-alpha' }));
  assert.equal((await request(a2.origin)).cached.credential, 'alpha-value');
  a1.release(); a1.release();
  await f.pool.drain(alpha.id);
  assert.equal((await request(a2.origin)).pid, aState.pid);
  a2.release();
  await until(() => f.pool.workerCount === 1);
  assert.equal(alive(aState.pid), false);
  assert.equal((await request(b.origin)).pid, bState.pid);
  b.release();
});

test('default configuration stays at the root and a slug rename preserves active leases', async t => {
  const f = await fixture(t);
  const original = await f.entry('', { title: 'admin' }, 'default');
  const first = await f.pool.acquire(original, host);
  const state = await request(first.origin);
  assert.equal(state.configDir, f.configRoot);
  assert.equal(state.basePath, '');
  const renamed = await f.pool.acquire({ ...original, slug: 'admin' }, host);
  const updated = await request(renamed.origin);
  assert.equal(updated.id, 'default');
  assert.equal(updated.basePath, '/admin');
  assert.notEqual(updated.pid, state.pid);
  assert.equal((await request(first.origin)).basePath, '');
  first.release();
  await until(() => !alive(state.pid));
  assert.equal(f.pool.workerCount, 1);
  renamed.release();
});

test('draining during startup honors an already reserved lease then reaps its child', async t => {
  const f = await fixture(t);
  const entry = await f.entry('slow', { startMs: 150 });
  const pending = f.pool.acquire(entry, host);
  await until(() => f.pool.workerCount === 1);
  await f.pool.drain(entry.id);
  const lease = await pending;
  const state = await request(lease.origin);
  assert.equal(state.id, entry.id);
  lease.release();
  await until(() => f.pool.workerCount === 0);
  assert.equal(alive(state.pid), false);
});

test('capacity cannot evict an active lease and can replace an idle worker', async t => {
  const f = await fixture(t, { maxWorkers: 1 });
  const alpha = await f.entry('alpha');
  const beta = await f.entry('beta');
  const first = await f.pool.acquire(alpha, host);
  const state = await request(first.origin);
  await rejectsCode(f.pool.acquire(beta, host), 'RENDERER_CAPACITY');
  assert.equal((await request(first.origin)).pid, state.pid);
  first.release();
  const second = await f.pool.acquire(beta, host);
  assert.equal(alive(state.pid), false);
  assert.equal(f.pool.workerCount, 1);
  assert.equal((await request(second.origin)).id, beta.id);
  second.release();
});

test('idle reaping closes a released worker and restarts it on demand', async t => {
  const f = await fixture(t, { idleMs: 40 });
  const entry = await f.entry('idle');
  const first = await f.pool.acquire(entry, host);
  const state = await request(first.origin);
  await new Promise(resolve => setTimeout(resolve, 70));
  assert.equal(f.pool.workerCount, 1);
  first.release();
  await until(() => f.pool.workerCount === 0);
  assert.equal(alive(state.pid), false);
  const next = await f.pool.acquire(entry, host);
  assert.notEqual((await request(next.origin)).pid, state.pid);
  next.release();
});

test('a crashed dashboard can restart without disturbing another dashboard', async t => {
  const f = await fixture(t);
  const alpha = await f.entry('alpha');
  const beta = await f.entry('beta');
  const [a, b] = await Promise.all([f.pool.acquire(alpha, host), f.pool.acquire(beta, host)]);
  const beforeA = await request(a.origin);
  const beforeB = await request(b.origin);
  await request(a.origin, '/crash');
  await until(() => f.pool.workerCount === 1);
  a.release();
  const restarted = await f.pool.acquire(alpha, host);
  assert.notEqual((await request(restarted.origin)).pid, beforeA.pid);
  assert.equal((await request(b.origin)).pid, beforeB.pid);
  restarted.release(); b.release();
});

test('rejects unapproved hosts, archived or malformed identities and symlinked storage before spawning', async t => {
  const f = await fixture(t);
  const entry = await f.entry('safe');
  await rejectsCode(f.pool.acquire(entry, 'elsewhere.test'), 'RENDERER_HOST_REJECTED');
  await rejectsCode(f.pool.acquire({ ...entry, archived: true }, host), 'RENDERER_DASHBOARD_UNAVAILABLE');
  await rejectsCode(f.pool.acquire({ ...entry, id: '../escape' }, host), 'INVALID_DASHBOARD_ID');
  await rejectsCode(f.pool.acquire({ ...entry, slug: '../escape' }, host), 'RENDERER_DASHBOARD_UNAVAILABLE');
  const linked = { ...entry, id: randomUUID(), slug: 'linked' };
  await fs.symlink(dashboardConfigDir(f.configRoot, entry.id), dashboardConfigDir(f.configRoot, linked.id));
  await rejectsCode(f.pool.acquire(linked, host), 'UNSAFE_RENDERER_STORAGE');
  assert.equal(f.pool.workerCount, 0);
});

test('build mismatch and timed out startup leave no worker slot or live child', async t => {
  const f = await fixture(t, { maxWorkers: 1, startupMs: 2000 });
  const mismatch = await f.entry('mismatch', { badBuild: true });
  const contextMismatch = await f.entry('context-mismatch', { badContext: true });
  const silent = await f.entry('silent', { silent: true });
  for (const [entry, code] of [[mismatch, 'RENDERER_BUILD_MISMATCH'], [mismatch, 'RENDERER_BUILD_MISMATCH'], [contextMismatch, 'RENDERER_CONTEXT_MISMATCH'], [silent, 'RENDERER_STARTUP_TIMEOUT']]) {
    await rejectsCode(f.pool.acquire(entry, host), code);
    assert.equal(f.pool.workerCount, 0);
    const pid = Number(await fs.readFile(path.join(dashboardConfigDir(f.configRoot, entry.id), 'pid'), 'utf8'));
    assert.equal(alive(pid), false);
  }
});

test('spawn failures before a PID exists do not leak renderer records', async t => {
  const f = await fixture(t, { maxWorkers: 1 });
  const entry = await f.entry('spawn');
  const spawn = t.mock.method(childProcess, 'spawn', () => {
    const child = new EventEmitter();
    queueMicrotask(() => child.emit('error', Object.assign(new Error('Synthetic pre-PID spawn failure'), { code: 'ENOENT' })));
    return child;
  });
  for (let i = 0; i < 3; i += 1) {
    await rejectsCode(f.pool.acquire(entry, host), 'RENDERER_UNAVAILABLE');
    assert.equal(f.pool.workerCount, 0);
  }
  spawn.mock.restore();
  const live = await f.pool.acquire(entry, host);
  assert.equal((await request(live.origin)).id, entry.id);
  live.release();
});

test('shutdown during startup is idempotent and cannot leave an orphan child', async t => {
  const f = await fixture(t);
  const entry = await f.entry('shutdown', { startMs: 1000 });
  const pending = f.pool.acquire(entry, host);
  const result = assert.rejects(pending, /shutting down|could not start|no longer available/);
  const pidFile = path.join(dashboardConfigDir(f.configRoot, entry.id), 'pid');
  await until(async () => { try { return Boolean(await fs.readFile(pidFile)); } catch { return false; } });
  const pid = Number(await fs.readFile(pidFile, 'utf8'));
  const shutdown = f.pool.close();
  assert.equal(f.pool.close(), shutdown);
  await shutdown; await result;
  assert.equal(f.pool.workerCount, 0);
  assert.equal(alive(pid), false);
  await rejectsCode(f.pool.acquire(entry, host), 'RENDERER_SHUTTING_DOWN');
});

test('shutdown reaps a child that ignores SIGTERM within the container grace period', async t => {
  const f = await fixture(t);
  const entry = await f.entry('stubborn', { ignoreTerm: true });
  const lease = await f.pool.acquire(entry, host);
  const { pid } = await request(lease.origin);
  const started = Date.now();
  await f.pool.close();
  assert.ok(Date.now() - started < 6500);
  assert.equal(f.pool.workerCount, 0);
  assert.equal(alive(pid), false);
  lease.release();
});
