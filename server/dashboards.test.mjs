import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createDashboardRegistry, resolveDashboardRoute } from './dashboards.mjs';
import { DASHBOARD_REGISTRY_FILE, DASHBOARD_REGISTRY_MARKER, validateDashboardManifest, dashboardConfigDir } from './dashboard-paths.mjs';

async function fixture(t, prepare, cleanup) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-dashboard-registry-'));
  const configRoot = path.join(root, 'config');
  const prepared = [];
  const cleaned = [];
  const registry = createDashboardRegistry({ configRoot, prepareDashboard: async (entry, source) => {
    prepared.push({ entry: structuredClone(entry), source: source && structuredClone(source) });
    await prepare?.(entry, source);
  }, cleanupDashboard: async entry => { cleaned.push(structuredClone(entry)); await cleanup?.(entry); } });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, configRoot, registry, prepared, cleaned };
}
const rejectsCode = (promise, code) => assert.rejects(promise, error => error.code === code);
const create = async (registry, slug, sourceId) => registry.mutate({ action: 'create', revision: (await registry.read()).revision, name: slug || 'Valid dashboard name', slug, ...(sourceId ? { sourceId } : {}) });

test('adopts existing root bytes and retains stable identity across restart', async t => {
  const f = await fixture(t);
  await fs.mkdir(f.configRoot);
  const file = path.join(f.configRoot, 'services.yaml');
  const bytes = '# Native user configuration\ncustom: &shared [one, two]\n';
  await fs.writeFile(file, bytes);
  const manifest = await f.registry.initialize();
  assert.deepEqual(manifest.dashboards, [{ id: 'default', name: 'Main dashboard', slug: '', archived: false }]);
  assert.equal(await fs.readFile(file, 'utf8'), bytes);
  const second = createDashboardRegistry({ configRoot: f.configRoot, prepareDashboard: () => assert.fail('No reseeding') });
  assert.deepEqual(await second.initialize(), manifest);
  manifest.dashboards[0].name = 'Caller mutation';
  assert.equal((await second.read()).dashboards[0].name, 'Main dashboard');
});

test('creation publishes only after initialization and failed preparation does not reserve a slug', async t => {
  let registry, fail = true;
  const f = await fixture(t, async entry => {
    if (entry.id === 'default') return;
    assert.equal((await registry.read()).dashboards.length, 1);
    if (fail) throw new Error('Synthetic disk failure');
  });
  registry = f.registry;
  const initial = await registry.initialize();
  await assert.rejects(create(registry, 'family'), /Synthetic disk/);
  assert.deepEqual(await registry.read(), initial);
  assert.equal(f.cleaned.length, 1);
  assert.notEqual(f.cleaned[0].id, 'default');
  fail = false;
  const result = await create(registry, 'family');
  assert.equal(result.registry.dashboards.length, 2);
  assert.equal(dashboardConfigDir(f.configRoot, result.dashboard.id), path.join(f.configRoot, 'dashboards', result.dashboard.id));
});

test('cleanup preserves the original failure and never exposes cleanup error details', async t => {
  const original = new Error('Original preparation failure');
  const f = await fixture(t, entry => { if (entry.id !== 'default') throw original; }, () => { throw new Error('private cleanup path /secret'); });
  await f.registry.initialize();
  const logged = [];
  const log = t.mock.method(console, 'error', (...values) => logged.push(values.join(' ')));
  await assert.rejects(create(f.registry, 'failed'), error => error === original);
  log.mock.restore();
  assert.equal(f.cleaned.length, 1);
  assert.deepEqual(logged, ['Unpublished dashboard cleanup failed: DASHBOARD_CLEANUP_FAILED']);
  assert.equal((await f.registry.read()).dashboards.length, 1);
});

test('post-rename directory sync failure retains a registered dashboard and its files', async t => {
  let configRoot;
  const f = await fixture(t, async entry => {
    if (entry.id === 'default') return;
    const directory = dashboardConfigDir(configRoot, entry.id);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'private.txt'), 'retained dashboard bytes');
  }, () => assert.fail('A registered id must never be cleaned up'));
  configRoot = f.configRoot;
  await f.registry.initialize();
  const open = fs.open;
  const patch = t.mock.method(fs, 'open', async (...args) => {
    const handle = await open(...args);
    if (args[0] === f.configRoot && args[1] === 'r') handle.sync = async () => { throw new Error('Synthetic post-rename sync failure'); };
    return handle;
  });
  try { await assert.rejects(create(f.registry, 'retained'), /post-rename sync failure/); }
  finally { patch.mock.restore(); }
  const current = await f.registry.read();
  const entry = current.dashboards.find(item => item.slug === 'retained');
  assert.ok(entry);
  assert.equal(f.cleaned.length, 0);
  assert.equal(await fs.readFile(path.join(dashboardConfigDir(f.configRoot, entry.id), 'private.txt'), 'utf8'), 'retained dashboard bytes');
});

test('an unreadable registry after failure never authorizes deletion and default adoption never invokes cleanup', async t => {
  let file;
  const f = await fixture(t, async entry => {
    if (entry.id === 'default') return;
    await fs.writeFile(file, '{interrupted registry');
    throw new Error('Original failed creation');
  });
  await f.registry.initialize();
  file = path.join(f.configRoot, DASHBOARD_REGISTRY_FILE);
  await assert.rejects(create(f.registry, 'ambiguous'), /Original failed creation/);
  assert.equal(f.cleaned.length, 0);
  assert.equal(await fs.readFile(file, 'utf8'), '{interrupted registry');

  const adopted = await fixture(t, () => { throw new Error('Invalid adopted source'); });
  await fs.mkdir(adopted.configRoot);
  await fs.writeFile(path.join(adopted.configRoot, 'services.yaml'), '# Existing operator data\n');
  await assert.rejects(adopted.registry.initialize(), /Invalid adopted source/);
  assert.equal(adopted.cleaned.length, 0);
  assert.equal(await fs.readFile(path.join(adopted.configRoot, 'services.yaml'), 'utf8'), '# Existing operator data\n');
});

test('stale simultaneous mutations and restart cannot overwrite another registry update', async t => {
  const f = await fixture(t);
  const initial = await f.registry.initialize();
  const results = await Promise.allSettled(['alpha', 'beta'].map(slug => f.registry.mutate({ action: 'create', revision: initial.revision, name: slug, slug })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'DASHBOARD_REVISION_CONFLICT');
  const restarted = createDashboardRegistry({ configRoot: f.configRoot, prepareDashboard: async () => {} });
  await restarted.initialize();
  await rejectsCode(restarted.mutate({ action: 'create', revision: initial.revision, name: 'gamma', slug: 'gamma' }), 'DASHBOARD_REVISION_CONFLICT');
  assert.equal((await restarted.read()).dashboards.length, 2);
});

test('duplication resolves an active source and reserves independent identity', async t => {
  const { registry, prepared } = await fixture(t);
  await registry.initialize();
  const source = (await create(registry, 'family')).dashboard;
  const duplicate = (await create(registry, 'family-copy', source.id)).dashboard;
  assert.notEqual(duplicate.id, source.id);
  assert.equal(prepared.at(-1).source.id, source.id);
  await rejectsCode(create(registry, 'missing', randomUUID()), 'DASHBOARD_NOT_FOUND');
});

test('rename, archive and restore preserve data identity and retain reserved archived addresses', async t => {
  const { registry } = await fixture(t);
  await registry.initialize();
  const first = (await create(registry, 'family')).dashboard;
  let result = await registry.mutate({ action: 'update', revision: (await registry.read()).revision, id: first.id, name: 'House', slug: 'house' });
  assert.equal(result.dashboard.id, first.id);
  await rejectsCode(registry.mutate({ action: 'archive', revision: result.registry.revision, id: first.id }), 'DASHBOARD_CONFIRMATION_REQUIRED');
  result = await registry.mutate({ action: 'archive', revision: result.registry.revision, id: first.id, confirmed: true });
  assert.equal(result.dashboard.archived, true);
  await rejectsCode(create(registry, 'house'), 'DASHBOARD_SLUG_CONFLICT');
  await rejectsCode(create(registry, 'copy', first.id), 'DASHBOARD_NOT_FOUND');
  assert.throws(() => resolveDashboardRoute(result.registry, '/house'), error => error.status === 404);
  result = await registry.mutate({ action: 'restore', revision: result.registry.revision, id: first.id });
  assert.equal(result.dashboard.archived, false);
  assert.equal(result.dashboard.id, first.id);
  await rejectsCode(registry.mutate({ action: 'archive', revision: result.registry.revision, id: 'default', confirmed: true }), 'DEFAULT_DASHBOARD_REQUIRED');
});

test('default can move to a slug with root redirect while named paths keep queries and explicit routing', async t => {
  const { registry } = await fixture(t);
  await registry.initialize();
  const child = (await create(registry, 'family')).dashboard;
  const changed = await registry.mutate({ action: 'update', revision: (await registry.read()).revision, id: 'default', name: 'Admin', slug: 'admin' });
  assert.equal(resolveDashboardRoute(changed.registry, '/?screen=1').redirect, '/admin?screen=1');
  assert.equal(resolveDashboardRoute(changed.registry, '/family/api/services?q=1').path, '/api/services?q=1');
  assert.equal(resolveDashboardRoute(changed.registry, '/family').dashboard.id, child.id);
  assert.equal(resolveDashboardRoute(changed.registry, '/family?x=1').path, '/?x=1');
  assert.throws(() => resolveDashboardRoute(changed.registry, '/api/services'), error => error.status === 404);
  for (const name of ['homepage.ico', 'safari-pinned-tab.svg', 'mstile-310x310.png', '_next/static/a.js']) assert.equal(resolveDashboardRoute(changed.registry, '/' + name).shared, true);
});

test('invalid slugs, unknown fields and ambiguous encoded paths fail closed', async t => {
  const { registry } = await fixture(t);
  await registry.initialize();
  for (const slug of ['', 'API', 'api', '__studio', 'config', '../escape', 'space here', '-bad', 'bad-', 'a'.repeat(65)]) await rejectsCode(create(registry, slug), 'INVALID_DASHBOARD_SLUG');
  const manifest = (await create(registry, 'family')).registry;
  for (const target of ['//family', '/family/../api', '/family/%2e%2e/api', '/family/%2Fapi', '/family/%5capi', '/family/%00', '/family/%XX', '/family\\api']) assert.throws(() => resolveDashboardRoute(manifest, target), error => error.code === 'INVALID_DASHBOARD_PATH');
  await rejectsCode(registry.mutate({ action: '__proto__', revision: manifest.revision }), 'INVALID_DASHBOARD_ACTION');
  await rejectsCode(registry.mutate({ action: 'create', revision: manifest.revision, name: 'bad', slug: 'bad', id: 'default' }), 'INVALID_DASHBOARD_ACTION');
  for (const bad of [{ ...manifest, extra: true }, { ...manifest, revision: [manifest.revision] }, { ...manifest, dashboards: [{ ...manifest.dashboards[0], archived: true }] }]) assert.throws(() => validateDashboardManifest(bad), error => error.code === 'INVALID_DASHBOARD_REGISTRY');
});

test('unsafe registry files and symlinked storage never rewrite their targets', async t => {
  const f = await fixture(t);
  await f.registry.initialize();
  const outside = path.join(f.root, 'outside');
  await fs.writeFile(outside, 'untouched');
  const file = path.join(f.configRoot, DASHBOARD_REGISTRY_FILE);
  await fs.unlink(file); await fs.symlink(outside, file);
  await rejectsCode(f.registry.read(), 'INVALID_DASHBOARD_REGISTRY');
  assert.equal(await fs.readFile(outside, 'utf8'), 'untouched');
  const alias = path.join(f.root, 'alias');
  await fs.symlink(f.configRoot, alias);
  await rejectsCode(createDashboardRegistry({ configRoot: alias, prepareDashboard: async () => {} }).initialize(), 'UNSAFE_DASHBOARD_STORAGE');
});

test('corrupt or missing registry never silently resets an initialized deployment', async t => {
  const f = await fixture(t);
  await f.registry.initialize();
  const file = path.join(f.configRoot, DASHBOARD_REGISTRY_FILE);
  await fs.writeFile(file, '{broken');
  await rejectsCode(f.registry.initialize(), 'INVALID_DASHBOARD_REGISTRY');
  assert.equal(await fs.readFile(file, 'utf8'), '{broken');
  await fs.unlink(file);
  await rejectsCode(f.registry.read(), 'DASHBOARDS_NOT_READY');
  await rejectsCode(f.registry.initialize(), 'DASHBOARD_REGISTRY_MISSING');
  await fs.unlink(path.join(f.configRoot, DASHBOARD_REGISTRY_MARKER));
  await fs.mkdir(path.join(f.configRoot, 'dashboards', randomUUID()), { recursive: true });
  await rejectsCode(f.registry.initialize(), 'DASHBOARD_REGISTRY_MISSING');
});

test('valid registry repairs partial regular markers atomically, but a missing registry cannot do so', async t => {
  const f = await fixture(t);
  await f.registry.initialize();
  await f.registry.mutate({ action: 'update', revision: (await f.registry.read()).revision, id: 'default', name: 'Admin', slug: 'admin' });
  const file = path.join(f.configRoot, DASHBOARD_REGISTRY_FILE), marker = path.join(f.configRoot, DASHBOARD_REGISTRY_MARKER);
  const bytes = await fs.readFile(file);
  const restarted = createDashboardRegistry({ configRoot: f.configRoot, prepareDashboard: () => assert.fail('No reseeding') });
  for (const partial of ['', '1', 'interrupted']) {
    await fs.writeFile(marker, partial);
    assert.equal((await restarted.initialize()).dashboards[0].slug, 'admin');
    assert.deepEqual(await fs.readFile(file), bytes);
    assert.equal(await fs.readFile(marker, 'utf8'), '1\n');
    assert.equal((await fs.readdir(f.configRoot)).some(name => name.startsWith('.studio-marker-')), false);
  }
  await fs.writeFile(marker, ''); await fs.unlink(file);
  await rejectsCode(restarted.initialize(), 'DASHBOARD_REGISTRY_MISSING');
  assert.equal(await fs.readFile(marker, 'utf8'), '');
});

test('marker repair rejects links and directories without changing targets', async t => {
  const f = await fixture(t);
  await f.registry.initialize();
  const marker = path.join(f.configRoot, DASHBOARD_REGISTRY_MARKER), outside = path.join(f.root, 'outside');
  await fs.writeFile(outside, 'untouched'); await fs.unlink(marker); await fs.symlink(outside, marker);
  await rejectsCode(f.registry.initialize(), 'INVALID_DASHBOARD_REGISTRY');
  assert.equal(await fs.readFile(outside, 'utf8'), 'untouched');
  await fs.unlink(marker); await fs.mkdir(marker);
  await rejectsCode(f.registry.initialize(), 'INVALID_DASHBOARD_REGISTRY');
});
