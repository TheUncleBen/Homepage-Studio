import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { openMain } from './storage.mjs';
import { availability, createMonitoring, windowActive } from './monitors.mjs';
import { acceptsStatus, jsonValue, parsePing, runHttp, runTcp } from './checks.mjs';

const DASH = '11111111-1111-4111-8111-111111111111';
const monitor = (extra = {}) => ({ id: 'm1', name: 'Nextcloud', scope: DASH, type: 'http', interval: 60, timeout: 10, failures: 2, retryInterval: 20, successes: 1, paused: false, tags: ['apps'], parent: null, notify: { channels: [] }, http: { url: 'http://x.example.org/' }, ...extra });

async function setup(t, defs) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-mon-'));
  const db = openMain(dir);
  t.after(async () => { db.close(); await fs.rm(dir, { recursive: true, force: true }); });
  let clock = Date.parse('2026-11-02T10:00:00');
  const events = [], transitions = [], results = [];
  const definitions = { monitors: [], maintenance: [], ...defs };
  const engine = createMonitoring({ db, definitions: () => definitions, runCheck: async () => ({ ok: true, ms: 5 }), onEvent: event => events.push(event), onTransition: change => transitions.push(change), onResult: (monitor, result) => results.push([monitor.id, result]), now: () => clock });
  return { db, engine, events, transitions, results, definitions, tick: ms => { clock += ms; }, get now() { return clock; } };
}

test('a monitor goes down only after its failure threshold, opens one incident and recovers with one success', async t => {
  const m = monitor();
  const env = await setup(t, { monitors: [m] });
  env.engine.apply(m, { ok: true, ms: 12 });
  assert.equal(env.engine.state('m1').state, 'up');
  env.tick(60e3);
  env.engine.apply(m, { ok: false, cls: 'refused', message: 'Connection refused' });
  assert.equal(env.engine.state('m1').state, 'pending', 'one failure is not an outage');
  env.tick(20e3);
  env.engine.apply(m, { ok: false, cls: 'refused', message: 'Connection refused' });
  assert.equal(env.engine.state('m1').state, 'down');
  const incident = env.db.get('SELECT * FROM incident WHERE monitor_id = ?', 'm1');
  assert.equal(incident.closed, null);
  assert.equal(incident.error_class, 'refused');
  env.tick(60e3);
  env.engine.apply(m, { ok: false, cls: 'refused' });
  assert.equal(env.db.get('SELECT COUNT(*) AS n FROM incident').n, 1, 'staying down does not open another');
  env.tick(60e3);
  env.engine.apply(m, { ok: true, ms: 9 });
  assert.equal(env.engine.state('m1').state, 'up');
  assert.ok(env.db.get('SELECT closed FROM incident WHERE id = ?', incident.id).closed);
  assert.deepEqual(env.transitions.map(change => change.state), ['up', 'pending', 'down', 'up']);
  // Every result reaches onResult, not only state changes (charts, certificate warnings).
  assert.equal(env.results.length, 5);
  env.tick(60e3);
  env.engine.apply(m, { ok: true, ms: 7, warning: { cls: 'tls-expired', message: 'The certificate expires in 5 days' } });
  assert.equal(env.results.at(-1)[1].warning.cls, 'tls-expired', 'a warning on an up monitor still reaches onResult');
  assert.ok(env.events.some(event => event.event_type === 'monitor.down' && event.scope === DASH && event.error_class === 'refused'));
});

test('maintenance pauses alerts and is left out of availability; a child of a down parent is unreachable', async t => {
  const parent = monitor({ id: 'p', name: 'Router' });
  const child = monitor({ id: 'c', name: 'NAS', parent: 'p', failures: 1 });
  const env = await setup(t, { monitors: [parent, child], maintenance: [] });
  env.engine.apply(parent, { ok: false, cls: 'timeout' }); env.engine.apply(parent, { ok: false, cls: 'timeout' });
  env.engine.apply(child, { ok: false, cls: 'timeout' });
  assert.equal(env.engine.state('p').state, 'down');
  assert.equal(env.engine.state('c').state, 'unreachable');
  assert.equal(env.db.get("SELECT COUNT(*) AS n FROM incident WHERE monitor_id = 'c'").n, 0, 'no incident for a child behind a down parent');
  env.definitions.maintenance.push({ id: 'w', name: 'Patch', scope: DASH, kind: 'now', start: env.now - 1, end: env.now + 3600e3, monitors: ['p'], tags: [] });
  env.tick(60e3);
  env.engine.apply(parent, { ok: false, cls: 'timeout' });
  assert.equal(env.engine.state('p').state, 'maintenance');
  const hour = env.db.all("SELECT up, down, maint FROM check_hour WHERE monitor_id = 'p'");
  assert.ok(hour[0].maint > 0);
  assert.equal(availability([{ up: 90, down: 10 }, { up: 0, down: 0 }]), 0.9);
});

test('weekly and overnight maintenance windows', () => {
  const window = { kind: 'weekly', from: '23:00', to: '01:00', days: [0] };
  assert.equal(windowActive(window, new Date(2026, 10, 1, 23, 30).getTime()), true, 'Sunday 23:30');
  assert.equal(windowActive(window, new Date(2026, 10, 2, 0, 30).getTime()), true, 'past midnight still Sunday\'s window');
  assert.equal(windowActive(window, new Date(2026, 10, 2, 23, 30).getTime()), false, 'Monday');
  assert.equal(windowActive({ kind: 'daily', from: '02:00', to: '03:00' }, new Date(2026, 10, 3, 2, 15).getTime()), true);
});

test('restart keeps state and open incidents', async t => {
  const m = monitor({ failures: 1 });
  const env = await setup(t, { monitors: [m] });
  env.engine.apply(m, { ok: false, cls: 'timeout' });
  const again = createMonitoring({ db: env.db, definitions: () => ({ monitors: [m], maintenance: [] }), runCheck: async () => ({ ok: false }), now: () => env.now });
  assert.equal(again.state('m1').state, 'down');
  assert.ok(again.state('m1').incident_id);
});

test('the HTTP check: accepted codes, keyword, JSON value, card rule, timeout', async t => {
  const server = http.createServer((req, res) => {
    if (req.url === '/json') { res.setHeader('content-type', 'application/json'); return res.end('{"status":{"healthy":true}}'); }
    if (req.url === '/forbidden') { res.statusCode = 403; return res.end('no'); }
    if (req.url === '/head-refused') { res.statusCode = req.method === 'HEAD' ? 405 : 200; return res.end(); }
    if (req.url === '/slow') return setTimeout(() => res.end('late'), 3000);
    res.end('hello world');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await runHttp({ url: base + '/' }, { timeoutMs: 2000 })).ok, true);
  assert.equal((await runHttp({ url: base + '/', keyword: 'world' }, { timeoutMs: 2000 })).ok, true);
  assert.equal((await runHttp({ url: base + '/', keyword: 'nope' }, { timeoutMs: 2000 })).cls, 'assertion');
  assert.equal((await runHttp({ url: base + '/json', jsonPath: 'status.healthy', jsonExpect: 'true' }, { timeoutMs: 2000 })).ok, true);
  const forbidden = await runHttp({ url: base + '/forbidden' }, { timeoutMs: 2000 });
  assert.equal(forbidden.cls, 'permission');
  assert.equal((await runHttp({ url: base + '/forbidden', card: true }, { timeoutMs: 2000 })).ok, true, 'a card counts 403 as up');
  assert.equal((await runHttp({ url: base + '/head-refused', card: true }, { timeoutMs: 2000 })).ok, true, 'cards retry with GET');
  assert.equal((await runHttp({ url: base + '/slow' }, { timeoutMs: 300 })).cls, 'timeout');
  assert.equal((await runHttp({ url: 'http://127.0.0.1:1/' }, { timeoutMs: 2000 })).cls, 'refused');
});

test('custom headers go only to the address\'s own origin, never to a redirect elsewhere', async t => {
  const seen = [];
  const other = http.createServer((req, res) => { seen.push({ at: 'other', auth: req.headers.authorization ?? null }); res.end('ok'); });
  await new Promise(resolve => other.listen(0, '127.0.0.1', resolve));
  const otherBase = `http://127.0.0.1:${other.address().port}`;
  const home = http.createServer((req, res) => {
    seen.push({ at: 'home' + req.url, auth: req.headers.authorization ?? null });
    if (req.url === '/same') { res.writeHead(302, { location: '/final' }); return res.end(); }
    if (req.url === '/away') { res.writeHead(302, { location: otherBase + '/landing' }); return res.end(); }
    res.end('ok');
  });
  await new Promise(resolve => home.listen(0, '127.0.0.1', resolve));
  t.after(() => { for (const server of [home, other]) { server.closeAllConnections(); server.close(); } });
  const base = `http://127.0.0.1:${home.address().port}`;
  const headers = [{ name: 'Authorization', value: 'Bearer secret-token' }];
  assert.equal((await runHttp({ url: base + '/same', headers }, { timeoutMs: 2000 })).ok, true);
  assert.deepEqual(seen.splice(0), [{ at: 'home/same', auth: 'Bearer secret-token' }, { at: 'home/final', auth: 'Bearer secret-token' }]);
  assert.equal((await runHttp({ url: base + '/away', headers }, { timeoutMs: 2000 })).ok, true);
  assert.deepEqual(seen.splice(0), [{ at: 'home/away', auth: 'Bearer secret-token' }, { at: 'other', auth: null }]);
});

test('TCP, ping parsing and helpers', async t => {
  const server = net.createServer(socket => socket.end());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  assert.equal((await runTcp({ host: '127.0.0.1', port: server.address().port }, { timeoutMs: 2000 })).ok, true);
  assert.equal((await runTcp({ host: '127.0.0.1', port: 1 }, { timeoutMs: 2000 })).cls, 'refused');
  assert.deepEqual(parsePing('1 packets transmitted, 1 received, 0% packet loss, time 0ms\nrtt min/avg/max/mdev = 0.041/0.041/0.041/0.000 ms'), { loss: 0, ms: 0.041 });
  assert.deepEqual(parsePing('garbage'), { loss: null, ms: null });
  assert.equal(acceptsStatus('200-299,404')(404), true);
  assert.equal(acceptsStatus('200-299')(301), false);
  assert.equal(jsonValue({ a: [{ b: 2 }] }, 'a.0.b'), 2);
});

test('history says when checks began, to the minute for a new monitor', async t => {
  const m = monitor();
  const env = await setup(t, { monitors: [m] });
  const began = env.now + 25 * 60e3;
  env.tick(25 * 60e3);
  env.engine.apply(m, { ok: true, ms: 4 });
  env.tick(60e3);
  env.engine.apply(m, { ok: true, ms: 4 });
  assert.equal(env.engine.history('m1').first, began);
});
