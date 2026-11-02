import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { COARSE_STEP_MS, FINE_MS, createHistoryStore, downsample, retentionDays } from './history.mjs';

const HOUR = 3600e3;

test('chart history keeps every sample for two days, then 15-minute averages until retention ends', async t => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-history-'));
  t.after(() => fs.rm(stateDir, { recursive: true, force: true }));
  const store = createHistoryStore({ stateDir });
  const start = Math.floor(Date.now() / COARSE_STEP_MS) * COARSE_STEP_MS - 10 * 86400e3;
  // Ten days of a sample every five minutes: 0, 5 and 10 in each quarter hour.
  for (let at = start; at <= start + 10 * 86400e3; at += 5 * 60e3) {
    await store.record('panel-a', [{ field: 'cpu', label: 'glances.cpu', format: 'percent', value: (at / 60e3) % 15 }], { at, days: 7 });
  }
  const file = JSON.parse(await fs.readFile(path.join(stateDir, 'history', (await fs.readdir(path.join(stateDir, 'history')))[0]), 'utf8'));
  const end = start + 10 * 86400e3;
  assert.ok(file.fine.every(point => point[0] >= end - FINE_MS - COARSE_STEP_MS), 'only two days of single samples');
  assert.ok(file.coarse.every(point => point[0] >= end - 7 * 86400e3), 'nothing older than the retention');
  assert.ok(file.coarse.every(point => point[0] % COARSE_STEP_MS === 0 && point[1] === 5), 'each 15 minutes averages its samples');
  assert.deepEqual(file.fields, [{ field: 'cpu', label: 'glances.cpu', format: 'percent' }]);
});

test('chart history reads a range, at most about 300 points, with the latest sample', async t => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-history-'));
  t.after(() => fs.rm(stateDir, { recursive: true, force: true }));
  const store = createHistoryStore({ stateDir });
  const now = Date.now();
  for (let i = 120; i >= 0; i--) await store.record('p', [{ field: 'rx', format: 'byterate', value: i }, { field: 'name', value: 'text' }, { field: '../x', value: 1 }, { field: 'Blocked today', format: 'percent', value: 5 }], { at: now - i * 60e3 });
  const hour = await store.read('p', '1h');
  assert.deepEqual(hour.fields, [{ field: 'rx', label: '', format: 'byterate' }, { field: 'Blocked today', label: '', format: 'percent' }], 'text and unsafe fields are never kept');
  assert.ok(hour.points.length <= 61 && hour.points.length >= 59);
  assert.equal(hour.latest.values.rx, 0);
  const day = await store.read('p', '24h');
  assert.ok(day.points.length <= 121);
  await assert.rejects(store.read('p', 'forever'), { status: 400 });
  assert.deepEqual((await store.read('missing', '24h')).points, []);
  await store.keepOnly([]);
  assert.deepEqual(await fs.readdir(path.join(stateDir, 'history')), [], 'history goes with the chart');
});

test('averages skip missing values and retention follows the dashboard setting', () => {
  assert.deepEqual(downsample([[0, 1, null], [60e3, 3, 4]], HOUR, 2), [[0, 2, 4]]);
  assert.deepEqual(downsample([[0, 1, 1.5], [60e3, 2, 2]], HOUR, 2), [[0, 2, 1.75]], 'whole numbers stay whole');
  assert.equal(retentionDays({}), 30);
  assert.equal(retentionDays({ studioDefaults: { chartDays: 90 } }), 90);
  assert.equal(retentionDays({ studioDefaults: { chartDays: 12 } }), 30);
});
