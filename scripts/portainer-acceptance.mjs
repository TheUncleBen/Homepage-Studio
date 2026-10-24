#!/usr/bin/env node
// Runs only in a disposable hosted VM after the direct Docker qualification.
// The Docker socket and loopback registry exist only in this test harness.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { networkInterfaces, tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { createDashboardFixture, eventually } from './acceptance-fixture.mjs';
import { PortainerClient, PORTAINER_IMAGE, PORTAINER_VERSION, REGISTRY_IMAGE, cleanupPortainerStack, inspectFixtureManifest, readSwarmClusterId, stackPayload } from './portainer-client.mjs';

if (process.env.STUDIO_TEST_CONTAINERS !== '1' || process.env.STUDIO_PORTAINER_TESTS !== '1' || process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted') {
  throw new Error('Portainer acceptance requires an explicitly enabled, disposable GitHub-hosted runner.');
}
if (!process.env.STUDIO_IMAGE || !/^[a-f0-9]{40}$/.test(process.env.STUDIO_EXPECTED_REVISION || '')) {
  throw new Error('Provide the already-built application image and its exact expected source revision.');
}
const architecture = { x64: 'amd64', arm64: 'arm64' }[process.arch];
assert.ok(architecture, 'Portainer qualification supports native amd64 and arm64 runners');
const execute = promisify(execFile);
const identity = `studio-portainer-${process.pid}`;
const origin = 'http://localhost:17779';
const portainer = new PortainerClient('http://127.0.0.1:19000');
const fixture = createDashboardFixture({ origin, expectedRevision: process.env.STUDIO_EXPECTED_REVISION });
// Template qualification exercises editing with sign-in off; container
// acceptance qualifies sign-in on with the same image.
const env = { ...process.env, STUDIO_AUTH: 'off', STUDIO_PUBLIC_ORIGIN: origin, STUDIO_BACKUP_RETENTION: '25', STUDIO_RENDERER_MAX_WORKERS: '8', STUDIO_RENDERER_IDLE_SECONDS: '600', STUDIO_RENDERER_STARTUP_SECONDS: '30' };
// Synthetic secrets: a random encryption key, and off for the unused single
// sign-on and email secrets, as a deployment without them has.
const secretValues = { studio_auth_key: randomBytes(48).toString('base64'), studio_oidc_client_secret: 'off', studio_smtp_password: 'off' };
let secretsDirectory;
// The templates publish no port. A disposable relay on the stack's proxy
// network stands in for the reverse proxy: it forwards the loopback fixture
// port to Studio's address on that network, bytes unchanged (Host included).
// On Swarm it dials the task address (tasks.<service>), so the relay doesn't
// depend on the runner kernel's virtual-IP load balancing.
const RELAY = "const net = require('node:net'); net.createServer(client => { const upstream = net.connect(3000, process.env.RELAY_TARGET); client.pipe(upstream).pipe(client); client.on('error', () => upstream.destroy()); upstream.on('error', () => client.destroy()); }).listen(17779);";
const infra = [];
const stacks = [];
const localTags = [];
const imageIdentities = {};
const references = {};
let endpointId;
let swarmStarted = false;
let primaryFailure;

async function docker(args, options = {}) {
  try {
    const result = await execute('docker', args, { env, timeout: 180000, maxBuffer: 8 * 1024 * 1024, ...options });
    return result.stdout.trim();
  } catch (error) {
    throw new Error(portainer.redact(`Docker ${args.slice(0, 2).join(' ')} failed: ${(error.stderr || error.message).slice(-5000)}`));
  }
}

const label = stack => `${stack.swarm ? 'com.docker.stack.namespace' : 'com.docker.compose.project'}=${stack.name}`;

async function healthyContainers(stack) {
  return eventually(async () => {
    const ids = (await docker(['ps', '--quiet', '--filter', `label=${label(stack)}`])).split('\n').filter(Boolean);
    assert.equal(ids.length, 1, 'Exactly one complete application container must be running');
    const result = {};
    for (const id of ids) {
      const item = JSON.parse(await docker(['inspect', id]))[0];
      const service = stack.swarm ? item.Config.Labels['com.docker.swarm.service.name'].replace(`${stack.name}_`, '') : item.Config.Labels['com.docker.compose.service'];
      assert.ok(['studio'].includes(service));
      assert.equal(item.State.Health.Status, 'healthy');
      assert.equal(item.Image, imageIdentities[service], 'Portainer must run the same already-built image config');
      assert.equal(item.Config.Labels['org.opencontainers.image.revision'], env.STUDIO_EXPECTED_REVISION);
      assert.equal(item.Config.Image, stack.environment.STUDIO_IMAGE);
      assert.equal(item.Config.User, '1000:1000');
      const configMount = item.Mounts.find(mount => mount.Destination === '/app/config');
      assert.equal(configMount?.RW, true, 'The controller owns persistent configuration');
      assert.equal(item.Mounts.find(mount => mount.Destination === '/app/state')?.RW, true);
      assert.ok(!item.Mounts.some(mount => mount.Source === '/var/run/docker.sock'), 'The product application must never inherit the test Docker socket');
      result[service] = id;
    }
    assert.deepEqual(Object.keys(result).sort(), ['studio']);
    return result;
  }, `Portainer ${stack.name} image identity and container health`);
}

async function verifySwarm(stack, completedUpdate = false) {
  await eventually(async () => {
    for (const service of ['studio']) {
      const item = JSON.parse(await docker(['service', 'inspect', `${stack.name}_${service}`]))[0];
      assert.equal(item.Spec.Mode.Replicated.Replicas, 1);
      assert.deepEqual(item.Spec.TaskTemplate.Placement.Constraints, [`node.hostname == ${env.STUDIO_NODE}`]);
      assert.equal(item.Spec.UpdateConfig.Order, 'stop-first');
      assert.equal(item.Spec.UpdateConfig.Monitor, 180000000000);
      assert.equal(item.Spec.RollbackConfig.Order, 'stop-first');
      assert.equal(item.Spec.RollbackConfig.Monitor, 180000000000);
      if (completedUpdate) assert.equal(item.UpdateStatus?.State, 'completed', 'The production update monitor must complete');
    }
  }, 'Portainer Swarm placement and production update monitoring', completedUpdate ? 360000 : 180000);
}

const removeStackResources = stack => cleanupPortainerStack(stack, { portainer, endpointId, docker, eventually });

async function prepareStack(name, swarm) {
  // What docs/DEPLOY.md (steps 2 and 5) and docs/DEPLOY-COMPOSE.md have a
  // person create before the first deploy: the proxy network and the secrets.
  const network = `${name}-proxy`;
  if (swarm) {
    await docker(['network', 'create', '--driver', 'overlay', '--attachable', '--label', `org.homepage-studio.fixture=${identity}`, network]);
    for (const secret of Object.keys(secretValues)) await docker(['secret', 'create', '--label', `org.homepage-studio.fixture=${identity}`, secret, path.join(secretsDirectory, secret)]);
  } else await docker(['network', 'create', '--driver', 'bridge', '--label', `org.homepage-studio.fixture=${identity}`, network]);
  const relay = `${name}-relay`;
  infra.push(relay);
  await docker(['run', '--detach', '--name', relay, '--label', `org.homepage-studio.fixture=${identity}`, '--network', network,
    '--publish', '127.0.0.1:17779:17779', '--no-healthcheck', '--env', `RELAY_TARGET=${swarm ? `tasks.${name}_studio` : 'homepage_studio'}`,
    '--entrypoint', 'node', env.STUDIO_IMAGE, '-e', RELAY]);
  return { network, relay };
}

async function releaseStack(stack) {
  await removeStackResources(stack);
  await docker(['rm', '--force', stack.relay]);
  infra.splice(infra.indexOf(stack.relay), 1);
  await docker(['network', 'rm', stack.network]);
  if (stack.swarm) for (const secret of Object.keys(secretValues)) await docker(['secret', 'rm', secret]);
}

async function runStack(swarm) {
  const name = `${identity}-${swarm ? 'swarm' : 'compose'}`;
  const template = await readFile(swarm ? 'portainer-swarm.yml' : 'portainer-compose.yml', 'utf8');
  const { network, relay } = await prepareStack(name, swarm);
  const stack = { name, swarm, network, relay, environment: { ...env, STUDIO_IMAGE: references.studio.initial, STUDIO_NETWORK_NAME: network } };
  const swarmId = swarm ? await readSwarmClusterId(docker) : undefined;
  const payload = stackPayload({ name, template, environment: stack.environment, swarmId });
  stacks.push(stack);
  stack.id = await portainer.createStack(endpointId, payload);
  await portainer.verifyStoredStack(stack.id, endpointId, payload);
  const saved = await fixture.freshAndEdit();
  const dashboards = await fixture.multiDashboard();
  const before = await healthyContainers(stack);
  if (swarm) await verifySwarm(stack);
  else {
    await docker(['restart', before.studio]);
    await fixture.assertPersisted(saved);
    await fixture.assertDashboardsPersisted(dashboards);
  }
  stack.environment = { ...stack.environment, STUDIO_IMAGE: references.studio.replacement };
  const replacement = stackPayload({ name, template, environment: stack.environment, swarmId });
  // A different local repository with identical manifest/config bytes forces a
  // real replacement even when Swarm sees the same content-addressed image.
  // Repull is permitted only from this disposable loopback registry.
  await portainer.updateStack(stack.id, endpointId, replacement, { repull: true });
  if (swarm) await verifySwarm(stack, true);
  const after = await healthyContainers(stack);
  for (const service of ['studio']) assert.notEqual(after[service], before[service], 'Portainer API redeployment must actually replace the application container');
  await fixture.assertPersisted(saved);
  await fixture.assertDashboardsPersisted(dashboards);
  await fixture.restoreEmpty(saved);
  console.log(`PASS: Portainer CE ${PORTAINER_VERSION} ${swarm ? 'Swarm' : 'standalone'} API deployment, unchanged stored template, external proxy network and secrets, no published port, explicit environment, immutable image identity, edit/snapshot persistence, independent dashboard lifecycles, real replacement and restore.`);
  await releaseStack(stack);
}

try {
  assert.equal(await docker(['info', '--format', '{{.Swarm.LocalNodeState}}']), 'inactive', 'Refuse to alter an existing Swarm');
  // The UID 1000 application reads the Compose secret files from a folder the
  // runner user owns, so this disposable folder is world-readable.
  secretsDirectory = await mkdtemp(path.join(tmpdir(), `${identity}-secrets-`));
  for (const [name, value] of Object.entries(secretValues)) await writeFile(path.join(secretsDirectory, name), value, { mode: 0o444 });
  await chmod(secretsDirectory, 0o755);
  env.STUDIO_SECRETS_DIR = secretsDirectory;
  for (const [service, sourceImage] of [['studio', env.STUDIO_IMAGE]]) {
    const image = JSON.parse(await docker(['image', 'inspect', sourceImage]))[0];
    assert.equal(image.Config.Labels['org.opencontainers.image.revision'], env.STUDIO_EXPECTED_REVISION);
    imageIdentities[service] = image.Id;
  }
  const registryName = `${identity}-registry`;
  infra.push(registryName);
  await docker(['run', '--detach', '--name', registryName, '--label', `org.homepage-studio.fixture=${identity}`,
    '--publish', '127.0.0.1:15000:5000', '--tmpfs', '/var/lib/registry:rw,nosuid,size=2g',
    '--env', 'OTEL_TRACES_EXPORTER=none', '--env', 'REGISTRY_LOG_LEVEL=warn', REGISTRY_IMAGE]);
  await eventually(async () => assert.equal((await fetch('http://127.0.0.1:15000/v2/', { signal: AbortSignal.timeout(5000) })).status, 200), 'Disposable loopback registry');
  for (const [service, role, sourceImage] of [['studio', 'application', env.STUDIO_IMAGE]]) {
    references[service] = {};
    for (const [variant, suffix] of [['initial', ''], ['replacement', '-replacement']]) {
      const repository = `studio-${role}${suffix}`;
      const tag = `127.0.0.1:15000/${repository}:source`;
      localTags.push(tag);
      await docker(['tag', sourceImage, tag]);
      await docker(['push', tag]); // Hard-coded loopback destination; never a public registry.
      const image = await inspectFixtureManifest({ repository, architecture, expectedConfig: imageIdentities[service] });
      references[service][variant] = image.reference;
      console.log(JSON.stringify({ event: 'Portainer fixture image identity', service, variant, sourceRevision: env.STUDIO_EXPECTED_REVISION, ...image }));
    }
  }
  const portainerName = `${identity}-server`;
  infra.push(portainerName);
  await docker(['run', '--detach', '--name', portainerName, '--label', `org.homepage-studio.fixture=${identity}`,
    '--publish', '127.0.0.1:19000:9000', '--mount', 'type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock',
    '--tmpfs', '/data:rw,nosuid,size=256m', PORTAINER_IMAGE, '--http-enabled', '--no-setup-token']);
  await eventually(async () => assert.equal((await portainer.request('GET', '/system/status')).Version, PORTAINER_VERSION), 'Pinned disposable Portainer startup');
  endpointId = await portainer.initialize();
  console.log(JSON.stringify({ event: 'Pinned Portainer fixture', image: PORTAINER_IMAGE, registryImage: REGISTRY_IMAGE, architecture, sourceRevision: env.STUDIO_EXPECTED_REVISION }));
  await runStack(false);
  const address = Object.values(networkInterfaces()).flat().find(item => item && item.family === 'IPv4' && !item.internal)?.address;
  assert.ok(address, 'A disposable runner address is required for Swarm');
  await docker(['swarm', 'init', '--advertise-addr', address]);
  swarmStarted = true;
  env.STUDIO_NODE = await docker(['node', 'inspect', 'self', '--format', '{{.Description.Hostname}}']);
  await portainer.request('POST', `/endpoints/${endpointId}/snapshot`);
  await runStack(true);
} catch (error) {
  primaryFailure = error;
  for (const name of infra) {
    try { console.error(portainer.redact((await docker(['logs', '--tail', '60', name])).slice(-9000))); } catch {}
  }
  for (const stack of stacks.filter(item => !item.removed)) {
    try {
      console.error(await docker(stack.swarm ? ['stack', 'ps', '--no-trunc', stack.name] : ['ps', '--all', '--filter', `label=${label(stack)}`]));
      const ids = (await docker(['ps', '--all', '--quiet', '--filter', `label=${label(stack)}`])).split('\n').filter(Boolean);
      for (const id of ids) {
        const item = JSON.parse(await docker(['inspect', id]))[0];
        console.error(JSON.stringify({ event: 'Portainer product task diagnostic', name: item.Name, image: item.Config.Image, status: item.State.Status, exitCode: item.State.ExitCode, health: item.State.Health }));
        console.error(portainer.redact(await docker(['logs', '--tail', '60', id])));
      }
    } catch {}
  }
  throw error;
} finally {
  const failures = [];
  const cleanup = async operation => { try { await operation(); } catch (error) { failures.push(error); console.error(portainer.redact(error.message)); } };
  for (const stack of stacks.filter(item => !item.removed)) {
    await cleanup(() => removeStackResources(stack));
  }
  if (swarmStarted) await cleanup(() => docker(['swarm', 'leave', '--force']));
  let containers;
  await cleanup(async () => { containers = new Set((await docker(['ps', '--all', '--format', '{{.Names}}'])).split('\n')); });
  for (const name of infra.reverse()) if (!containers || containers.has(name)) await cleanup(() => docker(['rm', '--force', '--volumes', name]));
  await cleanup(async () => {
    for (const network of (await docker(['network', 'ls', '--quiet', '--filter', `label=org.homepage-studio.fixture=${identity}`])).split('\n').filter(Boolean)) await docker(['network', 'rm', network]);
  });
  if (secretsDirectory) await cleanup(() => rm(secretsDirectory, { recursive: true, force: true }));
  for (const tag of localTags) await cleanup(async () => {
    const present = await docker(['image', 'ls', '--quiet', tag]);
    if (present) await docker(['image', 'rm', tag]);
  });
  await cleanup(async () => assert.equal(await docker(['ps', '--all', '--quiet', '--filter', `label=org.homepage-studio.fixture=${identity}`]), ''));
  if (failures.length && !primaryFailure) throw new AggregateError(failures, 'Portainer fixture cleanup failed after successful qualification.');
}
console.log('PASS: Portainer qualification and all disposable stack, volume, registry and server cleanup completed. No public registry or release was used.');
