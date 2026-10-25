#!/usr/bin/env node
// This integration suite creates and destroys a one-node Swarm. It deliberately
// runs only in disposable GitHub-hosted CI VMs, never against an existing Swarm.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { networkInterfaces, tmpdir } from 'node:os';
import path from 'node:path';
import { createDashboardFixture, eventually, HOME } from './acceptance-fixture.mjs';
import { rendererProcessProbe } from './renderer-process-probe.mjs';

if (process.env.STUDIO_TEST_CONTAINERS !== '1' || process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted') {
  throw new Error('Container acceptance requires an explicitly enabled, disposable GitHub-hosted runner.');
}
if (!process.env.STUDIO_IMAGE || !/^[a-f0-9]{40}$/.test(process.env.STUDIO_EXPECTED_REVISION || '')) {
  throw new Error('Provide the locally built application image and the exact expected source commit.');
}

const execute = promisify(execFile);
const identity = `studio-acceptance-${process.pid}`;
const port = 17778;
const origin = `http://localhost:${port}`;
// The long editing and browser qualification runs with Studio sign-in off; a
// separate phase below qualifies the same image with sign-in on.
// The shipped templates publish no port; the test-only override files publish
// one on this disposable runner instead of a reverse proxy.
const env = { ...process.env, STUDIO_AUTH: 'off', STUDIO_PUBLIC_ORIGIN: origin, STUDIO_TEST_PORT: String(port), STUDIO_NETWORK_NAME: `${identity}-proxy`, STUDIO_BACKUP_RETENTION: '25', STUDIO_RENDERER_MAX_WORKERS: '8', STUDIO_RENDERER_IDLE_SECONDS: '600', STUDIO_RENDERER_STARTUP_SECONDS: '30' };
const composeArgs = ['compose', '--project-name', identity, '--file', 'portainer-compose.yml', '--file', 'test/acceptance/compose-publish.yml'];
const swarmFiles = ['--compose-file', 'portainer-swarm.yml', '--compose-file', 'test/acceptance/swarm-publish.yml'];
// Synthetic secrets: a random encryption key, and off for the unused
// single sign-on and email secrets, as a deployment without them has.
const secretValues = { studio_auth_key: randomBytes(48).toString('base64'), studio_oidc_client_secret: 'off', studio_smtp_password: 'off', studio_admin_password: 'off' };
let secretsDirectory;
let networkCreated = false;
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

const { request, ready, state, freshAndEdit, assertPersisted, restoreEmpty, assertLegacyAdopted, multiDashboard, assertDashboardsPersisted } = createDashboardFixture({
  origin, expectedRevision: env.STUDIO_EXPECTED_REVISION,
});

async function composeHealth(services = ['studio']) {
  await eventually(async () => {
    const ids = (await docker([...composeArgs, 'ps', '--quiet', ...services])).split('\n').filter(Boolean);
    assert.equal(ids.length, services.length);
    for (const id of ids) assert.equal(await docker(['inspect', '--format', '{{.State.Health.Status}}', id]), 'healthy');
  }, `Docker health: ${services.join(', ')}`);
}

async function seedLegacyRootVolumes() {
  // Initialize the pre-registry root file/state format on real product volumes,
  // without starting the controller or creating a dashboard registry. This is
  // synthetic existing-installation data, never an owner's deployment.
  await docker([...composeArgs, 'create', '--no-build', '--pull', 'never']);
  const id = await docker([...composeArgs, 'ps', '--all', '--quiet', 'studio']);
  const container = JSON.parse(await docker(['inspect', id]))[0];
  const mounts = ['/app/config', '/app/state'].map(target => {
    const mount = container.Mounts.find(item => item.Destination === target);
    assert.ok(mount?.Name, 'Legacy fixture requires disposable named product volumes');
    return `type=volume,source=${mount.Name},target=${target}`;
  });
  const program = `
    import fs from 'node:fs/promises';
    import { createHash } from 'node:crypto';
    import { createConfigStore } from './server/config.mjs';
    const store = createConfigStore({ configDir: '/app/config', stateDir: '/app/state' });
    await store.initialize();
    const initial = await store.load();
    await store.save({ revision: initial.revision,
      servicesYaml: '- Existing:\\n    - Retained service:\\n        href: https://example.test/legacy\\n',
      settingsYaml: '# Existing root settings\\ntitle: Legacy adoption fixture\\n',
      widgetsYaml: '- greeting:\\n    text: Retained existing content\\n',
      bookmarksYaml: '- Existing:\\n    - Reference:\\n        - href: https://example.test/reference\\n',
      dockerYaml: '# Existing Docker configuration\\n{}\\n',
      kubernetesYaml: '# Existing Kubernetes configuration\\n{}\\n',
      proxmoxYaml: '# Existing Proxmox configuration\\n{}\\n',
      customCss: ':root { --legacy-fixture: retained; }\\n',
      customJs: 'window.__legacyFixture = "retained";\\n',
    });
    const archive = await store.exportCurrent();
    const backups = await store.listBackups();
    const hashes = {};
    for (const name of Object.keys(archive.files)) {
      const file = name === 'state.json' ? '/app/state/state.json' : '/app/config/' + name;
      hashes[file] = createHash('sha256').update(await fs.readFile(file)).digest('hex');
    }
    for (const entry of backups) {
      const file = '/app/state/backups/' + entry.id + '.json';
      hashes[file] = createHash('sha256').update(await fs.readFile(file)).digest('hex');
    }
    if ((await fs.readdir('/app/config')).some(name => name.startsWith('studio-dashboards.'))) throw new Error('Fixture unexpectedly created a registry');
    console.log(JSON.stringify({ archive, backups, hashes }));
  `;
  return JSON.parse(await docker(['run', '--rm', '--network', 'none', '--mount', mounts[0], '--mount', mounts[1], '--entrypoint', 'node', env.STUDIO_IMAGE, '--input-type=module', '-e', program]));
}

async function assertLegacyBytes(container, expected) {
  const actual = JSON.parse(await docker(['exec', container, 'node', '-e', `
    const fs = require('node:fs'), crypto = require('node:crypto');
    const files = JSON.parse(process.argv[1]);
    console.log(JSON.stringify(Object.fromEntries(files.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]))));
  `, JSON.stringify(Object.keys(expected.hashes))]));
  assert.deepEqual(actual, expected.hashes, 'Registry adoption and default address changes must preserve every original file and snapshot byte');
}

async function workers(container) {
  // Both templates run docker-init as PID 1; the entrypoint execs the
  // controller as its child, so locate the controller by its command line.
  const controller = Number(await docker(['exec', container, 'node', '-e', `
    const fs = require('node:fs');
    const found = fs.readdirSync('/proc').filter(name => /^\\d+$/.test(name)).filter(pid => {
      try { return fs.readFileSync('/proc/' + pid + '/cmdline', 'utf8') === 'node\\0server/index.mjs\\0'; } catch { return false; }
    });
    if (found.length !== 1) throw new Error('Expected exactly one controller process, found ' + found.length);
    console.log(found[0]);
  `]));
  return JSON.parse(await docker(['exec', container, 'node', '-e', rendererProcessProbe({ parentPid: controller })]));
}

async function assertWorkers(container, dashboards) {
  assert.equal(await docker(['exec', container, 'id', '-u']), '1000');
  const found = await workers(container);
  for (const id of ['default', ...dashboards.map(item => item.dashboard.id)]) {
    const selected = found.filter(item => item.id === id);
    assert.equal(selected.length, 1, 'Each selected dashboard must have exactly one native child');
    const worker = selected[0];
    assert.equal(worker.uid, 1000);
    assert.equal(worker.hostname, '127.0.0.1');
    assert.equal(worker.mcpWrite, 'false');
    assert.deepEqual(worker.addresses, ['0100007F'], 'The native TCP listener must bind only IPv4 loopback');
    assert.equal(worker.listeners[0].port, worker.port, 'The native child must own the listener at its assigned port');
    assert.equal(worker.configDir, id === 'default' ? '/app/config' : `/app/config/dashboards/${id}`);
  }
}

async function crashWorker(container, record) {
  const before = (await workers(container)).find(item => item.id === record.dashboard.id);
  assert.ok(before, 'The crash scenario requires an actual running native child');
  await docker(['exec', container, 'node', '-e', 'process.kill(Number(process.argv[1]), "SIGKILL")', String(before.pid)]);
  await eventually(async () => {
    await ready(`/${record.dashboard.slug}`);
    const after = (await workers(container)).find(item => item.id === record.dashboard.id);
    assert.ok(after && after.pid !== before.pid, 'A subsequent request must restart the crashed worker');
  }, 'Native child crash recovery');
  await assertDashboardsPersisted([record]);
  assert.equal((await request('/__studio/application-ready')).json().status, 'ready');
}

async function assertBadDefaultIsolation(container, record) {
  const settings = (await state()).settingsYaml;
  try {
    await docker(['exec', container, 'node', '-e', 'require("node:fs").writeFileSync("/app/config/settings.yaml", "invalid: [\\n")']);
    await request('/__studio/ready', undefined, 503);
    assert.equal((await request('/__studio/application-ready')).json().status, 'ready');
    await assertDashboardsPersisted([record]);
    const page = await request(`/${record.dashboard.slug}/`);
    const sharedAsset = page.text.match(/(?:src|href)="([^" ]*\/_next\/static\/[^" ]+)"/);
    assert.ok(sharedAsset, 'The actual native HTML must identify a shared build asset');
    const assetPath = sharedAsset[1].slice(sharedAsset[1].indexOf('/_next/static/')).replaceAll('&amp;', '&');
    await request(assetPath);
    await docker(['exec', container, 'node', 'scripts/healthcheck.mjs', 'application']);
  } finally {
    await docker(['exec', container, 'node', '-e', 'require("node:fs").writeFileSync("/app/config/settings.yaml", Buffer.from(process.argv[1], "base64"))', Buffer.from(settings).toString('base64')]);
  }
  await ready();
}

async function diagnostic(label, operation) {
  try { console.error(`[diagnostic] ${label}: ${(await operation()).slice(-12000)}`); }
  catch (error) { console.error(`[diagnostic] ${label} unavailable: ${error.message}`); }
}

async function swarmDiagnostics() {
  for (const service of ['studio']) {
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
          const targets = [
            ['application', 'http://127.0.0.1:3000/__studio/application-ready'],
            ['selected configuration', 'http://127.0.0.1:3000/__studio/config-ready'],
            ['selected native readiness', 'http://127.0.0.1:3000/__studio/ready'],
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
  // The UID 1000 application reads the secret files from a folder the runner
  // user owns, so this disposable folder is world-readable.
  secretsDirectory = await mkdtemp(path.join(tmpdir(), `${identity}-secrets-`));
  for (const [name, value] of Object.entries(secretValues)) await writeFile(path.join(secretsDirectory, name), value, { mode: 0o444 });
  await chmod(secretsDirectory, 0o755);
  env.STUDIO_SECRETS_DIR = secretsDirectory;
  await docker(['network', 'create', '--driver', 'bridge', env.STUDIO_NETWORK_NAME]);
  networkCreated = true;
  await docker([...composeArgs, 'config', '--quiet']);
  composeStarted = true;
  const legacy = await seedLegacyRootVolumes();
  await docker([...composeArgs, 'up', '--detach', '--no-build', '--pull', 'never']);
  await assertLegacyAdopted(legacy);
  await composeHealth();
  await assertLegacyBytes(await docker([...composeArgs, 'ps', '--quiet', 'studio']), legacy);
  await docker([...composeArgs, 'restart']);
  await assertLegacyAdopted(legacy);
  await assertLegacyBytes(await docker([...composeArgs, 'ps', '--quiet', 'studio']), legacy);
  await docker([...composeArgs, 'down', '--volumes', '--remove-orphans']);
  console.log('PASS: real legacy-root volume adoption at /home, main-dashboard move to /admin, native CSS/JS, complete byte/history preservation and idempotent restart.');
  await docker([...composeArgs, 'up', '--detach', '--no-build', '--pull', 'never']);
  await composeHealth();
  assert.equal((await request('/__studio/application-ready')).json().status, 'ready');
  const composeFixture = await freshAndEdit();
  const dashboards = await multiDashboard();
  const application = await docker([...composeArgs, 'ps', '--quiet', 'studio']);
  await assertWorkers(application, dashboards);
  await crashWorker(application, dashboards[0]);
  await assertBadDefaultIsolation(application, dashboards[0]);
  await docker([...composeArgs, 'restart']);
  await assertPersisted(composeFixture);
  await assertDashboardsPersisted(dashboards);
  await docker([...composeArgs, 'up', '--detach', '--force-recreate', '--no-build', '--pull', 'never']);
  await assertPersisted(composeFixture);
  await assertDashboardsPersisted(dashboards);
  await restoreEmpty(composeFixture);
  const recreated = JSON.parse(await docker(['inspect', await docker([...composeArgs, 'ps', '--quiet', 'studio'])]))[0];
  const gateway = Object.values(recreated.NetworkSettings.Networks).map(item => item.Gateway).find(value => /^\d+\.\d+\.\d+\.\d+$/.test(value));
  assert.ok(gateway, 'The disposable browser fixture needs the container bridge gateway');
  if (env.STUDIO_BROWSER_TESTS !== '1') throw new Error('The real browser gates must be enabled for container qualification.');
  for (const [label, command, args] of [
    ['Chromium dashboard', process.execPath, ['browser/node_modules/@playwright/test/cli.js', 'test', '--config', 'browser/playwright.config.mjs']],
    ['Firefox and WebKit desktop', process.execPath, ['browser/node_modules/@playwright/test/cli.js', 'test', '--config', 'browser/desktop.config.mjs']],
    ['real document visibility', 'xvfb-run', ['-a', process.execPath, 'browser/visibility/hidden-document.mjs']],
  ]) {
    try {
      const browserResult = await execute(command, args, {
        env: { ...env, STUDIO_BROWSER_ORIGIN: origin, STUDIO_BROWSER_FIXTURE_HOST: gateway }, timeout: 960000, maxBuffer: 8 * 1024 * 1024,
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
    retainedState = (await request(`${HOME}/__studio/api/save`, {
      revision: retainedState.revision, settingsYaml: `title: Retention qualification ${index}\n`,
    })).json();
    assert.deepEqual(retainedState.warnings, [], 'Every committed save must complete without a retention warning');
  }
  const retainedHistory = (await request(`${HOME}/__studio/api/backups`)).json();
  assert.equal(retainedHistory.length, 25, 'The real state volume must retain exactly the newest25 snapshots');
  assert.deepEqual(retainedHistory.map(item => item.revision), committedRevisions.slice(0, 25), 'History must correspond to the newest25 exact pre-save revisions');
  const retainedFiles = JSON.parse(await docker([...composeArgs, 'exec', '-T', 'studio', 'node', '-e',
    'console.log(JSON.stringify(require("node:fs").readdirSync("/app/state/backups").filter(name => /^backup-.*\\.json$/.test(name)).sort()))',
  ]));
  assert.deepEqual(retainedFiles, retainedHistory.map(item => `${item.id}.json`).sort(), 'On-volume snapshot files must exactly match the API history');
  assert.deepEqual((await request(`${HOME}/__studio/api/backups`)).json(), retainedHistory, 'Reading history must not change or resurrect entries');
  console.log('PASS: real Docker volume retains the exact newest25 pre-save revisions after26 committed saves; API history and on-volume snapshot identities agree.');
  // Sign-in on, the default: the same volumes lock behind first-administrator
  // setup and the container health check still passes.
  const signInEnv = { ...env, STUDIO_AUTH: 'on' };
  await docker([...composeArgs, 'up', '--detach', '--force-recreate', '--no-build', '--pull', 'never'], { env: signInEnv });
  await composeHealth();
  const home = await fetch(new URL('/', origin), { headers: { accept: 'text/html' }, redirect: 'manual', signal: AbortSignal.timeout(35000) });
  assert.equal(home.status, 302);
  assert.equal(home.headers.get('location'), '/__studio/auth/setup');
  assert.equal((await request(`${HOME}/__studio/api/state`, undefined, 401)).json().code, 'SETUP_REQUIRED');
  assert.deepEqual((await request('/__studio/application-ready')).json(), { status: 'ready' }, 'anonymous callers see readiness only');
  const setupPage = await fetch(new URL('/__studio/auth/setup', origin), { headers: { accept: 'text/html' }, signal: AbortSignal.timeout(35000) });
  assert.equal(setupPage.status, 200);
  assert.match(setupPage.headers.get('content-security-policy') || '', /script-src 'self'/);
  for (const asset of ['app.js', 'app.css', 'webauthn.js']) assert.equal((await fetch(new URL('/__studio/auth/assets/' + asset, origin), { signal: AbortSignal.timeout(35000) })).status, 200, asset);
  assert.match(await docker([...composeArgs, 'exec', '-T', 'studio', 'node', 'server/auth/cli.mjs', 'list'], { env: signInEnv }), /No accounts yet/);
  // Chromium with a virtual passkey: first-administrator setup, sign-out and
  // passkey sign-in against the real image.
  try {
    const signInResult = await execute(process.execPath, ['browser/node_modules/@playwright/test/cli.js', 'test', '--config', 'browser/sign-in.config.mjs'], {
      env: { ...signInEnv, STUDIO_BROWSER_ORIGIN: origin }, timeout: 300000, maxBuffer: 8 * 1024 * 1024,
    });
    console.log(signInResult.stdout.trim());
  } catch (error) {
    console.error((error.stdout || '').slice(-20000));
    throw new Error(`Real Chromium sign-in qualification failed: ${(error.stderr || error.message).slice(-5000)}`);
  }
  console.log('PASS: sign-in on by default locks the real volumes behind first-administrator setup, serves the sign-in assets, keeps the Docker health check passing and runs the recovery command.');
  await docker([...composeArgs, 'down', '--volumes', '--remove-orphans']);
  composeStarted = false;
  await docker(['network', 'rm', env.STUDIO_NETWORK_NAME]);
  networkCreated = false;
  console.log('PASS: fresh standalone volumes, native protocol, nonroot controller and loopback workers, independently configured dashboards, child-crash recovery and broken-default isolation, edit/snapshot, restart, replacement, restore, Chromium dashboard/mobile, Firefox/WebKit desktop and real hidden-document qualification.');

  const address = Object.values(networkInterfaces()).flat().find(item => item && item.family === 'IPv4' && !item.internal)?.address;
  assert.ok(address, 'A disposable runner network address is required for the one-node Swarm');
  await docker(['swarm', 'init', '--advertise-addr', address]);
  swarmStarted = true;
  env.STUDIO_NODE = await docker(['node', 'inspect', 'self', '--format', '{{.Description.Hostname}}']);
  // The stack joins a pre-created overlay network and external secrets, as a
  // deployment does (docs/DEPLOY.md, steps 2 and 5).
  await docker(['network', 'create', '--driver', 'overlay', '--attachable', env.STUDIO_NETWORK_NAME]);
  for (const name of Object.keys(secretValues)) await docker(['secret', 'create', name, path.join(secretsDirectory, name)]);
  await docker(['stack', 'config', ...swarmFiles]);
  stackStarted = true;
  await docker(['stack', 'deploy', '--resolve-image', 'never', ...swarmFiles, identity]);
  const swarmFixture = await freshAndEdit();
  const swarmDashboards = await multiDashboard();
  const swarmContainer = await docker(['ps', '--quiet', '--filter', `label=com.docker.swarm.service.name=${identity}_studio`]);
  await assertWorkers(swarmContainer, swarmDashboards);
  await crashWorker(swarmContainer, swarmDashboards[0]);
  for (const service of ['studio']) {
    const specification = JSON.parse(await docker(['service', 'inspect', `${identity}_${service}`]))[0].Spec;
    assert.equal(specification.Mode.Replicated.Replicas, 1);
    assert.equal(specification.UpdateConfig.Order, 'stop-first');
    assert.deepEqual(specification.TaskTemplate.Placement.Constraints, [`node.hostname == ${env.STUDIO_NODE}`]);
    await docker(['service', 'update', '--force', '--update-order', 'stop-first', `${identity}_${service}`], { timeout: 360000 });
    await assertPersisted(swarmFixture);
    await assertDashboardsPersisted(swarmDashboards);
  }
  await restoreEmpty(swarmFixture);
  console.log('PASS: fresh one-node Swarm, same-node single application, stop-first service replacement, edit/snapshot persistence and restore.');
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
  if (networkCreated) await cleanup(() => docker(['network', 'rm', env.STUDIO_NETWORK_NAME]));
  if (swarmStarted) {
    await cleanup(() => docker(['swarm', 'leave', '--force']));
  }
  if (secretsDirectory) await cleanup(() => rm(secretsDirectory, { recursive: true, force: true }));
  if (cleanupFailures.length && !primaryFailure) throw new AggregateError(cleanupFailures, 'Fixture cleanup failed after successful qualification.');
}
