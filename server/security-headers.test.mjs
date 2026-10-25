import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createStudioServer, parseFrameAncestors, securityHeaders } from './index.mjs';
// The main dashboard lives at /home. Its own addresses (native API, editor
// API, native data) move with it; Studio-wide addresses stay at the root.
const onPrimary = target => (/^\/(?:api\/|__studio\/(?:api\/(?!dashboards|overview)|catalog\.json|edit|settings)|_next\/(?!static\/))/.test(target) ? '/home' + target : target);


const HOST = 'frames.example.test:3000';

async function listen(server) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return server.address().port; }

async function fixture(t, options = {}, nativeHeaders = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-security-headers-'));
  const native = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...nativeHeaders });
    res.end('<!doctype html><title>Native dashboard</title>');
  });
  const nativePort = await listen(native);
  const app = createStudioServer({ configDir: path.join(root, 'config'), stateDir: path.join(root, 'state'), rendererDir: path.join(root, 'renderer'), upstream: `http://127.0.0.1:${nativePort}`, allowedHosts: HOST, auth: 'off', ...options });
  const port = await listen(app.server);
  t.after(async () => {
    await app.shutdown({ graceMs: 25 });
    native.closeAllConnections(); await new Promise(done => native.close(done));
    await app.initialization;
    await fs.rm(root, { recursive: true, force: true });
  });
  return (target, method = 'GET') => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: onPrimary(target), method, agent: false, headers: { host: HOST } }, res => {
      res.resume(); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, raw: res.rawHeaders }));
    });
    req.on('error', reject); req.end();
  });
}

function allValues(raw, name) {
  const found = [];
  for (let index = 0; index < raw.length; index += 2) if (raw[index].toLowerCase() === name) found.push(raw[index + 1]);
  return found;
}

test('dashboard documents refuse foreign framing by default', async t => {
  const request = await fixture(t);
  for (const target of ['/', '/__studio/health', '/robots.txt', '/__studio/api/missing']) {
    const response = await request(target);
    assert.equal(response.headers['content-security-policy'], "frame-ancestors 'self'", target);
    assert.equal(response.headers['x-frame-options'], 'SAMEORIGIN', target);
  }
  const page = await request('/home');
  assert.equal(page.status, 200);
  assert.match(page.headers['content-type'], /text\/html/);
});

test('a native response cannot remove or loosen the frame policy', async t => {
  const request = await fixture(t, {}, { 'x-frame-options': 'ALLOWALL', 'content-security-policy': "default-src 'self'" });
  const response = await request('/home');
  assert.deepEqual(allValues(response.raw, 'x-frame-options'), ['SAMEORIGIN']);
  // The native policy stays in force and the controller adds its own header.
  assert.deepEqual(allValues(response.raw, 'content-security-policy'), ["default-src 'self'", "frame-ancestors 'self'"]);
});

test('STUDIO_FRAME_ANCESTORS replaces the default list and drops X-Frame-Options', async t => {
  const request = await fixture(t, { frameAncestors: "'self'  https://ha.example.test:8123\thttp://panel.example.test" }, { 'x-frame-options': 'DENY' });
  for (const target of ['/', '/__studio/health']) {
    const response = await request(target);
    assert.equal(response.headers['content-security-policy'], "frame-ancestors 'self' https://ha.example.test:8123 http://panel.example.test", target);
    assert.equal(response.headers['x-frame-options'], undefined, target);
  }
});

test('frame ancestor configuration accepts only self and exact http(s) origins', () => {
  for (const blank of [undefined, null, '', '   ', '\n']) assert.equal(parseFrameAncestors(blank), null);
  assert.deepEqual(parseFrameAncestors("https://HA.Example.test:8123/ 'self'"), ['https://ha.example.test:8123', "'self'"]);
  assert.deepEqual(parseFrameAncestors('https://ha.example.test:443'), ['https://ha.example.test']);
  // .env files and shells drop the quotes, so a bare self means 'self'.
  assert.deepEqual(parseFrameAncestors('self https://ha.example.test:8123'), ["'self'", 'https://ha.example.test:8123']);
  assert.deepEqual(parseFrameAncestors('https://[::1]:8123 http://192.0.2.7'), ['https://[::1]:8123', 'http://192.0.2.7']);
  for (const invalid of ['https://a.test;script-src', "https://a.test;script-src'unsafe-inline'", "https://a'b.test", 'https://a_b.test', 'https://a"b.test',
    'https://a.test%3Bx', 'https://a.test!', 'https://a.test$x', "'SELF'", 'SELF', 'selfx', "'none'", '*', 'https://*.example.test', 'ha.example.test', 'https:ha.example.test', 'ftp://ha.example.test',
    'https://ha.example.test/path', 'https://ha.example.test?x=1', 'https://ha.example.test#x', 'https://user:pass@ha.example.test',
    'https://ha.example.test,https://b.example.test', "'self';", 'javascript:alert(1)', 'data:']) {
    assert.throws(() => parseFrameAncestors(invalid), /STUDIO_FRAME_ANCESTORS/, invalid);
  }
  const common = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin' };
  assert.deepEqual(securityHeaders(null), { 'content-security-policy': "frame-ancestors 'self'", 'x-frame-options': 'SAMEORIGIN', ...common });
  assert.deepEqual(securityHeaders(['https://ha.example.test']), { 'content-security-policy': 'frame-ancestors https://ha.example.test', ...common });
});

test('an invalid STUDIO_FRAME_ANCESTORS value stops startup', async () => {
  const previous = process.env.STUDIO_FRAME_ANCESTORS;
  process.env.STUDIO_FRAME_ANCESTORS = 'https://ha.example.test/dashboard';
  try {
    assert.throws(() => createStudioServer({ configDir: os.tmpdir(), stateDir: os.tmpdir(), upstream: 'http://127.0.0.1:9', allowedHosts: HOST, auth: 'off' }), /STUDIO_FRAME_ANCESTORS entry "https:\/\/ha\.example\.test\/dashboard"/);
  } finally {
    if (previous === undefined) delete process.env.STUDIO_FRAME_ANCESTORS; else process.env.STUDIO_FRAME_ANCESTORS = previous;
  }
});

test('every response is marked nosniff with a same-origin referrer policy that native responses cannot replace', async t => {
  const request = await fixture(t, {}, { 'x-content-type-options': 'sniff-anyway', 'referrer-policy': 'unsafe-url', 'x-powered-by': 'Next.js' });
  for (const target of ['/', '/__studio/health', '/robots.txt', '/__studio/api/missing']) {
    const response = await request(target);
    assert.deepEqual(allValues(response.raw, 'x-content-type-options'), ['nosniff'], target);
    assert.deepEqual(allValues(response.raw, 'referrer-policy'), ['same-origin'], target);
  }
  assert.deepEqual(allValues((await request('/')).raw, 'x-powered-by'), [], 'A proxied native response does not advertise its framework.');
});

test('the documented frame-ancestors example survives .env and shell parsing', () => {
  const example = readFileSync(new URL('../portainer.env.example', import.meta.url), 'utf8').match(/^# (STUDIO_FRAME_ANCESTORS=.*)$/m)?.[1];
  assert.equal(example, `STUDIO_FRAME_ANCESTORS="'self' https://ha.example.test:8123"`);
  const value = execFileSync('sh', ['-c', `${example}; printf %s "$STUDIO_FRAME_ANCESTORS"`], { encoding: 'utf8' });
  assert.deepEqual(parseFrameAncestors(value), ["'self'", 'https://ha.example.test:8123']);
  // Compose's dotenv reader removes the outer double quotes and keeps the rest.
  assert.deepEqual(parseFrameAncestors(example.split('=').slice(1).join('=').replace(/^"(.*)"$/, '$1')), ["'self'", 'https://ha.example.test:8123']);
});

test('the native build does not advertise its framework', async () => {
  const config = await fs.readFile(new URL('../homepage/next.config.js', import.meta.url), 'utf8');
  assert.match(config, /^\s*poweredByHeader: false,$/m);
});
