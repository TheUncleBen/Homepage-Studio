import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { gzipSync, gunzipSync, brotliDecompressSync } from 'node:zlib';
import { compressStaticAssets } from '../scripts/compress-static-assets.mjs';
import { serveSharedAsset } from './static-assets.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-static-assets-'));
  const assets = path.join(root, '.next/static/chunks');
  await fs.mkdir(assets, { recursive: true });
  await fs.mkdir(path.join(root, 'public'));
  const content = '/* bounded public application bundle */\n'.repeat(1000);
  await fs.writeFile(path.join(assets, 'bundle.js'), content);
  await fs.writeFile(path.join(assets, 'small.js'), 'window.small = true;');
  await fs.writeFile(path.join(root, 'public/config.json'), '{"public":"unchanged"}');
  await compressStaticAssets(path.join(root, '.next/static'));
  const server = http.createServer((req, res) => { serveSharedAsset(req, res, root).catch(() => { res.writeHead(503); res.end(); }); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); });
  const request = ({ target = '/_next/static/chunks/bundle.js', method = 'GET', headers = {} } = {}) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: target, method, headers, agent: false }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, bytes: Buffer.concat(chunks) }));
    });
    req.on('error', reject); req.setTimeout(1500, () => req.destroy(new Error('Static asset request did not finish'))); req.end();
  });
  return { root, assets, content, request };
}

test('built static representations round-trip and negotiate client quality and exclusions', async t => {
  const f = await fixture(t);
  for (const [accept, expected] of [
    ['gzip, deflate, br', 'br'], ['br;q=0, gzip', 'gzip'], ['br;q=0.2, gzip;q=0.8, identity;q=0', 'gzip'],
    ['*;q=1', 'br'], ['gzip;q=0, br;q=0', undefined], ['identity;q=1, br;q=0.5', undefined],
    ['br;q=invalid, gzip;q=1', 'gzip'], ['', undefined],
  ]) {
    const result = await f.request({ headers: { 'accept-encoding': accept } });
    assert.equal(result.status, 200, accept); assert.equal(result.headers['content-encoding'], expected, accept);
    assert.equal(result.headers.vary, 'Accept-Encoding');
    assert.equal(result.headers['content-type'], 'text/javascript; charset=utf-8');
    assert.equal(result.bytes.length, Number(result.headers['content-length']));
    const decoded = expected === 'br' ? brotliDecompressSync(result.bytes) : expected === 'gzip' ? gunzipSync(result.bytes) : result.bytes;
    assert.equal(decoded.toString(), f.content);
    if (expected) assert.ok(result.bytes.length < Buffer.byteLength(f.content) / 4);
  }
  assert.equal((await f.request({ headers: { 'accept-encoding': '*;q=0' } })).status, 406);
});

test('HEAD, validators and tiny/missing representations use the selected bytes', async t => {
  const f = await fixture(t);
  const br = await f.request({ headers: { 'accept-encoding': 'br' } });
  const identity = await f.request();
  assert.notEqual(br.headers.etag, identity.headers.etag);
  const head = await f.request({ method: 'HEAD', headers: { 'accept-encoding': 'br' } });
  assert.equal(head.bytes.length, 0); assert.equal(head.headers['content-length'], br.headers['content-length']);
  assert.equal(head.headers.etag, br.headers.etag); assert.equal(head.headers['content-encoding'], 'br');
  const unchanged = await f.request({ headers: { 'accept-encoding': 'br', 'if-none-match': `W/${br.headers.etag}` } });
  assert.equal(unchanged.status, 304); assert.equal(unchanged.bytes.length, 0); assert.equal(unchanged.headers['content-length'], undefined); assert.equal(unchanged.headers.vary, 'Accept-Encoding');
  assert.equal((await f.request({ headers: { 'if-none-match': br.headers.etag } })).status, 200);
  const small = await f.request({ target: '/_next/static/chunks/small.js', headers: { 'accept-encoding': 'gzip, br' } });
  assert.equal(small.headers['content-encoding'], undefined); assert.equal(small.bytes.toString(), 'window.small = true;');
  const plain = await f.request({ target: '/public-missing.js', headers: { 'accept-encoding': 'br' } });
  assert.equal(plain.status, 404);
  const publicFile = await f.request({ target: '/config.json', headers: { 'accept-encoding': 'br' } });
  assert.equal(publicFile.headers['content-encoding'], undefined); assert.equal(publicFile.headers['cache-control'], 'public, max-age=60');
});

test('compressed sidecars cannot expose external files or wait on special files', async t => {
  const f = await fixture(t);
  const sidecar = path.join(f.assets, 'bundle.js.br');
  const outside = path.join(f.root, 'private.br'); await fs.writeFile(outside, 'private synthetic fixture');
  await fs.unlink(sidecar); await fs.symlink(outside, sidecar);
  const result = await f.request({ headers: { 'accept-encoding': 'br, gzip' } });
  assert.equal(result.status, 200); assert.equal(result.headers['content-encoding'], 'gzip'); assert.equal(gunzipSync(result.bytes).toString(), f.content);
  assert.equal((await f.request({ headers: { 'accept-encoding': 'br, identity;q=0' } })).status, 406);
  await fs.unlink(sidecar); execFileSync('mkfifo', [sidecar]);
  assert.equal((await f.request({ headers: { 'accept-encoding': 'br, gzip' } })).headers['content-encoding'], 'gzip');
});

test('the build compressor is repeatable, skips tiny/binary assets and refuses links', async t => {
  const f = await fixture(t), directory = path.join(f.root, '.next/static');
  const first = await fs.readFile(path.join(f.assets, 'bundle.js.br'));
  await fs.writeFile(path.join(f.assets, 'font.woff2'), gzipSync(Buffer.alloc(5000)));
  const summary = await compressStaticAssets(directory);
  assert.equal(summary.files, 1); assert.equal(summary.bytes, Buffer.byteLength(f.content));
  assert.deepEqual(await fs.readFile(path.join(f.assets, 'bundle.js.br')), first);
  await assert.rejects(fs.stat(path.join(f.assets, 'small.js.br')), { code: 'ENOENT' });
  await assert.rejects(fs.stat(path.join(f.assets, 'font.woff2.br')), { code: 'ENOENT' });
  await fs.writeFile(path.join(f.assets, 'bundle.js'), 'window.rebuilt = true;');
  await compressStaticAssets(directory);
  await assert.rejects(fs.stat(path.join(f.assets, 'bundle.js.br')), { code: 'ENOENT' });
  await assert.rejects(fs.stat(path.join(f.assets, 'bundle.js.gz')), { code: 'ENOENT' });
  assert.equal((await f.request({ headers: { 'accept-encoding': 'br' } })).bytes.toString(), 'window.rebuilt = true;');
  await fs.symlink(path.join(f.root, 'public/config.json'), path.join(f.assets, 'bundle.js.br'));
  await assert.rejects(compressStaticAssets(directory), /regular files/);
  assert.equal(await fs.readFile(path.join(f.root, 'public/config.json'), 'utf8'), '{"public":"unchanged"}');
});
