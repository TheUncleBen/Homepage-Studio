import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { parse } from 'yaml';
import { UPSTREAM_COMMIT } from './healthcheck.mjs';

export async function eventually(check, label, timeout = 180000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try { return await check(); } catch (error) { last = error; }
    await delay(1000);
  }
  throw new Error(`${label} did not succeed: ${last?.message || 'deadline exceeded'}`);
}

export function createDashboardFixture({ origin, expectedRevision }) {
  async function request(route, body) {
    const response = await fetch(new URL(route, origin), {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'content-type': 'application/json', 'x-studio-request': '1', origin } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(5000),
    });
    const text = await response.text();
    assert.equal(response.status, 200, `${route}: HTTP ${response.status}`);
    return { response, text, json: () => JSON.parse(text) };
  }

  async function ready() {
    return eventually(async () => {
      const result = (await request('/__studio/ready')).json();
      assert.equal(result.status, 'ready');
      assert.equal(result.backupRetention, 25);
      const native = (await request('/api/studio/health')).json();
      assert.equal(native.protocolVersion, 1);
      assert.equal(native.upstreamCommit, UPSTREAM_COMMIT);
      assert.equal(native.buildRevision, expectedRevision);
      return result;
    }, 'Versioned startup readiness');
  }

  async function state() { return (await request('/__studio/api/state')).json(); }

  async function freshAndEdit() {
    await ready();
    const current = await state();
    for (const field of ['servicesYaml', 'widgetsYaml', 'bookmarksYaml']) assert.deepEqual(parse(current[field]), [], `${field} should start empty`);
    assert.deepEqual(parse(current.settingsYaml), {});
    const page = await request('/');
    assert.match(page.text, /<html[\s>]/i, 'Native Homepage must serve the real dashboard page');
    assert.match(page.response.headers.get('content-type'), /text\/html/i);
    const saved = (await request('/__studio/api/save', { revision: current.revision, settingsYaml: 'title: Container acceptance fixture\n' })).json();
    const backups = (await request('/__studio/api/backups')).json();
    assert.equal(backups.length, 1);
    const added = (await request('/__studio/api/service', {
      revision: saved.revision, action: 'add', name: 'Persistence fixture', group: 'Acceptance', config: { href: 'https://example.test/' },
    })).json();
    const service = added.services.find(item => item.name === 'Persistence fixture');
    assert.ok(service?.id, 'A saved tile must have a persistent identity');
    return { serviceId: service.id, restoreId: backups[0].id };
  }

  async function assertPersisted(fixture) {
    await ready();
    const current = await state();
    assert.equal(parse(current.settingsYaml).title, 'Container acceptance fixture');
    assert.equal(current.services.find(item => item.name === 'Persistence fixture')?.id, fixture.serviceId);
    assert.equal(current.backupRetention, 25);
    assert.ok((await request('/__studio/api/backups')).json().some(item => item.id === fixture.restoreId));
  }

  async function restoreEmpty(fixture) {
    const current = await state();
    const restored = (await request('/__studio/api/restore', { revision: current.revision, backupId: fixture.restoreId })).json();
    assert.deepEqual(parse(restored.servicesYaml), []);
    assert.deepEqual(parse(restored.settingsYaml), {});
  }

  return { request, ready, state, freshAndEdit, assertPersisted, restoreEmpty };
}
