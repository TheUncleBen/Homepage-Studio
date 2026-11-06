import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { createEngineHost } from './host.mjs';
import { hashToken } from './definitions.mjs';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('the engine runs monitors, keeps logs per dashboard and answers through the host', async () => {
  const root = mkdtempSync(join(tmpdir(), 'engine-'));
  const server = http.createServer((req, res) => { res.writeHead(200); res.end('ok'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const host = createEngineHost({ dir: join(root, 'observability'), stateRoot: root, signIn: true });
  try {
    host.start();
    const health = await host.call('health');
    assert.equal(health.storage, 'ok');
    const pushHash = hashToken('push-token-123456');
    const monitor = (id, scope, extra) => ({ id, name: id, scope, interval: 20, timeout: 5, failures: 1, retryInterval: 20, successes: 1, notify: { channels: [] }, ...extra });
    await host.set('definitions', { definitions: { monitors: [
      monitor('a', 'default', { type: 'http', http: { url, method: 'GET', accept: ['200-299'] } }),
      monitor('b', '11111111-1111-4111-8111-111111111111', { type: 'push', push: { tokenHash: pushHash, graceSeconds: 60 } }),
    ], channels: [], sources: [], alerts: [], maintenance: [], views: [] }, dashboards: [{ id: 'default', name: 'Home' }, { id: '11111111-1111-4111-8111-111111111111', name: 'Lab' }], docker: {} });
    await host.call('secrets', { list: [['supersecretvalue', 'a password']] });
    host.cast('log', [{ source_type: 'studio', scope: 'default', message: 'hello from home with supersecretvalue', severity: 6 }, { source_type: 'studio', scope: '11111111-1111-4111-8111-111111111111', message: 'hello from lab', severity: 3 }]);
    assert.ok(await host.call('push', { tokenHash: pushHash, signal: 'up' }));
    assert.equal(await host.call('push', { tokenHash: hashToken('wrong-token-123456'), signal: 'up' }), null);
    await host.call('checkNow', { id: 'a', scopes: null });
    let overview;
    for (let i = 0; i < 40; i++) { overview = await host.call('overview', { scopes: ['default'], admin: false }); if (overview.counts.up === 1) break; await wait(100); }
    assert.equal(overview.total, 1, 'one dashboard sees only its own monitor');
    assert.equal(overview.counts.up, 1);
    assert.equal(overview.health, undefined, 'non-admins do not get Studio health');
    const lab = await host.call('monitors', { scopes: ['11111111-1111-4111-8111-111111111111'] });
    assert.deepEqual(lab.monitors.map(item => item.id), ['b']);
    assert.equal(await host.call('monitor', { id: 'a', scopes: ['11111111-1111-4111-8111-111111111111'] }), null);
    await assert.rejects(host.call('nothing'), /Unknown call/);
    const stored = await host.call('storage');
    assert.equal(stored.health.storage, 'ok');
  } finally {
    await host.stop();
    server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('the host restarts an engine that exits and replays its definitions', async () => {
  const root = mkdtempSync(join(tmpdir(), 'engine-'));
  const host = createEngineHost({ dir: join(root, 'observability'), stateRoot: root });
  try {
    host.start();
    await host.set('definitions', { definitions: { monitors: [{ id: 'p', name: 'p', scope: 'default', type: 'push', push: { tokenHash: hashToken('push-token-abcdef') }, interval: 60, timeout: 10, failures: 1, retryInterval: 20, successes: 1, notify: { channels: [] } }] }, dashboards: [{ id: 'default', name: 'Home' }], docker: {} });
    // The engine ends after stop; the host starts a new one.
    await host.call('stop');
    await wait(150);
    await assert.rejects(host.call('health', null, 500), /restarting/);
    let monitors = null;
    for (let i = 0; i < 50 && !monitors; i++) { await wait(200); try { monitors = await host.call('monitors', { scopes: null }); } catch {} }
    assert.ok(monitors, 'engine came back');
    assert.deepEqual(monitors.monitors.map(item => item.id), ['p'], 'definitions were replayed');
  } finally {
    await host.stop();
    rmSync(root, { recursive: true, force: true });
  }
});
