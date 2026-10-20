import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import path from 'node:path';

if (!process.env.STUDIO_NATIVE_SOURCE) throw new Error('Set STUDIO_NATIVE_SOURCE to the prepared and installed native source directory.');
const requireNative = createRequire(path.join(path.resolve(process.env.STUDIO_NATIVE_SOURCE), 'package.json'));
const redirects = requireNative('follow-redirects');
const installedVersion = requireNative('follow-redirects/package.json').version;

async function server(t, callback) {
  const instance = http.createServer(callback);
  instance.listen(0, '127.0.0.1');
  await once(instance, 'listening');
  t.after(async () => { instance.closeAllConnections(); await new Promise(resolve => instance.close(resolve)); });
  return `http://127.0.0.1:${instance.address().port}`;
}

function get(url, options = {}) {
  return new Promise((resolve, reject) => {
    const request = redirects.http.get(url, { ...options, timeout: 2000 }, response => {
      let body = '';
      response.on('data', chunk => { body += chunk; });
      response.on('error', reject);
      response.on('end', () => { try { resolve(JSON.parse(body)); } catch (error) { reject(error); } });
    });
    request.on('error', reject);
    request.on('timeout', () => request.destroy(new Error('Fixture request timed out')));
  });
}

test('the native graph installs the exact reviewed redirect security fix', () => {
  assert.equal(installedVersion, '1.16.1');
});

test('native dependency strips object and array credential headers across origins', async t => {
  const destination = await server(t, (req, res) => res.end(JSON.stringify(req.headers)));
  const origin = await server(t, (_req, res) => { res.writeHead(302, { location: destination }); res.end(); });
  for (const headers of [
    { Authorization: 'fixture-only', Cookie: 'fixture-only', 'Proxy-Authorization': 'fixture-only', 'X-API-Key': 'fixture-only', 'X-Public': 'retained' },
    ['Authorization', 'fixture-only', 'Cookie', 'fixture-only', 'Proxy-Authorization', 'fixture-only', 'X-API-Key', 'fixture-only', 'X-Public', 'retained'],
  ]) {
    const seen = await get(origin, { headers, sensitiveHeaders: ['X-API-Key'] });
    for (const name of ['authorization', 'cookie', 'proxy-authorization', 'x-api-key']) assert.equal(seen[name], undefined);
    assert.equal(seen['x-public'], 'retained');
    assert.equal(seen.host, new URL(destination).host);
  }
});

test('declared credential header names with regex metacharacters are stripped exactly', async t => {
  const destination = await server(t, (req, res) => res.end(JSON.stringify(req.headers)));
  const origin = await server(t, (_req, res) => { res.writeHead(302, { location: destination }); res.end(); });
  const seen = await get(origin, {
    headers: { 'X-Api^Key': 'fixture-only', 'X-Token|Secret': 'fixture-only', 'X-Token': 'retained', Secret: 'retained' },
    sensitiveHeaders: ['X-Api^Key', 'X-Token|Secret'],
  });
  assert.equal(seen['x-api^key'], undefined);
  assert.equal(seen['x-token|secret'], undefined);
  assert.equal(seen['x-token'], 'retained');
  assert.equal(seen.secret, 'retained');
});

test('ordinary native-style object headers survive a same-origin redirect', async t => {
  const origin = await server(t, (req, res) => {
    if (req.url === '/start') { res.writeHead(302, { location: '/finish' }); res.end(); }
    else res.end(JSON.stringify(req.headers));
  });
  const seen = await get(`${origin}/start`, { headers: { Authorization: 'fixture-only', 'X-API-Key': 'fixture-only' }, sensitiveHeaders: ['X-API-Key'] });
  assert.equal(seen.authorization, 'fixture-only');
  assert.equal(seen['x-api-key'], 'fixture-only');
});
