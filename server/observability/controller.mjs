// Monitoring, metrics and logs on the controller's side (observability plan,
// build addendum of 6 Nov 2026). It owns the engine and log-search workers,
// keeps the engine's definitions, secrets and certificates current, and
// answers /studio/api/ops/* for signed-in people, each seeing only the
// dashboards an administrator gave them Monitoring or Logs on.
import fs from 'node:fs/promises';
import { constants, openSync, fstatSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { createEngineHost, createQueryHost } from './host.mjs';
import { createDefinitions, cleanMonitor, cleanMaintenance, cleanChannel, cleanView, cleanSource, cleanAlert, cleanSettings, publicChannel, publicMonitor, hashToken, newToken, DefinitionError } from './definitions.mjs';
import { STUDIO_SCOPE, SCOPE, severityLabel } from './model.mjs';
import { CLASS_SENTENCES } from '../../homepage/src/utils/studio/error-classes.mjs';
import { resolveEnvironmentVariables } from '../../homepage/src/utils/config/environment.mjs';
import { loadYaml } from '../../homepage/src/utils/config/yaml-parser.mjs';
import { dashboardConfigDir } from '../dashboard-paths.mjs';

export const OBSERVABILITY_DIR = 'observability';
const RANGES = { '15m': 15 * 60e3, '1h': 3600e3, '6h': 6 * 3600e3, '24h': 86400e3, '7d': 7 * 86400e3, '14d': 14 * 86400e3, '30d': 30 * 86400e3 };
const EXPORT_MAX = 50000;
const CARD_INTERVAL = 30;

export class OpsError extends Error {
  constructor(message, code = 'OPS_ERROR', status = 400) { super(message); this.code = code; this.status = status; }
}
const notFound = () => new OpsError('That isn\'t available.', 'NOT_FOUND', 404);

// A bounded read of a HOMEPAGE_FILE_* secret, as the native loader does.
function readEnvironmentFile(file) {
  const descriptor = openSync(file, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('Invalid file reference');
    const bytes = Buffer.alloc(stat.size);
    let length = 0;
    while (length < bytes.length) { const count = readSync(descriptor, bytes, length, bytes.length - length, null); if (!count) break; length += count; }
    return bytes.subarray(0, length).toString('utf8');
  } finally { closeSync(descriptor); }
}

// One Docker server from a dashboard's own docker.yaml (owner decision D2:
// normally a read-only socket proxy). Read the way Homepage reads it.
export async function dockerServer(configDir, name) {
  let text;
  try { text = await fs.readFile(join(configDir, 'docker.yaml'), 'utf8'); } catch { return null; }
  if (text.length > 256 * 1024) return null;
  let servers;
  try { servers = loadYaml(resolveEnvironmentVariables(text, Object.entries(process.env), readEnvironmentFile, { maxBytes: 512 * 1024 })) ?? {}; } catch { return null; }
  const entry = servers?.[name];
  if (!entry || typeof entry !== 'object') return null;
  if (typeof entry.socket === 'string') return { socket: entry.socket };
  if (typeof entry.host !== 'string') return null;
  const server = { host: entry.host, ...(entry.port ? { port: Number(entry.port) } : {}), ...(entry.protocol ? { protocol: String(entry.protocol) } : {}), ...(entry.headers && typeof entry.headers === 'object' ? { headers: entry.headers } : {}) };
  if (entry.tls && typeof entry.tls === 'object') {
    try {
      for (const [key, field] of [['ca', 'caFile'], ['cert', 'certFile'], ['key', 'keyFile']]) if (entry.tls[field]) server[key] = await fs.readFile(join(configDir, String(entry.tls[field])), 'utf8');
      server.protocol = 'https';
    } catch { return null; }
  }
  return server;
}

// Secrets that must never appear in a stored log line, with the words that
// replace them (plan 7.4).
function secretValues(authConfig) {
  const out = new Map();
  const add = (value, label) => { if (typeof value === 'string' && value.length >= 6) out.set(value, label); };
  const walk = (value, path) => {
    if (!value || typeof value !== 'object' || Buffer.isBuffer(value)) return;
    for (const [key, inner] of Object.entries(value)) {
      if (typeof inner === 'string' && /secret|password|token|apikey|api_key/i.test(key)) add(inner, `${path}${key}`);
      else if (inner && typeof inner === 'object') walk(inner, `${path}${key}.`);
    }
  };
  walk(authConfig ?? {}, 'sign-in ');
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('HOMEPAGE_VAR_') || /^(STUDIO|HOMEPAGE)_.*(SECRET|PASSWORD|TOKEN|KEY)$/.test(key)) add(value, key);
  }
  return out;
}

// What a card's status dot shows, from its monitor: never the address or a
// raw error, only the plain sentence for its kind of failure.
function panelView(panel) {
  return { state: panel.state, ms: panel.ms, code: panel.code, since: panel.since, checked: panel.checked, text: panel.errorClass ? CLASS_SENTENCES[panel.errorClass] ?? null : null, warning: panel.warning ? 'Warning' : null };
}

// Worker log lines: "[time] level: <label> message", maybe coloured.
const LEVELS = { error: 3, warn: 4, warning: 4, info: 6, http: 6, verbose: 7, debug: 7, silly: 7 };
export function parseWorkerLine(raw, stream) {
  const line = String(raw).replace(/\u001b\[[0-9;]*m/g, '');
  if (/^\s+at\s/.test(line)) return null;
  const match = /^\[([^\]]+)\] (\w+): (?:<([^>]{1,64})> )?([\s\S]*)$/.exec(line);
  if (match) {
    const ts = Date.parse(match[1]);
    return { severity: LEVELS[match[2].toLowerCase()] ?? 6, ts: Number.isFinite(ts) ? ts : undefined, label: match[3] ?? null, message: match[4] };
  }
  return { severity: stream === 'stderr' ? 4 : 6, label: null, message: line };
}

export function createObservability({ stateRoot, configRoot, signIn, authConfig = null, smtp = null, siteName = () => 'Homepage Studio', publicOrigin = null, trusted = null, listDashboards, connectionsOf = async () => [], now = () => Date.now() }) {
  const dir = join(stateRoot, OBSERVABILITY_DIR);
  const definitions = createDefinitions({ stateRoot });
  const engineLog = event => console.error(`Monitoring and logs: ${event.message}`);
  const engine = createEngineHost({ dir, stateRoot, smtp, siteName: siteName(), publicOrigin, signIn, onLog: engineLog });
  const queries = createQueryHost({ dir, onLog: engineLog });
  let started = false;
  const cardTargets = new Map(); // dashboard id → monitors sent

  // ---- Keeping the engine current ----
  async function dashboardsList() {
    try { return (await listDashboards()).map(entry => ({ id: entry.id, name: entry.name, slug: entry.slug, archived: Boolean(entry.archived) })); } catch { return []; }
  }
  async function pushDefinitions() {
    const defs = await definitions.read();
    const dashboards = await dashboardsList();
    const docker = {};
    for (const monitor of defs.monitors.filter(item => item.type === 'docker')) {
      const configDir = monitor.scope === STUDIO_SCOPE ? null : dashboardConfigDir(configRoot, monitor.scope);
      const server = configDir ? await dockerServer(configDir, monitor.docker.server) : null;
      if (server) docker[monitor.id] = server;
    }
    await engine.set('definitions', { definitions: defs, dashboards, docker });
    for (const id of cardTargets.keys()) if (!dashboards.some(entry => entry.id === id)) { cardTargets.delete(id); engine.forget('bound:' + id); }
  }
  async function pushSecrets() {
    const list = secretValues(authConfig);
    const defs = await definitions.read();
    for (const channel of defs.channels) for (const field of ['url', 'token', 'secret', 'password']) if (channel[field]) list.set(channel[field], `${channel.name} ${field}`);
    for (const monitor of defs.monitors) for (const header of monitor.http?.headers ?? []) list.set(header.value, `${monitor.name} header`);
    for (const entry of await dashboardsList()) {
      for (const connection of await connectionsOf(entry).catch(() => [])) {
        for (const field of ['key', 'password']) if (connection.secrets?.[field]) list.set(connection.secrets[field], `${connection.name} ${field}`);
      }
    }
    await engine.set('secrets', { list: [...list.entries()].filter(([value]) => typeof value === 'string' && value.length >= 6) });
  }
  async function pushCa() {
    if (!trusted) return;
    try { const { ca } = await trusted.caOptions(); await engine.set('ca', { pem: ca }); } catch {}
  }
  async function refresh() { await Promise.all([pushDefinitions(), pushSecrets(), pushCa()]).catch(error => console.error('Monitoring and logs could not be updated:', error.code || error.message)); }

  // ---- Who sees what ----
  // Scopes for one person: null means all (administrators).
  function accessOf(current, dashboards) {
    if (!signIn || !current) return null;
    const admin = current.user.role === 'admin';
    const out = { admin, monitoring: admin ? null : [], logs: admin ? null : [], dashboards: [] };
    for (const entry of dashboards) {
      if (entry.archived && !admin) continue;
      const ops = admin ? { monitoring: true, logs: true } : current.operations(entry.id);
      if (!admin) { if (ops.monitoring) out.monitoring.push(entry.id); if (ops.logs) out.logs.push(entry.id); }
      if (ops.monitoring || ops.logs) out.dashboards.push({ id: entry.id, name: entry.name, monitoring: ops.monitoring, logs: ops.logs });
    }
    return out;
  }
  // A dashboard filter narrows the person's scopes, never widens them.
  function narrowed(scopes, wanted) {
    if (!wanted) return scopes;
    if (!SCOPE.test(wanted)) throw new OpsError('Choose a dashboard.', 'INVALID_SCOPE');
    if (scopes === null) return [wanted];
    if (!scopes.includes(wanted)) throw notFound();
    return [wanted];
  }
  const canSee = (scopes, scope) => scopes === null || scopes.includes(scope);

  // ---- Routes ----
  function rangeOf(query) {
    const to = Number(query.get('to')) || now();
    const span = RANGES[query.get('range')] ?? null;
    const from = Number(query.get('from')) || to - (span ?? 3600e3);
    if (!(from < to) || to - from > 400 * 86400e3) throw new OpsError('Choose a time range.', 'INVALID_RANGE');
    return { from, to };
  }
  function logParams(query, scopes, admin) {
    const q = String(query.get('q') ?? '').slice(0, 1000);
    return { query: q, ...rangeOf(query), scopes: narrowed(scopes, query.get('dashboard')), restricted: admin };
  }

  async function handleApi(req, res, path, { current, json, readBody, manifest }) {
    if (!signIn) return json(res, 404, { error: 'Operations needs Studio sign-in.', code: 'OPERATIONS_UNAVAILABLE' });
    const access = accessOf(current, manifest.dashboards);
    const admin = access.admin;
    if (!admin && !access.dashboards.length) return json(res, 403, { error: 'Your account does not have access to monitoring or logs.', code: 'FORBIDDEN' });
    const url = new URL(req.url, 'http://studio.invalid');
    const query = url.searchParams;
    const method = req.method === 'HEAD' ? 'GET' : req.method;
    const route = path.slice('/studio/api/ops/'.length);
    const actor = current.user.displayName || current.user.username;
    const needMonitoring = () => { if (!admin && !access.monitoring.length) throw new OpsError('Your account does not have access to monitoring.', 'FORBIDDEN', 403); };
    const needLogs = () => { if (!admin && !access.logs.length) throw new OpsError('Your account does not have access to logs.', 'FORBIDDEN', 403); };
    const needAdmin = ({ fresh = false } = {}) => {
      if (!admin) throw new OpsError('Only administrators can do this.', 'FORBIDDEN', 403);
      if (fresh && !current.fresh()) throw new OpsError('Confirm it’s you to continue.', 'REAUTH_REQUIRED', 401);
    };
    const answer = value => (value === null || value === undefined ? json(res, 404, { error: 'That isn\'t available.', code: 'NOT_FOUND' }) : json(res, 200, value));
    try {
      // What this person may see, for the page's menus and filters.
      if (route === 'access' && method === 'GET') {
        return json(res, 200, { admin, dashboards: access.dashboards, monitoring: admin || access.monitoring.length > 0, logs: admin || access.logs.length > 0, siteName: siteName() });
      }
      // ---- Monitoring ----
      if (route === 'overview' && method === 'GET') {
        needMonitoring();
        return json(res, 200, await engine.call('overview', { scopes: narrowed(access.monitoring, query.get('dashboard')), admin }));
      }
      if (route === 'monitors' && method === 'GET') {
        needMonitoring();
        const result = await engine.call('monitors', { scopes: narrowed(access.monitoring, query.get('dashboard')) });
        return json(res, 200, result);
      }
      let match = /^monitors\/([^/]+)(?:\/(check|history))?$/.exec(route);
      if (match) {
        needMonitoring();
        const id = decodeURIComponent(match[1]);
        if (match[2] === 'check' && method === 'POST') return answer(await engine.call('checkNow', { id, scopes: access.monitoring }));
        if (!match[2] && method === 'GET') {
          const result = await engine.call('monitor', { id, scopes: access.monitoring });
          if (result && admin) {
            const defs = await definitions.read();
            const saved = defs.monitors.find(item => item.id === id);
            if (saved) result.definition = publicMonitor(saved);
            result.override = defs.overrides?.[id] ?? null;
          }
          return answer(result);
        }
      }
      if (route === 'incidents' && method === 'GET') {
        needMonitoring();
        return json(res, 200, await engine.call('incidents', { scopes: narrowed(access.monitoring, query.get('dashboard')), open: query.get('open') === '1', limit: Math.min(500, Number(query.get('limit')) || 100) }));
      }
      match = /^incidents\/([0-9a-f-]{36})(?:\/(ack|note))?$/.exec(route);
      if (match) {
        needMonitoring();
        const id = match[1];
        if (!match[2] && method === 'GET') return answer(await engine.call('incident', { id, scopes: access.monitoring }));
        if (match[2] === 'ack' && method === 'POST') return answer(await engine.call('ack', { id, actor, scopes: access.monitoring }));
        if (match[2] === 'note' && method === 'POST') {
          const body = await readBody(req, 8 * 1024);
          const text = typeof body?.text === 'string' ? body.text.trim() : '';
          if (!text || text.length > 1000) throw new OpsError('Write a note of up to 1000 characters.');
          return answer(await engine.call('note', { id, actor, text, scopes: access.monitoring }));
        }
      }
      if (route === 'metrics' && method === 'GET') {
        needMonitoring();
        const scope = query.get('scope');
        if (!scope || !canSee(access.monitoring, scope)) throw notFound();
        return json(res, 200, await engine.call('metrics', { scope, resource: String(query.get('resource') ?? ''), name: String(query.get('name') ?? ''), range: query.get('range') ?? '24h' }));
      }
      if (route === 'metrics/list' && method === 'GET') {
        needMonitoring();
        return json(res, 200, await engine.call('metricList', { scopes: narrowed(access.monitoring, query.get('dashboard')) }));
      }
      match = /^containers\/([^/]+)$/.exec(route);
      if (match && method === 'GET') { needMonitoring(); return answer(await engine.call('container', { id: decodeURIComponent(match[1]), scopes: access.monitoring }, 20000)); }

      // ---- Logs ----
      if (route.startsWith('logs/') && method === 'GET') {
        needLogs();
        const kind = route.slice(5);
        if (kind === 'export') {
          // Export is for administrators only, with a recent sign-in.
          needAdmin({ fresh: true });
          return await exportLogs(res, logParams(query, null, true), query.get('format') === 'csv' ? 'csv' : 'ndjson');
        }
        const params = logParams(query, access.logs, admin);
        if (kind === 'search') {
          const before = /^(\d{1,15}):([0-9a-z]{8,40})$/.exec(String(query.get('before') ?? ''));
          const result = await queries.call('search', { ...params, limit: Math.min(500, Number(query.get('limit')) || 200), before: before ? { ts: Number(before[1]), id: before[2] } : null, budgetMs: 8000 }, 15000);
          return json(res, 200, result ?? { events: [], next: null, partial: false });
        }
        if (kind === 'facets') return json(res, 200, (await queries.call('facets', params, 15000)) ?? { total: 0, facets: {} });
        if (kind === 'histogram') return json(res, 200, (await queries.call('histogram', { ...params, buckets: 60 }, 15000)) ?? { bars: [] });
        if (kind === 'groups') return json(res, 200, (await queries.call('groups', params, 15000)) ?? { groups: [] });
        if (kind === 'context') {
          const seq = Number(query.get('seq'));
          const stream = query.get('stream');
          if (!['logs', 'audit'].includes(stream) || !Number.isInteger(seq)) throw new OpsError('Choose an event.');
          if (stream === 'audit' && !admin) throw notFound();
          return answer(await queries.call('context', { id: String(query.get('id') ?? '').slice(0, 40), stream, seq, scopes: access.logs, restricted: admin }, 15000));
        }
      }
      if (route === 'views' && method === 'GET') { needLogs(); return json(res, 200, { views: (await definitions.read()).views }); }

      // ---- Settings (Administration › Monitoring and logs) ----
      if (route === 'config' && method === 'GET') {
        needAdmin();
        const defs = await definitions.read();
        let storage = null;
        try { storage = await engine.call('storage'); } catch {}
        return json(res, 200, {
          monitors: defs.monitors.map(publicMonitor), maintenance: defs.maintenance, channels: defs.channels.map(publicChannel), views: defs.views,
          sources: defs.sources.map(({ tokenHash, ...source }) => ({ ...source, tokenSet: Boolean(tokenHash) })), alerts: defs.alerts, settings: defs.settings, overrides: defs.overrides,
          storage, dashboards: access.dashboards.map(({ id, name }) => ({ id, name })),
        });
      }
      if (route === 'config' && method === 'POST') {
        needAdmin();
        const body = await readBody(req, 64 * 1024);
        return json(res, 200, await changeConfig(body, current));
      }
      if (route === 'test' && method === 'POST') {
        needAdmin();
        const body = await readBody(req, 64 * 1024);
        const defs = await definitions.read();
        const existing = body?.id ? defs.monitors.find(item => item.id === body.id) : null;
        const monitor = cleanMonitor({ ...(body?.monitor ?? {}), scope: body?.monitor?.scope ?? existing?.scope }, { existing, channels: defs.channels, monitors: defs.monitors });
        if (monitor.type === 'push' || monitor.type === 'group') throw new OpsError('Push and group monitors can\'t be tested from here.');
        if (monitor.type === 'docker') {
          const server = monitor.scope === STUDIO_SCOPE ? null : await dockerServer(dashboardConfigDir(configRoot, monitor.scope), monitor.docker.server);
          if (!server) return json(res, 200, { ok: false, cls: 'not-found', message: `No Docker server called ${monitor.docker.server} in this dashboard's docker.yaml` });
        }
        const result = await engine.call('test', { monitor }, 40000);
        return json(res, 200, { ok: result.ok, ms: result.ms ?? null, code: result.code ?? null, cls: result.cls ?? null, message: result.ok ? null : result.message ?? CLASS_SENTENCES[result.cls] ?? null, warning: result.warning?.message ?? null });
      }
      if (route === 'channels/test' && method === 'POST') {
        needAdmin();
        const body = await readBody(req, 4 * 1024);
        const channel = (await definitions.read()).channels.find(item => item.id === body?.id);
        if (!channel) throw notFound();
        return json(res, 200, await engine.call('testChannel', { channel }, 30000));
      }
      return json(res, 404, { error: 'This Operations endpoint does not exist.', code: 'NOT_FOUND' });
    } catch (error) {
      if (error instanceof OpsError || error instanceof DefinitionError || error.status) return json(res, error.status || 400, { error: error.message, code: error.code });
      throw error;
    }
  }

  const KINDS = {
    monitor: { list: 'monitors', clean: (input, ctx) => cleanMonitor(input, ctx), publish: publicMonitor },
    maintenance: { list: 'maintenance', clean: (input, ctx) => cleanMaintenance(input, ctx), publish: item => item },
    channel: { list: 'channels', clean: (input, ctx) => cleanChannel(input, ctx), publish: publicChannel, fresh: true },
    view: { list: 'views', clean: (input, ctx) => cleanView(input, ctx), publish: item => item },
    source: { list: 'sources', clean: (input, ctx) => cleanSource(input, ctx), publish: ({ tokenHash, ...item }) => ({ ...item, tokenSet: Boolean(tokenHash) }), fresh: true },
    alert: { list: 'alerts', clean: (input, ctx) => cleanAlert(input, ctx), publish: item => item },
  };
  async function changeConfig(body, current) {
    if (!body || typeof body !== 'object') throw new OpsError('Send a change.');
    const { kind, action } = body;
    if (kind === 'settings') {
      if (!current.fresh()) throw new OpsError('Confirm it’s you to continue.', 'REAUTH_REQUIRED', 401);
      const settings = await definitions.mutate(draft => { draft.settings = cleanSettings(body.settings, draft.settings); return draft.settings; });
      await audit(current, 'settings', 'changed', 'Monitoring and logs settings');
      await refresh();
      return { settings };
    }
    // A card monitor's notifications or pause (the card itself sets its check).
    if (kind === 'override') {
      const id = String(body.id ?? '');
      if (!/^card:/.test(id)) throw new OpsError('Choose a card monitor.');
      const override = await definitions.mutate(draft => {
        const channels = Array.isArray(body.notify?.channels) ? body.notify.channels : [];
        if (channels.length > 10 || channels.some(channelId => !draft.channels.some(channel => channel.id === channelId))) throw new OpsError('Choose notification channels that exist.');
        const value = { paused: body.paused === true, notify: { channels: [...new Set(channels)], down: body.notify?.down !== false, up: body.notify?.up !== false, certificate: body.notify?.certificate !== false, resendMinutes: Math.max(0, Math.min(1440, Number(body.notify?.resendMinutes) || 0)) } };
        if (!value.paused && !value.notify.channels.length) delete draft.overrides[id]; else draft.overrides[id] = value;
        return draft.overrides[id] ?? null;
      });
      await refresh();
      return { override };
    }
    const spec = KINDS[kind];
    if (!spec) throw new OpsError('Choose what to change.');
    if (spec.fresh && !current.fresh()) throw new OpsError('Confirm it’s you to continue.', 'REAUTH_REQUIRED', 401);
    let token = null;
    const known = new Set([STUDIO_SCOPE, ...(await dashboardsList()).map(entry => entry.id)]);
    const result = await definitions.mutate(draft => {
      const list = draft[spec.list];
      const index = body.id ? list.findIndex(item => item.id === body.id) : -1;
      const existing = index >= 0 ? list[index] : null;
      if (body.id && !existing) throw notFound();
      if (action === 'delete') {
        list.splice(index, 1);
        if (kind === 'channel') {
          for (const monitor of draft.monitors) monitor.notify.channels = monitor.notify.channels.filter(id => id !== existing.id);
          for (const alert of draft.alerts) alert.channels = alert.channels.filter(id => id !== existing.id);
          draft.alerts = draft.alerts.filter(alert => alert.channels.length);
          for (const override of Object.values(draft.overrides)) override.notify.channels = override.notify.channels.filter(id => id !== existing.id);
        }
        if (kind === 'monitor') {
          for (const monitor of draft.monitors) {
            if (monitor.parent === existing.id) monitor.parent = null;
            if (monitor.group) monitor.group.members = monitor.group.members.filter(id => id !== existing.id);
          }
          for (const window of draft.maintenance) window.monitors = window.monitors.filter(id => id !== existing.id);
        }
        return { removed: existing.id };
      }
      if (action === 'pause' || action === 'resume') {
        if (kind !== 'monitor' || !existing) throw new OpsError('Choose a monitor.');
        existing.paused = action === 'pause';
        return { item: spec.publish(existing) };
      }
      if (action === 'token') {
        // A new push or intake token; shown once.
        if (!existing || !((kind === 'monitor' && existing.type === 'push') || (kind === 'source' && existing.kind === 'https'))) throw new OpsError('Only push monitors and HTTPS log sources have a token.');
        token = newToken();
        if (kind === 'monitor') existing.push.tokenHash = hashToken(token); else existing.tokenHash = hashToken(token);
        return { item: spec.publish(existing) };
      }
      if (action !== 'save') throw new OpsError('Choose save, delete, pause, resume or token.');
      const item = spec.clean(body.item, { existing, channels: draft.channels, monitors: draft.monitors });
      if (item.scope && !known.has(item.scope)) throw new OpsError('Choose a dashboard that exists, or Studio only.', 'INVALID_SCOPE');
      // A new push monitor or intake source gets its token now.
      if (!existing && ((kind === 'monitor' && item.type === 'push') || (kind === 'source' && item.kind === 'https'))) {
        token = newToken();
        if (kind === 'monitor') item.push.tokenHash = hashToken(token); else item.tokenHash = hashToken(token);
      }
      if (existing) list[index] = item; else list.push(item);
      return { item: spec.publish(item) };
    });
    await audit(current, kind, action, result.item?.name ?? body.item?.name ?? result.removed);
    await refresh();
    return { ...result, ...(token ? { token } : {}) };
  }
  async function audit(current, kind, action, name) {
    engine.cast('log', { source_type: 'config', source_id: 'operations', category: 'audit', severity: 5, event_type: `ops.${kind}.${action}`, actor: current.user.username, message: `${current.user.username} ${action === 'save' ? 'saved' : action === 'delete' ? 'deleted' : action === 'token' ? 'made a new token for' : action === 'changed' ? 'changed' : action + 'd'} ${kind} ${name ?? ''}`.trim(), fields: { user_id: current.user.id, ip: current.ip } });
  }

  async function exportLogs(res, params, format) {
    res.writeHead(200, { 'content-type': format === 'csv' ? 'text/csv; charset=utf-8' : 'application/x-ndjson; charset=utf-8', 'content-disposition': `attachment; filename="studio-logs-${new Date(params.to).toISOString().slice(0, 10)}.${format === 'csv' ? 'csv' : 'ndjson'}"`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    const cell = value => { const text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value); return /[",\n\r]|^[=+\-@\t]/.test(text) ? `"${(/^[=+\-@\t]/.test(text) ? "'" : '') + text.replace(/"/g, '""')}"` : text; };
    if (format === 'csv') res.write('time,severity,dashboard,source,resource,type,class,message,actor,fields\n');
    let before = null, sent = 0;
    while (sent < EXPORT_MAX) {
      const page = await queries.call('search', { ...params, limit: 500, before, budgetMs: 20000 }, 30000);
      if (!page?.events?.length) break;
      for (const event of page.events) {
        if (format === 'csv') res.write([new Date(event.ts).toISOString(), severityLabel(event.severity), event.scope, event.source_type, event.resource, event.event_type, event.error_class, event.message, event.actor, event.fields].map(cell).join(',') + '\n');
        else res.write(JSON.stringify(event) + '\n');
      }
      sent += page.events.length;
      if (!page.next) break;
      before = page.next;
    }
    res.end();
  }

  // ---- Public endpoints: push heartbeats and HTTPS log intake ----
  const intakeHits = new Map();
  async function handlePublic(req, res, path, { json, readBody, clientIp }) {
    const push = /^\/studio\/push\/([A-Za-z0-9_-]{16,64})$/.exec(path);
    if (push) {
      if (!['GET', 'POST', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'Use GET or POST.' });
      const url = new URL(req.url, 'http://studio.invalid');
      const signal = ['up', 'down'].includes(url.searchParams.get('status')) ? url.searchParams.get('status') : 'up';
      let body = url.searchParams.get('msg')?.slice(0, 1000) ?? null;
      if (req.method === 'POST') { try { const value = await readBody(req, 16 * 1024); if (typeof value?.msg === 'string') body = value.msg.slice(0, 1000); } catch {} }
      let result = null;
      try { result = await engine.call('push', { tokenHash: hashToken(push[1]), signal, body }, 5000); } catch { return json(res, 503, { ok: false, error: 'Studio is starting. Try again.' }); }
      // An unknown token looks the same as a wrong address.
      if (!result) return json(res, 404, { ok: false, error: 'Not found.' });
      return json(res, 200, { ok: true });
    }
    if (path === '/studio/ingest/logs') {
      if (!signIn) return json(res, 404, { error: 'Log intake needs Studio sign-in.', code: 'INTAKE_UNAVAILABLE' });
      if (req.method !== 'POST') return json(res, 405, { error: 'Use POST.' });
      const header = String(req.headers.authorization ?? '');
      const token = /^Bearer ([A-Za-z0-9_-]{16,64})$/.exec(header)?.[1];
      if (!token) return json(res, 401, { error: 'Send the source\'s token as a Bearer token.', code: 'TOKEN_REQUIRED' });
      const address = clientIp(req);
      // About 60 requests a minute per sender (plan 7.3).
      const t = now();
      const hits = (intakeHits.get(address) ?? []).filter(at => t - at < 60000);
      if (hits.length >= 60) { res.setHeader('retry-after', '30'); return json(res, 429, { error: 'Too many requests. Send in batches.', code: 'RATE_LIMITED' }); }
      hits.push(t); intakeHits.set(address, hits);
      if (intakeHits.size > 5000) intakeHits.clear();
      let body;
      try { body = await readBody(req, 1024 * 1024); } catch (error) { return json(res, error.status === 413 ? 413 : 400, { error: 'Send JSON: one event, or {"events": [...]} of up to 1000.', code: 'INVALID_BODY' }); }
      const records = Array.isArray(body?.events) ? body.events : Array.isArray(body) ? body : body && typeof body === 'object' ? [body] : [];
      if (!records.length || records.length > 1000) return json(res, 400, { error: 'Send one event, or {"events": [...]} of up to 1000.', code: 'INVALID_BODY' });
      const result = await engine.call('intake', { tokenHash: hashToken(token), records: records.map(cleanIntakeRecord), address }, 10000).catch(() => undefined);
      if (result === undefined) return json(res, 503, { error: 'Studio is starting. Try again.' });
      if (!result) return json(res, 401, { error: 'That token isn\'t known.', code: 'TOKEN_UNKNOWN' });
      return json(res, 202, result);
    }
    return false;
  }
  function cleanIntakeRecord(record) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
    const out = {};
    if (typeof record.message === 'string') out.message = record.message.slice(0, 8192); else if (typeof record.msg === 'string') out.message = record.msg.slice(0, 8192);
    if (!out.message) return null;
    const severity = typeof record.severity === 'number' ? record.severity : typeof record.level === 'string' ? { critical: 2, error: 3, warn: 4, warning: 4, notice: 5, info: 6, debug: 7 }[record.level.toLowerCase()] : undefined;
    if (Number.isInteger(severity) && severity >= 0 && severity <= 7) out.severity = severity;
    const ts = typeof record.ts === 'number' ? record.ts : typeof record.time === 'string' || typeof record.timestamp === 'string' ? Date.parse(record.time ?? record.timestamp) : undefined;
    if (Number.isFinite(ts)) out.ts = ts;
    for (const key of ['resource', 'event_type', 'category']) if (typeof record[key] === 'string') out[key] = record[key].slice(0, 120);
    if (record.fields && typeof record.fields === 'object' && !Array.isArray(record.fields)) out.fields = record.fields;
    return out;
  }

  // ---- Card monitors (D6) ----
  // targets: [{ panel, check: 'web'|'ping', url|host, name }] from the
  // dashboard's renderer. Their status is checked by the engine.
  async function syncCards(dashboard, targets) {
    const monitors = targets.map(target => ({
      id: `card:${dashboard.id}:${target.panel}`, name: target.name || 'Card', scope: dashboard.id, card: true, panel: target.panel,
      type: target.check === 'ping' ? 'ping' : 'http', interval: CARD_INTERVAL, timeout: 10, failures: 1, retryInterval: CARD_INTERVAL, successes: 1, paused: false, tags: [], family: 'auto', parent: null,
      notify: { channels: [], down: true, up: true, certificate: true, resendMinutes: 0 },
      ...(target.check === 'ping' ? { ping: { host: target.host, count: 1 } } : { http: { url: target.url, card: true } }),
    }));
    const key = JSON.stringify(monitors);
    if (cardTargets.get(dashboard.id) === key) return;
    cardTargets.set(dashboard.id, key);
    await engine.set('bound', { dashboardId: dashboard.id, monitors }, 'bound:' + dashboard.id);
  }
  async function panelStatus(dashboardId) {
    try {
      const { panels } = await engine.call('panelStatus', { dashboardId }, 3000);
      return Object.fromEntries(Object.entries(panels).map(([id, panel]) => [id, panelView(panel)]));
    } catch { return null; }
  }

  // ---- Studio's own events ----
  function log(event) { if (started) engine.cast('log', event); }
  const consoleOriginals = {};
  function captureConsole() {
    for (const [name, severity] of [['error', 3], ['warn', 4], ['log', 6], ['info', 6]]) {
      const original = console[name].bind(console);
      consoleOriginals[name] = original;
      console[name] = (...args) => {
        original(...args);
        // Sign-in audit lines reach the logs as their own restricted events.
        if (args[0] === 'studio-auth') return;
        const message = args.map(arg => (arg instanceof Error ? arg.message : typeof arg === 'string' ? arg : (() => { try { return JSON.stringify(arg); } catch { return String(arg); } })())).join(' ');
        log({ source_type: 'studio', source_id: 'controller', category: 'application', severity, event_type: 'studio.log', message });
      };
    }
  }
  function workerOutput(dashboardId, stream, line) {
    const parsed = parseWorkerLine(line, stream);
    if (!parsed) return;
    log({ source_type: 'renderer', source_id: dashboardId, scope: SCOPE.test(dashboardId) ? dashboardId : STUDIO_SCOPE, category: /proxy|widget|service/i.test(parsed.label ?? '') ? 'integration' : 'application', severity: parsed.severity, ts: parsed.ts, resource: parsed.label ?? undefined, event_type: parsed.label ? `renderer.${parsed.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}` : 'renderer.log', message: parsed.message });
  }
  function auditEvent(event, user) {
    const { type, ip, userId, by, ...rest } = event;
    const security = /sign-in|signed-in|signed-out|reauth|recovery|session|password|link|setup|enrolled|logout/.test(type);
    log({ source_type: 'audit', source_id: 'sign-in', category: security ? 'security' : 'audit', severity: /failed/.test(type) ? 4 : 5, event_type: `auth.${type}`, actor: user?.username ?? null, message: `${user?.username ?? 'Someone'}: ${type.replace(/-/g, ' ')}`, fields: { ...rest, ...(ip ? { ip } : {}), ...(userId || by ? { user_id: userId ?? by } : {}), ...(user?.username ? { username: user.username } : {}) } });
  }

  return {
    async start() {
      started = true;
      engine.start();
      queries.start();
      await refresh();
    },
    refresh,
    refreshCertificates: pushCa,
    handleApi,
    handlePublic,
    syncCards,
    panelStatus,
    accessOf,
    log,
    captureConsole,
    workerOutput,
    auditEvent,
    async forgetDashboard(id) { cardTargets.delete(id); engine.forget('bound:' + id); try { await engine.call('dropDashboard', { id }); } catch {} await pushDefinitions().catch(() => {}); },
    // A removed person's name and address leave the logs' personal details.
    async forgetUser(userId) { try { await engine.call('forgetUser', { userId }, 10000); } catch {} },
    async health() { try { return await engine.call('health', null, 2000); } catch { return { status: 'unavailable' }; } },
    async stop() {
      for (const [name, original] of Object.entries(consoleOriginals)) console[name] = original;
      started = false;
      await Promise.all([engine.stop(), queries.stop()]);
    },
  };
}
