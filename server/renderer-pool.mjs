import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import childProcess from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { dashboardConfigDir, dashboardBasePath, validateDashboardId } from './dashboard-paths.mjs';

const UPSTREAM_COMMIT = '51cc1684f9f34a7877ed462b8f94c9cc687b4dde';
const PROTOCOL = 1;

export class RendererError extends Error {
  constructor(message, code = 'RENDERER_UNAVAILABLE', status = 503) {
    super(message);
    this.name = 'RendererError'; this.code = code; this.status = status;
  }
}

function integer(value, fallback, min, max, label) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`${label} must be an integer between ${min} and ${max}.`);
  return parsed;
}

async function realDirectory(path) {
  const full = resolve(path);
  const stat = await fs.lstat(full);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(full) !== full) throw new RendererError('Dashboard storage must use real directories without symbolic links.', 'UNSAFE_RENDERER_STORAGE');
}

async function unusedPort() {
  const reservation = net.createServer();
  await new Promise((resolveListen, reject) => {
    reservation.once('error', reject);
    reservation.listen(0, '127.0.0.1', resolveListen);
  });
  const port = reservation.address().port;
  await new Promise((resolveClose, reject) => reservation.close(error => error ? reject(error) : resolveClose()));
  return port;
}

function health(origin, host, timeout) {
  return new Promise((resolveHealth, reject) => {
    const request = http.get(new URL('/api/studio/health', origin), { headers: { host }, timeout }, response => {
      let bytes = 0; const chunks = [];
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 4096) request.destroy(new Error('Invalid native health response'));
        else chunks.push(chunk);
      });
      response.once('error', reject);
      response.once('end', () => {
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* Startup can briefly return another response. */ }
        resolveHealth({ status: response.statusCode, body });
      });
    });
    request.once('error', reject);
    request.once('timeout', () => request.destroy(new Error('Native startup health timed out')));
  });
}

export function createRendererPool({
  configRoot, appRoot, workerScript, allowedHosts = process.env.HOMEPAGE_ALLOWED_HOSTS,
  buildRevision = process.env.STUDIO_BUILD_REVISION || 'unreleased',
  maxWorkers, idleMs, startupMs, workerEnv = {},
} = {}) {
  configRoot = resolve(configRoot);
  appRoot = resolve(appRoot);
  workerScript = resolve(workerScript || join(appRoot, 'server.js'));
  const hosts = String(allowedHosts || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
  if (!hosts.length || hosts.includes('*')) throw new Error('Set HOMEPAGE_ALLOWED_HOSTS to explicit approved hostname:port values.');
  maxWorkers = integer(maxWorkers ?? process.env.STUDIO_RENDERER_MAX_WORKERS, 8, 1, 64, 'STUDIO_RENDERER_MAX_WORKERS');
  idleMs = integer(idleMs ?? (process.env.STUDIO_RENDERER_IDLE_SECONDS === undefined ? undefined : Number(process.env.STUDIO_RENDERER_IDLE_SECONDS) * 1000), 600000, 10, 86400000, 'Renderer idle duration');
  startupMs = integer(startupMs ?? (process.env.STUDIO_RENDERER_STARTUP_SECONDS === undefined ? undefined : Number(process.env.STUDIO_RENDERER_STARTUP_SECONDS) * 1000), 30000, 50, 120000, 'Renderer startup duration');
  const current = new Map();
  const records = new Set();
  let closed = false; let closeResult; let queue = Promise.resolve();
  // The queue orders record bookkeeping only. Nothing awaits a worker stop
  // while holding it, so one slow-exiting worker never delays other
  // dashboards. A stopping worker stays in `records`, and so counts against
  // maxWorkers, until its process has exited.
  const serial = operation => {
    const result = queue.then(operation, operation);
    queue = result.catch(() => {});
    return result;
  };

  function remove(record) {
    clearTimeout(record.idleTimer);
    records.delete(record);
    if (current.get(record.id) === record) current.delete(record.id);
  }

  function stop(record) {
    if (record.stopping) return record.stopping;
    record.draining = true;
    clearTimeout(record.idleTimer);
    record.stopping = (async () => {
      // launch() may still be reserving a port. Its closed/stopping check then
      // prevents a delayed child from escaping shutdown.
      if (record.child?.pid && !record.exited) {
        record.child.kill('SIGTERM');
        let timer;
        try {
          await Promise.race([
            record.exit,
            new Promise(resolveTimeout => { timer = setTimeout(resolveTimeout, 4000); }),
          ]);
        } finally { clearTimeout(timer); }
        if (!record.exited) {
          record.child.kill('SIGKILL');
          await record.exit;
        }
      }
      remove(record);
    })();
    return record.stopping;
  }

  function scheduleIdle(record) {
    clearTimeout(record.idleTimer);
    if (record.refs || record.exited || record.draining || closed) return;
    record.idleTimer = setTimeout(() => {
      void serial(() => {
        if (!record.refs && records.has(record)) void stop(record);
      }).catch(() => {});
    }, idleMs);
    record.idleTimer.unref();
  }

  async function launch(record, host) {
    try {
      await realDirectory(appRoot);
      const script = await fs.lstat(workerScript);
      if (!script.isFile() || script.isSymbolicLink()) throw new RendererError('The controlled native runtime is missing or invalid.', 'RENDERER_RUNTIME_INVALID');
      const port = await unusedPort();
      if (closed || record.stopping) throw new RendererError('The dashboard renderer is shutting down.', 'RENDERER_SHUTTING_DOWN');
      record.origin = new URL(`http://127.0.0.1:${port}`);
      record.child = childProcess.spawn(process.execPath, [workerScript], {
        cwd: appRoot,
        env: {
          ...process.env, ...workerEnv,
          NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: String(port),
          HOMEPAGE_CONFIG_DIR: record.configDir, HOMEPAGE_ALLOWED_HOSTS: hosts.join(','),
          STUDIO_DASHBOARD_ID: record.id, STUDIO_DASHBOARD_BASE_PATH: record.basePath,
          STUDIO_RENDERER_INSTANCE: record.instance,
          // The platform default look each dashboard inherits (server/platform.mjs).
          STUDIO_PLATFORM_FILE: join(resolve(configRoot), 'studio-platform.json'),
          STUDIO_BUILD_REVISION: buildRevision, HOMEPAGE_AUTH_ENABLED: 'false',
          HOMEPAGE_MCP_ALLOW_WRITE: 'false', NEXT_TELEMETRY_DISABLED: '1', LOG_TARGETS: 'stdout',
        },
        stdio: ['ignore', 'inherit', 'inherit'],
      });
      record.exit = new Promise(resolveExit => {
        const exited = () => { record.exited = true; remove(record); resolveExit(); };
        record.child.once('exit', exited);
        record.child.once('error', error => { record.spawnError = error; exited(); });
      });
      const deadline = Date.now() + startupMs;
      while (Date.now() < deadline) {
        if (closed || record.stopping || record.exited) throw new RendererError('The dashboard renderer could not start. Check the application logs and runtime files.');
        let result;
        try { result = await health(record.origin, host, Math.min(1000, Math.max(1, deadline - Date.now()))); }
        catch { /* A child can be initializing before its listener exists. */ }
        if (result?.status === 200) {
          const body = result.body;
          if (body?.protocolVersion !== PROTOCOL || body?.upstreamCommit !== UPSTREAM_COMMIT || body?.buildRevision !== buildRevision) throw new RendererError('The dashboard renderer does not match this application build. Replace it with the complete qualified image.', 'RENDERER_BUILD_MISMATCH');
          if (body.dashboardId !== record.id || body.dashboardBasePath !== record.basePath || body.rendererInstance !== record.instance) throw new RendererError('The native renderer does not match the requested dashboard instance.', 'RENDERER_CONTEXT_MISMATCH');
          if (closed || record.stopping || record.exited) throw new RendererError('The dashboard renderer is shutting down.', 'RENDERER_SHUTTING_DOWN');
          return record;
        }
        await new Promise(resolveDelay => setTimeout(resolveDelay, Math.min(50, Math.max(1, deadline - Date.now()))));
      }
      throw new RendererError('The dashboard renderer did not become ready within its startup limit. Check the application logs and available resources.', 'RENDERER_STARTUP_TIMEOUT');
    } catch (error) {
      await stop(record);
      if (error instanceof RendererError) throw error;
      throw new RendererError('The dashboard renderer could not start. Check the application logs, configuration directory and runtime files.');
    }
  }

  async function acquire(entry, requestHost) {
    validateDashboardId(entry?.id);
    if (entry.archived || typeof entry.slug !== 'string' || (entry.slug && !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(entry.slug)) || (!entry.slug && entry.id !== 'default')) throw new RendererError('That dashboard is unavailable.', 'RENDERER_DASHBOARD_UNAVAILABLE');
    const host = String(requestHost || '').toLowerCase();
    if (!hosts.includes(host)) throw new RendererError('This dashboard address is not approved.', 'RENDERER_HOST_REJECTED', 403);
    const configDir = dashboardConfigDir(configRoot, entry.id);
    await realDirectory(configRoot);
    await realDirectory(configDir);
    let record;
    while (!record) {
      const slot = await serial(() => {
        if (closed) throw new RendererError('The application is shutting down.', 'RENDERER_SHUTTING_DOWN');
        let found = current.get(entry.id);
        if (found && (found.basePath !== dashboardBasePath(entry) || found.draining || found.exited)) {
          current.delete(entry.id); found.draining = true;
          if (!found.refs) void stop(found);
          found = null;
        }
        if (!found) {
          if (records.size >= maxWorkers) {
            const idle = [...records].filter(item => !item.refs && !item.stopping).sort((a, b) => a.lastUsed - b.lastUsed)[0];
            if (idle) void stop(idle);
          }
          if (records.size >= maxWorkers) {
            // Wait for a slot outside the queue; other dashboards keep going.
            const stopping = [...records].filter(item => item.stopping).map(item => item.stopping);
            if (stopping.length) return { wait: Promise.race(stopping) };
            throw new RendererError('All dashboard renderers are busy. Retry shortly, or increase STUDIO_RENDERER_MAX_WORKERS for this deployment.', 'RENDERER_CAPACITY');
          }
          found = { id: entry.id, basePath: dashboardBasePath(entry), instance: randomUUID(), configDir, refs: 0, lastUsed: Date.now(), draining: false, exited: false };
          records.add(found); current.set(found.id, found);
          found.ready = launch(found, host);
          // A synchronous caller cancellation must not leave a rejected startup
          // promise unobserved; acquire below still receives the actual error.
          found.ready.catch(() => {});
        }
        clearTimeout(found.idleTimer); found.refs += 1;
        return { record: found };
      });
      if (slot.wait) await slot.wait;
      else record = slot.record;
    }
    let released = false;
    const release = () => {
      if (released) return; released = true;
      record.refs = Math.max(0, record.refs - 1); record.lastUsed = Date.now();
      if (!record.refs && record.draining) void stop(record);
      else scheduleIdle(record);
    };
    try {
      await record.ready;
      if (closed || record.exited || record.stopping) throw new RendererError('The dashboard renderer is no longer available. Retry the current dashboard address.');
      return { origin: new URL(record.origin.href), release };
    } catch (error) { release(); throw error; }
  }

  return {
    acquire,
    // Resolves once an unleased worker has exited; a leased one stops on its
    // last release. The wait happens outside the queue.
    async drain(id) {
      // Wrapped so the queue does not adopt (and wait for) the stop promise.
      const result = await serial(() => {
        const record = current.get(id);
        if (!record) return {};
        current.delete(id); record.draining = true;
        return { stopping: record.refs ? undefined : stop(record) };
      });
      await result.stopping;
    },
    close() {
      if (closeResult) return closeResult;
      closed = true;
      closeResult = serial(() => ({ all: Promise.all([...records].map(record => stop(record))) })).then(({ all }) => all).then(() => {});
      return closeResult;
    },
    get workerCount() { return records.size; },
  };
}
