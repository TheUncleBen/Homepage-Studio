import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { observeChildClose, removeBrowserProfile, stopBrowserProcess } from '../browser/visibility/cleanup.mjs';

const posix = process.platform !== 'win32';

async function processFixture(t, source) {
  const directory = await mkdtemp(join(tmpdir(), 'studio-browser-cleanup-test-'));
  const profile = join(directory, 'profile');
  await mkdir(join(profile, 'Default'), { recursive: true });
  const child = spawn(process.execPath, ['-e', source, directory], { detached: posix, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  const observed = observeChildClose(child, { processGroup: posix });
  let diagnostics = '';
  let extraGroup;
  child.stderr.on('data', bytes => { diagnostics = (diagnostics + bytes).slice(-4000); });
  t.after(async () => {
    for (const pid of [extraGroup, observed.result ? undefined : child.pid].filter(Boolean)) {
      try { process.kill(posix ? -pid : pid, 'SIGKILL'); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    if (!observed.result) await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Test process failed to close during teardown.')), 2000);
      observed.complete.then(() => { clearTimeout(timer); resolve(); });
    });
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
  });
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error(`Fixture readiness timed out: ${diagnostics}`)), 5000);
    const failed = error => finish(error);
    const closed = () => finish(new Error(`Fixture closed before readiness: ${diagnostics}`));
    const message = value => { if (value.ready) finish(null, value); };
    function finish(error, value) {
      clearTimeout(timer);
      child.off('error', failed);
      child.off('close', closed);
      child.off('message', message);
      if (error) reject(error); else resolve(value);
    }
    child.once('error', failed);
    child.once('close', closed);
    child.on('message', message);
  });
  extraGroup = ready.extraGroup;
  return { directory, profile, child, observed };
}

test('graceful shutdown waits for final profile writes without sending SIGTERM', { timeout: 5000 }, async t => {
  const f = await processFixture(t, `
    const fs = require('node:fs');
    const path = require('node:path');
    const root = process.argv[1];
    process.on('SIGTERM', () => fs.appendFileSync(path.join(root, 'events'), 'term\\n'));
    process.on('message', () => {
      fs.writeFileSync(path.join(root, 'events'), 'close-request\\n');
      setTimeout(() => {
        fs.writeFileSync(path.join(root, 'profile/Default/final-write'), 'finished');
        process.exit(0);
      }, 100);
    });
    process.send({ready:true});
  `);
  const result = await stopBrowserProcess(f.observed, { requestClose: () => f.child.send('close'), graceMs: 1000, terminateMs: 300, killMs: 300 });
  assert.deepEqual(result, { method: 'graceful', code: 0, signal: null });
  assert.ok(f.observed.result, 'The close event must be observed before returning.');
  assert.equal(await readFile(join(f.profile, 'Default/final-write'), 'utf8'), 'finished');
  assert.equal(await readFile(join(f.directory, 'events'), 'utf8'), 'close-request\n');
  await removeBrowserProfile(f.profile);
  await assert.rejects(readFile(join(f.profile, 'Default/final-write')), { code: 'ENOENT' });
});

test('parent exit does not permit profile removal before a descendant closes inherited stderr', { skip: !posix, timeout: 5000 }, async t => {
  const f = await processFixture(t, `
    const {spawn} = require('node:child_process');
    const root = process.argv[1];
    const descendant = spawn(process.execPath, ['-e', \
      "const fs=require('node:fs');const path=require('node:path');const root=process.argv[1];process.on('message',()=>setTimeout(()=>{fs.writeFileSync(path.join(root,'profile/Default/descendant-final'),'finished');process.exit(0);},150));process.send({ready:true});", root], {stdio:['ignore','ignore','inherit','ipc']});
    descendant.once('message', () => process.send({ready:true}));
    process.on('message', () => { descendant.send('finish'); process.exit(0); });
  `);
  const exited = once(f.child, 'exit');
  const stopped = stopBrowserProcess(f.observed, { requestClose: () => f.child.send('close'), graceMs: 1500, terminateMs: 300, killMs: 300 });
  await exited;
  assert.equal(f.observed.result, undefined, 'An inherited pipe keeps close pending after root exit.');
  const result = await stopped;
  assert.equal(result.method, 'graceful');
  assert.equal(await readFile(join(f.profile, 'Default/descendant-final'), 'utf8'), 'finished');
  await removeBrowserProfile(f.profile);
});

test('SIGTERM fallback waits for asynchronous termination instead of deleting the active profile', { timeout: 5000 }, async t => {
  const f = await processFixture(t, `
    const fs = require('node:fs');const path = require('node:path');const root = process.argv[1];
    process.on('message', () => {});
    process.on('SIGTERM', () => setTimeout(() => { fs.writeFileSync(path.join(root,'profile/Default/terminated'),'done');process.exit(0); }, 70));
    process.send({ready:true});
  `);
  const result = await stopBrowserProcess(f.observed, { requestClose: () => f.child.send('ignored'), graceMs: 30, terminateMs: 1000, killMs: 300 });
  assert.equal(result.method, 'sigterm');
  assert.equal(await readFile(join(f.profile, 'Default/terminated'), 'utf8'), 'done');
  assert.ok(f.observed.result);
});

test('SIGKILL fallback is awaited when a real process refuses SIGTERM', { skip: !posix, timeout: 5000 }, async t => {
  const f = await processFixture(t, `process.on('message',()=>{});process.on('SIGTERM',()=>{});process.send({ready:true});`);
  const result = await stopBrowserProcess(f.observed, { requestClose: () => f.child.send('ignored'), graceMs: 20, terminateMs: 40, killMs: 1000 });
  assert.deepEqual(result, { method: 'sigkill', code: null, signal: 'SIGKILL' });
  assert.equal(f.child.exitCode, null);
  assert.equal(f.child.signalCode, 'SIGKILL');
  assert.ok(f.observed.result);
});

test('fallback terminates owned descendants even after the browser parent has exited', { skip: !posix, timeout: 5000 }, async t => {
  const f = await processFixture(t, `
    const {spawn} = require('node:child_process');const root = process.argv[1];
    const descendant = spawn(process.execPath, ['-e', \
      "const fs=require('node:fs');const path=require('node:path');const file=path.join(process.argv[1],'profile/Default/ticks');process.on('SIGTERM',()=>{});setInterval(()=>fs.appendFileSync(file,'x'),10);process.send({ready:true});", root], {stdio:['ignore','ignore','inherit','ipc']});
    descendant.once('message', () => process.send({ready:true}));
    process.on('message', () => process.exit(0));
  `);
  const result = await stopBrowserProcess(f.observed, { requestClose: () => f.child.send('close'), graceMs: 70, terminateMs: 70, killMs: 1000 });
  assert.equal(result.method, 'sigkill');
  assert.equal(result.code, 0, 'The root exited normally; fallback waited for its descendant pipe.');
  const final = await readFile(join(f.profile, 'Default/ticks'), 'utf8');
  await delay(40);
  assert.equal(await readFile(join(f.profile, 'Default/ticks'), 'utf8'), final, 'Descendant profile writes must have stopped.');
  await removeBrowserProfile(f.profile);
});

test('a process already closed by a signal is recognized without another termination attempt', { skip: !posix, timeout: 5000 }, async t => {
  const f = await processFixture(t, `process.send({ready:true});setTimeout(()=>process.kill(process.pid,'SIGTERM'),50);`);
  await f.observed.complete;
  assert.equal(f.child.exitCode, null);
  assert.equal(f.child.signalCode, 'SIGTERM');
  assert.deepEqual(await stopBrowserProcess(f.observed), { method: 'already-closed', code: null, signal: 'SIGTERM' });
});

test('an unclosed external descendant produces a bounded cleanup failure, never success', { skip: !posix, timeout: 5000 }, async t => {
  const f = await processFixture(t, `
    const {spawn} = require('node:child_process');
    const descendant = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000);process.send({ready:true});"], {detached:true,stdio:['ignore','ignore','inherit','ipc']});
    descendant.once('message', () => process.send({ready:true,extraGroup:descendant.pid}));
    process.on('message', () => process.exit(0));
  `);
  await assert.rejects(stopBrowserProcess(f.observed, { requestClose: () => f.child.send('close'), graceMs: 30, terminateMs: 30, killMs: 60 }), /did not close after bounded/);
  assert.equal(f.observed.result, undefined);
});

async function profileFixture(t) {
  const profile = await mkdtemp(join(tmpdir(), 'studio-profile-retry-test-'));
  await mkdir(join(profile, 'Default'));
  await writeFile(join(profile, 'Default/late-write'), 'Chromium descendant write');
  t.after(() => rm(profile, { recursive: true, force: true }));
  return profile;
}

test('a real ENOTEMPTY during profile removal is retried and the full directory is removed', async t => {
  const profile = await profileFixture(t);
  let calls = 0;
  const result = await removeBrowserProfile(profile, { retryDelayMs: 5, remove: async (path, options) => {
    calls += 1;
    // A real nonempty directory supplies the error Chromium's shutdown race
    // produced, then the next attempt performs the actual recursive removal.
    if (calls === 1) await rmdir(join(path, 'Default'));
    await rm(path, options);
  } });
  assert.deepEqual(result, { attempts: 2 });
  assert.equal(calls, 2);
  await assert.rejects(readFile(join(profile, 'Default/late-write')), { code: 'ENOENT' });
});

test('persistent ENOTEMPTY is bounded and preserves its final filesystem error', async t => {
  const profile = await profileFixture(t);
  let calls = 0;
  await assert.rejects(removeBrowserProfile(profile, { attempts: 3, retryDelayMs: 5, remove: async path => { calls += 1; await rmdir(join(path, 'Default')); } }), { code: 'ENOTEMPTY' });
  assert.equal(calls, 3);
  assert.equal(await readFile(join(profile, 'Default/late-write'), 'utf8'), 'Chromium descendant write');
});

test('nontransient filesystem failure is surfaced immediately without retrying or hiding it', async t => {
  const profile = await profileFixture(t);
  let calls = 0;
  await assert.rejects(removeBrowserProfile(profile, { attempts: 6, retryDelayMs: 5, remove: async path => { calls += 1; await rmdir(join(path, 'Default/late-write')); } }), { code: 'ENOTDIR' });
  assert.equal(calls, 1);
});
