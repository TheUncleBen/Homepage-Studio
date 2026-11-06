// A minimal, read-only Docker Engine API client (plan 10.1, owner decision D2:
// through a read-only socket proxy). It only ever sends GET requests.
import http from 'node:http';
import https from 'node:https';

// Which socket-proxy section each API path needs, for plain-words errors.
const SECTIONS = [[/^\/containers\/[^/]+\/logs/, 'CONTAINERS'], [/^\/containers/, 'CONTAINERS'], [/^\/events/, 'EVENTS'], [/^\/services/, 'SERVICES'], [/^\/tasks/, 'TASKS'], [/^\/info/, 'INFO'], [/^\/version/, 'VERSION'], [/^\/_ping/, 'PING']];
export const sectionFor = path => SECTIONS.find(([pattern]) => pattern.test(path))?.[1] ?? 'the API';

export class DockerError extends Error {
  constructor(message, code, status) { super(message); this.code = code; this.status = status; }
}

// server: { socket } or { host, port, protocol, ca, cert, key, headers }.
export function createDockerClient(server, { timeoutMs = 10000 } = {}) {
  const tlsOn = server.protocol === 'https' || Boolean(server.cert);
  const transport = tlsOn ? https : http;
  const base = server.socket ? { socketPath: server.socket } : { host: server.host, port: server.port ?? (tlsOn ? 2376 : 2375), ...(tlsOn ? { ca: server.ca, cert: server.cert, key: server.key } : {}) };

  function open(path, { stream = false, query } = {}) {
    const search = query ? '?' + new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined).map(([key, value]) => [key, typeof value === 'object' ? JSON.stringify(value) : String(value)])).toString() : '';
    return new Promise((resolve, reject) => {
      const req = transport.request({ ...base, method: 'GET', path: `/v1.41${path}${search}`, headers: { host: 'docker', ...(server.headers ?? {}) }, agent: false, ...(stream ? {} : { timeout: timeoutMs }) }, res => {
        if (res.statusCode === 403) { res.resume(); return reject(new DockerError(`Permission: enable ${sectionFor(path)} on the socket proxy`, 'DOCKER_PERMISSION', 403)); }
        if (res.statusCode === 404) { res.resume(); return reject(new DockerError('Not found on this Docker server', 'DOCKER_NOT_FOUND', 404)); }
        if (res.statusCode >= 400) { res.resume(); return reject(new DockerError(`Docker answered ${res.statusCode}`, 'DOCKER_ERROR', res.statusCode)); }
        resolve(res);
      });
      req.on('timeout', () => req.destroy(new DockerError('Docker did not answer in time', 'ETIMEDOUT')));
      req.on('error', error => reject(error instanceof DockerError ? error : new DockerError(error.code === 'ENOENT' || error.code === 'EACCES' ? 'The Docker socket isn\'t available to Studio' : `Can't reach Docker (${error.code ?? 'error'})`, error.code ?? 'DOCKER_UNREACHABLE')));
      req.end();
    });
  }
  async function getJson(path, query) {
    const res = await open(path, { query });
    const chunks = [];
    let size = 0;
    for await (const chunk of res) { size += chunk.length; if (size > 8 * 1024 * 1024) throw new DockerError('Docker\'s answer is too large', 'DOCKER_TOO_LARGE'); chunks.push(chunk); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new DockerError('Docker\'s answer isn\'t JSON', 'DOCKER_BAD_RESPONSE'); }
  }

  return {
    ping: () => getJson('/version'),
    containers: (filters) => getJson('/containers/json', { all: 1, ...(filters ? { filters } : {}) }),
    inspect: id => getJson(`/containers/${encodeURIComponent(id)}/json`),
    stats: id => getJson(`/containers/${encodeURIComponent(id)}/stats`, { stream: 'false', 'one-shot': 'true' }),
    services: name => getJson('/services', { filters: { name: [name] } }),
    tasks: service => getJson('/tasks', { filters: { service: [service] } }),
    // A live stream of container events; onEvent gets each parsed event.
    async events(onEvent, { since } = {}) {
      const res = await open('/events', { stream: true, query: { filters: { type: ['container'] }, ...(since ? { since: Math.floor(since / 1000) } : {}) } });
      let buffer = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        buffer += chunk;
        let index;
        while ((index = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
          if (line.trim()) { try { onEvent(JSON.parse(line)); } catch {} }
        }
        if (buffer.length > 1024 * 1024) buffer = '';
      });
      return res;
    },
    // Container log lines (timestamps on). Non-TTY streams carry an 8-byte
    // header per frame (stream type, size), which is removed here.
    async logs(id, onLine, { since, follow = true, tty = false } = {}) {
      const res = await open(`/containers/${encodeURIComponent(id)}/logs`, { stream: follow, query: { stdout: 1, stderr: 1, timestamps: 1, follow: follow ? 1 : 0, ...(since ? { since: (since / 1000).toFixed(3) } : { tail: 200 }) } });
      let pending = Buffer.alloc(0);
      let text = { 1: '', 2: '' };
      const emit = (stream, data) => {
        text[stream] += data;
        let index;
        while ((index = text[stream].indexOf('\n')) >= 0) {
          const line = text[stream].slice(0, index); text[stream] = text[stream].slice(index + 1);
          const match = /^(\d{4}-\d\d-\d\dT[\d:.]+Z) ?(.*)$/.exec(line);
          onLine({ stream: stream === 2 ? 'stderr' : 'stdout', ts: match ? Date.parse(match[1]) : Date.now(), line: (match ? match[2] : line).slice(0, 16384) });
        }
        if (text[stream].length > 64 * 1024) text[stream] = '';
      };
      res.on('data', chunk => {
        if (tty) return emit(1, chunk.toString('utf8'));
        pending = Buffer.concat([pending, chunk]);
        while (pending.length >= 8) {
          const type = pending[0];
          const size = pending.readUInt32BE(4);
          if (![0, 1, 2].includes(type) || size > 16 * 1024 * 1024) { pending = Buffer.alloc(0); return emit(1, chunk.toString('utf8')); }
          if (pending.length < 8 + size) break;
          emit(type === 2 ? 2 : 1, pending.subarray(8, 8 + size).toString('utf8'));
          pending = pending.subarray(8 + size);
        }
      });
      return res;
    },
  };
}

// CPU and memory from one stats sample, as Docker's CLI computes them.
export function statsSummary(stats) {
  const cpuDelta = (stats?.cpu_stats?.cpu_usage?.total_usage ?? 0) - (stats?.precpu_stats?.cpu_usage?.total_usage ?? 0);
  const systemDelta = (stats?.cpu_stats?.system_cpu_usage ?? 0) - (stats?.precpu_stats?.system_cpu_usage ?? 0);
  const cpus = stats?.cpu_stats?.online_cpus ?? stats?.cpu_stats?.cpu_usage?.percpu_usage?.length ?? 1;
  const cpu = systemDelta > 0 && cpuDelta >= 0 ? (cpuDelta / systemDelta) * cpus * 100 : null;
  const cache = stats?.memory_stats?.stats?.inactive_file ?? stats?.memory_stats?.stats?.cache ?? 0;
  const used = stats?.memory_stats?.usage != null ? stats.memory_stats.usage - cache : null;
  const limit = stats?.memory_stats?.limit ?? null;
  let rx = 0, tx = 0;
  for (const net of Object.values(stats?.networks ?? {})) { rx += net.rx_bytes ?? 0; tx += net.tx_bytes ?? 0; }
  return { cpu: cpu === null ? null : Math.round(cpu * 10) / 10, memory: used, memoryLimit: limit, memoryPercent: used !== null && limit ? Math.round((used / limit) * 1000) / 10 : null, rx, tx };
}

// The state of a container or a Swarm service, as a monitor result.
export async function checkContainer(client, { container }) {
  try {
    const found = await client.containers({ name: [container] });
    const exact = found.find(item => item.Names?.some(name => name.replace(/^\//, '') === container)) ?? found.find(item => item.Labels?.['com.docker.swarm.service.name'] === container);
    if (!exact) {
      // A Swarm service by name: up when its running tasks match the wanted count.
      try {
        const services = await client.services(container);
        const service = services.find(item => item.Spec?.Name === container);
        if (service) {
          const tasks = await client.tasks(container);
          const running = tasks.filter(task => task.Status?.State === 'running').length;
          const wanted = service.Spec?.Mode?.Replicated?.Replicas ?? running;
          const failed = tasks.filter(task => ['failed', 'rejected'].includes(task.Status?.State) && Date.now() - Date.parse(task.Status?.Timestamp) < 3600e3).length;
          const details = { kind: 'service', running, wanted, recentFailures: failed };
          if (running >= wanted && wanted > 0) return { ok: true, docker: details };
          return { ok: false, cls: 'unreachable', message: `${running} of ${wanted} tasks running${failed ? ` · ${failed} failed in the last hour` : ''}`, docker: details };
        }
      } catch (error) { if (error.code !== 'DOCKER_NOT_FOUND' && error.code !== 'DOCKER_PERMISSION') throw error; }
      return { ok: false, cls: 'not-found', message: `No container or service called ${container}` };
    }
    const info = await client.inspect(exact.Id);
    const state = info.State ?? {};
    const docker = { kind: 'container', id: exact.Id, status: state.Status, health: state.Health?.Status ?? null, restarts: info.RestartCount ?? 0, exitCode: state.ExitCode ?? null, oom: Boolean(state.OOMKilled), startedAt: Date.parse(state.StartedAt) || null, image: info.Config?.Image ?? null, memoryLimit: info.HostConfig?.Memory || null };
    if (!state.Running) return { ok: false, cls: 'unreachable', message: `${state.Status ?? 'stopped'}${state.ExitCode ? ` · exit code ${state.ExitCode}` : ''}${state.OOMKilled ? ' · out of memory' : ''}`, docker };
    if (state.Health?.Status === 'unhealthy') return { ok: false, cls: 'assertion', message: 'Running but its health check fails', docker };
    if (state.Restarting) return { ok: false, cls: 'unreachable', message: 'Restarting', docker };
    return { ok: true, docker, ...(state.Health?.Status === 'starting' ? { warning: { cls: 'assertion', message: 'Health check starting' } } : {}) };
  } catch (error) {
    return { ok: false, cls: error.code === 'DOCKER_PERMISSION' ? 'permission' : error.code === 'ETIMEDOUT' ? 'timeout' : 'unreachable', message: error.message };
  }
}
