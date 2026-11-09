// A save gives newly charted widgets their first numbers at once, but does
// not poll every integration on the dashboard again (security review M1).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStudioServer, NATIVE_PROTOCOL, UPSTREAM_COMMIT } from './index.mjs';

const onPrimary = target => (/^\/(?:api\/|studio\/(?:api\/(?!dashboards|overview|preview|platform|backups|saved-items|trusted-certificates|ops\/)|catalog\.json|edit|settings)|_next\/(?!static\/))/.test(target) ? '/home' + target : target);
const HOST = 'localhost:3001';
const ORIGIN = `http://${HOST}`;
const listen = server => new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server.address().port)); });
const close = server => new Promise(resolve => { server.closeAllConnections?.(); server.close(resolve); });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function setup(t, sources) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-card-sync-'));
  const configDir = path.join(dir, 'config');
  await fs.mkdir(configDir);
  for (const [file, content] of [['services.yaml', '[]\n'], ['widgets.yaml', '[]\n'], ['settings.yaml', 'title: t\n'], ['bookmarks.yaml', '[]\n'], ['docker.yaml', '{}\n'], ['kubernetes.yaml', '{}\n'], ['proxmox.yaml', '{}\n']]) await fs.writeFile(path.join(configDir, file), content);
  const collects = [];
  let inFlight = 0;
  let overlapped = false;
  const upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/studio/health') return res.end(JSON.stringify({ protocolVersion: NATIVE_PROTOCOL, upstreamCommit: UPSTREAM_COMMIT, buildRevision: 'unreleased' }));
    if (req.url === '/api/studio/sources') return res.end(JSON.stringify({ protocolVersion: NATIVE_PROTOCOL, upstreamCommit: UPSTREAM_COMMIT, sources, warnings: [] }));
    if (req.url === '/api/studio/collect') {
      const { panels } = JSON.parse(Buffer.concat(chunks).toString());
      collects.push(panels.map(panel => panel.id));
      inFlight += 1;
      if (inFlight > 1) overlapped = true;
      await wait(300);
      inFlight -= 1;
      return res.end(JSON.stringify({ results: Object.fromEntries(panels.map(panel => [panel.id, { values: [{ field: 'up', value: 1 }, { field: 'ms', value: 12 }] }])) }));
    }
    res.end('{}');
  });
  const upstreamPort = await listen(upstream);
  // collectMs 0: no minute round, so every collection here comes from saves.
  const app = createStudioServer({ configDir, stateDir: path.join(dir, 'state'), upstream: `http://127.0.0.1:${upstreamPort}`, allowedHosts: HOST, publicOrigin: ORIGIN, auth: 'off', collectMs: 0 });
  const port = await listen(app.server);
  t.after(async () => { await close(app.server); await close(upstream); await app.shutdown({ graceMs: 0 }).catch(() => {}); await fs.rm(dir, { recursive: true, force: true }); });
  const request = (target, body) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: onPrimary(target), method: body ? 'POST' : 'GET', agent: false, headers: { host: HOST, ...(body ? { 'content-type': 'application/json', origin: ORIGIN, 'x-studio-request': '1' } : {}) } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => { const text = Buffer.concat(chunks).toString(); let json; try { json = JSON.parse(text); } catch {} resolve({ status: res.statusCode, text, json }); });
    });
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
  return { request, collects, overlapped: () => overlapped };
}

const source = (n) => {
  const id = `discovered-service-0123456789abcdef0123456${n}`;
  return { id, kind: 'service', title: `Svc ${n}`, group: 'Lab', nativeLocator: { discovered: true, discoveryId: id, serviceId: id, groupPath: ['Lab'], name: `Svc ${n}`, origin: 'docker' } };
};

test('saves collect only widgets without recent numbers, one collection at a time', async t => {
  const { request, collects, overlapped } = await setup(t, [source(1), source(2)]);
  const registry = await request('/studio/api/dashboards');
  assert.equal((await request('/studio/api/dashboards', { revision: registry.json.revision, action: 'update', id: 'default', name: 'Main', slug: 'home' })).status, 200);
  const state = (await request('/studio/api/state')).json;
  const [first, second] = state.board.panels.map(panel => panel.id);
  const charted = panel => ({ ...panel, look: { blocks: [{ id: 'b1', type: 'response' }] }, behaviour: { status: 'web' } });
  // The first widget becomes a response-time chart: collected at once.
  let saved = await request('/studio/api/board', { revision: state.revision, board: { ...state.board, panels: state.board.panels.map(panel => (panel.id === first ? charted(panel) : panel)) } });
  assert.equal(saved.status, 200, saved.text);
  await wait(1500);
  assert.deepEqual(collects, [[first]]);
  // Moving it around many times polls nothing more.
  for (let i = 0; i < 6; i += 1) {
    const board = { ...saved.json.board, panels: saved.json.board.panels.map(panel => (panel.id === first ? { ...panel, rect: { ...panel.rect, x: 0, y: 30 + (i % 2) } } : panel)) };
    saved = await request('/studio/api/board', { revision: saved.json.revision, board });
    assert.equal(saved.status, 200, saved.text);
    await wait(400);
  }
  await wait(1200);
  assert.deepEqual(collects, [[first]]);
  // A second widget charted later: only that one is asked for.
  saved = await request('/studio/api/board', { revision: saved.json.revision, board: { ...saved.json.board, panels: saved.json.board.panels.map(panel => (panel.id === second ? charted(panel) : panel)) } });
  assert.equal(saved.status, 200, saved.text);
  await wait(1500);
  assert.deepEqual(collects, [[first], [second]]);
  assert.equal(overlapped(), false);
});
