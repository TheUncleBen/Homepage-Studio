// The controller's side of the observability engine (plan 5.1): it starts the
// engine worker, restarts it with a growing pause when it stops, and replays
// the last definitions, secrets and certificates to each new engine.
import { Worker } from 'node:worker_threads';
import { createPort } from './rpc.mjs';

const ENGINE = new URL('./engine.mjs', import.meta.url);
const BACKOFF = [1000, 2000, 5000, 15000, 30000, 60000];

export function createEngineHost({ dir, stateRoot, smtp = null, siteName = 'Homepage Studio', publicOrigin = null, journal = 'WAL', signIn = false, extraCaFile = null, onLog = () => {}, resourceLimits = { maxOldGenerationSizeMb: 256 } }) {
  let worker = null, port = null, failures = 0, stopped = false, restartTimer = null, ready = null;
  // The last value of each replayed call, so a restarted engine catches up.
  const replay = new Map();
  const queued = [];

  function start() {
    if (stopped) return;
    const env = { ...process.env };
    if (extraCaFile) env.NODE_EXTRA_CA_CERTS = extraCaFile;
    worker = new Worker(ENGINE, { workerData: { dir, stateRoot, smtp, siteName, publicOrigin, journal, signIn }, resourceLimits, env, stdout: false, stderr: false });
    const current = worker;
    port = createPort(worker, {});
    const startedAt = Date.now();
    ready = (async () => {
      for (const [method, params] of replay.values()) await port.call(method, params, 30000).catch(() => {});
      while (queued.length) { const [method, params] = queued.shift(); port.cast(method, params); }
    })();
    current.on('error', error => onLog({ severity: 3, message: `The monitoring engine stopped: ${error.message}` }));
    current.on('exit', code => {
      if (worker !== current) return;
      port.abort();
      worker = null; port = null;
      if (stopped) return;
      if (Date.now() - startedAt > 120000) failures = 0;
      const wait = BACKOFF[Math.min(failures, BACKOFF.length - 1)];
      failures++;
      onLog({ severity: 3, message: `The monitoring engine exited (code ${code}); restarting in ${Math.round(wait / 1000)} s.` });
      restartTimer = setTimeout(start, wait);
      restartTimer.unref?.();
    });
  }

  const unavailable = () => Object.assign(new Error('Monitoring and logs are restarting. Try again in a moment.'), { code: 'OBSERVABILITY_UNAVAILABLE', status: 503 });

  return {
    start,
    get running() { return Boolean(worker); },
    forget(key) { replay.delete(key); },
    async call(method, params, timeoutMs) {
      if (!port) throw unavailable();
      await ready;
      if (!port) throw unavailable();
      return port.call(method, params, timeoutMs);
    },
    // Fire and forget; kept briefly while the engine restarts.
    cast(method, params) {
      if (port) return port.cast(method, params);
      if (queued.length < 1000) queued.push([method, params]);
    },
    // Calls whose latest value every new engine needs (definitions, secrets, CA).
    // key separates values of one method (bound card monitors per dashboard).
    async set(method, params, key = method) {
      replay.delete(key);
      replay.set(key, [method, params]);
      if (!port) return null;
      await ready;
      return port ? port.call(method, params, 30000) : null;
    },
    async stop() {
      stopped = true;
      clearTimeout(restartTimer);
      if (!worker) return;
      const current = worker;
      try { await port.call('stop', null, 10000); } catch {}
      await current.terminate().catch(() => {});
    },
  };
}
