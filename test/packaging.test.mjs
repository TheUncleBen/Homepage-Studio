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

test('the exact application health command is independent of a broken dashboard and rejects shared runtime damage', async t => {
  const dirs = await directories(t);
  let nativeRequests = 0;
  const upstream = await endpoint(t, (_req, res) => {
    nativeRequests += 1;
    res.statusCode = 503;
    res.end('{"status":"starting"}');
  });
  const host = 'dashboard.example.test:3000';
  const rendererDir = path.join(dirs.temp, 'runtime');
  await fs.mkdir(path.join(rendererDir, '.next/static'), { recursive: true });
  await fs.mkdir(path.join(rendererDir, 'public'));
  for (const name of ['server.js', '.next/BUILD_ID', '.next/build-manifest.json']) await fs.writeFile(path.join(rendererDir, name), '{}');
  const { server, initialization } = createStudioServer({ ...dirs, rendererDir, upstream, allowedHosts: host });
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
  await execute(process.execPath, command.slice(1), options);
  await fs.unlink(path.join(rendererDir, '.next/BUILD_ID'));
  await assert.rejects(execute(process.execPath, command.slice(1), options), { code: 1 });
});

test('health checks bound unresponsive and oversized endpoints', async t => {
  const stalled = await endpoint(t, () => {});
  await assert.rejects(checkHealth({ url: stalled, host: 'localhost', kind: 'writer', timeoutMs: 30 }), /timed out/);
  const oversized = await endpoint(t, (_req, res) => res.end('x'.repeat(65537)));
  await assert.rejects(checkHealth({ url: oversized, host: 'localhost', kind: 'writer' }), /too large/);
});

test('deployment templates publish one application and preserve bounded internal worker controls', async () => {
  for (const file of ['portainer-compose.yml', 'portainer-swarm.yml']) {
    const template = parse(await fs.readFile(path.join(root, file), 'utf8'));
    assert.deepEqual(Object.keys(template.services), ['studio']);
    assert.deepEqual(template.services.studio.volumes, ['config:/app/config', 'state:/app/state']);
    assert.equal(template.services.studio.ports[0].target, 3000);
    assert.equal(template.services.studio.stop_grace_period, '30s');
    for (const [key, value] of Object.entries({ STUDIO_RENDERER_MAX_WORKERS: 8, STUDIO_RENDERER_IDLE_SECONDS: 600, STUDIO_RENDERER_STARTUP_SECONDS: 30 })) {
      assert.equal(template.services.studio.environment[key], '${' + key + ':-' + value + '}');
    }
    assert.ok(!JSON.stringify(template).includes('docker.sock'));
    assert.equal(template.services.studio.environment.STUDIO_BACKUP_RETENTION, '${STUDIO_BACKUP_RETENTION:-25}');
    assert.equal(template.services.studio.depends_on, undefined);
    // Hardening: the UID 1000 application needs no capabilities.
    assert.deepEqual(template.services.studio.cap_drop, ['ALL']);
    assert.equal(template.services.studio.cap_add, undefined);
    assert.equal(template.services.studio.privileged, undefined);
    assert.equal(template.services.studio.read_only, undefined, 'read-only rootfs is deferred until ping and Next cache behavior are qualified');
    assert.equal(template.services.studio.environment.STUDIO_FRAME_ANCESTORS, '${STUDIO_FRAME_ANCESTORS:-}');
    if (file.includes('compose')) assert.deepEqual(template.services.studio.security_opt, ['no-new-privileges:true']);
    // docker stack deploy ignores security_opt; the image strips setuid bits instead.
    else assert.equal(template.services.studio.security_opt, undefined);
    if (file.includes('swarm')) {
      for (const service of Object.values(template.services)) {
        assert.equal(service.deploy.replicas, 1);
        assert.equal(service.deploy.update_config.order, 'stop-first');
        assert.equal(service.deploy.rollback_config.order, 'stop-first');
      }
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
    value => { value.images.studio.reference = 'ghcr.io/theuncleben/homepage-studio:latest'; },
    value => { value.images.studio.buildRevision = 'f'.repeat(40); },
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
    for (const name of ['studio']) assert.equal(template.services[name].image, accepted.images[name].reference);
  }
  await assert.rejects(materializeRelease(accepted, output), /already exists/);
  const example = JSON.parse(await fs.readFile(path.join(root, 'release-manifest.example.json'), 'utf8'));
  assert.throws(() => validateReleaseManifest(example), /owner-approved/);
});

function dockerStages(text) {
  const stages = [];
  for (const line of text.replace(/\\\s*\n/g, ' ').split('\n')) {
    const from = line.match(/^FROM\s+\S+(?:\s+AS\s+(\S+))?\s*$/i);
    if (from) stages.push({ name: from[1] ?? null, lines: [] });
    else if (stages.length && line.trim() && !line.trim().startsWith('#')) stages.at(-1).lines.push(line.trim());
  }
  return stages;
}

test('controller tests and fixtures never enter the runtime image and nothing at runtime imports them', async () => {
  const stages = dockerStages(await fs.readFile(path.join(root, 'Dockerfile'), 'utf8'));
  const runtime = stages.at(-1);
  assert.equal(runtime.name, null, 'The final stage is the unnamed runtime image');
  const serverCopies = runtime.lines.filter(line => /^COPY\b.*\s\.\/server\/?$/.test(line));
  assert.equal(serverCopies.length, 1);
  const source = serverCopies[0].match(/--from=(\S+)/)?.[1];
  assert.ok(source, 'The runtime must not copy server/ straight from the build context');
  const stage = stages.find(item => item.name === source);
  assert.ok(stage.lines.includes('COPY server ./server'));
  const prune = stage.lines.find(line => line.startsWith('RUN '));
  assert.match(prune, /rm -rf server\/fixtures/);
  assert.match(prune, /find server -type f -name '\*\.test\.mjs' -delete/);
  for (const line of runtime.lines.filter(item => item.startsWith('COPY') && !item.includes('--from='))) {
    assert.doesNotMatch(line, /\s(?:server|test)\/?(?:\s|$)/, `runtime copies tests from the build context: ${line}`);
  }
  // Every module that ships must resolve without the removed files.
  const shipped = (await fs.readdir(path.join(root, 'server'))).filter(name => name.endsWith('.mjs') && !name.endsWith('.test.mjs'));
  assert.ok(shipped.includes('index.mjs'));
  for (const name of shipped) {
    const text = await fs.readFile(path.join(root, 'server', name), 'utf8');
    for (const [, specifier] of text.matchAll(/(?:from|import\()\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const target = path.relative(root, path.resolve(root, 'server', specifier));
      assert.doesNotMatch(target, /\.test\.|(?:^|\/)fixtures(?:\/|$)/, `${name} imports ${specifier}`);
    }
  }
});

test('runtime application code is root-owned and only configuration and state are writable by UID 1000', async () => {
  const runtime = dockerStages(await fs.readFile(path.join(root, 'Dockerfile'), 'utf8')).at(-1).lines;
  for (const line of runtime.filter(item => item.startsWith('COPY'))) assert.doesNotMatch(line, /--chown/, `application code must stay root-owned: ${line}`);
  const chowns = runtime.filter(line => /\bchown\b/.test(line));
  assert.equal(chowns.length, 1);
  assert.match(chowns[0], /chown 1000:1000 \/app\/config \/app\/state(?:\s|$)/);
  assert.doesNotMatch(chowns[0], /chown\s+-R/);
  const user = runtime.indexOf('USER 1000:1000');
  assert.ok(user > runtime.indexOf(chowns[0]));
  const guard = runtime.slice(user).find(line => line.startsWith('RUN '));
  assert.ok(guard, 'the build must verify writability as the runtime user');
  assert.match(guard, /test -w \/app\/config && test -w \/app\/state/);
  assert.match(guard, /find \/app \\\( -path \/app\/config -o -path \/app\/state \\\) -prune -o -writable -print -quit/);
  // Capability-free templates need ping without setuid or file capabilities.
  const packages = runtime.find(line => line.includes('iputils-ping'));
  assert.match(packages, /cp "\$ping" "\$ping\.plain" && mv -f "\$ping\.plain" "\$ping" && chmod 0755 "\$ping"/);
  assert.match(packages, /find \/ -xdev -type f -perm \/6000 -exec chmod ug-s \{\} \+/);
  assert.match(packages, /test -z "\$\(find \/ -xdev -type f -perm \/6000 -print -quit\)"/);
});

test('runtime and Dockerfile pins agree with the reviewed source lock', async () => {
  const lock = JSON.parse(await fs.readFile(path.join(root, 'upstream.lock.json'), 'utf8'));
  assert.equal(lock.homepage.commit, UPSTREAM_COMMIT);
  for (const file of ['Dockerfile']) {
    const text = await fs.readFile(path.join(root, file), 'utf8');
    assert.ok(text.includes(`ARG NODE_IMAGE=${lock.nodeImage}`));
    assert.ok(text.includes('USER 1000:1000'));
  }
  const native = await fs.readFile(path.join(root, 'Dockerfile'), 'utf8');
  assert.match(lock.pnpmVersion, /^\d+\.\d+\.\d+$/);
  assert.match(lock.pnpmIntegrity, /^sha512-[A-Za-z0-9+/]{86}==$/);
  const toolchainFiles = [...native.matchAll(/^COPY\s+(.+)\s+\/tmp\/studio-toolchain\/\s*$/gm)]
    .flatMap(([, files]) => files.trim().split(/\s+/));
  for (const file of ['upstream.lock.json', 'scripts/install-pinned-pnpm.mjs', 'scripts/compress-static-assets.mjs']) {
    assert.ok(toolchainFiles.includes(file), `native builder must receive ${file}`);
  }
  assert.ok(native.includes('node /tmp/studio-toolchain/install-pinned-pnpm.mjs /tmp/studio-toolchain/upstream.lock.json && pnpm install --frozen-lockfile'));
  assert.ok(native.includes('RUN pnpm lint'));
  assert.ok(native.includes('RUN pnpm test'));
  assert.ok(native.includes('RUN node /tmp/studio-toolchain/compress-static-assets.mjs /build/homepage/.next/static'));
  assert.ok(native.includes('COPY homepage/ ./'));
  assert.ok(native.includes('homepage/src/utils/config/environment.mjs ./homepage/src/utils/config/environment.mjs'));
  assert.ok(native.includes('homepage/src/utils/config/yaml-parser.mjs ./homepage/src/utils/config/yaml-parser.mjs'));
  assert.ok(!native.includes('prepare-homepage'));
  assert.ok(!native.includes('apply-homepage-overlay'));
  assert.ok(native.includes('STUDIO_NATIVE_SOURCE=/build/homepage node --test'));
});
