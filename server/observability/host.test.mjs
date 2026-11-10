// A monitoring or log-search worker that can't start (a module missing from
// the image, say) is restarted with a back-off; it must never take the
// server down with it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWorkerHost } from './host.mjs';

test('a worker that fails to load is reported, not fatal', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'studio-host-'));
  const entry = join(dir, 'broken.mjs');
  writeFileSync(entry, "import './missing-module.mjs';\n");
  const rejections = [];
  const onRejection = error => rejections.push(error);
  process.on('unhandledRejection', onRejection);
  const logs = [];
  const host = createWorkerHost({ entry: pathToFileURL(entry), name: 'test engine', onLog: entry => logs.push(entry.message) });
  // A value every new engine is given (replayed on start), as definitions are.
  host.set('definitions', { monitors: [] });
  host.set('ca', { pem: [] });
  host.start();
  await new Promise(resolve => setTimeout(resolve, 1500));
  host.stop?.();
  process.off('unhandledRejection', onRejection);
  assert.deepEqual(rejections, []);
  assert.ok(logs.some(message => /test engine (stopped|exited)/.test(message)), logs.join('\n'));
  await assert.rejects(host.call('anything', {}, 1000), error => error.code === 'OBSERVABILITY_UNAVAILABLE');
});
