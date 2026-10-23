import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('npm test uses only runner options accepted by every supported Node version', async (t) => {
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const minimum = Number(/^>=(\d+)/.exec(manifest.engines.node)?.[1]);
  assert.ok(Number.isInteger(minimum), 'engines.node must declare a minimum major version');
  const current = Number(process.versions.node.split('.')[0]);
  if (current < minimum) {
    t.skip(`Node ${process.versions.node} is below the declared engines.node ${manifest.engines.node}`);
    return;
  }

  const words = manifest.scripts.test.split(/\s+/);
  assert.deepEqual(words.slice(0, 2), ['node', '--test'], 'npm test must invoke the built-in Node test runner');
  const options = words.slice(1).filter((word) => word.startsWith('--'));

  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-npm-test-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const probe = path.join(temp, 'probe.test.mjs');
  await fs.writeFile(probe, "import { test } from 'node:test';\ntest('probe', () => {});\n");
  const result = spawnSync(process.execPath, [...options, probe], { encoding: 'utf8' });
  assert.equal(result.status, 0, `node ${options.join(' ')} was rejected by Node ${process.versions.node}:\n${result.stderr}`);
});
