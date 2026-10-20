import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { EMPTY_CONFIG, seedConfig } from '../scripts/seed-config.mjs';
import { runtimeHost } from '../scripts/runtime-host.mjs';
import { UPSTREAM_COMMIT, checkHealth } from '../scripts/healthcheck.mjs';
import { artifactFingerprint, validateReleaseManifest, materializeRelease } from '../scripts/release-manifest.mjs';
import { createStudioServer } from '../server/index.mjs';

const execute = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function directories(t) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-packaging-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  return { temp, configDir: path.join(temp, 'config'), stateDir: path.join(temp, 'state') };
}

async function endpoint(t, handler) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return `http://127.0.0.1:${server.address().port}`;
}

test('a fresh volume gets exactly nine empty native files and private state storage', async t => {
  const dirs = await directories(t);
  const seeded = await seedConfig(dirs);
  assert.equal(seeded.created.length, 9);
  assert.equal(seeded.recoveryPending, false);
  assert.deepEqual((await fs.readdir(dirs.configDir)).sort(), Object.keys(EMPTY_CONFIG).sort());
  for (const [name, content] of Object.entries(EMPTY_CONFIG)) {
    assert.equal(await fs.readFile(path.join(dirs.configDir, name), 'utf8'), content);
    assert.equal((await fs.stat(path.join(dirs.configDir, name))).mode & 0o777, 0o640);
  }
  assert.deepEqual(await fs.readdir(dirs.stateDir), []);
  assert.equal((await fs.stat(dirs.stateDir)).mode & 0o777, 0o700);
});

test('seeding is idempotent and preserves existing configuration byte for byte', async t => {
  const dirs = await directories(t);
  await fs.mkdir(dirs.configDir);
  const retained = '# retain comment\ntitle: Existing setup\n';
  await fs.writeFile(path.join(dirs.configDir, 'settings.yaml'), retained, { mode: 0o600 });
  const first = await seedConfig(dirs);
  assert.equal(first.created.length, 8);
  const second = await seedConfig(dirs);
  assert.deepEqual(second.created, []);
  assert.equal(await fs.readFile(path.join(dirs.configDir, 'settings.yaml'), 'utf8'), retained);
  assert.equal((await fs.stat(path.join(dirs.configDir, 'settings.yaml'))).mode & 0o777, 0o600);
});

test('an active recovery journal prevents all configuration seeding', async t => {
  const dirs = await directories(t);
  await fs.mkdir(dirs.stateDir);
  await fs.writeFile(path.join(dirs.stateDir, 'transaction.json'), '{"version":1}\n');
  const result = await seedConfig(dirs);
  assert.deepEqual(result, { created: [], recoveryPending: true });
  assert.deepEqual(await fs.readdir(dirs.configDir), []);
});

test('the seeder refuses symlinked configuration, directories and journals', async t => {
  const dirs = await directories(t);
  const target = path.join(dirs.temp, 'outside');
  await fs.writeFile(target, 'keep this');
  await fs.mkdir(dirs.configDir);
  await fs.symlink(target, path.join(dirs.configDir, 'services.yaml'));
  await assert.rejects(seedConfig(dirs), /regular files/);
  assert.equal(await fs.readFile(target, 'utf8'), 'keep this');
  await fs.unlink(path.join(dirs.configDir, 'services.yaml'));
  await fs.symlink(target, path.join(dirs.stateDir, 'transaction.json'));
  await assert.rejects(seedConfig(dirs), /journal must be a regular file/);
  const alias = path.join(dirs.temp, 'alias');
  await fs.symlink(dirs.configDir, alias);
  await assert.rejects(seedConfig({ ...dirs, configDir: alias }), /real directories/);
});

test('origin configuration derives the exact allowed host including the published port', () => {
  assert.deepEqual(runtimeHost('https://Dashboard.example.test:8443'), { allowedHosts: 'dashboard.example.test:8443', healthHost: 'dashboard.example.test:8443' });
  assert.deepEqual(runtimeHost(undefined, 'localhost:3000, dashboard.example.test:3000'), { allowedHosts: 'localhost:3000,dashboard.example.test:3000', healthHost: 'localhost:3000' });
  assert.equal(runtimeHost('http://[::1]:3000').healthHost, '[::1]:3000');
});

test('origins, host allowlists and wildcard defaults cannot silently disagree', () => {
  for (const origin of ['ftp://example.test', 'https://user:pass@example.test', 'https://example.test/subpath', 'https://example.test?token=fixture', 'https://example.test#fragment']) assert.throws(() => runtimeHost(origin));
  for (const hosts of ['', '*', 'example.test/*', 'user@example.test', 'example.test?anything', 'example.test#anything', 'example.test:99999']) assert.throws(() => runtimeHost(undefined, hosts));
  assert.throws(() => runtimeHost('https://dashboard.example.test', 'different.example.test'));
});

test('renderer health validates the protocol, upstream pin and exact build revision', async t => {
  let data = { protocolVersion: 1, upstreamCommit: UPSTREAM_COMMIT, buildRevision: 'fixture-build' };
  const url = await endpoint(t, (req, res) => {
    assert.equal(req.headers.host, 'dashboard.example.test:3000');
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(data));
  });
  const options = { url, host: 'dashboard.example.test:3000', kind: 'renderer', buildRevision: 'fixture-build' };
  assert.equal((await checkHealth(options)).upstreamCommit, UPSTREAM_COMMIT);
  for (const wrong of [{ ...data, protocolVersion: 2 }, { ...data, upstreamCommit: 'different' }, { ...data, buildRevision: 'other-build' }, null, [], 'up']) {
    data = wrong;
    await assert.rejects(checkHealth(options));
  }
});

test('readiness accepts configuration-only readiness and rejects HTTP/JSON failures', async t => {
  let status = 200;
  let body = '{"status":"ready"}';
  const url = await endpoint(t, (_req, res) => { res.statusCode = status; res.end(body); });
  const options = { url, host: 'localhost', kind: 'configuration' };
  assert.equal((await checkHealth(options)).status, 'ready');
  status = 503;
  await assert.rejects(checkHealth(options), /not ready/);
  status = 200;
  body = 'up';
  await assert.rejects(checkHealth(options), /Invalid health response/);
  body = '{"status":"starting"}';
  await assert.rejects(checkHealth(options), /not ready/);
  await assert.rejects(checkHealth({ ...options, kind: 'unknown' }), /Invalid health protocol/);
});

test('the exact writer Docker health command succeeds without native readiness and rejects invalid configuration', async t => {
  const dirs = await directories(t);
  await seedConfig(dirs);
  let nativeRequests = 0;
  const upstream = await endpoint(t, (_req, res) => {
    nativeRequests += 1;
    res.statusCode = 503;
    res.end('{"status":"starting"}');
  });
  const host = 'dashboard.example.test:3000';
  const { server, initialization } = createStudioServer({ ...dirs, upstream, allowedHosts: host });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  await initialization;
  const port = server.address().port;
  const dockerfile = await fs.readFile(path.join(root, 'Dockerfile'), 'utf8');
  const command = JSON.parse(dockerfile.match(/^HEALTHCHECK[^\n]+ CMD (\[[^\n]+\])$/m)[1]);
  assert.equal(command[0], 'node');
  const options = {
    cwd: root, timeout: 5000,
    env: { ...process.env, PORT: String(port), STUDIO_PUBLIC_ORIGIN: `http://${host}`, HOMEPAGE_ALLOWED_HOSTS: '', STUDIO_HEALTH_HOST: '' },
  };
  await execute(process.execPath, command.slice(1), options);
  assert.equal(nativeRequests, 0, 'Container health must not wait for the renderer it enables.');
  const readiness = await new Promise((resolve, reject) => {
    const request = http.get(`http://127.0.0.1:${port}/__studio/ready`, { headers: { host } }, response => {
      let body = '';
      response.on('data', chunk => { body += chunk; });
      response.on('error', reject);
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(body) }));
    });
    request.on('error', reject);
  });
  assert.equal(readiness.status, 503);
  assert.equal(readiness.body.code, 'HOMEPAGE_UNREACHABLE');
  await assert.rejects(execute(process.execPath, ['scripts/healthcheck.mjs', 'writer'], options), { code: 1 });
  assert.equal(nativeRequests, 2, 'Explicit aggregate readiness must still inspect native health.');
  await fs.writeFile(path.join(dirs.configDir, 'settings.yaml'), 'invalid: [\n');
  await assert.rejects(execute(process.execPath, command.slice(1), options), { code: 1 });
});

test('health checks bound unresponsive and oversized endpoints', async t => {
  const stalled = await endpoint(t, () => {});
  await assert.rejects(checkHealth({ url: stalled, host: 'localhost', kind: 'writer', timeoutMs: 30 }), /timed out/);
  const oversized = await endpoint(t, (_req, res) => res.end('x'.repeat(65537)));
  await assert.rejects(checkHealth({ url: oversized, host: 'localhost', kind: 'writer' }), /too large/);
});

test('renderer startup retries the live configuration endpoint before starting native code', async t => {
  let requests = 0;
  const url = await endpoint(t, (req, res) => {
    assert.equal(req.url, '/__studio/config-ready');
    assert.equal(req.headers.host, 'dashboard.example.test:3000');
    requests += 1;
    res.statusCode = requests > 1 ? 200 : 503;
    res.end(JSON.stringify({ status: requests > 1 ? 'ready' : 'starting' }));
  });
  await execute(process.execPath, [path.join(root, 'scripts/wait-for-config.mjs')], {
    timeout: 6000,
    env: { ...process.env, STUDIO_WRITER_ORIGIN: url, STUDIO_PUBLIC_ORIGIN: 'http://dashboard.example.test:3000', STUDIO_STARTUP_TIMEOUT_SECONDS: '4', HOMEPAGE_ALLOWED_HOSTS: '', STUDIO_HEALTH_HOST: '' },
  });
  assert.ok(requests >= 2);
});

test('deployment templates preserve a single writer and do not expose or mount native host controls', async () => {
  for (const file of ['portainer-compose.yml', 'portainer-swarm.yml']) {
    const template = parse(await fs.readFile(path.join(root, file), 'utf8'));
    assert.deepEqual(Object.keys(template.services).sort(), ['homepage', 'studio']);
    assert.deepEqual(template.services.homepage.volumes, ['config:/app/config:ro']);
    assert.deepEqual(template.services.studio.volumes, ['config:/app/config', 'state:/app/state']);
    assert.equal(template.services.homepage.ports, undefined);
    assert.ok(!JSON.stringify(template).includes('docker.sock'));
    assert.equal(template.services.studio.environment.STUDIO_BACKUP_RETENTION, '${STUDIO_BACKUP_RETENTION:-25}');
    assert.equal(template.services.studio.depends_on, undefined);
    assert.equal(template.services.homepage.depends_on, undefined);
    if (file.includes('swarm')) {
      for (const service of Object.values(template.services)) {
        assert.equal(service.deploy.replicas, 1);
        assert.equal(service.deploy.update_config.order, 'stop-first');
        assert.equal(service.deploy.rollback_config.order, 'stop-first');
      }
      assert.deepEqual(template.services.studio.deploy.placement, template.services.homepage.deploy.placement);
      assert.equal(template.services.studio.ports[0].mode, 'host');
    }
  }
});

test('automatic validation has no publication permission, registry login or image upload', async () => {
  const text = await fs.readFile(path.join(root, '.github/workflows/validate.yml'), 'utf8');
  const workflow = parse(text);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.deepEqual(workflow.jobs.qualify.strategy.matrix.include.map(item => item.arch).sort(), ['amd64', 'arm64']);
  assert.doesNotMatch(text, /docker\s+(?:push|login)\b|--push\b|push:\s*true|upload-artifact@|packages:\s*write|contents:\s*write|pull_request_target:/);
});

function acceptedFixture() {
  // Synthetic structure only. These digests do not identify released images.
  const sourceCommit = 'a'.repeat(40);
  const value = {
    schemaVersion: 1, status: 'owner-approved', version: '2026.10.20', sourceCommit, upstreamCommit: UPSTREAM_COMMIT,
    images: {
      studio: { reference: `ghcr.io/theuncleben/homepage-studio@sha256:${'b'.repeat(64)}`, buildRevision: sourceCommit, platforms: ['linux/amd64', 'linux/arm64'] },
      homepage: { reference: `ghcr.io/theuncleben/homepage-studio-renderer@sha256:${'c'.repeat(64)}`, buildRevision: sourceCommit, platforms: ['linux/amd64', 'linux/arm64'] },
    },
    verification: { automated: 'passed', human: 'passed', reportSha256: 'd'.repeat(64), humanAcceptanceSha256: 'e'.repeat(64) },
    approval: { actor: 'TheUncleBen', approvedAt: '2026-10-21T03:00:00Z' },
  };
  value.approval.artifactSetSha256 = artifactFingerprint(value);
  return value;
}

test('release manifests bind the exact artifacts and Chicago approval date without enforcing a daily cadence', () => {
  const accepted = acceptedFixture();
  assert.equal(validateReleaseManifest(accepted).version, '2026.10.20');
  for (const modify of [
    value => { value.status = 'unapproved'; },
    value => { value.version = '2026.10.21'; },
    value => { value.version = '2026.02.30'; },
    value => { value.images.homepage.reference = 'ghcr.io/theuncleben/homepage-studio-renderer:latest'; },
    value => { value.images.homepage.buildRevision = 'f'.repeat(40); },
    value => { value.images.studio.platforms.pop(); },
    value => { value.images.studio.reference = `ghcr.io/theuncleben/homepage-studio@sha256:${'f'.repeat(64)}`; },
    value => { value.verification.human = 'not_run'; },
    value => { value.approval.actor = 'someone-else'; },
    value => { value.approval.approvedAt = '2026-02-30T03:00:00Z'; },
  ]) {
    const invalid = structuredClone(accepted);
    modify(invalid);
    assert.throws(() => validateReleaseManifest(invalid));
  }
});

test('release materialization pins both templates by digest and refuses overwriting artifacts', async t => {
  const dirs = await directories(t);
  const output = path.join(dirs.temp, 'official-fixture');
  const accepted = acceptedFixture();
  await materializeRelease(accepted, output);
  for (const file of ['portainer-compose.yml', 'portainer-swarm.yml']) {
    const template = parse(await fs.readFile(path.join(output, file), 'utf8'));
    for (const name of ['studio', 'homepage']) assert.equal(template.services[name].image, accepted.images[name].reference);
  }
  await assert.rejects(materializeRelease(accepted, output), /already exists/);
  const example = JSON.parse(await fs.readFile(path.join(root, 'release-manifest.example.json'), 'utf8'));
  assert.throws(() => validateReleaseManifest(example), /owner-approved/);
});

test('runtime and Dockerfile pins agree with the reviewed source lock', async () => {
  const lock = JSON.parse(await fs.readFile(path.join(root, 'upstream.lock.json'), 'utf8'));
  assert.equal(lock.homepage.commit, UPSTREAM_COMMIT);
  for (const file of ['Dockerfile', 'Dockerfile.homepage']) {
    const text = await fs.readFile(path.join(root, file), 'utf8');
    assert.ok(text.includes(`ARG NODE_IMAGE=${lock.nodeImage}`));
    assert.ok(text.includes('USER 1000:1000'));
  }
  const native = await fs.readFile(path.join(root, 'Dockerfile.homepage'), 'utf8');
  assert.ok(native.includes(`pnpm@${lock.pnpmVersion}`));
  assert.ok(native.includes('RUN pnpm test'));
  assert.ok(native.includes('STUDIO_NATIVE_SOURCE=/app node --test'));
});
