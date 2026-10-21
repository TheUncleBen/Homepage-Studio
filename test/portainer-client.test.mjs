import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { PortainerClient, PORTAINER_IMAGE, PORTAINER_VERSION, REGISTRY_IMAGE, cleanupPortainerStack, inspectFixtureManifest, stackPayload } from '../scripts/portainer-client.mjs';

const environment = {
  STUDIO_IMAGE: '127.0.0.1:15000/studio-writer@sha256:' + 'a'.repeat(64),
  HOMEPAGE_IMAGE: '127.0.0.1:15000/studio-renderer@sha256:' + 'b'.repeat(64),
  STUDIO_PUBLIC_ORIGIN: 'http://localhost:17779', STUDIO_PORT: '17779', STUDIO_BACKUP_RETENTION: '25', STUDIO_NODE: 'disposable-node',
  UNRELATED_SECRET: 'must-not-be-sent',
};
const json = (value, status = 200) => new Response(status === 204 ? null : JSON.stringify(value), { status });

test('Portainer acceptance refuses missing opt-ins and self-hosted runners before Docker access', async () => {
  const execute = promisify(execFile);
  const script = fileURLToPath(new URL('../scripts/portainer-acceptance.mjs', import.meta.url));
  const enabled = { STUDIO_TEST_CONTAINERS: '1', STUDIO_PORTAINER_TESTS: '1', GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted' };
  for (const key of Object.keys(enabled)) {
    await assert.rejects(execute(process.execPath, [script], { env: { ...enabled, [key]: '' }, timeout: 10000 }), error => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /requires an explicitly enabled, disposable GitHub-hosted runner/);
      return true;
    });
  }
  await assert.rejects(execute(process.execPath, [script], { env: { ...enabled, RUNNER_ENVIRONMENT: 'self-hosted' }, timeout: 10000 }), /disposable GitHub-hosted runner/);
  await assert.rejects(execute(process.execPath, [script], { env: enabled, timeout: 10000 }), /both already-built local images and their exact expected source revision/);
});

test('Portainer fixture is digest pinned and supports only a loopback test origin', () => {
  assert.match(PORTAINER_IMAGE, /^portainer\/portainer-ce:2\.45\.2@sha256:[a-f0-9]{64}$/);
  assert.match(REGISTRY_IMAGE, /^registry:3\.1\.2@sha256:[a-f0-9]{64}$/);
  for (const origin of ['https://example.test', 'http://example.test', 'http://user:password@localhost', 'http://localhost/path', 'http://localhost/?token=value']) {
    assert.throws(() => new PortainerClient(origin), /loopback/);
  }
  assert.equal(new PortainerClient('http://127.0.0.1:19000').origin, 'http://127.0.0.1:19000');
});

test('both exact product templates use the documented Portainer payload and explicit values only', async () => {
  for (const swarm of [false, true]) {
    const template = await readFile(new URL(`../portainer-${swarm ? 'swarm' : 'compose'}.yml`, import.meta.url), 'utf8');
    const input = { name: 'studio-fixture', template, environment, ...(swarm ? { swarmId: 'synthetic-swarm' } : {}) };
    const payload = stackPayload(input);
    assert.equal(payload.StackFileContent, template);
    assert.equal(payload.SwarmID, swarm ? 'synthetic-swarm' : undefined);
    assert.equal(payload.Env.length, swarm ? 6 : 5);
    assert.ok(payload.Env.every(item => Object.keys(item).join(',') === 'name,value'));
    assert.ok(!JSON.stringify(payload).includes(environment.UNRELATED_SECRET));
    for (const key of payload.Env.map(item => item.name)) {
      for (const value of [undefined, '', '   ']) assert.throws(() => stackPayload({ ...input, environment: { ...environment, [key]: value } }), new RegExp(key));
    }
    assert.match(payload.StackFileContent, /\$\{STUDIO_IMAGE:\?/);
    assert.doesNotMatch(payload.StackFileContent, /docker\.sock|portainer-ce/);
    if (swarm) assert.equal((payload.StackFileContent.match(/monitor: 180s/g) || []).length, 4);
  }
});

test('initialization checks exact version, uses in-memory credentials, and creates the documented local endpoint', async () => {
  const calls = [];
  const token = 'synthetic-jwt-fixture-value-longer-than-twenty';
  const client = new PortainerClient('http://localhost:19000', { fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/system/status')) return json({ Version: PORTAINER_VERSION });
    if (url.endsWith('/users/admin/init')) return json({ Id: 1 });
    if (url.endsWith('/auth')) return json({ jwt: token });
    if (url.endsWith('/endpoints')) return json({ Id: 8 });
    throw new Error('Unexpected request');
  } });
  assert.equal(await client.initialize(), 8);
  const credentials = JSON.parse(calls[1].options.body);
  assert.match(credentials.Password, /^[a-f0-9]{64}$/);
  assert.deepEqual(JSON.parse(calls[2].options.body), credentials);
  assert.equal(calls[1].options.headers.authorization, undefined);
  assert.equal(calls[3].options.headers.authorization, `Bearer ${token}`);
  assert.deepEqual(Object.fromEntries(calls[3].options.body), { Name: 'Disposable local Docker', EndpointCreationType: '1', ContainerEngine: 'docker' });
  assert.ok(calls.every(call => call.options.redirect === 'error' && call.options.headers.origin === 'http://localhost:19000'));
  assert.equal(client.redact(`${credentials.Password} ${token}`), '[redacted] [redacted]');
  assert.ok(!JSON.stringify(client).includes(credentials.Password));
  assert.ok(!JSON.stringify(client).includes(token));
});

test('wrong Portainer version fails before creating an administrator', async () => {
  let calls = 0;
  const client = new PortainerClient('http://localhost', { fetchImpl: async () => { calls++; return json({ Version: 'different-version' }); } });
  await assert.rejects(client.initialize(), /pinned contract/);
  assert.equal(calls, 1);
});

test('request failures do not reflect response bodies or thrown credential details', async () => {
  const reflected = 'synthetic-password-token-do-not-reflect';
  const refused = new PortainerClient('http://localhost', { fetchImpl: async () => new Response(reflected, { status: 403 }) });
  await assert.rejects(refused.request('POST', '/auth', { json: { Password: reflected } }), error => error.message === 'Portainer POST /auth: HTTP 403' && error.cause === undefined);
  const failed = new PortainerClient('http://localhost', { fetchImpl: async () => { throw new Error(reflected); } });
  await assert.rejects(failed.request('POST', '/auth', { json: { Password: reflected } }), error => error.message === 'Portainer POST /auth request failed' && error.cause === undefined);
});

test('asynchronous stack creation must reach active; failed or inactive deployment cannot pass', async () => {
  let clock = 0;
  const states = [3, 3, 1];
  const client = new PortainerClient('http://localhost', { now: () => clock, sleep: async ms => { clock += ms; }, fetchImpl: async () => json({ Id: 4, Status: states.shift() }) });
  assert.equal((await client.waitForStack(4)).Status, 1);
  assert.equal(clock, 2000);
  for (const Status of [2, 4, 99]) {
    const failed = new PortainerClient('http://localhost', { fetchImpl: async () => json({ Id: 4, Status, DeploymentStatus: [{ Status: 4, Message: 'synthetic deployment failure' }] }) });
    await assert.rejects(failed.waitForStack(4));
  }
  clock = 0;
  const stalled = new PortainerClient('http://localhost', { now: () => clock, sleep: async ms => { clock += ms; }, fetchImpl: async () => json({ Id: 4, Status: 3 }) });
  await assert.rejects(stalled.waitForStack(4, { timeout: 2000 }), /exceeded 2000ms/);
  assert.equal(clock, 2000);
});

test('stack create, stored template/environment verification, no-repull update, and deletion follow pinned API routes', async () => {
  for (const swarm of [false, true]) {
    const template = await readFile(new URL(`../portainer-${swarm ? 'swarm' : 'compose'}.yml`, import.meta.url), 'utf8');
    const payload = stackPayload({ name: 'studio-fixture', template, environment, ...(swarm ? { swarmId: 'synthetic-swarm' } : {}) });
    const stack = { Id: 4, Name: payload.Name, EndpointId: 8, Type: swarm ? 1 : 2, Status: 1, SwarmId: payload.SwarmID, Env: payload.Env };
    const calls = [];
    const client = new PortainerClient('http://localhost:19000', { fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (options.method === 'DELETE') return json(undefined, 204);
      if (url.endsWith('/file')) return json({ StackFileContent: template });
      return json(stack);
    } });
    assert.equal(await client.createStack(8, payload), 4);
    assert.equal(calls[0].url, `http://localhost:19000/api/stacks/create/${swarm ? 'swarm' : 'standalone'}/string?endpointId=8`);
    assert.deepEqual(JSON.parse(calls[0].options.body), payload);
    await client.verifyStoredStack(4, 8, payload);
    await client.updateStack(4, 8, payload);
    const update = calls.find(call => call.options.method === 'PUT');
    assert.deepEqual(JSON.parse(update.options.body), { StackFileContent: template, Env: payload.Env, Prune: true, RepullImageAndRedeploy: false });
    await client.updateStack(4, 8, payload, { repull: true });
    assert.equal(JSON.parse(calls.findLast(call => call.options.method === 'PUT').options.body).RepullImageAndRedeploy, true);
    await client.deleteStack(4, 8);
    assert.equal(calls.at(-1).url, 'http://localhost:19000/api/stacks/4?endpointId=8');
    assert.equal(calls.at(-1).options.method, 'DELETE');
    stack.Env = [];
    await assert.rejects(client.verifyStoredStack(4, 8, payload), /persist all explicit/);
  }
});

test('registry transfer verifies exact manifest bytes and the already-built config identity', async () => {
  const expectedConfig = 'sha256:' + 'c'.repeat(64);
  const manifest = { schemaVersion: 2, config: { digest: expectedConfig }, layers: [] };
  const bytes = JSON.stringify(manifest);
  const digest = 'sha256:' + createHash('sha256').update(bytes).digest('hex');
  const fetchImpl = async url => {
    assert.equal(url, 'http://127.0.0.1:15000/v2/studio-writer/manifests/source');
    return new Response(bytes, { headers: { 'docker-content-digest': digest } });
  };
  const value = await inspectFixtureManifest({ repository: 'studio-writer', expectedConfig, architecture: 'amd64' }, { fetchImpl });
  assert.deepEqual(value, { reference: `127.0.0.1:15000/studio-writer@${digest}`, manifestDigest: digest, configDigest: expectedConfig });
  await assert.rejects(inspectFixtureManifest({ repository: 'studio-writer', expectedConfig: 'wrong-config', architecture: 'amd64' }, { fetchImpl }), /preserve/);
  await assert.rejects(inspectFixtureManifest({ repository: 'studio-writer', expectedConfig, architecture: 'amd64' }, { fetchImpl: async () => new Response(bytes, { headers: { 'docker-content-digest': 'sha256:' + 'd'.repeat(64) } }) }), /advertised digest/);
  await assert.rejects(inspectFixtureManifest({ repository: 'example.test/public', expectedConfig, architecture: 'amd64' }, { fetchImpl }));
});

test('registry index selection requires one exact native platform and verifies child digest', async () => {
  const expectedConfig = 'sha256:' + 'e'.repeat(64);
  const child = JSON.stringify({ schemaVersion: 2, config: { digest: expectedConfig }, layers: [] });
  const childDigest = 'sha256:' + createHash('sha256').update(child).digest('hex');
  const index = JSON.stringify({ manifests: [{ platform: { os: 'linux', architecture: 'arm64' }, digest: childDigest }] });
  const indexDigest = 'sha256:' + createHash('sha256').update(index).digest('hex');
  const fetchImpl = async url => url.endsWith('/source')
    ? new Response(index, { headers: { 'docker-content-digest': indexDigest } })
    : new Response(child, { headers: { 'docker-content-digest': childDigest } });
  const value = await inspectFixtureManifest({ repository: 'studio-renderer', expectedConfig, architecture: 'arm64' }, { fetchImpl });
  assert.equal(value.manifestDigest, indexDigest);
  assert.equal(value.configDigest, expectedConfig);
  await assert.rejects(inspectFixtureManifest({ repository: 'studio-renderer', expectedConfig, architecture: 'amd64' }, { fetchImpl }), /exactly one current-platform/);
});

function cleanupFixture({ apiFails = false, firstVolumeFails = false } = {}) {
  const calls = [];
  const volumes = new Set(['studio-fixture_config', 'studio-fixture_state']);
  let taskChecks = 0;
  const docker = async args => {
    calls.push(args);
    if (args[0] === 'ps') {
      assert.ok(args.includes('--all'), 'Stopped task containers must also be considered');
      return taskChecks++ === 0 ? 'stopped-task-still-holds-volume' : '';
    }
    if (args[0] === 'network') return '';
    if (args[0] === 'stack') return '';
    if (args[0] === 'volume' && args[1] === 'ls') return [...volumes].join('\n');
    if (args[0] === 'volume' && args[1] === 'rm') {
      assert.ok(taskChecks >= 2, 'Wait for stopped task removal before removing volumes');
      if (firstVolumeFails && args[2].endsWith('_config')) throw new Error('synthetic volume still in use');
      volumes.delete(args[2]); return args[2];
    }
    throw new Error('Unexpected Docker fixture command');
  };
  const portainer = { deleteStack: async (id, endpoint) => {
    assert.equal(id, 4); assert.equal(endpoint, 8);
    if (apiFails) throw new Error('synthetic Portainer removal failed');
  } };
  const eventually = async (check, _label, timeout) => {
    assert.equal(timeout, 60000);
    try { await check(); } catch { await check(); }
  };
  return { calls, volumes, deps: { portainer, endpointId: 8, docker, eventually } };
}

test('Portainer cleanup waits for stopped tasks and removes both explicit volumes', async () => {
  const fixture = cleanupFixture();
  const stack = { name: 'studio-fixture', id: 4, swarm: true };
  await cleanupPortainerStack(stack, fixture.deps);
  assert.equal(stack.removed, true);
  assert.equal(fixture.volumes.size, 0);
  assert.equal(fixture.calls.filter(args => args[0] === 'volume' && args[1] === 'rm').length, 2);
});

test('Portainer API cleanup failure still removes Docker resources but fails qualification', async () => {
  const fixture = cleanupFixture({ apiFails: true });
  const stack = { name: 'studio-fixture', id: 4, swarm: true };
  await assert.rejects(cleanupPortainerStack(stack, fixture.deps), /synthetic Portainer removal failed/);
  assert.ok(fixture.calls.some(args => args[0] === 'stack' && args[1] === 'rm'));
  assert.equal(fixture.volumes.size, 0);
  assert.equal(stack.removed, true);
});

test('one Portainer fixture volume cleanup failure cannot skip the other volume or pass silently', async () => {
  const fixture = cleanupFixture({ firstVolumeFails: true });
  const stack = { name: 'studio-fixture', id: 4, swarm: true };
  await assert.rejects(cleanupPortainerStack(stack, fixture.deps), /synthetic volume still in use/);
  assert.ok(fixture.volumes.has('studio-fixture_config'));
  assert.ok(!fixture.volumes.has('studio-fixture_state'));
  assert.notEqual(stack.removed, true);
});
