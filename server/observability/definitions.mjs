// What administrators set up for monitoring and logs (plan 10.2): monitors,
// maintenance windows, notification channels, saved views, log sources, log
// alerts and settings, in one atomic JSON file in the state volume. In-app
// backups include it. History lives in the database and can be lost without
// losing any of this.
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { join } from 'node:path';
import { SCOPE } from './model.mjs';
import { queryProblem } from './query.mjs';

export const DEFINITIONS_FILE = 'observability.json';
const MAX_FILE_BYTES = 4 * 1024 * 1024;
export const LIMITS = { monitors: 1000, maintenance: 200, channels: 50, views: 100, sources: 100, alerts: 20 };
export const MONITOR_TYPES = ['http', 'tcp', 'ping', 'dns', 'tls', 'push', 'docker', 'group'];
export const CHANNEL_TYPES = ['email', 'webhook', 'ntfy', 'gotify', 'discord', 'slack', 'teams', 'telegram', 'pushover', 'matrix', 'homeassistant', 'apprise'];
export const DNS_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'PTR', 'CAA', 'SOA'];
export const DEFAULT_SETTINGS = { logDays: 30, auditDays: 365, budgetMB: 2048, batchSeconds: 2, metricDays: 30, syslog: { enabled: false, port: 5514, udp: true, tcp: true } };

export class DefinitionError extends Error {
  constructor(message, code = 'INVALID_OBSERVABILITY_SETTING', status = 400) { super(message); this.code = code; this.status = status; }
}
const fail = (message, code) => { throw new DefinitionError(message, code); };

export const hashToken = token => createHash('sha256').update(String(token)).digest('hex');
export const newToken = () => randomBytes(24).toString('base64url');
const newId = () => randomUUID();

const text = (value, label, max = 120, { optional = false, empty } = {}) => {
  if ((value === undefined || value === null || value === '') && optional) return '';
  if (typeof value !== 'string' || !value.trim()) fail(empty ?? `Fill in ${label.toLowerCase()}.`);
  if (value.length > max) fail(`${label} can be up to ${max} characters.`);
  if (/[\u0000-\u001f\u007f]/.test(value)) fail(`${label} can’t contain line breaks or control characters.`);
  return value.trim();
};
const integer = (value, label, min, max, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) fail(`${label} must be a whole number from ${min} to ${max}.`);
  return n;
};
const bool = (value, fallback) => (typeof value === 'boolean' ? value : fallback);
const scopeOf = value => {
  if (typeof value !== 'string' || !SCOPE.test(value)) fail('Choose a dashboard, or Studio only.', 'INVALID_SCOPE');
  return value;
};
const host = (value, label = 'Host') => {
  const name = text(value, label, 253);
  if (!isIP(name) && !/^(?=.{1,253}$)(?:[A-Za-z0-9_](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9_](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9])?\.?$/.test(name)) fail(`${label} must be a host name or an IP address.`);
  if (name.startsWith('-')) fail(`${label} must be a host name or an IP address.`);
  return name;
};
const httpUrl = (value, label = 'Address') => {
  const raw = text(value, label, 2048);
  let url;
  try { url = new URL(raw); } catch { fail(`${label} must be a full http:// or https:// address.`); }
  if (!['http:', 'https:'].includes(url.protocol)) fail(`${label} must be a full http:// or https:// address.`);
  return url.href;
};
const tags = value => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 10) fail('Use up to 10 tags.');
  return [...new Set(value.map(tag => text(tag, 'A tag', 32)))];
};
const codeRanges = value => {
  const spec = text(value ?? '200-399', 'Accepted status codes', 80);
  for (const part of spec.split(',')) if (!/^\s*[1-5]\d\d(?:\s*-\s*[1-5]\d\d)?\s*$/.test(part)) fail('Accepted status codes look like 200-399 or 200,204,301.');
  return spec.replace(/\s+/g, '');
};

// Notifications for a monitor: which channels, and when.
function notifyOf(input, channels) {
  const value = input ?? {};
  const ids = Array.isArray(value.channels) ? value.channels : [];
  if (ids.length > 10 || ids.some(id => !channels.some(channel => channel.id === id))) fail('Choose notification channels that exist.');
  return { channels: [...new Set(ids)], down: bool(value.down, true), up: bool(value.up, true), certificate: bool(value.certificate, true), resendMinutes: integer(value.resendMinutes, 'Resend every', 0, 1440, 0) };
}

// A monitor from an administrator's form. Secrets (header values) are
// write-only: an empty value keeps the saved one.
export function cleanMonitor(input, { existing, channels, monitors }) {
  if (!input || typeof input !== 'object') fail('Send a monitor.');
  const type = existing?.type ?? input.type;
  if (!MONITOR_TYPES.includes(type)) fail('Choose a monitor type.');
  const interval = integer(input.interval, 'Check every', 20, 86400, existing?.interval ?? 60);
  const monitor = {
    id: existing?.id ?? newId(),
    name: text(input.name, 'Name', 80, { empty: 'Give the monitor a name.' }),
    scope: scopeOf(input.scope ?? existing?.scope),
    type,
    interval,
    timeout: integer(input.timeout, 'Timeout', 1, 120, existing?.timeout ?? Math.min(10, Math.floor(interval * 0.8))),
    failures: integer(input.failures, 'Failures before down', 1, 10, existing?.failures ?? 2),
    retryInterval: integer(input.retryInterval, 'Retry every', 5, 3600, existing?.retryInterval ?? 20),
    successes: integer(input.successes, 'Successes before up', 1, 10, existing?.successes ?? 1),
    paused: bool(input.paused, existing?.paused ?? false),
    tags: tags(input.tags ?? existing?.tags),
    parent: null,
    family: ['auto', '4', '6'].includes(String(input.family ?? existing?.family ?? 'auto')) ? String(input.family ?? existing?.family ?? 'auto') : 'auto',
    notify: notifyOf(input.notify ?? existing?.notify, channels),
    created: existing?.created ?? Date.now(),
  };
  if (monitor.timeout >= monitor.interval) monitor.timeout = Math.max(1, Math.floor(monitor.interval * 0.8));
  if (input.parent) {
    const parent = monitors.find(item => item.id === input.parent);
    if (!parent || parent.id === monitor.id || parent.scope !== monitor.scope) fail('A parent monitor must exist on the same dashboard.');
    monitor.parent = parent.id;
  }
  const settings = input[type] ?? {};
  const before = existing?.[type] ?? {};
  if (type === 'http') {
    const headers = Array.isArray(settings.headers) ? settings.headers : before.headers ?? [];
    if (headers.length > 10) fail('Use up to 10 headers.');
    monitor.http = {
      url: httpUrl(settings.url),
      method: ['GET', 'HEAD', 'POST'].includes(settings.method) ? settings.method : 'GET',
      accept: codeRanges(settings.accept),
      keyword: text(settings.keyword, 'Keyword', 200, { optional: true }),
      keywordAbsent: bool(settings.keywordAbsent, false),
      jsonPath: text(settings.jsonPath, 'JSON path', 200, { optional: true }),
      jsonExpect: text(settings.jsonExpect, 'Expected value', 200, { optional: true }),
      maxMs: integer(settings.maxMs, 'Slower than', 0, 120000, 0),
      verifyTls: bool(settings.verifyTls, true),
      followRedirects: bool(settings.followRedirects, true),
      body: settings.method === 'POST' ? text(settings.body, 'Body', 4096, { optional: true }) : '',
      headers: headers.map((header, index) => {
        const name = text(header?.name, 'Header name', 64);
        if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(name)) fail('Header names use letters, digits and dashes.');
        const kept = before.headers?.find(item => item.name.toLowerCase() === name.toLowerCase());
        const value = header?.value === undefined || header.value === '' ? kept?.value : text(header.value, 'Header value', 1024);
        if (value === undefined) fail(`Enter a value for the ${name} header.`);
        return { name, value };
      }),
    };
  } else if (type === 'tcp') monitor.tcp = { host: host(settings.host), port: integer(settings.port, 'Port', 1, 65535) };
  else if (type === 'ping') monitor.ping = { host: host(settings.host), count: integer(settings.count, 'Pings', 1, 5, 1) };
  else if (type === 'dns') {
    const recordType = String(settings.recordType ?? 'A').toUpperCase();
    if (!DNS_TYPES.includes(recordType)) fail('Choose a record type.');
    monitor.dns = { name: host(settings.name, 'Name'), recordType, resolver: settings.resolver ? host(settings.resolver, 'Resolver') : '', expect: text(settings.expect, 'Expected answer', 255, { optional: true }) };
  } else if (type === 'tls') monitor.tls = { host: host(settings.host), port: integer(settings.port, 'Port', 1, 65535, 443), warnDays: integer(settings.warnDays, 'Warn when', 1, 90, 14) };
  else if (type === 'push') monitor.push = { tokenHash: before.tokenHash ?? null, period: integer(settings.period, 'Expect a ping every', 60, 30 * 86400, before.period ?? 3600), grace: integer(settings.grace, 'Grace', 0, 86400, before.grace ?? 300) };
  else if (type === 'docker') monitor.docker = { server: text(settings.server, 'Docker server', 80), container: text(settings.container, 'Container or service', 128), collectLogs: bool(settings.collectLogs, false) };
  else if (type === 'group') {
    const members = Array.isArray(settings.members) ? settings.members : [];
    if (members.length > 100) fail('A group holds up to 100 monitors.');
    for (const id of members) {
      const member = monitors.find(item => item.id === id);
      if (!member || member.id === monitor.id || member.scope !== monitor.scope || member.type === 'group') fail('Group members must be other monitors on the same dashboard.');
    }
    monitor.group = { members: [...new Set(members)], mode: settings.mode === 'all' ? 'all' : 'any' };
  }
  return monitor;
}

const time = value => { if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) fail('Times look like 02:30.'); return value; };
export function cleanMaintenance(input, { existing, monitors, cards = [] }) {
  if (!input || typeof input !== 'object') fail('Send a maintenance window.');
  const kind = ['now', 'once', 'daily', 'weekly'].includes(input.kind) ? input.kind : fail('Choose when the maintenance happens.');
  const ids = Array.isArray(input.monitors) ? input.monitors : [];
  if (!ids.length && !(input.tags ?? []).length) fail('Choose the monitors or tags it covers.');
  const scope = scopeOf(input.scope ?? existing?.scope);
  // A card's monitor may be named too; one whose card has since gone stays
  // in the window harmlessly, so an edit keeps it.
  const known = id => [...monitors, ...cards].some(monitor => monitor.id === id && monitor.scope === scope) || (existing?.scope === scope && existing.monitors.includes(id));
  for (const id of ids) if (typeof id !== 'string' || !known(id)) fail('Choose monitors on the same dashboard.');
  const window = { id: existing?.id ?? newId(), name: text(input.name, 'Name', 80, { empty: 'Give the maintenance window a name.' }), scope, kind, monitors: [...new Set(ids)], tags: tags(input.tags) };
  if (kind === 'now') { window.start = Date.now(); window.end = window.start + integer(input.minutes, 'Minutes', 5, 7 * 1440, 60) * 60e3; }
  if (kind === 'once') {
    window.start = Number(input.start); window.end = Number(input.end);
    if (!Number.isFinite(window.start) || !Number.isFinite(window.end) || window.end <= window.start || window.end - window.start > 31 * 86400e3) fail('A one-off window needs a start before its end, at most 31 days long.');
  }
  if (kind === 'daily' || kind === 'weekly') {
    window.from = time(input.from); window.to = time(input.to);
    if (kind === 'weekly') {
      const days = Array.isArray(input.days) ? [...new Set(input.days.map(Number))] : [];
      if (!days.length || days.some(day => !Number.isInteger(day) || day < 0 || day > 6)) fail('Choose the days of the week.');
      window.days = days.sort();
    }
  }
  return window;
}

// Channel secrets (webhook URLs, tokens) are write-only like saved
// connection keys: the API never returns them.
export const CHANNEL_SECRET_FIELDS = ['url', 'token', 'secret', 'password'];
export function cleanChannel(input, { existing }) {
  if (!input || typeof input !== 'object') fail('Send a notification channel.');
  const type = existing?.type ?? input.type;
  if (!CHANNEL_TYPES.includes(type)) fail('Choose a channel type.');
  const keep = field => (input[field] === undefined || input[field] === '' ? existing?.[field] : input[field]);
  const channel = { id: existing?.id ?? newId(), name: text(input.name, 'Name', 80, { empty: 'Give the channel a name.' }), type };
  if (type === 'email') {
    const list = String(input.to ?? existing?.to ?? '').split(/[,;\s]+/).filter(Boolean);
    if (!list.length || list.length > 10 || list.some(address => !/^[^\s@<>()",;:]{1,64}@[^\s@<>()",;:]{1,253}$/.test(address))) fail('Enter up to 10 email addresses.');
    channel.to = list.join(', ');
    return channel;
  }
  const needsUrl = !['telegram', 'pushover'].includes(type);
  if (needsUrl) channel.url = httpUrl(keep('url'), 'Address');
  if (['gotify', 'telegram', 'pushover', 'matrix', 'ntfy'].includes(type)) {
    const token = keep('token');
    if (type !== 'ntfy' || token) channel.token = text(token, 'Token', 512);
  }
  if (type === 'webhook') { const secret = keep('secret'); if (secret) channel.secret = text(secret, 'Signing secret', 256); }
  if (type === 'telegram') channel.chat = text(input.chat ?? existing?.chat, 'Chat id', 64);
  if (type === 'pushover') channel.user = text(input.user ?? existing?.user, 'User key', 64);
  if (type === 'matrix') channel.room = text(input.room ?? existing?.room, 'Room id', 255);
  if (type === 'ntfy') channel.topicPriority = integer(input.topicPriority, 'Priority', 1, 5, existing?.topicPriority ?? 4);
  return channel;
}
export function publicChannel(channel) {
  const out = { ...channel };
  for (const field of CHANNEL_SECRET_FIELDS) if (field in out) { out[field] = undefined; out[`${field}Set`] = true; }
  return JSON.parse(JSON.stringify(out));
}
export function publicMonitor(monitor) {
  const out = structuredClone(monitor);
  if (out.http?.headers) out.http.headers = out.http.headers.map(header => ({ name: header.name, valueSet: true }));
  if (out.push) delete out.push.tokenHash;
  return out;
}

export function cleanView(input, { existing }) {
  if (!input || typeof input !== 'object') fail('Send a saved view.');
  return { id: existing?.id ?? newId(), name: text(input.name, 'Name', 80, { empty: 'Give the search a name.' }), query: text(input.query, 'Search', 1000, { optional: true }), range: ['15m', '1h', '6h', '24h', '7d', '14d', '30d'].includes(input.range) ? input.range : '1h' };
}

export function cleanSource(input, { existing }) {
  if (!input || typeof input !== 'object') fail('Send a log source.');
  const kind = existing?.kind ?? input.kind;
  if (!['https', 'syslog'].includes(kind)) fail('Choose HTTPS intake or syslog.');
  const source = { id: existing?.id ?? newId(), name: text(input.name, 'Name', 80, { empty: 'Give the source a name.' }), kind, scope: scopeOf(input.scope ?? existing?.scope), resource: text(input.resource ?? existing?.resource, 'Resource', 120, { optional: true }) };
  if (kind === 'https') source.tokenHash = existing?.tokenHash ?? null;
  if (kind === 'syslog') {
    const address = text(input.address ?? existing?.address, 'Sender address', 64);
    if (!isIP(address)) fail('The sender address must be an IP address.');
    source.address = address;
  }
  return source;
}

export function cleanAlert(input, { existing, channels }) {
  if (!input || typeof input !== 'object') fail('Send a log alert.');
  const ids = Array.isArray(input.channels) ? input.channels : [];
  const name = text(input.name, 'Name', 80, { empty: 'Give the alert a name.' });
  const query = text(input.query, 'Search', 1000);
  const problem = queryProblem(query);
  if (problem) fail(problem);
  if (!ids.length || ids.some(id => !channels.some(channel => channel.id === id))) fail('Choose at least one notification channel.');
  return { id: existing?.id ?? newId(), name, query, threshold: integer(input.threshold, 'At least', 1, 100000, 1), minutes: integer(input.minutes, 'Within', 1, 1440, 5), channels: [...new Set(ids)], quietMinutes: integer(input.quietMinutes, 'Then stay quiet for', 1, 1440, 30) };
}

export function cleanSettings(input, current) {
  const value = input ?? {};
  const syslog = value.syslog ?? {};
  return {
    logDays: integer(value.logDays, 'Keep logs for', 1, 365, current.logDays),
    auditDays: integer(value.auditDays, 'Keep sign-in and audit events for', 30, 3650, current.auditDays),
    budgetMB: integer(value.budgetMB, 'Disk budget', 100, 1024 * 1024, current.budgetMB),
    batchSeconds: integer(value.batchSeconds, 'Write every', 1, 30, current.batchSeconds),
    metricDays: integer(value.metricDays, 'Keep metrics for', 7, 365, current.metricDays),
    syslog: { enabled: bool(syslog.enabled, current.syslog.enabled), port: integer(syslog.port, 'Syslog port', 1024, 65535, current.syslog.port), udp: bool(syslog.udp, current.syslog.udp), tcp: bool(syslog.tcp, current.syslog.tcp) },
  };
}

const empty = () => ({ version: 1, settings: structuredClone(DEFAULT_SETTINGS), monitors: [], maintenance: [], channels: [], views: [], sources: [], alerts: [], overrides: {} });

export function createDefinitions({ stateRoot }) {
  const path = join(stateRoot, DEFINITIONS_FILE);
  let cache = null;
  let chain = Promise.resolve();
  async function load() {
    if (cache) return cache;
    let handle;
    try {
      handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new DefinitionError('The monitoring settings file is not usable.', 'OBSERVABILITY_SETTINGS_UNAVAILABLE', 503);
      const value = JSON.parse(await handle.readFile('utf8'));
      if (!value || value.version !== 1) throw new DefinitionError('The monitoring settings file is not usable.', 'OBSERVABILITY_SETTINGS_UNAVAILABLE', 503);
      const base = empty();
      cache = { ...base, ...value, settings: { ...base.settings, ...value.settings, syslog: { ...base.settings.syslog, ...value.settings?.syslog } } };
      for (const key of Object.keys(LIMITS)) if (!Array.isArray(cache[key])) cache[key] = [];
      if (!cache.overrides || typeof cache.overrides !== 'object' || Array.isArray(cache.overrides)) cache.overrides = {};
    } catch (error) {
      if (error.code === 'ENOENT') cache = empty();
      else if (error instanceof SyntaxError) throw new DefinitionError('The monitoring settings file is not usable.', 'OBSERVABILITY_SETTINGS_UNAVAILABLE', 503);
      else throw error;
    } finally { await handle?.close(); }
    return cache;
  }
  async function write(value) {
    const temp = join(stateRoot, `.observability-${randomUUID()}.tmp`);
    let handle;
    try {
      handle = await fs.open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      await handle.writeFile(JSON.stringify(value, null, 2) + '\n');
      await handle.sync(); await handle.close(); handle = null;
      await fs.rename(temp, path);
    } finally {
      await handle?.close();
      await fs.unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }
  return {
    path,
    read: async () => structuredClone(await load()),
    // Serialized read-modify-write. fn receives a draft and returns a result.
    mutate(fn) {
      const run = chain.then(async () => {
        const draft = structuredClone(await load());
        const result = await fn(draft);
        for (const [key, limit] of Object.entries(LIMITS)) if (draft[key].length > limit) throw new DefinitionError(`At most ${limit} ${key}.`, 'OBSERVABILITY_LIMIT');
        await write(draft);
        cache = draft;
        return result;
      });
      chain = run.catch(() => {});
      return run;
    },
    // After a restore or an outside change.
    reload() { cache = null; },
  };
}
