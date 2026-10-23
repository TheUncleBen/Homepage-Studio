import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { rendererProcessProbe } from '../scripts/renderer-process-probe.mjs';

const execute = promisify(execFile);
const linux = process.platform === 'linux';

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

// Returns the error code when this host cannot bind IPv6 loopback at all, or
// null when it can. Any other bind failure is rethrown so it stays visible.
async function ipv6LoopbackUnavailable() {
  const server = net.createServer();
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '::1', resolve); });
  } catch (error) {
    if (error.code === 'EAFNOSUPPORT' || error.code === 'EADDRNOTAVAIL') return error.code;
    throw error;
  }
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return null;
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'studio-renderer-probe-'));
  const rendererRoot = join(root, 'renderer');
  const otherRoot = join(root, 'renderer-other');
  await Promise.all([mkdir(rendererRoot), mkdir(otherRoot)]);
  const script = join(rendererRoot, 'server.js');
  await writeFile(script, `
    const { spawn } = require('node:child_process');
    const net = require('node:net');
    const options = JSON.parse(process.argv[2]);
    if (options.descendant) {
      const child = spawn(process.execPath, [__filename, JSON.stringify({ ...options, descendant: false })], {
        cwd: process.cwd(), env: { ...process.env, ...options.childMarkers }, stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
      });
      child.once('message', value => process.send(value));
      child.once('error', error => { throw error; });
    } else {
      process.title = 'next-server (v16.3.8)';
      const servers = [];
      const listen = (port, host) => new Promise((resolve, reject) => {
        const server = net.createServer(); servers.push(server);
        server.once('error', reject); server.listen(port, host, resolve);
      });
      (async () => {
        if (options.listen !== false) await listen(Number(process.env.PORT), options.host || '127.0.0.1');
        if (options.extraIpv6) await listen(0, '::1');
        setInterval(() => {}, 1000);
        process.send({ ready: true, pid: process.pid });
      })().catch(error => { console.error(error); process.exit(1); });
    }
  `);
  const children = [];
  t.after(async () => {
    for (const child of children) {
      try { process.kill(-child.pid, 'SIGTERM'); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    await Promise.all(children.map(async child => {
      let timer;
      try {
        await Promise.race([child.closed, new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Renderer probe fixture failed to close.')), 3000);
        })]);
      } finally {
        clearTimeout(timer);
        try { process.kill(-child.pid, 'SIGKILL'); }
        catch (error) { if (error.code !== 'ESRCH') throw error; }
      }
    }));
    await rm(root, { recursive: true, force: true });
  });

  async function start({ id = 'default', env: overrides = {}, cwd = rendererRoot, port, ...options } = {}) {
    port ??= await unusedPort();
    const env = { ...process.env, STUDIO_DASHBOARD_ID: id, STUDIO_RENDERER_INSTANCE: randomUUID(),
      HOMEPAGE_CONFIG_DIR: '/app/config', HOSTNAME: '127.0.0.1', HOMEPAGE_MCP_ALLOW_WRITE: 'false', PORT: String(port), ...overrides };
    if (options.descendant) {
      options.childMarkers = { STUDIO_DASHBOARD_ID: env.STUDIO_DASHBOARD_ID, STUDIO_RENDERER_INSTANCE: env.STUDIO_RENDERER_INSTANCE };
      env.STUDIO_DASHBOARD_ID = ''; env.STUDIO_RENDERER_INSTANCE = '';
    }
    const child = spawn(process.execPath, [script, JSON.stringify(options)], { cwd, env, detached: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    child.closed = new Promise(resolve => child.once('close', resolve));
    children.push(child);
    let diagnostics = '';
    child.stderr.on('data', bytes => { diagnostics = (diagnostics + bytes).slice(-2000); });
    const ready = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('Renderer probe fixture timed out: ' + diagnostics)), 5000);
      const failed = error => finish(error);
      const closed = () => finish(new Error('Renderer probe fixture closed before readiness: ' + diagnostics));
      const message = value => { if (value.ready) finish(null, value); };
      function finish(error, value) {
        clearTimeout(timer); child.off('error', failed); child.off('close', closed); child.off('message', message);
        if (error) reject(error); else resolve(value);
      }
      child.once('error', failed); child.once('close', closed); child.on('message', message);
    });
    return { pid: ready.pid, port, instance: env.STUDIO_RENDERER_INSTANCE };
  }

  async function inspect() {
    const { stdout } = await execute(process.execPath, ['-e', rendererProcessProbe({ parentPid: process.pid, rendererRoot })], { timeout: 5000 });
    return JSON.parse(stdout);
  }
  return { start, inspect, script, otherRoot };
}

test('the exact container probe finds a real renderer after Next-style process title mutation', { skip: !linux, timeout: 15000 }, async t => {
  const f = await fixture(t);
  const child = await f.start();
  const command = await readFile(`/proc/${child.pid}/cmdline`, 'utf8');
  assert.ok(command.startsWith('next-server (v16.3.8)'));
  assert.ok(!command.split('\0').includes(f.script), 'This must reproduce the argv-based discovery failure.');
  const found = await f.inspect();
  assert.equal(found.length, 1);
  assert.deepEqual(found[0], { pid: child.pid, parentPid: process.pid, id: 'default', instance: child.instance,
    configDir: '/app/config', hostname: '127.0.0.1', mcpWrite: 'false', uid: process.getuid(), port: child.port,
    listeners: [{ family: 'tcp', address: '0100007F', port: child.port }], addresses: ['0100007F'] });
});

test('renderer discovery rejects missing markers, wrong cwd and descendants without hiding duplicate direct workers', { skip: !linux, timeout: 15000 }, async t => {
  const f = await fixture(t);
  const valid = await f.start();
  await f.start({ env: { STUDIO_RENDERER_INSTANCE: '' } });
  await f.start({ env: { STUDIO_DASHBOARD_ID: '' } });
  await f.start({ cwd: f.otherRoot });
  await f.start({ descendant: true });
  assert.deepEqual((await f.inspect()).map(item => item.pid), [valid.pid]);
  const duplicate = await f.start();
  const selected = (await f.inspect()).filter(item => item.id === 'default');
  assert.deepEqual(selected.map(item => item.pid).sort((a, b) => a - b), [valid.pid, duplicate.pid].sort((a, b) => a - b));
  assert.equal(selected.length, 2, 'Duplicate workers must remain visible to the strict one-child acceptance assertion.');
});

test('a renderer cannot borrow another process listener and wildcard listeners remain visible', { skip: !linux, timeout: 15000 }, async t => {
  const f = await fixture(t);
  const owner = await f.start({ id: randomUUID() });
  const claimant = await f.start({ id: randomUUID(), port: owner.port, listen: false });
  const wildcard = await f.start({ id: randomUUID(), host: '0.0.0.0' });
  const records = await f.inspect();
  assert.deepEqual(records.find(item => item.pid === owner.pid).addresses, ['0100007F']);
  assert.deepEqual(records.find(item => item.pid === claimant.pid).listeners, []);
  assert.deepEqual(records.find(item => item.pid === claimant.pid).addresses, []);
  assert.deepEqual(records.find(item => item.pid === wildcard.pid).addresses, ['00000000']);
});

test('an additional owned IPv6 listener cannot escape the IPv4-only acceptance assertion', { skip: !linux, timeout: 15000 }, async t => {
  const unavailable = await ipv6LoopbackUnavailable();
  if (unavailable) {
    t.skip(`This host cannot bind IPv6 loopback ::1 (${unavailable}).`);
    return;
  }
  const f = await fixture(t);
  const child = await f.start({ extraIpv6: true });
  const [record] = await f.inspect();
  assert.equal(record.pid, child.pid);
  assert.deepEqual(record.listeners.map(item => item.family), ['tcp', 'tcp6']);
  assert.equal(record.listeners[0].port, child.port);
  assert.equal(record.addresses.length, 2);
  assert.notDeepEqual(record.addresses, ['0100007F']);
});
