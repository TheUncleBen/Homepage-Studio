import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createStudioServer } from './index.mjs';
import { createRendererPool } from './renderer-pool.mjs';

const HOST = 'slow-body.example.test:3000';
const ORIGIN = `http://${HOST}`;
const BUILD = 'slow-body-test';
const worker = `
import http from 'node:http';
const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  res.setHeader('content-type', 'application/json');
  if (req.url === '/api/studio/health') {
    return res.end(JSON.stringify({ protocolVersion: 1, upstreamCommit: '51cc1684f9f34a7877ed462b8f94c9cc687b4dde', buildRevision: process.env.STUDIO_BUILD_REVISION, dashboardId: process.env.STUDIO_DASHBOARD_ID, dashboardBasePath: process.env.STUDIO_DASHBOARD_BASE_PATH, rendererInstance: process.env.STUDIO_RENDERER_INSTANCE }));
  }
  if (req.url === '/api/studio/sources') return res.end(JSON.stringify({ protocolVersion: 1, upstreamCommit: '51cc1684f9f34a7877ed462b8f94c9cc687b4dde', sources: [], warnings: [] }));
  res.end(JSON.stringify({ id: process.env.STUDIO_DASHBOARD_ID, url: req.url, body: Buffer.concat(chunks).toString('utf8'), length: req.headers['content-length'] ?? null }));
});
server.listen(Number(process.env.PORT), process.env.HOSTNAME);
`;

async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-slow-body-'));
  const configDir = path.join(root, 'config'), stateDir = path.join(root, 'state'), rendererDir = path.join(root, 'renderer');
  await fs.mkdir(rendererDir);
  const workerScript = path.join(rendererDir, 'worker.mjs');
  await fs.writeFile(workerScript, worker);
  const rendererPool = createRendererPool({ configRoot: configDir, appRoot: rendererDir, workerScript, allowedHosts: HOST, buildRevision: BUILD, maxWorkers: 2, startupMs: 5000 });
  const app = createStudioServer({ configDir, stateDir, rendererDir, rendererPool, allowedHosts: HOST, buildRevision: BUILD, ...options });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const port = app.server.address().port;
  const sockets = new Set();
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await app.shutdown({ graceMs: 25 });
    await fs.rm(root, { recursive: true, force: true });
  });
  const request = (target, { method = 'GET', body, headers = {} } = {}) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: target, method, agent: false, headers: { host: HOST, ...headers } }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('error', reject);
      res.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); let json; try { json = JSON.parse(text); } catch {} resolve({ status: res.statusCode, headers: res.headers, json, text }); });
    });
    req.on('error', reject); req.setTimeout(8000, () => req.destroy(new Error('Slow-body fixture request timed out'))); req.end(body);
  });
  const create = async slug => {
    const { json } = await request('/__studio/api/dashboards');
    const result = await request('/__studio/api/dashboards', { method: 'POST', body: JSON.stringify({ revision: json.revision, action: 'create', name: slug, slug }), headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-studio-request': '1' } });
    assert.equal(result.status, 200, result.text);
  };
  // Sends the headers and one byte of a 64-byte body, then stalls.
  const slowPost = async target => {
    const socket = net.connect(port, '127.0.0.1'); sockets.add(socket);
    socket.on('error', () => {});
    await once(socket, 'connect');
    let response = '';
    socket.on('data', data => { response += data.toString(); });
    socket.write(`POST ${target} HTTP/1.1\r\nHost: ${HOST}\r\nContent-Type: application/json\r\nContent-Length: 64\r\n\r\n{`);
    return { socket, get response() { return response; } };
  };
  return { app, rendererPool, request, create, slowPost };
}

async function until(condition, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (!(await condition())) {
    if (Date.now() >= deadline) assert.fail('Timed out waiting for the expected state');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

test('stalled native request bodies do not hold renderer leases that starve other dashboards', async t => {
  const f = await fixture(t);
  await f.create('family'); await f.create('office');
  // Two dashboards receive slow uploads while the pool allows two workers.
  const slow = [await f.slowPost('/api/ping'), await f.slowPost('/family/api/ping')];
  await new Promise(resolve => setTimeout(resolve, 300));
  const office = await f.request('/office/api/ping');
  assert.equal(office.status, 200, office.text);
  assert.equal(office.json.url, '/api/ping');
  assert.ok(slow.every(item => item.response === ''));
  // Completing a slow body still forwards it intact.
  slow[0].socket.write('"padding":"' + 'x'.repeat(50) + '"}');
  await until(() => slow[0].response.includes('\r\n\r\n{'));
  assert.match(slow[0].response, /^HTTP\/1\.1 200/);
  assert.ok(slow[0].response.includes('"body":"{\\"padding\\"'));
  assert.ok(slow[0].response.includes('"length":"64"'));
});

test('a stalled native request body is refused after its deadline and the connection closes', async t => {
  const f = await fixture(t, { nativeBodyTimeoutMs: 200 });
  const slow = await f.slowPost('/api/ping');
  await once(slow.socket, 'close');
  assert.match(slow.response, /^HTTP\/1\.1 408/);
  assert.match(slow.response, /REQUEST_BODY_TIMEOUT/);
  assert.match(slow.response, /[Cc]onnection: close/);
  assert.equal(f.rendererPool.workerCount, 0);
  // Ordinary native posts and chunked bodies still reach the worker.
  const posted = await f.request('/api/action', { method: 'POST', body: '{"a":1}', headers: { 'content-type': 'application/json' } });
  assert.equal(posted.status, 200); assert.equal(posted.json.body, '{"a":1}'); assert.equal(posted.json.length, '7');
  const chunked = await f.request('/api/action', { method: 'POST', body: '{"chunked":true}', headers: { 'content-type': 'application/json', 'transfer-encoding': 'chunked' } });
  assert.equal(chunked.status, 200); assert.equal(chunked.json.body, '{"chunked":true}'); assert.equal(chunked.json.length, '16');
});

test('native request bodies above the controller limit are refused without using a worker', async t => {
  const f = await fixture(t);
  const result = await f.request('/api/action', { method: 'POST', body: 'x'.repeat(4 * 1024 * 1024 + 1), headers: { 'content-type': 'application/json' } }).catch(error => ({ error }));
  // The controller may close the socket while the client is still writing.
  if (!result.error) { assert.equal(result.status, 413); assert.equal(result.json.code, 'REQUEST_TOO_LARGE'); }
  assert.equal(f.rendererPool.workerCount, 0);
});
