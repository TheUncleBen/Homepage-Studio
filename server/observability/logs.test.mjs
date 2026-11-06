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
  env.ingest.add({ message: 'sign-in-failed', event_type: 'auth.sign-in-failed', category: 'security', source_type: 'audit', fields: { ip: '192.0.2.4', username: 'admni' } });
  env.ingest.flush();
  const found = env.query.search({ query: '', ...range(env.now), scopes: null, restricted: true }).events;
  const text = JSON.stringify(found);
  assert.ok(!text.includes('s3cr3t-api-key-value'));
  assert.ok(!text.includes('abcdef123456'));
  assert.ok(!text.includes('abcdefghijklmnop'));
  assert.ok(text.includes('[secret: Sonarr key]'));
  assert.equal(env.query.search({ query: 's3cr3t', ...range(env.now), scopes: null, restricted: true }).events.length, 0);
  const audit = found.find(event => event.event_type === 'auth.sign-in-failed');
  assert.equal(audit.restricted, true);
  assert.equal(audit.fields.ip, undefined, 'personal fields are kept apart');
  assert.equal(audit.personal.ip, '192.0.2.4');
  assert.equal(env.query.search({ query: '', ...range(env.now), scopes: null, restricted: false }).events.some(event => event.restricted), false);
});

test('repeats inside a minute fold into one row with a count; pages continue by cursor', async t => {
  const env = await setup(t);
  for (let i = 0; i < 30; i++) env.ingest.add({ message: `HTTP 401 calling widget ${i}`, resource: 'Sonarr', severity: 'error' });
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
