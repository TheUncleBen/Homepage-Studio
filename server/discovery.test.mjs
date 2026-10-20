// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  DISCOVERY_UPSTREAM_COMMIT, DiscoveryError, createDiscoveryClient,
  mergeDiscoveredSources, validateDiscoveryManifest, validateHiddenDiscoveredIds,
  validateStoredDiscoveredSources,
} from '../server/discovery.mjs';

const serviceId = n => `discovered-service-${n.toString(16).padStart(32, '0')}`;
const widgetId = n => `discovered-widget-${n.toString(16).padStart(32, '0')}`;
const service = (n = 1) => ({
  id: serviceId(n), kind: 'service', title: `Service ${n}`, group: 'Infrastructure / Hosts',
  nativeLocator: { discovered: true, discoveryId: serviceId(n), serviceId: serviceId(n), origin: 'docker', groupPath: ['Infrastructure', 'Hosts'], name: `Service ${n}` },
});
const widget = (n = 1, singular = false) => ({
  ...service(n), id: widgetId(n), kind: 'serviceWidget', title: `Service ${n} · glances`,
  nativeLocator: { ...service(n).nativeLocator, widgetIndex: singular ? 2 : 1, sourceKey: singular ? 'widget' : 'widgets', sourceIndex: singular ? 0 : 1, proxyIndex: singular ? -1 : 1, type: 'glances' },
});
const envelope = (sources = [service(), widget()]) => ({ protocolVersion: 1, upstreamCommit: DISCOVERY_UPSTREAM_COMMIT, sources, warnings: [] });
const clone = value => structuredClone(value);
const safeError = error => error instanceof DiscoveryError && error.code === 'INVALID_DISCOVERY_MANIFEST' && !/private|password|token|secret\.internal/.test(error.message);

async function renderer(t, handler) {
  const requests = [];
  const server = http.createServer((req, res) => { requests.push({ method: req.method, url: req.url, headers: req.headers }); handler(req, res); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return { upstream: `http://127.0.0.1:${server.address().port}`, requests };
}
function json(res, value, status = 200) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); }

test('valid native descriptors retain raw plural/singular routing without private configuration', () => {
  const input = envelope([service(), widget(), widget(2, true)]);
  input.sources[2].nativeLocator.origin = 'kubernetes';
  const result = validateDiscoveryManifest(input);
  assert.deepEqual(result, input);
  assert.equal(result.sources[1].nativeLocator.proxyIndex, 1);
  assert.equal(result.sources[2].nativeLocator.proxyIndex, -1);
  assert.equal(result.sources[2].nativeLocator.widgetIndex, 2);
  result.sources[0].nativeLocator.groupPath[0] = 'Changed';
  assert.equal(input.sources[0].nativeLocator.groupPath[0], 'Infrastructure');
});

test('strict whitelist rejects private endpoint/config fields without echoing their values', () => {
  const variants = [
    value => { value.private = 'private'; },
    value => { value.sources[0].config = { key: 'private password' }; },
    value => { value.sources[0].nativeLocator.url = 'http://secret.internal'; },
    value => { value.sources[1].nativeLocator.apiKey = 'private token'; },
    value => { value.sources[0].available = true; },
    value => { value.warnings = [{ code: 'INVALID_NATIVE_SOURCE', count: 1, message: 'private password' }]; },
  ];
  for (const mutate of variants) { const value = envelope(); mutate(value); assert.throws(() => validateDiscoveryManifest(value), safeError); }
});

test('pin/protocol mismatch, duplicate identity and incompatible descriptor kinds fail closed', () => {
  const variants = [
    value => { value.protocolVersion = 2; },
    value => { value.upstreamCommit = '0'.repeat(40); },
    value => { value.sources.push(clone(value.sources[0])); },
    value => { value.sources[0].kind = 'bookmark'; },
    value => { value.sources[0].id = widgetId(1); },
    value => { value.sources[0].id = ['discovered-service-' + '0'.repeat(32)]; },
    value => { value.sources[1].id = 'discovered-widget-123'; },
    value => { value.sources[0].nativeLocator.serviceId = serviceId(9); },
    value => { value.sources[0].nativeLocator.discoveryId = serviceId(9); value.sources[0].nativeLocator.serviceId = serviceId(9); },
    value => { value.sources[0].nativeLocator.discovered = false; },
    value => { value.sources[0].nativeLocator.sourceKey = 'widget'; },
  ];
  for (const mutate of variants) { const value = envelope(); mutate(value); assert.throws(() => validateDiscoveryManifest(value), safeError); }
});

test('routing locators reject malformed group paths and incorrect raw/proxy indices', () => {
  const variants = [
    value => { value.sources[0].group = 'Different'; },
    value => { value.sources[0].nativeLocator.groupPath = []; },
    value => { value.sources[0].nativeLocator.groupPath = Array(21).fill('A'); },
    value => { value.sources[0].nativeLocator.name = '   '; },
    value => { value.sources[0].nativeLocator.name = 'Bad\u007fName'; },
    value => { value.sources[0].nativeLocator.origin = 'config'; },
    value => { value.sources[1].nativeLocator.sourceKey = 'wrong'; },
    value => { value.sources[1].nativeLocator.sourceIndex = -1; },
    value => { value.sources[1].nativeLocator.widgetIndex = 0.5; },
    value => { value.sources[1].nativeLocator.widgetIndex = 4096; },
    value => { value.sources[1].nativeLocator.proxyIndex = -1; },
    value => { value.sources[1].nativeLocator.sourceKey = 'widget'; value.sources[1].nativeLocator.proxyIndex = -1; },
    value => { value.sources[1].nativeLocator.type = ''; },
  ];
  for (const mutate of variants) { const value = envelope(); mutate(value); assert.throws(() => validateDiscoveryManifest(value), safeError); }
});

test('bounded safe warning codes preserve actionable limitations without arbitrary messages', () => {
  const input = envelope();
  input.warnings = ['AMBIGUOUS_NATIVE_SOURCE', 'POSITIONAL_WIDGET_IDENTITY', 'INVALID_NATIVE_SOURCE', 'NATIVE_DISCOVERY_UNAVAILABLE', 'SOURCE_LIMIT_REACHED'].map(code => ({ code, count: 1 }));
  assert.deepEqual(validateDiscoveryManifest(input).warnings, input.warnings);
  for (const warnings of [
    [{ code: 'PRIVATE_SERVICE_ERROR', count: 1 }], [{ code: 'INVALID_NATIVE_SOURCE', count: 4097 }],
    [{ code: 'INVALID_NATIVE_SOURCE', count: 0 }], [{ code: 'INVALID_NATIVE_SOURCE', count: 1.2 }],
    [{ code: 'INVALID_NATIVE_SOURCE', count: 1 }, { code: 'INVALID_NATIVE_SOURCE', count: 2 }],
  ]) assert.throws(() => validateDiscoveryManifest({ ...input, warnings }), safeError);
  delete input.warnings;
  assert.deepEqual(validateDiscoveryManifest(input).warnings, []);
});

test('stored metadata permits only a boolean availability extension and remains independently copied', () => {
  const input = [{ ...service(), available: false }, { ...widget(), available: true }];
  assert.deepEqual(validateStoredDiscoveredSources(input), input);
  const output = validateStoredDiscoveredSources(input);
  output[0].nativeLocator.groupPath.push('Changed');
  assert.equal(input[0].nativeLocator.groupPath.length, 2);
  assert.throws(() => validateStoredDiscoveredSources([{ ...service(), available: 'false' }]), safeError);
  assert.throws(() => validateStoredDiscoveredSources([{ ...service(), url: 'http://secret.internal' }]), safeError);
});

test('empty successful refresh and refresh failure retain all saved identities as unavailable', () => {
  const persisted = [{ ...service(), available: true }, { ...widget(), available: true }];
  for (const incoming of [null, []]) {
    const result = mergeDiscoveredSources({ persisted, incoming });
    assert.deepEqual(result.map(item => item.id), persisted.map(item => item.id));
    assert.ok(result.every(item => item.available === false));
    assert.deepEqual(result[1].nativeLocator, persisted[1].nativeLocator);
  }
  assert.ok(persisted.every(item => item.available === true));
});

test('fresh sources supersede cached metadata while absent cached/persisted sources remain in order', () => {
  const persisted = [service(1), service(2)];
  const cached = [{ ...service(1), title: 'Cached title', available: true }, { ...service(3), available: true }];
  const incoming = [{ ...service(1), title: 'Current title' }, service(4)];
  const result = mergeDiscoveredSources({ persisted, cached, incoming });
  assert.deepEqual(result.map(item => item.id), [1, 2, 3, 4].map(serviceId));
  assert.deepEqual(result.map(item => item.available), [true, false, false, true]);
  assert.equal(result[0].title, 'Current title');
  result[0].nativeLocator.groupPath[0] = 'Changed';
  assert.equal(incoming[0].nativeLocator.groupPath[0], 'Infrastructure');
  assert.deepEqual(mergeDiscoveredSources(), []);
});

test('visibility preferences deduplicate discovered identities and never alter retained metadata', () => {
  const input = [serviceId(1), widgetId(1), serviceId(1)];
  const hidden = validateHiddenDiscoveredIds(input);
  assert.deepEqual(hidden, [serviceId(1), widgetId(1)]);
  hidden.push(serviceId(2));
  assert.equal(input.length, 3);
  const retained = mergeDiscoveredSources({ persisted: [service(1), widget(1)], incoming: [] });
  assert.equal(retained.length, 2);
  for (const value of [['service-static-id'], [null], [12], ['discovered-service-' + 'G'.repeat(32)], { hidden: [] }]) assert.throws(() => validateHiddenDiscoveredIds(value), safeError);
  assert.deepEqual(validateHiddenDiscoveredIds(), []);
});

test('per-list and union limits prevent unbounded metadata accumulation', () => {
  assert.throws(() => validateDiscoveryManifest(envelope([service(1), service(2)]), { maxSources: 1 }), safeError);
  assert.throws(() => validateStoredDiscoveredSources([service(1), service(2)], { maxSources: 1 }), safeError);
  assert.throws(() => validateHiddenDiscoveredIds([serviceId(1), serviceId(2)], { maxSources: 1 }), safeError);
  assert.throws(() => mergeDiscoveredSources({ persisted: [service(1)], incoming: [service(2)], maxSources: 1 }), error => error.code === 'DISCOVERY_SOURCE_LIMIT');
  for (const maxSources of [0, -1, 4097, 1.5, NaN]) {
    assert.throws(() => validateDiscoveryManifest(envelope(), { maxSources }), TypeError);
    assert.throws(() => validateHiddenDiscoveredIds([], { maxSources }), TypeError);
  }
});

test('HTTP client fetches only the configured origin/path and forwards only the validated dashboard Host', async t => {
  const mock = await renderer(t, (req, res) => json(res, envelope()));
  const client = createDiscoveryClient({ upstream: mock.upstream });
  assert.deepEqual(await client.read('Dashboard.Internal:3000'), envelope());
  assert.equal(mock.requests.length, 1);
  assert.equal(mock.requests[0].method, 'GET');
  assert.equal(mock.requests[0].url, '/api/studio/sources');
  assert.equal(mock.requests[0].headers.host, 'Dashboard.Internal:3000');
  assert.equal(mock.requests[0].headers.accept, 'application/json');
  assert.equal(mock.requests[0].headers.authorization, undefined);
  assert.equal(mock.requests[0].headers.cookie, undefined);
  await client.read('dashboard.internal:80');
  await client.read('[::1]:3000');
  assert.equal(mock.requests[1].headers.host, 'dashboard.internal:80');
  assert.equal(mock.requests[2].headers.host, '[::1]:3000');
});

test('client refuses malformed upstreams, unbounded limits and unsafe Host header syntax before I/O', async t => {
  for (const upstream of [undefined, 'file:///tmp/renderer', 'http://user:password@renderer', 'http://renderer/a', 'http://renderer/?key=private', 'http://renderer/#private']) assert.throws(() => createDiscoveryClient({ upstream }), TypeError);
  for (const limits of [{ timeoutMs: 0 }, { timeoutMs: 60001 }, { maxBytes: 0 }, { maxBytes: 4194305 }, { maxSources: 0 }, { maxSources: 4097 }]) assert.throws(() => createDiscoveryClient({ upstream: 'http://renderer', ...limits }), TypeError);
  const mock = await renderer(t, (req, res) => json(res, envelope()));
  const client = createDiscoveryClient({ upstream: mock.upstream });
  for (const host of [undefined, '', 'user@dashboard.internal', 'dashboard.internal/path', 'dashboard.internal?private=1', 'dashboard.internal#fragment', 'dashboard.internal\r\nx-private: value', 'dashboard.internal:99999', 'dashboard\\internal']) assert.throws(() => client.read(host), error => error.code === 'INVALID_DISCOVERY_HOST');
  assert.equal(mock.requests.length, 0);
});

test('client does not follow redirects or expose upstream error content', async t => {
  const redirectTarget = await renderer(t, (req, res) => json(res, envelope()));
  const mock = await renderer(t, (req, res) => { res.writeHead(302, { location: `${redirectTarget.upstream}/secret`, 'content-type': 'application/json' }); res.end('private password'); });
  await assert.rejects(createDiscoveryClient({ upstream: mock.upstream }).read('dashboard.internal'), error => error.code === 'DISCOVERY_INVALID_RESPONSE' && !error.message.includes('private'));
  assert.equal(redirectTarget.requests.length, 0);
});

test('client rejects wrong media type and failed status without trusting JSON-like bodies', async t => {
  let mode = 'html';
  const mock = await renderer(t, (req, res) => { res.writeHead(mode === 'status' ? 503 : 200, { 'content-type': mode === 'html' ? 'text/html' : 'application/json' }); res.end(JSON.stringify(envelope())); });
  const client = createDiscoveryClient({ upstream: mock.upstream });
  await assert.rejects(client.read('dashboard.internal'), error => error.code === 'DISCOVERY_INVALID_RESPONSE');
  mode = 'status';
  await assert.rejects(client.read('dashboard.internal'), error => error.code === 'DISCOVERY_INVALID_RESPONSE');
});

test('client validates parsed JSON with the same pinned safe manifest schema', async t => {
  let body = '{"private password';
  const mock = await renderer(t, (req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(body); });
  const client = createDiscoveryClient({ upstream: mock.upstream });
  for (const value of [body, JSON.stringify({ ...envelope(), upstreamCommit: 'wrong' }), JSON.stringify({ ...envelope(), private: 'private password' })]) {
    body = value;
    await assert.rejects(client.read('dashboard.internal'), error => error.code === 'DISCOVERY_INVALID_MANIFEST' && !error.message.includes('password'));
  }
});

test('declared and streamed byte bounds abort oversized responses', async t => {
  let declared = true;
  const mock = await renderer(t, (req, res) => {
    res.writeHead(200, { 'content-type': 'application/json', ...(declared ? { 'content-length': 1024 } : {}) });
    res.end(' '.repeat(1024));
  });
  const client = createDiscoveryClient({ upstream: mock.upstream, maxBytes: 128 });
  await assert.rejects(client.read('dashboard.internal'), error => error.code === 'DISCOVERY_RESPONSE_TOO_LARGE');
  declared = false;
  await assert.rejects(client.read('dashboard.internal'), error => error.code === 'DISCOVERY_RESPONSE_TOO_LARGE');
});

test('overall request deadline also bounds a renderer that never sends headers', async t => {
  const mock = await renderer(t, () => {});
  await assert.rejects(createDiscoveryClient({ upstream: mock.upstream, timeoutMs: 30 }).read('dashboard.internal'), error => error.code === 'DISCOVERY_TIMEOUT' && error.status === 503);
});

test('truncated body and transport failure produce safe unavailable errors', async t => {
  let mode = 'truncated';
  const mock = await renderer(t, (req, res) => {
    if (mode === 'transport') { req.socket.destroy(); return; }
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': 10000 });
    res.write('{"private":"password"');
    setImmediate(() => res.destroy());
  });
  const client = createDiscoveryClient({ upstream: mock.upstream, timeoutMs: 500 });
  await assert.rejects(client.read('dashboard.internal'), error => error.code === 'DISCOVERY_UNAVAILABLE' && !error.message.includes('password'));
  mode = 'transport';
  await assert.rejects(client.read('dashboard.internal'), error => error.code === 'DISCOVERY_UNAVAILABLE');
});

test('successful client response still observes configured source cardinality', async t => {
  const mock = await renderer(t, (req, res) => json(res, envelope([service(1), service(2)])));
  await assert.rejects(createDiscoveryClient({ upstream: mock.upstream, maxSources: 1 }).read('dashboard.internal'), error => error.code === 'DISCOVERY_INVALID_MANIFEST');
});
