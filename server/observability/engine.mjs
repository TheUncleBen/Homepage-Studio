// The observability engine: a worker thread inside the controller (plan 5.1).
// It owns history storage and every loop (checks, ingestion, notifications,
// Docker, syslog, metrics, retention). The controller talks to it through
// rpc.mjs; it never handles HTTP requests from browsers itself.
import { parentPort, workerData } from 'node:worker_threads';
import { join } from 'node:path';
import { createPort } from './rpc.mjs';
import { createStorage, openMain, selfTest } from './storage.mjs';
import { openDatabase, hasFts5, sqliteVersion } from './sqlite.mjs';
import { MAIN_SCHEMA } from './schema.mjs';
import { createRedactor } from './redact.mjs';
import { createIngest } from './ingest.mjs';
import { createMonitoring, availability } from './monitors.mjs';
import { runDns, runHttp, runPing, runTcp, runTls } from './checks.mjs';
import { createNotifier } from './notify.mjs';
import { createDockerClient, checkContainer, statsSummary } from './docker.mjs';
import { createMetrics, createHostSampler } from './metrics.mjs';
import { createSyslogServer } from './syslog.mjs';
import { createQueryRunner } from './query.mjs';
import { DEFAULT_SETTINGS } from './definitions.mjs';
import { STUDIO_SCOPE } from './model.mjs';

const config = workerData ?? {};
const dir = config.dir;
const health = { status: 'starting', storage: 'unknown', reason: null, journal: null, fts: null, sqlite: null };
let defs = { settings: structuredClone(DEFAULT_SETTINGS), monitors: [], maintenance: [], channels: [], views: [], sources: [], alerts: [], overrides: {} };
let dashboards = new Map(); // id → { name, slug, path }
let dockerServers = {}; // monitor id → resolved server config
const boundRaw = new Map(); // dashboard id → card monitors as the controller sent them
let ca;

// ---- Storage, with monitoring kept alive when history can't be written ----
let storage = null, db;
const REMOVED_PERSON = 'removed person';
try {
  if (!hasFts5()) throw Object.assign(new Error('SQLite FTS5 is missing'), { code: 'OBSERVABILITY_FTS5_MISSING' });
  selfTest(dir);
  storage = createStorage({ dir, journal: config.journal ?? 'WAL' });
  db = storage.main;
  health.storage = 'ok';
  health.journal = storage.journalMode;
  if (health.journal.toLowerCase() !== 'wal') health.reason = 'The history folder does not support write-ahead logging; Studio uses a slower, safer mode.';
} catch (error) {
  health.storage = 'unavailable';
  health.reason = `History and logs are paused: the history folder can't be used (${error.code ?? error.message}). Monitoring keeps running.`;
  db = openDatabase(':memory:', { journal: 'DELETE' });
  db.exec(MAIN_SCHEMA);
}
health.fts = storage ? true : null;
try { health.sqlite = sqliteVersion(); } catch {}

const redactor = createRedactor();
const ingest = storage ? createIngest({ storage, redactor, batchMs: (defs.settings.batchSeconds ?? 2) * 1000, onDropped: count => log({ source_type: 'studio', source_id: 'logs', category: 'application', severity: 4, event_type: 'logs.dropped', message: `${count} log events were not kept in the last minute (rate limit or full queue).`, fields: { count } }) }) : null;
let droppedWithoutStorage = 0;
function log(event) {
  if (ingest) return ingest.add(event);
  droppedWithoutStorage++;
  return null;
}
const queries = storage ? createQueryRunner({ dir }) : null;

// ---- Monitoring ----
const metrics = createMetrics({ db, onEvent: log });
const notifier = createNotifier({ db, smtp: config.smtp ?? null, siteName: () => config.siteName ?? 'Homepage Studio', publicOrigin: config.publicOrigin ?? null, ca: () => ca, onEvent: log });

const effective = monitor => {
  const override = defs.overrides?.[monitor.id];
  return override ? { ...monitor, notify: override.notify ?? monitor.notify, paused: override.paused ?? monitor.paused } : monitor;
};

async function runCheck(monitor) {
  const timeoutMs = monitor.timeout * 1000;
  const family = monitor.family ?? 'auto';
  switch (monitor.type) {
    case 'http': return runHttp(monitor.http, { timeoutMs, ca, family });
    case 'tcp': return runTcp(monitor.tcp, { timeoutMs, family });
    case 'ping': return runPing(monitor.ping, { timeoutMs, family });
    case 'dns': return runDns(monitor.dns, { timeoutMs });
    case 'tls': return runTls(monitor.tls, { timeoutMs, ca, family });
    case 'docker': {
      const server = dockerServers[monitor.id];
      if (!server) return { ok: false, cls: 'not-found', message: `No Docker server called ${monitor.docker.server} in this dashboard's docker.yaml` };
      const client = createDockerClient(server, { timeoutMs });
      const result = await checkContainer(client, monitor.docker);
      if (result.docker?.kind === 'container' && result.docker.status === 'running') {
        try {
          const stats = statsSummary(await client.stats(result.docker.id));
          for (const [name, value, meta] of [['cpu', stats.cpu, { label: 'CPU', unit: '%', format: 'percent' }], ['memory', stats.memory, { label: 'Memory', format: 'bytes' }], ['memory_percent', stats.memoryPercent, { label: 'Memory of limit', unit: '%', format: 'percent' }]]) metrics.record(monitor.scope, `container:${monitor.id}`, name, value, meta);
          result.docker.stats = stats;
        } catch {}
      }
      return result;
    }
    default: return { ok: false, cls: 'internal', message: 'Unknown monitor type' };
  }
}

const monitoring = createMonitoring({
  db,
  definitions: () => ({ ...defs, monitors: defs.monitors.map(effective) }),
  runCheck,
  onEvent: log,
  onTransition: change => {
    const { monitor, state, previous, result } = change;
    if (result?.docker) docker.track(monitor, result.docker);
    notifyTransition(effective(monitor), previous, state, result);
  },
});
// Response time series for every check, for charts and resource pages.
const applyOriginal = monitoring.apply;
monitoring.apply = (monitor, result, ts) => {
  const record = applyOriginal(monitor, result, ts);
  if (Number.isFinite(result?.ms) && result.ok) metrics.record(monitor.scope, `monitor:${monitor.id}`, 'response_ms', result.ms, { label: 'Response time', unit: 'ms', format: 'duration' });
  if (result?.docker) docker.track(monitor, result.docker);
  certificateWarning(effective(monitor), result);
  return record;
};

const dashboardName = scope => (scope === STUDIO_SCOPE ? 'Studio' : dashboards.get(scope)?.name ?? 'a dashboard');
const timeText = ts => new Date(ts).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });
function message(monitor, kind, result) {
  const titles = { down: `${monitor.name} is down`, up: `${monitor.name} is up again`, certificate: `${monitor.name}: certificate expires soon`, reminder: `${monitor.name} is still down` };
  const lines = [];
  if (kind === 'down' || kind === 'reminder') lines.push(result?.message ?? 'No answer');
  if (kind === 'up') { const down = db.get('SELECT opened FROM incident WHERE monitor_id = ? ORDER BY opened DESC LIMIT 1', monitor.id); if (down) lines.push(`Down for ${Math.max(1, Math.round((Date.now() - down.opened) / 60000))} minutes`); }
  if (kind === 'certificate') lines.push(result?.warning?.message ?? 'The certificate expires soon');
  lines.push(`Dashboard: ${dashboardName(monitor.scope)}`);
  lines.push(`At ${timeText(Date.now())}`);
  return { title: titles[kind], text: lines.join('\n'), urgent: kind === 'down' || kind === 'reminder', scope: monitor.scope, path: `/studio/operations#monitor/${encodeURIComponent(monitor.id)}`, data: { monitor: monitor.name, state: kind === 'certificate' ? 'warning' : kind === 'up' ? 'up' : 'down', dashboard: dashboardName(monitor.scope), at: new Date().toISOString() } };
}
function channelsFor(monitor) { return (monitor.notify?.channels ?? []).map(id => defs.channels.find(channel => channel.id === id)).filter(Boolean); }
function notifyTransition(monitor, previous, state, result) {
  const channels = channelsFor(monitor);
  if (!channels.length) return;
  let kind = null;
  if (state === 'down' && monitor.notify.down !== false) kind = 'down';
  if (state === 'up' && previous === 'down' && monitor.notify.up !== false) kind = 'up';
  if (!kind) return;
  const body = message(monitor, kind, result);
  for (const channel of channels) notifier.deliver(channel, body);
  const incident = monitoring.state(monitor.id)?.incident_id ?? db.get('SELECT id FROM incident WHERE monitor_id = ? ORDER BY opened DESC LIMIT 1', monitor.id)?.id;
  if (incident) {
    db.run('UPDATE incident SET notified = ? WHERE id = ?', Date.now(), incident);
    monitoring.incidentEvent(incident, 'notified', `${kind === 'down' ? 'Down' : 'Recovery'} notice sent to ${channels.map(channel => channel.name).join(', ')}`);
  }
}
const certNotified = new Map();
function certificateWarning(monitor, result) {
  if (!result?.warning || result.warning.cls !== 'tls-expired' || monitor.notify?.certificate === false) return;
  const last = certNotified.get(monitor.id) ?? Number(db.get('SELECT last_fired FROM alert_state WHERE rule_id = ?', 'cert:' + monitor.id)?.last_fired ?? 0);
  if (Date.now() - last < 86400e3) return;
  certNotified.set(monitor.id, Date.now());
  db.run('INSERT OR REPLACE INTO alert_state (rule_id, last_fired) VALUES (?, ?)', 'cert:' + monitor.id, Date.now());
  log({ source_type: 'monitor', source_id: monitor.id, scope: monitor.scope, resource: monitor.name, category: 'monitoring', severity: 4, event_type: 'monitor.certificate', error_class: 'tls-expired', message: `${monitor.name}: ${result.warning.message}` });
  for (const channel of channelsFor(monitor)) notifier.deliver(channel, message(monitor, 'certificate', result));
}
// Reminders while down and not acknowledged (plan 5.10).
function reminders() {
  for (const incident of db.all('SELECT * FROM incident WHERE closed IS NULL AND ack_at IS NULL')) {
    const monitor = monitoring.byId(incident.monitor_id);
    if (!monitor) continue;
    const m = effective(monitor);
    const every = m.notify?.resendMinutes ?? 0;
    if (!every || Date.now() - (incident.notified ?? incident.opened) < every * 60e3) continue;
    const state = monitoring.state(m.id);
    if (state?.state !== 'down') continue;
    const body = message(m, 'reminder', { message: state.last_message });
    for (const channel of channelsFor(m)) notifier.deliver(channel, body);
    db.run('UPDATE incident SET notified = ? WHERE id = ?', Date.now(), incident.id);
  }
}

// ---- Docker: events and opted-in container logs (plan 7.2) ----
const docker = (() => {
  const followers = new Map(); // key → { res, monitorId }
  const eventStreams = new Map(); // server key → res
  const known = new Map(); // container id → monitor ids
  const serverKey = server => JSON.stringify([server.socket ?? null, server.host ?? null, server.port ?? null]);
  function track(monitor, info) {
    if (info.kind !== 'container' || !info.id) return;
    const set = known.get(info.id) ?? new Set();
    set.add(monitor.id);
    known.set(info.id, set);
  }
  async function sync() {
    const wanted = new Map();
    const servers = new Map();
    for (const monitor of defs.monitors.filter(item => item.type === 'docker')) {
      const server = dockerServers[monitor.id];
      if (!server) continue;
      servers.set(serverKey(server), server);
      if (monitor.docker.collectLogs && !monitor.paused) wanted.set(`${monitor.id}`, { monitor, server });
    }
    for (const [key, follower] of followers) if (!wanted.has(key)) { follower.res?.destroy(); followers.delete(key); }
    for (const [key, { monitor, server }] of wanted) if (!followers.has(key)) follow(key, monitor, server);
    for (const [key, res] of eventStreams) if (!servers.has(key)) { res?.destroy(); eventStreams.delete(key); }
    for (const [key, server] of servers) if (!eventStreams.has(key)) watchEvents(key, server);
  }
  async function follow(key, monitor, server) {
    const entry = { res: null, monitorId: monitor.id };
    followers.set(key, entry);
    try {
      const client = createDockerClient(server);
      const found = await client.containers({ name: [monitor.docker.container] });
      const container = found.find(item => item.Names?.some(name => name.replace(/^\//, '') === monitor.docker.container));
      if (!container) { followers.delete(key); return; }
      const cursorKey = serverKey(server);
      const since = db.get('SELECT since FROM docker_cursor WHERE endpoint = ? AND container = ?', cursorKey, container.Id)?.since;
      entry.res = await client.logs(container.Id, line => {
        if (since && line.ts <= since) return;
        log({ source_type: 'docker', source_id: container.Id.slice(0, 12), scope: monitor.scope, resource: monitor.name, category: 'infrastructure', severity: line.stream === 'stderr' ? (/\b(error|fatal|panic|exception)\b/i.test(line.line) ? 3 : 5) : (/\b(error|fatal|panic)\b/i.test(line.line) ? 3 : /\bwarn(ing)?\b/i.test(line.line) ? 4 : 6), event_type: 'container.log', ts: line.ts, message: line.line, fields: { container: monitor.docker.container, stream: line.stream } });
        db.run('INSERT OR REPLACE INTO docker_cursor (endpoint, container, since) VALUES (?, ?, ?)', cursorKey, container.Id, line.ts);
      }, { since, follow: true, tty: Boolean(container.Labels?.tty) });
      entry.res.on('close', () => { if (followers.get(key) === entry) { followers.delete(key); setTimeout(() => sync().catch(() => {}), 30000).unref?.(); } });
    } catch (error) {
      followers.delete(key);
      log({ source_type: 'docker', source_id: 'logs', scope: monitor.scope, resource: monitor.name, category: 'infrastructure', severity: 4, event_type: 'container.logs-unavailable', message: `Container logs for ${monitor.docker.container} aren't available: ${error.message}` });
      setTimeout(() => sync().catch(() => {}), 60000).unref?.();
    }
  }
  async function watchEvents(key, server) {
    eventStreams.set(key, null);
    try {
      const res = await createDockerClient(server).events(event => {
        const action = String(event.Action ?? event.status ?? '').split(':')[0];
        if (!['start', 'stop', 'die', 'restart', 'kill', 'oom', 'health_status', 'pause', 'unpause'].includes(action)) return;
        const id = event.id ?? event.Actor?.ID;
        const name = event.Actor?.Attributes?.name ?? id?.slice(0, 12);
        const monitors = [...(known.get(id) ?? [])].map(mid => monitoring.byId(mid)).filter(Boolean);
        const severity = action === 'oom' || (action === 'die' && event.Actor?.Attributes?.exitCode && event.Actor.Attributes.exitCode !== '0') ? 3 : action === 'health_status' && /unhealthy/.test(event.Action) ? 4 : 5;
        const text = `${name}: ${action === 'health_status' ? event.Action.replace('health_status: ', 'health ') : action}${event.Actor?.Attributes?.exitCode ? ` (exit code ${event.Actor.Attributes.exitCode})` : ''}`;
        const ts = event.timeNano ? Math.floor(Number(event.timeNano) / 1e6) : Date.now();
        // Studio-wide always; also on each dashboard whose monitor watches it.
        log({ source_type: 'docker', source_id: 'events', category: 'infrastructure', severity, event_type: `container.${action}`, resource: name, message: text, ts, fields: { container: name } });
        for (const monitor of monitors) {
          log({ source_type: 'docker', source_id: id?.slice(0, 12) ?? 'events', scope: monitor.scope, resource: monitor.name, category: 'infrastructure', severity, event_type: `container.${action}`, message: text, ts, fields: { container: name } });
          if (['die', 'stop', 'oom', 'start', 'restart'].includes(action) || /unhealthy|healthy/.test(event.Action)) monitoring.checkNow(monitor.id);
        }
      });
      eventStreams.set(key, res);
      res.on('close', () => { if (eventStreams.get(key) === res) { eventStreams.delete(key); setTimeout(() => sync().catch(() => {}), 30000).unref?.(); } });
    } catch {
      eventStreams.delete(key);
      setTimeout(() => sync().catch(() => {}), 60000).unref?.();
    }
  }
  return { sync, track, close() { for (const f of followers.values()) f.res?.destroy(); for (const r of eventStreams.values()) r?.destroy(); followers.clear(); eventStreams.clear(); } };
})();

// ---- Syslog (D4) ----
let syslog = null, syslogConfig = null;
async function syncSyslog() {
  const wanted = config.signIn && defs.settings.syslog?.enabled && defs.sources.some(source => source.kind === 'syslog') ? defs.settings.syslog : null;
  const key = wanted ? JSON.stringify(wanted) : null;
  if (key === syslogConfig) return;
  if (syslog) { await syslog.close().catch(() => {}); syslog = null; }
  syslogConfig = key;
  if (!wanted) return;
  try {
    // Read the sender list on each check, so senders added later are allowed.
    const senderOf = address => defs.sources.find(item => item.kind === 'syslog' && item.address === address);
    syslog = createSyslogServer({ port: wanted.port, udp: wanted.udp, tcp: wanted.tcp, allow: address => Boolean(senderOf(address)), onRefused: () => { unknownSenders++; }, onError: error => { health.syslog = `Syslog can't listen on port ${wanted.port}: ${error.code ?? error.message}`; log({ source_type: 'syslog', source_id: 'listener', category: 'application', severity: 3, event_type: 'syslog.listen-failed', message: health.syslog }); }, onMessage: (parsed, address) => {
      const source = senderOf(address);
      if (!source) { unknownSenders++; return; }
      log({ source_type: 'syslog', source_id: source.id, scope: source.scope, resource: source.resource || source.name, category: 'infrastructure', severity: parsed.severity, ts: parsed.ts, event_type: 'syslog.message', message: parsed.message, fields: { host: parsed.host, app: parsed.app, facility: parsed.facility } });
    } });
    health.syslog = null;
  } catch (error) { health.syslog = `Syslog couldn't start: ${error.message}`; }
}
let unknownSenders = 0;

// ---- Log alerts (B6) ----
function evaluateAlerts() {
  if (!queries) return;
  for (const rule of defs.alerts) {
    const last = Number(db.get('SELECT last_fired FROM alert_state WHERE rule_id = ?', rule.id)?.last_fired ?? 0);
    if (Date.now() - last < rule.quietMinutes * 60e3) continue;
    const to = Date.now(), from = to - rule.minutes * 60e3;
    let count = 0;
    try { count = queries.count({ query: rule.query, from, to, scopes: null, restricted: true }); } catch { continue; }
    if (count < rule.threshold) continue;
    db.run('INSERT OR REPLACE INTO alert_state (rule_id, last_fired) VALUES (?, ?)', rule.id, to);
    log({ source_type: 'studio', source_id: 'alerts', category: 'monitoring', severity: 4, event_type: 'alert.fired', resource: rule.name, message: `Log alert “${rule.name}”: ${count} matching events in ${rule.minutes} minutes` });
    for (const channel of rule.channels.map(id => defs.channels.find(item => item.id === id)).filter(Boolean)) notifier.deliver(channel, { title: `Log alert: ${rule.name}`, text: `${count} events matched “${rule.query}” in the last ${rule.minutes} minutes.`, urgent: true, path: `/studio/operations#logs?q=${encodeURIComponent(rule.query)}`, data: { alert: rule.name, count } });
  }
}

// ---- Housekeeping ----
const hostSample = createHostSampler({ stateRoot: config.stateRoot ?? dir });
let mainMetrics = {};
function selfMetrics() {
  const stats = ingest?.stats() ?? { queued: 0, dropped: droppedWithoutStorage, written: 0 };
  const values = { queue: stats.queued, written: stats.written, running_checks: monitoring.running, ...mainMetrics };
  for (const [name, value] of Object.entries(values)) metrics.record(STUDIO_SCOPE, 'studio', name, value, { label: name.replace(/_/g, ' ') });
}
function hostMetrics() {
  const sample = hostSample();
  const meta = { cpu: { label: 'CPU', unit: '%', format: 'percent' }, memory: { label: 'Memory', format: 'bytes' }, memoryPercent: { label: 'Memory used', unit: '%', format: 'percent' }, diskFree: { label: 'Free disk', format: 'bytes' }, diskPercent: { label: 'Disk used', unit: '%', format: 'percent' } };
  for (const [name, value] of Object.entries(sample)) metrics.record(STUDIO_SCOPE, 'host', name.replace(/[A-Z]/g, c => '_' + c.toLowerCase()), value, meta[name]);
}
let storageWarnedAt = 0;
function retention() {
  if (!storage) return;
  const s = defs.settings;
  try {
    ingest?.flush();
    const removed = storage.retain({ logDays: s.logDays, auditDays: s.auditDays, budgetBytes: s.budgetMB * 1024 * 1024 });
    if (removed.length) log({ source_type: 'studio', source_id: 'logs', category: 'application', severity: 5, event_type: 'logs.retention', message: `Removed ${removed.length} old log file${removed.length === 1 ? '' : 's'} (${[...new Set(removed.map(item => item.reason === 'age' ? 'past the keep time' : 'over the disk budget'))].join(', ')})` });
    metrics.prune(s.metricDays);
    // Personal details of sign-in events are masked after 30 days (plan 7.10).
    db.run('DELETE FROM personal WHERE ts < ?', Date.now() - 30 * 86400e3);
    db.run('DELETE FROM delivery WHERE ts < ?', Date.now() - 30 * 86400e3);
    const usage = storage.usage();
    if (usage.total > s.budgetMB * 1024 * 1024 * 0.8 && Date.now() - storageWarnedAt > 86400e3) {
      storageWarnedAt = Date.now();
      log({ source_type: 'studio', source_id: 'logs', category: 'application', severity: 4, event_type: 'logs.budget', message: `Monitoring and logs use ${Math.round(usage.total / 1048576)} MB of the ${s.budgetMB} MB budget.` });
    }
    // A little full-text index merging on closed segments, in quiet times.
    const closed = db.all("SELECT stream, seq FROM segment WHERE closed = 1 ORDER BY seq DESC LIMIT 3");
    for (const segment of closed) storage.streams[segment.stream].mergeStep(segment.seq);
  } catch (error) {
    log({ source_type: 'studio', source_id: 'logs', category: 'application', severity: 3, event_type: 'logs.retention-failed', message: `Clean-up of old logs failed: ${error.code ?? error.message}` });
  }
}

// ---- Views for the controller's API ----
function monitorSummary(monitor, { withBars = false } = {}) {
  const state = monitoring.state(monitor.id);
  const out = { id: monitor.id, name: monitor.name, scope: monitor.scope, type: monitor.type, card: Boolean(monitor.card), panel: monitor.panel ?? null, tags: monitor.tags ?? [], paused: Boolean(effective(monitor).paused), interval: monitor.interval, target: targetText(monitor), state: state?.state ?? 'unknown', since: state?.since ?? null, lastCheck: state?.last_check ?? null, ms: state?.last_ms ?? null, code: state?.last_code ?? null, errorClass: state?.last_class ?? null, message: clean(state?.last_message ?? null), certExpires: state?.cert_expires ?? null, incident: state?.incident_id ?? null, warning: state?.details?.warning ?? null };
  if (withBars) {
    const since = Date.now() - 24 * 3600e3;
    const hours = db.all('SELECT start, up, down, maint, unknown FROM check_hour WHERE monitor_id = ? AND start >= ? ORDER BY start', monitor.id, since - 3600e3);
    out.day = availability(hours);
    out.bars = hours.map(row => ({ start: row.start, up: row.up, down: row.down, maint: row.maint }));
  }
  return out;
}
// Stored check text passes the redactor on the way out too, so a secret
// saved after the check ran is masked as well (security review M1).
const clean = text => (text === null || text === undefined ? text : redactor.text(String(text)));
const cleanIncident = incident => ({ ...incident, cause: clean(incident.cause) });
// A web address without its user info and query (which can carry keys).
function safeUrl(value) {
  try { const url = new URL(value); return `${url.protocol}//${url.host}${url.pathname}`; }
  catch { return clean(value); }
}
function targetText(monitor) {
  switch (monitor.type) {
    case 'http': return clean(safeUrl(monitor.http.url));
    case 'tcp': return `${monitor.tcp.host}:${monitor.tcp.port}`;
    case 'ping': return monitor.ping.host;
    case 'dns': return `${monitor.dns.name} (${monitor.dns.recordType})`;
    case 'tls': return `${monitor.tls.host}:${monitor.tls.port}`;
    case 'push': return 'Push URL';
    case 'docker': return `${monitor.docker.container} on ${monitor.docker.server}`;
    case 'group': return `${monitor.group.members.length} monitors`;
    default: return '';
  }
}
const visible = (scopes, scope) => !Array.isArray(scopes) || scopes.includes(scope);

const handlers = {
  definitions({ definitions, dashboards: list, docker: servers }) {
    defs = { ...defs, ...definitions, overrides: definitions.overrides ?? {} };
    dashboards = new Map((list ?? []).map(item => [item.id, item]));
    dockerServers = servers ?? {};
    // Bound monitors of dashboards that no longer exist go.
    for (const id of [...boundRaw.keys()]) if (!dashboards.has(id)) { boundRaw.delete(id); monitoring.dropDashboard(id); }
    // Overrides (paused, notifications) of card monitors may have changed.
    for (const [id, list] of boundRaw) monitoring.setBound(id, list.map(effective));
    docker.sync().catch(() => {});
    syncSyslog().catch(() => {});
    return { ok: true };
  },
  secrets({ list }) { redactor.setSecrets(new Map(list)); return { count: redactor.secretCount }; },
  ca({ pem }) { ca = Array.isArray(pem) && pem.length ? pem : undefined; return { ok: true }; },
  log(events) { for (const event of Array.isArray(events) ? events : [events]) log(event); },
  mainMetrics(values) { mainMetrics = values ?? {}; },
  bound({ dashboardId, monitors }) { boundRaw.set(dashboardId, monitors); monitoring.setBound(dashboardId, monitors.map(effective)); return { count: monitors.length }; },
  dropDashboard({ id }) { boundRaw.delete(id); monitoring.dropDashboard(id); metrics.dropScope(id); return { ok: true }; },
  panelStatus({ dashboardId }) {
    const out = {};
    for (const monitor of monitoring.bound(dashboardId)) {
      const state = monitoring.state(monitor.id);
      if (!state) continue;
      out[monitor.panel] = { state: ['up', 'down', 'pending', 'maintenance', 'paused', 'unreachable'].includes(state.state) ? state.state : 'unknown', ms: state.last_ms ?? null, code: state.last_code ?? null, since: state.since, checked: state.last_check ?? null, errorClass: state.state === 'down' || state.state === 'pending' ? state.last_class : null, warning: state.details?.warning?.message ?? null };
    }
    return { panels: out };
  },
  monitors({ scopes }) {
    return { monitors: monitoring.monitors().filter(monitor => visible(scopes, monitor.scope)).map(monitor => monitorSummary(monitor, { withBars: true })) };
  },
  monitor({ id, scopes }) {
    const monitor = monitoring.byId(id);
    if (!monitor || !visible(scopes, monitor.scope)) return null;
    const history = monitoring.history(id);
    history.recent = history.recent.map(item => ({ ...item, message: clean(item.message) }));
    const incidents = db.all('SELECT * FROM incident WHERE monitor_id = ? ORDER BY opened DESC LIMIT 20', id).map(cleanIncident);
    return { monitor: monitorSummary(monitor), history, incidents, series: metrics.list([monitor.scope]).filter(series => series.resource === `monitor:${id}` || series.resource === `container:${id}`) };
  },
  overview({ scopes, admin }) {
    const list = monitoring.monitors().filter(monitor => visible(scopes, monitor.scope));
    const counts = { up: 0, down: 0, pending: 0, maintenance: 0, paused: 0, unreachable: 0, unknown: 0 };
    for (const monitor of list) { const s = effective(monitor).paused ? 'paused' : monitoring.state(monitor.id)?.state ?? 'unknown'; counts[s] = (counts[s] ?? 0) + 1; }
    const open = db.all('SELECT * FROM incident WHERE closed IS NULL ORDER BY opened DESC').filter(incident => visible(scopes, incident.scope));
    const attention = [];
    for (const monitor of list) {
      const state = monitoring.state(monitor.id);
      if (state?.cert_expires && state.cert_expires - Date.now() < 14 * 86400e3) attention.push({ kind: 'certificate', monitor: monitor.id, scope: monitor.scope, name: monitor.name, text: state.cert_expires < Date.now() ? 'Certificate has expired' : `Certificate expires in ${Math.max(0, Math.floor((state.cert_expires - Date.now()) / 86400e3))} days` });
      else if (state?.details?.warning && state.state === 'up') attention.push({ kind: 'warning', monitor: monitor.id, scope: monitor.scope, name: monitor.name, text: state.details.warning.message });
    }
    if (admin) {
      for (const id of notifier.failing()) { const channel = defs.channels.find(item => item.id === id); if (channel) attention.push({ kind: 'channel', name: channel.name, text: 'Notifications are failing to send' }); }
      if (health.storage !== 'ok' || health.reason) attention.push({ kind: 'storage', name: 'Studio', text: health.reason });
      if (health.syslog) attention.push({ kind: 'syslog', name: 'Syslog', text: health.syslog });
    }
    return { counts, total: list.length, incidents: open.map(incident => ({ ...cleanIncident(incident), monitorState: monitoring.state(incident.monitor_id)?.state ?? null })), attention: attention.slice(0, 20), health: admin ? studioHealth() : undefined };
  },
  incidents({ scopes, open = false, limit = 100 }) {
    const rows = db.all(`SELECT * FROM incident ${open ? 'WHERE closed IS NULL' : ''} ORDER BY opened DESC LIMIT ?`, Math.min(500, limit * 3)).filter(row => visible(scopes, row.scope)).slice(0, limit);
    return { incidents: rows.map(cleanIncident) };
  },
  incident({ id, scopes }) {
    const incident = db.get('SELECT * FROM incident WHERE id = ?', id);
    if (!incident || !visible(scopes, incident.scope)) return null;
    return { incident: cleanIncident(incident), timeline: db.all('SELECT ts, kind, text, actor FROM incident_event WHERE incident_id = ? ORDER BY ts, seq', id).map(item => ({ ...item, text: clean(item.text) })), monitor: monitoring.byId(incident.monitor_id) ? monitorSummary(monitoring.byId(incident.monitor_id)) : null };
  },
  ack({ id, actor, scopes }) {
    const incident = db.get('SELECT * FROM incident WHERE id = ?', id);
    if (!incident || !visible(scopes, incident.scope)) return null;
    if (incident.closed || incident.ack_at) return { incident };
    db.run('UPDATE incident SET ack_by = ?, ack_at = ? WHERE id = ?', actor, Date.now(), id);
    monitoring.incidentEvent(id, 'ack', `${actor} is looking into it`, actor);
    log({ source_type: 'monitor', source_id: incident.monitor_id, scope: incident.scope, resource: incident.name, category: 'monitoring', severity: 5, event_type: 'incident.acknowledged', actor, message: `${actor} acknowledged ${incident.name} being down`, correlation: id });
    return { incident: db.get('SELECT * FROM incident WHERE id = ?', id) };
  },
  note({ id, actor, text, scopes }) {
    const incident = db.get('SELECT * FROM incident WHERE id = ?', id);
    if (!incident || !visible(scopes, incident.scope)) return null;
    monitoring.incidentEvent(id, 'note', redactor.text(text, 1000), actor);
    return { ok: true };
  },
  async test({ monitor }) { return runCheck({ ...monitor, timeout: Math.min(monitor.timeout ?? 10, 30) }); },
  checkNow({ id, scopes }) { const monitor = monitoring.byId(id); if (!monitor || !visible(scopes, monitor.scope)) return null; monitoring.checkNow(id); return { ok: true }; },
  push({ tokenHash, signal, body }) {
    const monitor = defs.monitors.find(item => item.type === 'push' && item.push.tokenHash === tokenHash);
    if (!monitor) return null;
    if (effective(monitor).paused) return { ok: true, paused: true };
    return monitoring.push(effective(monitor), signal, body ? redactor.text(body, 10240) : null);
  },
  intake({ tokenHash, records, address }) {
    const source = defs.sources.find(item => item.kind === 'https' && item.tokenHash === tokenHash);
    if (!source) return null;
    let accepted = 0;
    for (const record of records) {
      if (!record || typeof record !== 'object') continue;
      const stored = log({ ...record, source_type: 'ingest', source_id: source.id, scope: source.scope, resource: typeof record.resource === 'string' ? record.resource : source.resource || source.name, category: ['application', 'integration', 'infrastructure', 'monitoring'].includes(record.category) ? record.category : 'application', restricted: false, fields: { ...(record.fields ?? {}), sender: address } });
      if (stored) accepted++;
    }
    return { accepted, rejected: records.length - accepted };
  },
  async testChannel({ channel }) { return notifier.test(channel); },
  storage() {
    const usage = storage ? storage.usage() : null;
    return { health: studioHealth(), usage: usage ? { total: usage.total, main: usage.main, logs: usage.logs, audit: usage.audit, segments: usage.segments.length, oldest: usage.segments.find(segment => segment.first_ts)?.first_ts ?? null } : null, ingest: ingest?.stats() ?? null, emailReady: notifier.emailReady, unknownSyslogSenders: unknownSenders };
  },
  metrics(params) { return metrics.read(params); },
  metricList({ scopes }) { return { series: metrics.list(scopes) }; },
  async container({ id, scopes }) {
    const monitor = monitoring.byId(id);
    if (!monitor || monitor.type !== 'docker' || !visible(scopes, monitor.scope)) return null;
    const server = dockerServers[id];
    if (!server) return { monitor: monitorSummary(monitor), available: false, reason: `No Docker server called ${monitor.docker.server} in this dashboard's docker.yaml` };
    const result = await checkContainer(createDockerClient(server), monitor.docker);
    return { monitor: monitorSummary(monitor), available: !result.cls || result.cls !== 'permission', result, series: metrics.list([monitor.scope]).filter(series => series.resource === `container:${id}`) };
  },
  forgetUser({ userId, names = [] }) {
    db.run('UPDATE personal SET ip = NULL, username = NULL WHERE user_id = ?', userId);
    const wanted = [...new Set(names.filter(name => typeof name === 'string' && name.trim()).map(name => name.trim()))];
    if (!wanted.length) return { ok: true, changed: 0 };
    const marks = wanted.map(() => '?').join(', ');
    db.run(`UPDATE incident SET ack_by = ? WHERE ack_by IN (${marks})`, REMOVED_PERSON, ...wanted);
    db.run(`UPDATE incident_event SET text = ? WHERE kind = 'ack' AND actor IN (${marks})`, `${REMOVED_PERSON} is looking into it`, ...wanted);
    db.run(`UPDATE incident_event SET actor = ? WHERE actor IN (${marks})`, REMOVED_PERSON, ...wanted);
    ingest?.flush(); // events still queued are written first, then rewritten
    let changed = 0;
    if (storage) for (const stream of Object.values(storage.streams)) changed += stream.forgetNames(wanted, REMOVED_PERSON);
    return { ok: true, changed };
  },
  health: () => studioHealth(),
  // The engine ends once it has answered; the host restarts it unless stopping.
  async stop() { await shutdown(); setTimeout(() => process.exit(0), 50); return { ok: true }; },
};
function studioHealth() {
  return { status: health.storage === 'ok' && !health.syslog ? 'ok' : 'degraded', storage: health.storage, journal: health.journal, reason: health.reason, syslog: health.syslog ?? null, sqlite: health.sqlite, monitors: monitoring.monitors().length, running: monitoring.running, queue: ingest?.stats().queued ?? 0, dropped: ingest?.stats().dropped ?? droppedWithoutStorage };
}
const port = createPort(parentPort, handlers);

// ---- Loops ----
const loops = [];
const every = (ms, fn) => { const t = setInterval(() => { try { fn(); } catch {} }, ms); loops.push(t); };
monitoring.start();
ingest?.start();
every(15000, selfMetrics);
every(60000, hostMetrics);
every(60000, reminders);
every(60000, evaluateAlerts);
every(3600e3, retention);
setTimeout(retention, 60000).unref?.();
health.status = 'ok';
log({ source_type: 'studio', source_id: 'observability', category: 'application', severity: 6, event_type: 'observability.started', message: `Monitoring and logs started${health.storage === 'ok' ? '' : ' without history storage'}` });

let stopping = null;
async function shutdown() {
  stopping ??= (async () => {
    monitoring.stop();
    for (const t of loops) clearInterval(t);
    docker.close();
    if (syslog) await syslog.close().catch(() => {});
    try { ingest?.stop(); } catch {}
    try { queries?.close(); } catch {}
    try { storage ? storage.close() : db.close(); } catch {}
  })();
  return stopping;
}
