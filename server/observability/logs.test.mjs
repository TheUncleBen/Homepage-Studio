import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStorage } from './storage.mjs';
import { createIngest } from './ingest.mjs';
import { createRedactor } from './redact.mjs';
import { createQueryRunner, parseQuery } from './query.mjs';
import { fingerprint, normalizeEvent } from './model.mjs';

async function setup(t, options = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-obs-'));
  const storage = createStorage({ dir });
  const redactor = createRedactor();
  let clock = options.now ?? Date.now();
  const ingest = createIngest({ storage, redactor, now: () => clock });
  const query = createQueryRunner({ dir });
  t.after(async () => { query.close(); storage.close(); await fs.rm(dir, { recursive: true, force: true }); });
  return { dir, storage, redactor, ingest, query, tick: ms => { clock += ms; }, get now() { return clock; } };
}

const range = now => ({ from: now - 86400e3, to: now + 1000 });

test('events are stored, found by words and by coded errors, and limited to the scopes a person may read', async t => {
  const env = await setup(t);
  const dashA = '11111111-1111-4111-8111-111111111111', dashB = '22222222-2222-4222-8222-222222222222';
  env.ingest.add({ message: 'connect ECONNREFUSED 10.0.0.5:8989', source_type: 'renderer', source_id: dashA, scope: dashA, severity: 'error', category: 'integration', resource: 'Sonarr', error_class: 'refused' });
  env.ingest.add({ message: 'HTTP 401 calling https://sonarr.example.org/api', source_type: 'renderer', source_id: dashB, scope: dashB, severity: 'error', category: 'integration', resource: 'Sonarr' });
  env.ingest.add({ message: 'Studio started', source_type: 'studio', severity: 'info' });
  env.ingest.flush();
  const all = env.query.search({ query: '', ...range(env.now), scopes: null, restricted: true });
  assert.equal(all.events.length, 3);
  assert.equal(env.query.search({ query: 'refused', ...range(env.now), scopes: null }).events.length, 1, 'plain word finds ECONNREFUSED');
  assert.equal(env.query.search({ query: 'unauthorized', ...range(env.now), scopes: null }).events.length, 1, 'plain word finds a 401');
  // Dashboard isolation: the same integration on two dashboards never mixes.
  const onlyA = env.query.search({ query: 'resource:Sonarr', ...range(env.now), scopes: [dashA] });
  assert.deepEqual(onlyA.events.map(event => event.scope), [dashA]);
  assert.equal(env.query.search({ query: '', ...range(env.now), scopes: [] }).events.length, 0, 'no scopes, nothing');
  assert.equal(env.query.search({ query: 'severity:error -resource:Sonarr', ...range(env.now), scopes: null }).events.length, 0);
  const facets = env.query.facets({ query: '', ...range(env.now), scopes: [dashA, dashB] });
  assert.equal(facets.total, 2);
  assert.deepEqual(facets.facets.resource, [{ value: 'Sonarr', count: 2 }]);
});

test('secrets never reach storage, and audit events stay administrator-only', async t => {
  const env = await setup(t);
  env.redactor.setSecrets(new Map([['s3cr3t-api-key-value', 'Sonarr key']]));
  env.ingest.add({ message: 'GET https://host.example.org/api?apikey=abcdef123456&x=1 failed with key s3cr3t-api-key-value', severity: 'error' });
  env.ingest.add({ message: 'Authorization: Bearer abcdefghijklmnop', severity: 'warning' });
  // Fields named like secrets keep no value, however deep (review M2).
  env.ingest.add({ message: 'structured', severity: 'info', fields: { password: 'hunter2hunter2', api_key: 'K3Y-VALUE-998', nested: { token: 'tok-123456789' }, code: 200 } });
  env.ingest.add({ message: 'sign-in-failed', event_type: 'auth.sign-in-failed', category: 'security', source_type: 'audit', fields: { ip: '192.0.2.4', username: 'admni' } });
  env.ingest.flush();
  const found = env.query.search({ query: '', ...range(env.now), scopes: null, restricted: true }).events;
  const text = JSON.stringify(found);
  assert.ok(!text.includes('s3cr3t-api-key-value'));
  assert.ok(!text.includes('abcdef123456'));
  assert.ok(!text.includes('abcdefghijklmnop'));
  assert.ok(text.includes('[secret: Sonarr key]'));
  for (const leaked of ['hunter2hunter2', 'K3Y-VALUE-998', 'tok-123456789']) assert.ok(!text.includes(leaked), leaked);
  assert.equal(found.find(event => event.message === 'structured').fields.code, 200);
  assert.equal(env.query.search({ query: 's3cr3t', ...range(env.now), scopes: null, restricted: true }).events.length, 0);
  const audit = found.find(event => event.event_type === 'auth.sign-in-failed');
  assert.equal(audit.restricted, true);
  assert.equal(audit.fields.ip, undefined, 'personal fields are kept apart');
  assert.equal(audit.personal.ip, '192.0.2.4');
  assert.equal(env.query.search({ query: '', ...range(env.now), scopes: null, restricted: false }).events.some(event => event.restricted), false);
});

test('identical repeats within seconds fold into one row with a count; pages continue by cursor', async t => {
  const env = await setup(t);
  for (let i = 0; i < 30; i++) env.ingest.add({ message: 'HTTP 401 calling widget', resource: 'Sonarr', severity: 'error' });
  for (let i = 0; i < 250; i++) { env.ingest.add({ message: `line ${i} unique ${'x'.repeat(i % 7)} ${String.fromCharCode(97 + (i % 26))}${i}`, source_type: 'renderer', source_id: 'r' + i }); env.tick(1); }
  env.ingest.flush();
  const grouped = env.query.search({ query: 'widget', ...range(env.now), scopes: null });
  assert.equal(grouped.events.length, 1);
  assert.equal(grouped.events[0].repeat, 30);
  const first = env.query.search({ query: 'line', ...range(env.now), scopes: null, limit: 200 });
  assert.equal(first.events.length, 200);
  assert.ok(first.next);
  const second = env.query.search({ query: 'line', ...range(env.now), scopes: null, limit: 200, before: first.next });
  assert.equal(second.events.length, 50);
  assert.equal(new Set([...first.events, ...second.events].map(event => event.id)).size, 250);
  const hist = env.query.histogram({ query: '', ...range(env.now), scopes: null, buckets: 24 });
  assert.equal(hist.bars.reduce((sum, bar) => sum + bar.n, 0), 251);
});

test('events that differ only in numbers, or are minutes apart, stay separate rows (UI review H2)', async t => {
  const env = await setup(t);
  // Sent together, one a minute apart by their own time.
  const base = env.now - 40 * 60e3;
  for (let i = 0; i < 40; i++) env.ingest.add({ message: `Snapshot ${1003 + i} created`, resource: 'nas', ts: base + i * 60e3 });
  for (let i = 0; i < 3; i++) env.ingest.add({ message: 'Backup finished', resource: 'nas', ts: base + i * 60e3 });
  env.ingest.flush();
  const snapshots = env.query.search({ query: 'snapshot', ...range(env.now), scopes: null, limit: 100 });
  assert.equal(snapshots.events.length, 40);
  assert.ok(snapshots.events.every(event => event.repeat === 1));
  assert.equal(env.query.search({ query: '"Snapshot 1042"', ...range(env.now), scopes: null }).events.length, 1, 'a later one can be found');
  assert.equal(env.query.search({ query: 'backup', ...range(env.now), scopes: null }).events.length, 3);
  // Similar together still groups them by shape.
  const groups = env.query.groups({ query: 'snapshot', ...range(env.now), scopes: null });
  assert.equal(groups.groups.length, 1);
  assert.equal(groups.groups[0].count, 40);
});

test('retention removes whole segments by age and never the one being written', async t => {
  const start = Date.parse('2026-10-01T12:00:00');
  const env = await setup(t, { now: start });
  for (let day = 0; day < 5; day++) { env.ingest.add({ message: `day ${day}` }); env.ingest.flush(); env.tick(86400e3); }
  assert.equal(env.storage.main.all("SELECT seq FROM segment WHERE stream = 'logs'").length, 5);
  const removed = env.storage.retain({ logDays: 2, auditDays: 400, budgetBytes: 1e12, now: env.now });
  assert.ok(removed.length >= 2);
  assert.ok(env.storage.main.get("SELECT COUNT(*) AS n FROM segment WHERE stream = 'logs'").n >= 2);
  // A clock that jumps far back deletes nothing.
  assert.deepEqual(env.storage.retain({ logDays: 2, auditDays: 400, budgetBytes: 1e12, now: start - 365 * 86400e3 }), []);
});

test('the search language: fields, phrases, negation and prefixes', () => {
  assert.deepEqual(parseQuery('sonarr -class:timeout "key refused" type:auth.*').map(term => [term.kind, term.field ?? null, term.negate, term.value]), [
    ['text', null, false, 'sonarr'], ['field', 'class', true, 'timeout'], ['text', null, false, 'key refused'], ['field', 'type', false, 'auth.*'],
  ]);
  assert.equal(fingerprint('x', 'HTTP 401 calling 10.0.0.5:8989 id 42'), fingerprint('x', 'HTTP 402 calling 10.0.0.6:80 id 7'));
  const event = normalizeEvent({ message: '\u001b[31mred\u001b[0m and \u0007bell', severity: 'warn', ts: Date.now() - 3 * 86400e3 }, { redact: (text, limit) => createRedactor().text(text, limit), now: Date.now() });
  assert.equal(event.message, 'red and \\x07bell');
  assert.equal(event.severity, 4);
  assert.ok(Math.abs(event.ts - Date.now()) < 5000, 'times far from receipt use the receive time');
});

test('the renderer start-up banner is Studio debug output, not a dashboard event (UI review M4)', async () => {
  const { parseWorkerLine } = await import('./controller.mjs');
  for (const line of ['   ▲ Next.js 16.4.2', '   - Local:        http://127.0.0.1:38173', '   - Network:      http://10.0.0.5:38173', ' ✓ Ready in 0ms', ' ✓ Starting...']) {
    const parsed = parseWorkerLine(line, 'stdout');
    assert.equal(parsed.startup, true, line);
    assert.equal(parsed.severity, 7);
  }
  const widget = parseWorkerLine('[2026-11-06T10:00:00.000Z] error: <httpProxy> Error calling http://plex', 'stdout');
  assert.equal(widget.startup, undefined);
  assert.equal(widget.label, 'httpProxy');
  assert.equal(widget.severity, 3);
});

test('a repeat that keeps coming stays one row for a few minutes, then starts another (UI review M4)', async t => {
  const env = await setup(t);
  // A failing widget, polled every 10 s for 7 minutes.
  for (let i = 0; i < 42; i++) { env.ingest.add({ message: 'Error calling https://nas: Self-signed certificate', resource: 'glances', severity: 'error', source_type: 'renderer', source_id: 'r' }); env.tick(10000); env.ingest.flush(); }
  const rows = env.query.search({ query: 'certificate', ...range(env.now), scopes: null, limit: 50 }).events;
  assert.equal(rows.length, 2, 'one row for the first five minutes, one after');
  assert.equal(rows.reduce((sum, row) => sum + row.repeat, 0), 42);
});

test('renderer error lines carry their class (UI review M4)', async () => {
  const { workerEvent } = await import('./controller.mjs');
  const event = workerEvent('11111111-1111-4111-8111-111111111111', 'stdout', '[2026-11-07T03:00:00.000Z] error: <httpProxy> Error calling https://nas: Self-signed certificate (DEPTH_ZERO_SELF_SIGNED_CERT)');
  assert.equal(event.error_class, 'tls-untrusted');
  assert.equal(workerEvent('default', 'stdout', '[2026-11-07T03:00:00.000Z] info: <x> all good').error_class, undefined);
});

test('the Logs page knows the same filter names and levels as the search (audit, 11 Nov 2026)', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../auth/ui/ops.js', import.meta.url), 'utf8');
  const list = name => JSON.parse(source.match(new RegExp(`const ${name} = (\\[[^\\]]*\\]);`))[1].replace(/'/g, '"'));
  const query = readFileSync(new URL('./query.mjs', import.meta.url), 'utf8');
  const keys = name => Object.keys(Function(`return ${query.match(new RegExp(`const ${name} = (\\{[^}]*\\});`))[1]}`)()).sort();
  assert.deepEqual(list('FILTERS').sort(), keys('FIELD_ALIASES'));
  assert.deepEqual(list('LEVEL_WORDS').sort(), keys('SEVERITY_WORDS'));
});

test('a log alert whose search can never match is refused with the reason (audit, 11 Nov 2026)', async () => {
  const { queryProblem } = await import('./query.mjs');
  const { cleanAlert } = await import('./definitions.mjs');
  assert.equal(queryProblem('severity:error resource:plex "backup failed"'), '');
  assert.equal(queryProblem('level:3 -type:monitor.* http://nas:5000'), '');
  assert.match(queryProblem('severity:eror'), /^Levels are/);
  assert.match(queryProblem('sevrity:error'), /isn’t a filter/);
  assert.match(queryProblem('"backup failed'), /quote is left open/);
  // Names an object has by inheritance are not filters or levels.
  assert.match(queryProblem('constructor:x'), /isn’t a filter/);
  assert.match(queryProblem('level:constructor'), /^Levels are/);
  assert.equal(parseQuery('constructor:x')[0].kind, 'text');
  // Searches that work are not refused (UI review, 11 Nov 2026).
  assert.equal(queryProblem('sshd: Failed password'), '');
  assert.equal(queryProblem('severity:"error"'), '');
  assert.equal(queryProblem('"say \\"hi\\" now"'), '');
  const channels = [{ id: 'c1' }];
  assert.throws(() => cleanAlert({ name: 'Errors', query: 'severity:eror', channels: ['c1'] }, { channels }), /Levels are/);
  assert.equal(cleanAlert({ name: 'Errors', query: 'severity:error', channels: ['c1'] }, { channels }).query, 'severity:error');
});
