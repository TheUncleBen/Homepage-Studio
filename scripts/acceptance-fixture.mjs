import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { parse } from 'yaml';
import { UPSTREAM_COMMIT } from './healthcheck.mjs';
import { DEFAULT_PLAYBACK } from '../server/board.mjs';

const nativeFields = ['servicesYaml', 'settingsYaml', 'widgetsYaml', 'bookmarksYaml', 'dockerYaml', 'kubernetesYaml', 'proxmoxYaml', 'customCss', 'customJs'];
const nativeFiles = ['services.yaml', 'settings.yaml', 'widgets.yaml', 'bookmarks.yaml', 'docker.yaml', 'kubernetes.yaml', 'proxmox.yaml', 'custom.css', 'custom.js'];

export async function eventually(check, label, timeout = 180000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try { return await check(); } catch (error) { last = error; }
    await delay(1000);
  }
  throw new Error(`${label} did not succeed: ${last?.message || 'deadline exceeded'}`);
}

// The main dashboard's address. The bare address is the Dashboards page.
export const HOME = '/home';

export function createDashboardFixture({ origin, expectedRevision }) {
  async function request(route, body, expectedStatus = 200) {
    const response = await fetch(new URL(route, origin), {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'content-type': 'application/json', 'x-studio-request': '1', origin } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(35000), redirect: 'manual',
    });
    const text = await response.text();
    assert.equal(response.status, expectedStatus, `${route}: HTTP ${response.status}: ${text.slice(0, 300)}`);
    return { response, text, json: () => JSON.parse(text) };
  }

  async function ready(basePath = HOME) {
    return eventually(async () => {
      const application = (await request('/studio/application-ready')).json();
      assert.equal(application.status, 'ready');
      assert.deepEqual(application.checks, { dashboardRegistry: 'ok', sharedStorage: 'ok', runtimeFiles: 'ok' });
      assert.equal(application.buildRevision, expectedRevision);
      const result = (await request(`${basePath}/studio/ready`)).json();
      assert.equal(result.status, 'ready');
      assert.equal(result.backupRetention, 25);
      const native = (await request(`${basePath}/api/studio/health`)).json();
      assert.equal(native.protocolVersion, 1);
      assert.equal(native.upstreamCommit, UPSTREAM_COMMIT);
      assert.equal(native.buildRevision, expectedRevision);
      return result;
    }, 'Versioned startup readiness');
  }

  async function state(basePath = HOME) { return (await request(`${basePath}/studio/api/state`)).json(); }

  async function freshAndEdit() {
    await ready();
    const current = await state();
    for (const field of ['servicesYaml', 'widgetsYaml', 'bookmarksYaml']) assert.deepEqual(parse(current[field]), [], `${field} should start empty`);
    assert.deepEqual(parse(current.settingsYaml), {});
    const bare = await request('/', undefined, 307);
    assert.equal(bare.response.headers.get('location'), '/studio/dashboards', 'With sign-in off the bare address opens the Dashboards page');
    const page = await request(HOME);
    assert.match(page.text, /<html[\s>]/i, 'Native Homepage must serve the real dashboard page');
    assert.match(page.response.headers.get('content-type'), /text\/html/i);
    const saved = (await request(`${HOME}/studio/api/save`, { revision: current.revision, settingsYaml: 'title: Container acceptance fixture\n' })).json();
    const backups = (await request(`${HOME}/studio/api/backups`)).json();
    assert.equal(backups.length, 1);
    const added = (await request(`${HOME}/studio/api/service`, {
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
    assert.ok((await request(`${HOME}/studio/api/backups`)).json().some(item => item.id === fixture.restoreId));
  }

  async function restoreEmpty(fixture) {
    const current = await state();
    const restored = (await request(`${HOME}/studio/api/restore`, { revision: current.revision, backupId: fixture.restoreId })).json();
    assert.deepEqual(parse(restored.servicesYaml), []);
    assert.deepEqual(parse(restored.settingsYaml), {});
  }

  async function manage(change) {
    const registry = (await request('/studio/api/dashboards')).json();
    return (await request('/studio/api/dashboards', { revision: registry.revision, ...change })).json();
  }

  async function assertDefaultAddress() {
    const registry = (await request('/studio/api/dashboards')).json();
    const original = registry.dashboards.find(entry => entry.id === 'default');
    assert.equal(original.slug, 'home', 'The address fixture starts from the main dashboard\'s /home address');
    assert.ok(!registry.dashboards.some(entry => entry.slug === 'admin'), 'The disposable /admin fixture address must be available');
    const before = await state();
    const history = (await request(`${HOME}/studio/api/backups`)).json();
    try {
      await manage({ action: 'update', id: 'default', name: 'Admin address fixture', slug: 'admin' });
      const redirect = await request('/?source=address-fixture', undefined, 307);
      assert.equal(redirect.response.headers.get('location'), '/studio/dashboards');
      await request(`${HOME}/studio/api/state`, undefined, 404);
      await ready('/admin');
      const moved = await state('/admin');
      assert.equal(moved.revision, before.revision);
      for (const field of nativeFields) assert.equal(moved[field], before[field]);
      assert.deepEqual(moved.board, before.board);
      assert.deepEqual((await request('/admin/studio/api/backups')).json(), history);
      assert.match((await request('/admin/')).text, /<html[\s>]/i);
      assert.equal((await request('/admin/api/config/custom.css')).text, before.customCss);
      assert.equal((await request('/admin/api/config/custom.js')).text, before.customJs);
    } finally {
      await manage({ action: 'update', id: 'default', name: original.name, slug: original.slug });
    }
    await ready();
    assert.equal((await state()).revision, before.revision);
    assert.deepEqual((await request(`${HOME}/studio/api/backups`)).json(), history);
  }

  async function assertLegacyAdopted(expected) {
    await ready();
    const archive = (await request(`${HOME}/studio/api/export`)).json();
    assert.deepEqual(archive.files, expected.archive.files, 'Adopting existing root files must preserve complete native configuration and state');
    assert.deepEqual((await request(`${HOME}/studio/api/backups`)).json(), expected.backups, 'Registry initialization must preserve preexisting snapshots');
    const registry = (await request('/studio/api/dashboards')).json();
    assert.deepEqual(registry.dashboards, [{ id: 'default', slug: 'home', name: 'Main dashboard', archived: false }]);
    assert.equal(parse((await state()).settingsYaml).title, 'Legacy adoption fixture');
    await assertDefaultAddress();
  }

  async function multiDashboard() {
    await assertDefaultAddress();
    const rootBefore = await state();
    const suffix = Date.now().toString(36);
    const first = (await manage({ action: 'create', name: 'Container isolation source', slug: `fixture-source-${suffix}` })).dashboard;
    let basePath = `/${first.slug}`;
    const blank = await state(basePath);
    for (const field of ['servicesYaml', 'widgetsYaml', 'bookmarksYaml']) assert.deepEqual(parse(blank[field]), []);
    const changes = {
      servicesYaml: '- Fixture:\n    - One:\n        href: https://example.test/one\n    - Two:\n        href: https://example.test/two\n',
      settingsYaml: 'title: Independent source fixture\ntheme: dark\ncolor: purple\n',
      widgetsYaml: '- greeting:\n    text: Independent fixture\n- datetime:\n    format:\n      timeStyle: short\n',
      bookmarksYaml: '- References:\n    - Example:\n        - href: https://example.test/reference\n          abbr: EX\n',
      dockerYaml: '# Independent Docker configuration\n{}\n',
      kubernetesYaml: '# Independent Kubernetes configuration\n{}\n',
      proxmoxYaml: '# Independent Proxmox configuration\n{}\n',
      customCss: ':root { --fixture-color: #7353ba; }\n',
      customJs: 'window.__studioAcceptanceFixture = "source";\n',
    };
    let current = (await request(`${basePath}/studio/api/save`, { revision: blank.revision, ...changes })).json();
    const board = structuredClone(current.board);
    board.panels.at(-1).rect = { x: 6, y: 24, w: 6, h: 4 };
    board.stacks = [{ id: 'fixture-independent-stack', panelIds: board.panels.slice(0, 2).map(panel => panel.id), rect: { x: 0, y: 24, w: 6, h: 4 }, playback: { ...DEFAULT_PLAYBACK, intervalMs: 15000 } }];
    await request(`${basePath}/studio/api/board`, { revision: current.revision, board });
    current = await state(basePath);
    const sourceArchive = (await request(`${basePath}/studio/api/export`)).json();
    assert.deepEqual(Object.keys(sourceArchive.files).sort(), [...nativeFiles, 'state.json'].sort());
    const foreignSnapshot = (await request(`${basePath}/studio/api/backups`)).json()[0].id;
    const duplicate = (await manage({ action: 'create', name: 'Container isolation copy', slug: `fixture-copy-${suffix}`, sourceId: first.id })).dashboard;
    const copyPath = `/${duplicate.slug}`;
    let copied = await state(copyPath);
    for (const field of nativeFields) assert.equal(copied[field], current[field], `Duplicate must retain ${field}`);
    assert.deepEqual(copied.board, current.board, 'Duplicate must retain layout, stable content identities and playback');
    const beforeForeign = copied.revision;
    const rejected = (await request(`${copyPath}/studio/api/restore`, { revision: copied.revision, backupId: foreignSnapshot }, 404)).json();
    assert.equal(rejected.code, 'BACKUP_NOT_FOUND');
    assert.equal((await state(copyPath)).revision, beforeForeign, 'Foreign snapshot must not change another dashboard');
    copied = (await request(`${copyPath}/studio/api/save`, { revision: copied.revision, settingsYaml: 'title: Independent copied fixture\ntheme: light\ncolor: emerald\n', customCss: ':root { --fixture-color: #15803d; }\n', customJs: 'window.__studioAcceptanceFixture = "copy";\n' })).json();
    assert.equal((await state(basePath)).revision, current.revision, 'Copy edits must not modify its source');
    const updated = (await manage({ action: 'update', id: first.id, name: 'Renamed source fixture', slug: `fixture-renamed-${suffix}` })).dashboard;
    await request(`${basePath}/studio/api/state`, undefined, 404);
    basePath = `/${updated.slug}`;
    assert.equal((await state(basePath)).revision, current.revision, 'Address changes retain immutable identity and files');
    await manage({ action: 'archive', id: first.id, confirmed: true });
    await request(`${basePath}/studio/api/state`, undefined, 404);
    assert.equal((await state(copyPath)).revision, copied.revision, 'Archiving the source must not affect its copy');
    await manage({ action: 'restore', id: first.id });
    assert.equal((await state(basePath)).revision, current.revision);
    const imported = (await manage({ action: 'create', name: 'Container imported fixture', slug: `fixture-imported-${suffix}` })).dashboard;
    const importPath = `/${imported.slug}`;
    await request(`${importPath}/studio/api/import`, { revision: (await state(importPath)).revision, archive: sourceArchive });
    const importedState = await state(importPath);
    for (const field of nativeFields) assert.equal(importedState[field], current[field], `Import must retain ${field}`);
    assert.deepEqual(importedState.board, current.board);
    assert.equal((await state()).revision, rootBefore.revision, 'Named dashboard operations leave the root dashboard unchanged');
    const records = [{ dashboard: updated, state: current }, { dashboard: duplicate, state: copied }, { dashboard: imported, state: importedState }];
    await assertDashboardsPersisted(records);
    return records;
  }

  async function assertDashboardsPersisted(records) {
    const registry = (await request('/studio/api/dashboards')).json();
    for (const { dashboard, state: expected } of records) {
      assert.deepEqual(registry.dashboards.find(entry => entry.id === dashboard.id), dashboard);
      const basePath = `/${dashboard.slug}`;
      await ready(basePath);
      const actual = await state(basePath);
      assert.equal(actual.revision, expected.revision);
      for (const field of nativeFields) assert.equal(actual[field], expected[field]);
      assert.deepEqual(actual.board, expected.board);
      const page = await request(`${basePath}/`);
      assert.match(page.text, /<html[\s>]/i);
      assert.match(page.text, new RegExp(parse(expected.settingsYaml).title));
    }
  }

  return { request, ready, state, freshAndEdit, assertPersisted, restoreEmpty, assertDefaultAddress, assertLegacyAdopted, multiDashboard, assertDashboardsPersisted };
}
