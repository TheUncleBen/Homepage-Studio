import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createStudioServer, NATIVE_BODY_LIMIT, NATIVE_BODY_BUDGET } from './index.mjs';
import { createRendererPool } from './renderer-pool.mjs';
import { addressMainDashboard } from './fixtures/main-address.mjs';

// The main dashboard lives at /home. Its own addresses (native API, editor
// API, native data) move with it; Studio-wide addresses stay at the root.
const onPrimary = target => (/^\/(?:api\/|studio\/(?:api\/(?!dashboards|overview)|catalog\.json|edit|settings)|_next\/(?!static\/))/.test(target) ? '/home' + target : target);
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
  res.end(JSON.stringify({ id: process.env.STUDIO_DASHBOARD_ID, url: req.url, body: Buffer.concat(chunks).toString('utf8'), length: req.headers['content-length'] ?? null, expect: req.headers.expect ?? null }));
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
  const app = createStudioServer({ configDir, stateDir, rendererDir, rendererPool, allowedHosts: HOST, buildRevision: BUILD, auth: 'off', ...options });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const port = app.server.address().port;
  await addressMainDashboard({ port, host: HOST, origin: ORIGIN });
  const sockets = new Set();
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await app.shutdown({ graceMs: 25 });
    await fs.rm(root, { recursive: true, force: true });
  });
  const request = (target, { method = 'GET', body, headers = {} } = {}) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: onPrimary(target), method, agent: false, headers: { host: HOST, ...headers } }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('error', reject);
      res.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); let json; try { json = JSON.parse(text); } catch {} resolve({ status: res.statusCode, headers: res.headers, json, text }); });
    });
    req.on('error', reject); req.setTimeout(8000, () => req.destroy(new Error('Slow-body fixture request timed out'))); req.end(body);
  });
  const create = async slug => {
    const { json } = await request('/studio/api/dashboards');
    const result = await request('/studio/api/dashboards', { method: 'POST', body: JSON.stringify({ revision: json.revision, action: 'create', name: slug, slug }), headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-studio-request': '1' } });
    assert.equal(result.status, 200, result.text);
  };
  // Sends the headers and one byte of a 64-byte body, then stalls.
  const slowPost = async target => {
    const socket = net.connect(port, '127.0.0.1'); sockets.add(socket);
    socket.on('error', () => {});
    await once(socket, 'connect');
    let response = '';
    socket.on('data', data => { response += data.toString(); });
    socket.write(`POST ${onPrimary(target)} HTTP/1.1\r\nHost: ${HOST}\r\nContent-Type: application/json\r\nContent-Length: 64\r\n\r\n{`);
    return { socket, get response() { return response; } };
  };
  // Sends only the request head; the caller decides what follows.
  const rawHead = async head => {
    const socket = net.connect(port, '127.0.0.1'); sockets.add(socket);
    socket.on('error', () => {});
    await once(socket, 'connect');
    let response = '';
    socket.on('data', data => { response += data.toString(); });
    socket.write(head.replaceAll('\n', '\r\n') + '\r\n');
    return { socket, get response() { return response; } };
  };
  return { app, rendererPool, request, create, slowPost, rawHead };
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
  assert.equal(NATIVE_BODY_LIMIT, 1024 * 1024, 'The controller matches the native 1 MiB body parser default.');
  const result = await f.request('/api/action', { method: 'POST', body: 'x'.repeat(NATIVE_BODY_LIMIT + 1), headers: { 'content-type': 'application/json' } }).catch(error => ({ error }));
  // The controller may close the socket while the client is still writing.
  if (!result.error) { assert.equal(result.status, 413); assert.equal(result.json.code, 'REQUEST_TOO_LARGE'); }
  // A chunked body without a declared length is cut off at the same limit.
  const chunked = await f.request('/api/action', { method: 'POST', body: 'x'.repeat(NATIVE_BODY_LIMIT + 1), headers: { 'content-type': 'application/json', 'transfer-encoding': 'chunked' } }).catch(error => ({ error }));
  if (!chunked.error) { assert.equal(chunked.status, 413); assert.equal(chunked.json.code, 'REQUEST_TOO_LARGE'); }
  assert.equal(f.rendererPool.workerCount, 0);
  assert.equal(f.app.nativeBodyBytesInFlight, 0);
  const exact = await f.request('/api/action', { method: 'POST', body: 'y'.repeat(NATIVE_BODY_LIMIT), headers: { 'content-type': 'application/json' } });
  assert.equal(exact.status, 200); assert.equal(exact.json.length, String(NATIVE_BODY_LIMIT)); assert.equal(exact.json.body.length, NATIVE_BODY_LIMIT);
  await until(() => f.app.nativeBodyBytesInFlight === 0);
});

test('a declared oversized length is refused at once, before any body arrives', async t => {
  const f = await fixture(t);
  const raw = await f.rawHead(`POST /home/api/action HTTP/1.1\nHost: ${HOST}\nContent-Type: application/json\nContent-Length: ${NATIVE_BODY_LIMIT + 1}\n`);
  await once(raw.socket, 'close');
  assert.match(raw.response, /^HTTP\/1\.1 413/);
  assert.match(raw.response, /REQUEST_TOO_LARGE/);
  assert.match(raw.response, /[Cc]onnection: close/);
  assert.equal(f.rendererPool.workerCount, 0);
  assert.equal(f.app.nativeBodyBytesInFlight, 0);
});

test('Expect: 100-continue is answered only for acceptable native uploads and is not forwarded', async t => {
  const f = await fixture(t);
  const oversized = await f.rawHead(`POST /home/api/action HTTP/1.1\nHost: ${HOST}\nContent-Type: application/json\nExpect: 100-continue\nContent-Length: ${NATIVE_BODY_LIMIT + 1}\n`);
  await once(oversized.socket, 'close');
  assert.match(oversized.response, /^HTTP\/1\.1 413/);
  assert.doesNotMatch(oversized.response, /100 Continue/);
  assert.equal(f.rendererPool.workerCount, 0);
  const valid = await f.rawHead(`POST /home/api/action HTTP/1.1\nHost: ${HOST}\nContent-Type: application/json\nExpect: 100-continue\nContent-Length: 7\nConnection: close\n`);
  await until(() => valid.response.includes('\r\n\r\n'));
  assert.match(valid.response, /^HTTP\/1\.1 100 Continue\r\n\r\n$/);
  const closed = once(valid.socket, 'close');
  valid.socket.write('{"a":1}');
  await closed;
  const final = valid.response.slice(valid.response.indexOf('\r\n\r\n') + 4);
  assert.match(final, /^HTTP\/1\.1 200/);
  const echoed = JSON.parse(final.slice(final.indexOf('\r\n\r\n') + 4));
  assert.equal(echoed.body, '{"a":1}'); assert.equal(echoed.expect, null);
  // Editor routes still receive 100 Continue before their JSON body is read.
  const editor = await f.rawHead(`POST /studio/api/dashboards HTTP/1.1\nHost: ${HOST}\nContent-Type: application/json\nOrigin: ${ORIGIN}\nX-Studio-Request: 1\nExpect: 100-continue\nContent-Length: 2\nConnection: close\n`);
  await until(() => editor.response.includes('\r\n\r\n'));
  assert.match(editor.response, /^HTTP\/1\.1 100 Continue/);
  const editorClosed = once(editor.socket, 'close'); editor.socket.write('{}'); await editorClosed;
  assert.match(editor.response.slice(editor.response.indexOf('\r\n\r\n') + 4), /^HTTP\/1\.1 (400|409)/);
});

// Regression (N2): 150 concurrent 4 MiB uploads were all buffered at once.
test('concurrent native uploads share one byte budget and excess uploads get 503 with Retry-After', async t => {
  const f = await fixture(t);
  await f.create('family');
  assert.equal(NATIVE_BODY_BUDGET, 32 * 1024 * 1024);
  const slots = NATIVE_BODY_BUDGET / NATIVE_BODY_LIMIT;
  const stalled = [];
  for (let i = 0; i < slots; i++) stalled.push(await f.rawHead(`POST ${i % 2 ? '/family' : '/home'}/api/upload HTTP/1.1\nHost: ${HOST}\nContent-Type: application/octet-stream\nContent-Length: ${NATIVE_BODY_LIMIT}\n`));
  await until(() => f.app.nativeBodyBytesInFlight === NATIVE_BODY_BUDGET);
  const over = await f.request('/family/api/upload', { method: 'POST', body: 'z', headers: { 'content-type': 'application/json' } });
  assert.equal(over.status, 503); assert.equal(over.json.code, 'REQUEST_BODY_BUDGET_EXCEEDED');
  assert.equal(over.headers['retry-after'], '5');
  const chunked = await f.request('/api/upload', { method: 'POST', body: 'z', headers: { 'content-type': 'application/json', 'transfer-encoding': 'chunked' } });
  assert.equal(chunked.status, 503); assert.equal(chunked.headers['retry-after'], '5');
  // Requests without a body are unaffected.
  const read = await f.request('/family/api/ping'); assert.equal(read.status, 200);
  assert.ok(stalled.every(item => item.response === ''));
  for (const item of stalled) item.socket.destroy();
  await until(() => f.app.nativeBodyBytesInFlight === 0);
  const posted = await f.request('/api/action', { method: 'POST', body: '{"after":1}', headers: { 'content-type': 'application/json' } });
  assert.equal(posted.status, 200); assert.equal(posted.json.body, '{"after":1}');
  await until(() => f.app.nativeBodyBytesInFlight === 0);
});
