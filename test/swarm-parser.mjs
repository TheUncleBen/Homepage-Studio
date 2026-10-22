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
  STUDIO_PORT: '17778',
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
  await withParser(async render => {
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
    assert.equal(Number(result.services.studio.ports[0].published), 17778);
    assert.equal(Number(result.services.studio.environment.STUDIO_BACKUP_RETENTION), 25);
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
