import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { RegistryAccessError, registryReader } from '../scripts/ghcr-read.mjs';

const repository = 'ghcr.io/theuncleben/homepage-studio';
const digestOf = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const challenge = 'Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:theuncleben/homepage-studio:pull"';

function streamingResponse(parts, options = {}) {
  let next = 0;
  const response = new Response(new ReadableStream({
    pull(controller) {
      if (next === parts.length) controller.close();
      else controller.enqueue(parts[next++]);
    },
    cancel() { options.cancelled?.(); },
  }, { highWaterMark: 0 }), { headers: options.headers });
  response.arrayBuffer = () => { throw new Error('Layer verification must not buffer the complete response.'); };
  return response;
}

test('anonymous layer verification streams all bytes and proves size plus SHA-256', async () => {
  const bytes = Buffer.from('a complete production image layer');
  const actual = registryReader(repository, { fetcher: async (url, options) => {
    assert.equal(url, `https://ghcr.io/v2/theuncleben/homepage-studio/blobs/${digestOf(bytes)}`);
    assert.equal(options.redirect, 'manual');
    assert.equal(options.headers.authorization, undefined);
    return streamingResponse([bytes.subarray(0, 9), bytes.subarray(9, 20), bytes.subarray(20)], { headers: { 'content-length': String(bytes.length) } });
  } });
  assert.deepEqual(await actual.verifyBlob(digestOf(bytes), bytes.length), { digest: digestOf(bytes), size: bytes.length });
});

test('empty descriptor bytes are verified rather than exempted', async () => {
  const empty = Buffer.alloc(0);
  const read = registryReader(repository, { fetcher: async () => new Response(null, { headers: { 'content-length': '0' } }) });
  assert.deepEqual(await read.verifyBlob(digestOf(empty), 0), { digest: digestOf(empty), size: 0 });
});

test('invalid layer descriptors fail before any registry request', async () => {
  let requests = 0;
  const read = registryReader(repository, { fetcher: async () => { requests += 1; throw new Error('unexpected request'); } });
  for (const size of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1', undefined]) await assert.rejects(read.verifyBlob(digestOf('x'), size), /descriptor size/);
  for (const digest of ['latest', 'sha256:xyz', `sha512:${'a'.repeat(64)}`]) await assert.rejects(read.verifyBlob(digest, 1), /exact SHA-256/);
  assert.equal(requests, 0);
});

test('wrong advertised Content-Length cancels the response before consuming its layer', async () => {
  let cancelled = false;
  const bytes = Buffer.from('layer');
  const read = registryReader(repository, { fetcher: async () => streamingResponse([bytes], { headers: { 'content-length': '20' }, cancelled: () => { cancelled = true; } }) });
  await assert.rejects(read.verifyBlob(digestOf(bytes), bytes.length), /Content-Length differs/);
  assert.equal(cancelled, true);
});

test('chunked oversize response is stopped and cancelled at the descriptor bound', async () => {
  let cancelled = false;
  const read = registryReader(repository, { fetcher: async () => streamingResponse([Buffer.from('abc'), Buffer.from('def'), Buffer.from('never needed')], { cancelled: () => { cancelled = true; } }) });
  await assert.rejects(read.verifyBlob(digestOf('abc'), 3), /exceeds its manifest descriptor size/);
  assert.equal(cancelled, true);
});

test('truncated and same-length altered blobs fail integrity verification', async () => {
  const expected = Buffer.from('expected');
  for (const actual of [Buffer.from('expect'), Buffer.from('tampered')]) {
    const read = registryReader(repository, { fetcher: async () => streamingResponse([actual]) });
    await assert.rejects(read.verifyBlob(digestOf(expected), expected.length), /bytes differ from their manifest digest or size/);
  }
});

test('stream transport failure propagates and cannot be recorded as a successful layer', async () => {
  const read = registryReader(repository, { fetcher: async () => new Response(new ReadableStream({ start(controller) { controller.error(new Error('transport interrupted')); } })) });
  await assert.rejects(read.verifyBlob(digestOf('layer'), 5), /transport interrupted/);
});

test('GHCR challenge obtains the scoped token and storage redirect receives no authorization', async () => {
  const bytes = Buffer.from('layer through the registry CDN');
  const calls = [];
  const read = registryReader(repository, { credential: 'fixture-token', fetcher: async (url, options) => {
    calls.push({ url, options });
    if (url.startsWith('https://ghcr.io/token?')) {
      assert.equal(new URL(url).searchParams.get('scope'), 'repository:theuncleben/homepage-studio:pull');
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers.authorization, `Basic ${Buffer.from('TheUncleBen:fixture-token').toString('base64')}`);
      return Response.json({ token: 'fixture-pull-token' });
    }
    if (url.startsWith('https://pkg-containers.githubusercontent.com/')) {
      assert.equal(options.headers, undefined);
      assert.equal(options.redirect, 'error');
      return streamingResponse([bytes.subarray(0, 7), bytes.subarray(7)]);
    }
    if (!options.headers.authorization) return new Response(null, { status: 401, headers: { 'www-authenticate': challenge } });
    assert.equal(options.headers.authorization, 'Bearer fixture-pull-token');
    return new Response(null, { status: 307, headers: { location: 'https://pkg-containers.githubusercontent.com/ghcr1/blobs/fixture?signature=fixture' } });
  } });
  assert.deepEqual(await read.verifyBlob(digestOf(bytes), bytes.length), { digest: digestOf(bytes), size: bytes.length });
  assert.equal(calls.length, 4);
});

test('anonymous token request does not include an account credential', async () => {
  const bytes = Buffer.from('anonymous');
  const read = registryReader(repository, { fetcher: async (url, options) => {
    if (url.startsWith('https://ghcr.io/token?')) {
      assert.equal(options.headers, undefined);
      return Response.json({ access_token: 'fixture-public-token' });
    }
    if (!options.headers.authorization) return new Response(null, { status: 401, headers: { 'www-authenticate': challenge } });
    assert.equal(options.headers.authorization, 'Bearer fixture-public-token');
    return streamingResponse([bytes]);
  } });
  await read.verifyBlob(digestOf(bytes), bytes.length);
});

test('401 and 403 are typed access failures without treating them as absence', async () => {
  for (const status of [401, 403]) for (const credential of [undefined, 'fixture-token']) {
    const read = registryReader(repository, { credential, fetcher: async (url) => {
      if (url.startsWith('https://ghcr.io/token?')) return new Response(null, { status });
      return new Response(null, { status: 401, headers: { 'www-authenticate': challenge } });
    } });
    await assert.rejects(read.verifyBlob(digestOf('x'), 1), error => error instanceof RegistryAccessError && error.status === status && error.anonymous === !credential);
  }
  const denied = registryReader(repository, { fetcher: async () => new Response(null, { status: 403 }) });
  await assert.rejects(denied('manifests', digestOf('x'), { absent: true }), error => error instanceof RegistryAccessError && error.anonymous);
});

test('CDN denial and transient registry errors remain failures, never visibility-pending evidence', async () => {
  const redirected = registryReader(repository, { fetcher: async (url) => url.startsWith('https://ghcr.io/')
    ? new Response(null, { status: 302, headers: { location: 'https://pkg-containers.githubusercontent.com/ghcr1/blobs/fixture?signature=expired' } })
    : new Response(null, { status: 403 }) });
  await assert.rejects(redirected.verifyBlob(digestOf('x'), 1), error => !(error instanceof RegistryAccessError) && /readback failed \(403\)/.test(error.message));
  const unavailable = registryReader(repository, { fetcher: async () => new Response(null, { status: 503 }) });
  await assert.rejects(unavailable.verifyBlob(digestOf('x'), 1), error => !(error instanceof RegistryAccessError) && /readback failed \(503\)/.test(error.message));
});

test('unsafe or second storage redirects never receive credentials or cause an extra request', async () => {
  for (const location of ['https://evil.example/layer', 'http://pkg-containers.githubusercontent.com/layer', 'https://user:secret@pkg-containers.githubusercontent.com/layer']) {
    let requests = 0;
    const read = registryReader(repository, { fetcher: async () => { requests += 1; return new Response(null, { status: 307, headers: { location } }); } });
    await assert.rejects(read.verifyBlob(digestOf('x'), 1), /Unexpected registry blob redirect/);
    assert.equal(requests, 1);
  }
  let requests = 0;
  const secondRedirect = registryReader(repository, { fetcher: async (url, options) => {
    requests += 1;
    if (requests === 2) assert.equal(options.redirect, 'error');
    return new Response(null, { status: 307, headers: { location: 'https://pkg-containers.githubusercontent.com/other' } });
  } });
  await assert.rejects(secondRedirect.verifyBlob(digestOf('x'), 1), /readback failed \(307\)/);
  assert.equal(requests, 2);
});

test('metadata reading remains bounded and only explicit manifest 404 is absent', async () => {
  const read = registryReader(repository, { fetcher: async () => new Response('manifest') });
  assert.deepEqual(await read('manifests', digestOf('manifest')), Buffer.from('manifest'));
  const missing = registryReader(repository, { fetcher: async () => new Response(null, { status: 404 }) });
  assert.equal(await missing('manifests', digestOf('missing'), { absent: true }), null);
  await assert.rejects(missing.verifyBlob(digestOf('missing'), 7), /readback failed \(404\)/);
  const huge = registryReader(repository, { fetcher: async () => new Response('metadata', { headers: { 'content-length': String(4 * 1024 * 1024 + 1) } }) });
  await assert.rejects(huge('manifests', digestOf('metadata')), /metadata exceeds/);
});
