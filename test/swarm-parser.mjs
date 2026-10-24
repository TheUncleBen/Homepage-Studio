// Run the actual Docker CLI legacy Swarm parser; no daemon is needed.
// This deliberately lives outside *.test.mjs because ordinary unit runs do not
// require Docker. CI invokes it explicitly before building the application image.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { parse } from 'yaml';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));
const cli = process.env.STUDIO_DOCKER_CLI || 'docker';
const required = ['STUDIO_IMAGE', 'STUDIO_PUBLIC_ORIGIN', 'STUDIO_NODE'];
const fixture = {
  STUDIO_IMAGE: 'homepage-studio-ci:application',
  STUDIO_PUBLIC_ORIGIN: 'http://localhost:17778',
  STUDIO_NODE: 'fixture-node',
  STUDIO_BACKUP_RETENTION: '25',
};

async function withParser(run) {
  const directory = await mkdtemp(path.join(tmpdir(), 'studio-swarm-parser-'));
  // Avoid a user's Docker configuration and make accidental daemon access fail.
  const env = { ...process.env, ...fixture, DOCKER_CONFIG: directory, DOCKER_HOST: `unix://${directory}/no-daemon.sock` };
  const render = (variables = env) => execute(cli, ['stack', 'config', '--compose-file', 'portainer-swarm.yml'], {
    cwd: root, env: variables, timeout: 10000, maxBuffer: 1024 * 1024,
  });
  try { await run(render, env); } finally { await rm(directory, { recursive: true, force: true }); }
}

test('the actual Swarm parser preserves required image, origin and node values', async () => {
  await withParser(async (render, env) => {
    const { stdout } = await render();
    const result = parse(stdout);
    assert.equal(result.services.studio.image, fixture.STUDIO_IMAGE);
    assert.deepEqual(Object.keys(result.services), ['studio']);
    for (const service of Object.values(result.services)) {
      assert.equal(service.environment.STUDIO_PUBLIC_ORIGIN, fixture.STUDIO_PUBLIC_ORIGIN);
      assert.deepEqual(service.deploy.placement.constraints, [`node.hostname == ${fixture.STUDIO_NODE}`]);
      assert.equal(service.deploy.replicas, 1);
      assert.equal(service.deploy.update_config.order, 'stop-first');
    }
    // No published port; the proxy network and the secrets are external.
    assert.equal(result.services.studio.ports, undefined);
    assert.deepEqual(result.networks, { proxy: { external: true, name: 'homepage-studio' } });
    assert.deepEqual(parse((await render({ ...env, STUDIO_NETWORK_NAME: 'Proxy-Net' })).stdout).networks.proxy.name, 'Proxy-Net');
    const secrets = ['studio_auth_key', 'studio_oidc_client_secret', 'studio_smtp_password', 'studio_admin_password'];
    assert.deepEqual(Object.keys(result.secrets), secrets);
    for (const name of secrets) assert.equal(result.secrets[name].external, true);
    assert.deepEqual(result.services.studio.secrets.map(item => item.source), secrets);
    assert.equal(result.services.studio.environment.STUDIO_AUTH_KEY_FILE, '/run/secrets/studio_auth_key');
    assert.equal(result.services.studio.environment.STUDIO_AUTH_KEY, undefined);
    // Hardening must survive the real parser; security_opt is not supported
    // by docker stack deploy, so the template must not pretend to set it.
    assert.equal(result.services.studio.init, true);
    assert.deepEqual(result.services.studio.cap_drop, ['ALL']);
    assert.equal(result.services.studio.security_opt, undefined);
    assert.equal(result.services.studio.environment.STUDIO_FRAME_ANCESTORS, '');
    assert.equal(Number(result.services.studio.environment.STUDIO_BACKUP_RETENTION), 25);
  });
});

test('the actual Swarm parser uses named volumes by default and absolute host paths when set', async () => {
  await withParser(async (render, env) => {
    const named = parse((await render()).stdout).services.studio.volumes;
    assert.deepEqual(named.map(({ type, source, target }) => ({ type, source, target })), [
      { type: 'volume', source: 'config', target: '/app/config' },
      { type: 'volume', source: 'state', target: '/app/state' },
    ]);
    const bound = parse((await render({ ...env, STUDIO_CONFIG_PATH: '/srv/studio/config', STUDIO_STATE_PATH: '/srv/studio/state' })).stdout).services.studio.volumes;
    assert.deepEqual(bound.map(({ type, source, target }) => ({ type, source, target })), [
      { type: 'bind', source: '/srv/studio/config', target: '/app/config' },
      { type: 'bind', source: '/srv/studio/state', target: '/app/state' },
    ]);
  });
});

test('the actual Swarm parser rejects every unset or empty required deployment value', async () => {
  await withParser(async (render, env) => {
    for (const name of required) {
      for (const empty of [false, true]) {
        const variables = { ...env };
        if (empty) variables[name] = ''; else delete variables[name];
        await assert.rejects(render(variables), error => {
          assert.ok(Number.isInteger(error.code) && error.code !== 0, `${name} must fail closed`);
          assert.match(error.stderr, new RegExp(`required variable ${name} is missing a value`));
          return true;
        }, `${name} ${empty ? 'empty' : 'unset'} must be rejected`);
      }
    }
  });
});
