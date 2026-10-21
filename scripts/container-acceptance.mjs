#!/usr/bin/env node
// This integration suite creates and destroys a one-node Swarm. It deliberately
// runs only in disposable GitHub-hosted CI VMs, never against an existing Swarm.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { networkInterfaces } from 'node:os';
import { createDashboardFixture, eventually } from './acceptance-fixture.mjs';

if (process.env.STUDIO_TEST_CONTAINERS !== '1' || process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted') {
  throw new Error('Container acceptance requires an explicitly enabled, disposable GitHub-hosted runner.');
}
if (!process.env.STUDIO_IMAGE || !process.env.HOMEPAGE_IMAGE || !/^[a-f0-9]{40}$/.test(process.env.STUDIO_EXPECTED_REVISION || '')) {
  throw new Error('Provide both locally built image names and the exact expected source commit.');
}

const execute = promisify(execFile);
const identity = `studio-acceptance-${process.pid}`;
const port = 17778;
const origin = `http://localhost:${port}`;
const env = { ...process.env, STUDIO_PUBLIC_ORIGIN: origin, STUDIO_PORT: String(port), STUDIO_BACKUP_RETENTION: '25' };
const composeArgs = ['compose', '--project-name', identity, '--file', 'portainer-compose.yml'];
let composeStarted = false;
let swarmStarted = false;
let stackStarted = false;
let primaryFailure;

async function docker(args, options = {}) {
  try {
    const result = await execute('docker', args, { env, timeout: 180000, maxBuffer: 8 * 1024 * 1024, ...options });
    return result.stdout.trim();
  } catch (error) {
    throw new Error(`Docker ${args.slice(0, 2).join(' ')} failed: ${(error.stderr || error.message).slice(-5000)}`);
  }
}

const { request, ready, state, freshAndEdit, assertPersisted, restoreEmpty } = createDashboardFixture({
  origin, expectedRevision: env.STUDIO_EXPECTED_REVISION,
});

async function composeHealth(services = ['studio', 'homepage']) {
  await eventually(async () => {
    const ids = (await docker([...composeArgs, 'ps', '--quiet', ...services])).split('\n').filter(Boolean);
    assert.equal(ids.length, services.length);
    for (const id of ids) assert.equal(await docker(['inspect', '--format', '{{.State.Health.Status}}', id]), 'healthy');
  }, `Docker health: ${services.join(', ')}`);
}

async function diagnostic(label, operation) {
  try { console.error(`[diagnostic] ${label}: ${(await operation()).slice(-12000)}`); }
  catch (error) { console.error(`[diagnostic] ${label} unavailable: ${error.message}`); }
}

async function swarmDiagnostics() {
  for (const service of ['studio', 'homepage']) {
    const name = `${identity}_${service}`;
    await diagnostic(`${name} tasks`, () => docker(['service', 'ps', '--no-trunc', name], { timeout: 15000 }));
    await diagnostic(`${name} specification`, async () => {
      const value = JSON.parse(await docker(['service', 'inspect', name], { timeout: 15000 }))[0];
      return JSON.stringify({ name, image: value.Spec.TaskTemplate.ContainerSpec.Image, healthcheck: value.Spec.TaskTemplate.ContainerSpec.Healthcheck, updateStatus: value.UpdateStatus, serviceStatus: value.ServiceStatus, endpoint: value.Endpoint });
    });
    await diagnostic(`${name} containers`, async () => {
      const ids = (await docker(['ps', '--all', '--quiet', '--filter', `label=com.docker.swarm.service.name=${name}`], { timeout: 15000 })).split('\n').filter(Boolean).slice(0, 4);
      for (const id of ids) {
        await diagnostic(`${id} health and state`, async () => {
          const value = JSON.parse(await docker(['inspect', id], { timeout: 15000 }))[0];
          return JSON.stringify({ name: value.Name, state: value.State, healthcheck: value.Config.Healthcheck });
        });
        await diagnostic(`${id} local and service endpoints`, () => docker(['exec', id, 'node', '--input-type=module', '-e', `
          import http from 'node:http';
          import https from 'node:https';
          const host = new URL(process.env.STUDIO_PUBLIC_ORIGIN).host;
          const writer = process.argv[1] === 'studio';
          const targets = writer ? [
            ['local configuration', 'http://127.0.0.1:3001/__studio/config-ready'],
            ['local aggregate', 'http://127.0.0.1:3001/__studio/ready'],
            ['native service', new URL('/api/studio/health', process.env.HOMEPAGE_UPSTREAM)],
          ] : [
            ['local native', 'http://127.0.0.1:3000/api/studio/health'],
            ['writer service', new URL('/__studio/config-ready', process.env.STUDIO_WRITER_ORIGIN)],
          ];
          for (const [endpoint, url] of targets) {
            try {
              const response = await new Promise((resolve, reject) => {
                const transport = new URL(url).protocol === 'https:' ? https : http;
                const request = transport.get(url, { headers: { host }, signal: AbortSignal.timeout(3000) }, response => {
                  let body = '';
                  response.on('data', chunk => { body += chunk; });
                  response.on('error', reject);
                  response.on('end', () => resolve({ status: response.statusCode, body }));
                });
                request.on('error', reject);
              });
              let value = {};
              try { value = JSON.parse(response.body) || {}; } catch {}
              console.log(JSON.stringify({ endpoint, status: response.status, code: value.code, checks: value.checks, protocolVersion: value.protocolVersion, upstreamCommit: value.upstreamCommit, buildRevision: value.buildRevision }));
            } catch (error) { console.log(JSON.stringify({ endpoint, error: error.message, code: error.cause?.code })); }
          }
        `, service], { timeout: 15000 }));
      }
      return `${ids.length} recent containers inspected`;
    });
    await diagnostic(`${name} logs`, () => docker(['service', 'logs', '--raw', '--tail', '80', name], { timeout: 15000 }));
  }
}

try {
  assert.equal(await docker(['info', '--format', '{{.Swarm.LocalNodeState}}']), 'inactive', 'Refuse to use or alter an existing Swarm');
  await docker([...composeArgs, 'config', '--quiet']);
  composeStarted = true;
  await docker([...composeArgs, 'up', '--detach', '--no-build', '--pull', 'never', 'studio']);
  await composeHealth(['studio']);
  assert.equal((await request('/__studio/config-ready')).json().status, 'ready');
  const missingNative = await fetch(new URL('/__studio/ready', origin), { signal: AbortSignal.timeout(5000) });
  assert.equal(missingNative.status, 503);
  assert.equal((await missingNative.json()).code, 'HOMEPAGE_UNREACHABLE');
  console.log('PASS: writer container health succeeds before native startup while aggregate readiness stays unavailable.');
  await docker([...composeArgs, 'up', '--detach', '--no-build', '--pull', 'never']);
  const composeFixture = await freshAndEdit();
  await composeHealth();
  for (const service of ['studio', 'homepage']) assert.equal(await docker([...composeArgs, 'exec', '-T', service, 'id', '-u']), '1000');
  await docker([...composeArgs, 'exec', '-T', 'homepage', 'node', '-e', `
    const fs = require('node:fs');
    const file = '/app/config/.studio-readonly-probe';
    try { fs.writeFileSync(file, 'fixture'); fs.unlinkSync(file); process.exit(1); }
    catch (error) { if (!['EROFS', 'EACCES'].includes(error.code)) throw error; }
  `]);
  await docker([...composeArgs, 'restart']);
  await assertPersisted(composeFixture);
  await docker([...composeArgs, 'up', '--detach', '--force-recreate', '--no-build', '--pull', 'never']);
  await assertPersisted(composeFixture);
  await restoreEmpty(composeFixture);
  if (env.STUDIO_BROWSER_TESTS !== '1') throw new Error('The real browser gates must be enabled for container qualification.');
  for (const [label, command, args] of [
    ['Chromium dashboard', process.execPath, ['browser/node_modules/@playwright/test/cli.js', 'test', '--config', 'browser/playwright.config.mjs']],
    ['Firefox and WebKit desktop', process.execPath, ['browser/node_modules/@playwright/test/cli.js', 'test', '--config', 'browser/desktop.config.mjs']],
    ['real document visibility', 'xvfb-run', ['-a', process.execPath, 'browser/visibility/hidden-document.mjs']],
  ]) {
    try {
      const browserResult = await execute(command, args, {
        env: { ...env, STUDIO_BROWSER_ORIGIN: origin }, timeout: 300000, maxBuffer: 8 * 1024 * 1024,
      });
      console.log(browserResult.stdout.trim());
    } catch (error) {
      console.error((error.stdout || '').slice(-20000));
      throw new Error(`Real ${label} qualification failed: ${(error.stderr || error.message).slice(-5000)}`);
    }
  }
  // Independently qualify retention on a real Docker volume after the browser
  // suite. Each snapshot represents the revision immediately before its save.
  // Compare the observed post-commit API history and actual filenames without
  // issuing an extra readiness call. Normal container health remains enabled.
  let retainedState = await state();
  const committedRevisions = [];
  for (let index = 0; index < 26; index += 1) {
    committedRevisions.unshift(retainedState.revision);
    retainedState = (await request('/__studio/api/save', {
      revision: retainedState.revision, settingsYaml: `title: Retention qualification ${index}\n`,
    })).json();
    assert.deepEqual(retainedState.warnings, [], 'Every committed save must complete without a retention warning');
  }
  const retainedHistory = (await request('/__studio/api/backups')).json();
  assert.equal(retainedHistory.length, 25, 'The real state volume must retain exactly the newest25 snapshots');
  assert.deepEqual(retainedHistory.map(item => item.revision), committedRevisions.slice(0, 25), 'History must correspond to the newest25 exact pre-save revisions');
  const retainedFiles = JSON.parse(await docker([...composeArgs, 'exec', '-T', 'studio', 'node', '-e',
    'console.log(JSON.stringify(require("node:fs").readdirSync("/app/state/backups").filter(name => /^backup-.*\\.json$/.test(name)).sort()))',
  ]));
  assert.deepEqual(retainedFiles, retainedHistory.map(item => `${item.id}.json`).sort(), 'On-volume snapshot files must exactly match the API history');
  assert.deepEqual((await request('/__studio/api/backups')).json(), retainedHistory, 'Reading history must not change or resurrect entries');
  console.log('PASS: real Docker volume retains the exact newest25 pre-save revisions after26 committed saves; API history and on-volume snapshot identities agree.');
  await docker([...composeArgs, 'down', '--volumes', '--remove-orphans']);
  composeStarted = false;
  console.log('PASS: fresh standalone volumes, native protocol, nonroot processes, read-only renderer configuration, edit/snapshot, restart, replacement, restore, Chromium dashboard/mobile, Firefox/WebKit desktop and real hidden-document qualification.');

  const address = Object.values(networkInterfaces()).flat().find(item => item && item.family === 'IPv4' && !item.internal)?.address;
  assert.ok(address, 'A disposable runner network address is required for the one-node Swarm');
  await docker(['swarm', 'init', '--advertise-addr', address]);
  swarmStarted = true;
  env.STUDIO_NODE = await docker(['node', 'inspect', 'self', '--format', '{{.Description.Hostname}}']);
  await docker(['stack', 'config', '--compose-file', 'portainer-swarm.yml']);
  stackStarted = true;
  await docker(['stack', 'deploy', '--resolve-image', 'never', '--compose-file', 'portainer-swarm.yml', identity]);
  const swarmFixture = await freshAndEdit();
  for (const service of ['studio', 'homepage']) {
    const specification = JSON.parse(await docker(['service', 'inspect', `${identity}_${service}`]))[0].Spec;
    assert.equal(specification.Mode.Replicated.Replicas, 1);
    assert.equal(specification.UpdateConfig.Order, 'stop-first');
    assert.deepEqual(specification.TaskTemplate.Placement.Constraints, [`node.hostname == ${env.STUDIO_NODE}`]);
    await docker(['service', 'update', '--force', '--update-order', 'stop-first', `${identity}_${service}`], { timeout: 360000 });
    await assertPersisted(swarmFixture);
  }
  await restoreEmpty(swarmFixture);
  console.log('PASS: fresh one-node Swarm, same-node single writer, stop-first service replacement, edit/snapshot persistence and restore.');
} catch (error) {
  primaryFailure = error;
  if (composeStarted) {
    try { console.error((await docker([...composeArgs, 'logs', '--no-color', '--tail', '80'])).slice(-14000)); } catch {}
  }
  if (stackStarted) {
    await swarmDiagnostics();
  }
  throw error;
} finally {
  const cleanupFailures = [];
  const cleanup = async operation => {
    try { await operation(); }
    catch (error) { cleanupFailures.push(error); console.error(error.message); }
  };
  if (composeStarted) {
    await cleanup(() => docker([...composeArgs, 'down', '--volumes', '--remove-orphans']));
  }
  if (stackStarted) {
    await cleanup(() => docker(['stack', 'rm', identity]));
    // Stopped task containers can still hold volumes while Swarm removes them.
    await cleanup(() => eventually(async () => assert.equal(await docker(['ps', '--all', '--quiet', '--filter', `label=com.docker.stack.namespace=${identity}`]), ''), 'Fixture task removal', 60000));
    for (const suffix of ['config', 'state']) await cleanup(() => docker(['volume', 'rm', `${identity}_${suffix}`]));
  }
  if (swarmStarted) {
    await cleanup(() => docker(['swarm', 'leave', '--force']));
  }
  if (cleanupFailures.length && !primaryFailure) throw new AggregateError(cleanupFailures, 'Fixture cleanup failed after successful qualification.');
}
