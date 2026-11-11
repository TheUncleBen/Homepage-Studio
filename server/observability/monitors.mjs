// The monitoring engine (plan 5.3-5.7): scheduling, the state machine,
// availability rollups, incidents and maintenance. Runs in the engine thread
// with the main database; check runners are injected so tests stay offline.
import { randomUUID } from 'node:crypto';
import { localDay } from './storage.mjs';

export const STATES = ['up', 'pending', 'down', 'maintenance', 'paused', 'unreachable', 'unknown'];
const HOUR = 3600e3;
const RESULT_DAYS = 7, HOUR_DAYS = 90, DAY_DAYS = 730;

function dayStart(ts) { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); }
const hourStart = ts => Math.floor(ts / HOUR) * HOUR;
const minutesOf = clock => { const [h, m] = clock.split(':').map(Number); return h * 60 + m; };

// Whether a maintenance window covers this moment (deployment time zone).
export function windowActive(window, ts) {
  if (window.kind === 'now' || window.kind === 'once') return ts >= window.start && ts < window.end;
  const d = new Date(ts);
  const minute = d.getHours() * 60 + d.getMinutes();
  const from = minutesOf(window.from), to = minutesOf(window.to);
  const day = d.getDay();
  const inside = from <= to ? minute >= from && minute < to : minute >= from || minute < to;
  if (!inside) return false;
  if (window.kind === 'daily') return true;
  // A window past midnight belongs to the day it started.
  const startedDay = from > to && minute < to ? (day + 6) % 7 : day;
  return window.days.includes(startedDay);
}

export function covers(window, monitor) {
  if (window.scope !== monitor.scope) return false;
  return window.monitors.includes(monitor.id) || window.tags.some(tag => monitor.tags?.includes(tag));
}

// Availability from rollup rows: up ÷ (up + down), excluding maintenance and
// unknown time (plan 5.5). null when nothing is known.
export function availability(rows) {
  let up = 0, down = 0;
  for (const row of rows) { up += row.up; down += row.down; }
  return up + down ? up / (up + down) : null;
}

export function createMonitoring({ db, definitions, runCheck, onEvent = () => {}, onTransition = () => {}, onResult = () => {}, now = () => Date.now(), concurrency = 16, perHost = 2 }) {
  const states = new Map(); // monitor id → state record
  const bound = new Map(); // dashboard id → monitors derived from its cards
  const running = new Map(); // monitor id → host
  const hostRunning = new Map();
  const due = new Map(); // monitor id → next run time
  const pushes = new Map(); // monitor id → { started }
  let timer = null, lastPrune = 0, overloadedAt = 0;

  for (const row of db.all('SELECT * FROM monitor_state')) states.set(row.monitor_id, { ...row, details: row.details ? JSON.parse(row.details) : null });

  const all = () => [...definitions().monitors, ...[...bound.values()].flat()];
  const byId = id => all().find(monitor => monitor.id === id);
  const targetHost = monitor => monitor.http?.url ? (() => { try { return new URL(monitor.http.url).hostname; } catch { return 'x'; } })() : monitor.tcp?.host ?? monitor.ping?.host ?? monitor.tls?.host ?? monitor.dns?.resolver ?? monitor.docker?.server ?? monitor.id;

  function persist(id, record) {
    db.run('INSERT OR REPLACE INTO monitor_state (monitor_id, scope, state, since, last_check, last_ms, last_code, last_class, last_message, failures, successes, cert_expires, incident_id, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, record.scope, record.state, record.since, record.last_check ?? null, record.last_ms ?? null, record.last_code ?? null, record.last_class ?? null, record.last_message ?? null, record.failures ?? 0, record.successes ?? 0, record.cert_expires ?? null, record.incident_id ?? null, record.details ? JSON.stringify(record.details) : null);
  }

  function rollup(monitorId, state, ms, seconds, ts) {
    const column = state === 'up' ? 'up' : state === 'down' ? 'down' : state === 'maintenance' ? 'maint' : state === 'pending' ? 'up' : 'unknown';
    const timed = Number.isFinite(ms) ? 1 : 0;
    for (const [table, start] of [['check_hour', hourStart(ts)], ['check_day', dayStart(ts)]]) {
      db.run(`INSERT INTO ${table} (monitor_id, start, ${column}, ms_sum, ms_n, ms_min, ms_max) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (monitor_id, start) DO UPDATE SET ${column} = ${column} + excluded.${column}, ms_sum = ms_sum + excluded.ms_sum, ms_n = ms_n + excluded.ms_n,
        ms_min = CASE WHEN excluded.ms_min IS NULL THEN ms_min WHEN ms_min IS NULL OR excluded.ms_min < ms_min THEN excluded.ms_min ELSE ms_min END,
        ms_max = CASE WHEN excluded.ms_max IS NULL THEN ms_max WHEN ms_max IS NULL OR excluded.ms_max > ms_max THEN excluded.ms_max ELSE ms_max END`,
      monitorId, start, seconds, timed ? ms : 0, timed, timed ? ms : null, timed ? ms : null);
    }
  }

  function inMaintenance(monitor, ts) {
    return definitions().maintenance.find(window => covers(window, monitor) && windowActive(window, ts)) ?? null;
  }

  function incidentEvent(incidentId, kind, text, actor = null, ts = now()) {
    const seq = (db.get('SELECT COUNT(*) AS n FROM incident_event WHERE incident_id = ? AND ts = ?', incidentId, ts)?.n ?? 0);
    db.run('INSERT INTO incident_event (incident_id, ts, seq, kind, text, actor) VALUES (?, ?, ?, ?, ?, ?)', incidentId, ts, seq, kind, text, actor);
  }

  function transition(monitor, record, next, result, ts) {
    const previous = record.state;
    record.state = next;
    record.since = ts;
    const words = { up: 'Up', down: 'Down', pending: 'Not answering, checking again', maintenance: 'In maintenance', paused: 'Paused', unreachable: 'Unreachable because its parent is down', unknown: 'No data' };
    let incident = null;
    if (next === 'down') {
      const id = randomUUID();
      db.run('INSERT INTO incident (id, monitor_id, scope, name, opened, cause, error_class) VALUES (?, ?, ?, ?, ?, ?, ?)', id, monitor.id, monitor.scope, monitor.name, ts, result?.message ?? null, result?.cls ?? null);
      incidentEvent(id, 'down', `Down · ${result?.message ?? 'no answer'}`, null, ts);
      record.incident_id = id;
      incident = { id, opened: ts };
    } else if (record.incident_id && next !== 'pending' && next !== 'unreachable') {
      db.run('UPDATE incident SET closed = ? WHERE id = ? AND closed IS NULL', ts, record.incident_id);
      incidentEvent(record.incident_id, next === 'up' ? 'up' : 'closed', next === 'up' ? 'Up again' : words[next], null, ts);
      incident = { id: record.incident_id, closed: ts };
      record.incident_id = null;
    }
    const severity = next === 'down' ? 3 : next === 'up' && previous === 'down' ? 5 : 6;
    onEvent({ source_type: 'monitor', source_id: monitor.id, scope: monitor.scope, resource: monitor.name, panel: monitor.panel ?? null, category: 'monitoring', severity, event_type: `monitor.${next}`, error_class: next === 'down' ? result?.cls ?? null : null, message: `${monitor.name}: ${words[next]}${next === 'down' && result?.message ? ` · ${result.message}` : ''}`, fields: { monitor: monitor.id, previous, ...(Number.isFinite(result?.ms) ? { ms: result.ms } : {}), ...(result?.code ? { code: result.code } : {}) }, correlation: record.incident_id ?? incident?.id ?? null });
    onTransition({ monitor, previous, state: next, result, incident });
  }

  // Applies one check result to a monitor (plan 5.3).
  function apply(monitor, result, ts = now()) {
    let record = states.get(monitor.id);
    if (!record) { record = { monitor_id: monitor.id, scope: monitor.scope, state: 'unknown', since: ts, failures: 0, successes: 0 }; states.set(monitor.id, record); }
    record.scope = monitor.scope;
    const elapsed = record.last_check ? Math.min(ts - record.last_check, monitor.interval * 2000) : monitor.interval * 1000;
    record.last_check = ts;
    record.last_ms = Number.isFinite(result.ms) ? result.ms : null;
    record.last_code = result.code ?? null;
    record.last_class = result.ok ? result.warning?.cls ?? null : result.cls ?? null;
    record.last_message = result.ok ? result.warning?.message ?? null : result.message ?? null;
    if (result.certExpires) record.cert_expires = result.certExpires;
    record.details = result.warning ? { warning: result.warning } : result.answer ? { answer: result.answer } : null;
    const window = inMaintenance(monitor, ts);
    let next = record.state;
    if (window) {
      next = 'maintenance';
      record.failures = 0; record.successes = 0;
    } else if (result.ok) {
      record.successes++; record.failures = 0;
      if (record.state !== 'up' && (record.successes >= monitor.successes || record.state === 'pending' || record.state === 'unknown' || record.state === 'maintenance' || record.state === 'paused')) next = 'up';
    } else {
      record.failures++; record.successes = 0;
      const parentDown = monitor.parent && ['down', 'unreachable'].includes(states.get(monitor.parent)?.state);
      if (record.failures >= monitor.failures) next = parentDown ? 'unreachable' : 'down';
      else if (record.state !== 'down' && record.state !== 'unreachable') next = 'pending';
    }
    db.transaction(() => {
      db.run('INSERT OR REPLACE INTO check_result (monitor_id, ts, state, ms, code, error_class, message) VALUES (?, ?, ?, ?, ?, ?, ?)', monitor.id, ts, window ? 'maintenance' : result.ok ? 'up' : 'down', record.last_ms, record.last_code, result.ok ? null : result.cls ?? null, result.ok ? null : (result.message ?? '').slice(0, 300));
      rollup(monitor.id, window ? 'maintenance' : result.ok ? 'up' : 'down', record.last_ms, Math.round(elapsed / 1000), ts);
      if (next !== record.state) transition(monitor, record, next, result, ts);
      persist(monitor.id, record);
    });
    // Next run: sooner while confirming a failure.
    due.set(monitor.id, ts + (record.state === 'pending' ? monitor.retryInterval : monitor.interval) * 1000);
    if (monitor.type !== 'group') refreshGroups(monitor, ts);
    // Every result, not only changes: response times, certificate warnings.
    try { onResult(monitor, result, ts); } catch (error) { onEvent({ source_type: 'studio', source_id: 'monitoring', category: 'application', severity: 4, event_type: 'monitor.result-failed', message: `Recording a result of ${monitor.name} failed: ${error.message}` }); }
    return record;
  }

  function refreshGroups(member, ts) {
    for (const group of definitions().monitors.filter(item => item.type === 'group' && item.group.members.includes(member.id))) evaluateGroup(group, ts);
  }
  function evaluateGroup(group, ts = now()) {
    const members = group.group.members.map(id => states.get(id)?.state ?? 'unknown');
    const downs = members.filter(state => state === 'down' || state === 'unreachable').length;
    const known = members.filter(state => !['unknown', 'paused'].includes(state)).length;
    if (!known) return;
    const isDown = group.group.mode === 'all' ? downs === members.length : downs > 0;
    const result = isDown ? { ok: false, cls: 'unreachable', message: `${downs} of ${members.length} down` } : { ok: true };
    const record = states.get(group.id);
    if (record?.state === (isDown ? 'down' : 'up')) return;
    apply({ ...group, failures: 1, successes: 1 }, result, ts);
  }

  async function run(monitor) {
    const host = targetHost(monitor);
    running.set(monitor.id, host);
    hostRunning.set(host, (hostRunning.get(host) ?? 0) + 1);
    try {
      const result = await runCheck(monitor);
      if (byId(monitor.id)) apply(byId(monitor.id), result);
    } catch (error) {
      if (byId(monitor.id)) apply(byId(monitor.id), { ok: false, cls: 'internal', message: 'Studio couldn\'t run the check' });
    } finally {
      running.delete(monitor.id);
      const left = (hostRunning.get(host) ?? 1) - 1;
      if (left <= 0) hostRunning.delete(host); else hostRunning.set(host, left);
    }
  }

  function tick() {
    const t = now();
    const monitors = all();
    const ids = new Set(monitors.map(monitor => monitor.id));
    for (const id of [...due.keys()]) if (!ids.has(id)) due.delete(id);
    let behind = 0;
    for (const monitor of monitors) {
      if (monitor.type === 'group') { if (!due.has(monitor.id) || due.get(monitor.id) <= t) { evaluateGroup(monitor, t); due.set(monitor.id, t + 30000); } continue; }
      const record = states.get(monitor.id);
      if (monitor.paused) {
        if (record?.state !== 'paused') { const r = record ?? { monitor_id: monitor.id, scope: monitor.scope, state: 'unknown', since: t, failures: 0, successes: 0 }; states.set(monitor.id, r); db.transaction(() => { transition(monitor, r, 'paused', null, t); persist(monitor.id, r); }); }
        continue;
      }
      if (monitor.type === 'push') { checkPush(monitor, t); continue; }
      // First run after start: spread over one interval (plan 5.3).
      if (!due.has(monitor.id)) { due.set(monitor.id, t + Math.floor(Math.random() * Math.min(monitor.interval * 1000, 30000))); continue; }
      if (due.get(monitor.id) > t || running.has(monitor.id)) continue;
      if (t - due.get(monitor.id) > monitor.interval * 1000) behind++;
      if (running.size >= concurrency) continue;
      const host = targetHost(monitor);
      if ((hostRunning.get(host) ?? 0) >= perHost) continue;
      due.set(monitor.id, t + monitor.interval * 1000);
      run(monitor);
    }
    if (behind && t - overloadedAt > 600000) {
      overloadedAt = t;
      onEvent({ source_type: 'studio', source_id: 'monitoring', category: 'monitoring', severity: 4, event_type: 'monitoring.overloaded', message: `Monitoring is behind: ${behind} checks are late. Lower the number of monitors or lengthen their intervals.` });
    }
    // Maintenance starts and ends change state even between checks.
    for (const monitor of monitors) {
      const record = states.get(monitor.id);
      if (!record || monitor.paused) continue;
      const active = inMaintenance(monitor, t);
      if (active && record.state !== 'maintenance') db.transaction(() => { transition(monitor, record, 'maintenance', null, t); persist(monitor.id, record); });
      if (!active && record.state === 'maintenance' && monitor.type !== 'push') due.set(monitor.id, Math.min(due.get(monitor.id) ?? t, t));
    }
    if (t - lastPrune > HOUR) { lastPrune = t; prune(t); }
  }

  function checkPush(monitor, t) {
    const record = states.get(monitor.id);
    const last = record?.last_check ?? monitor.created ?? t;
    const late = t - last > (monitor.push.period + monitor.push.grace) * 1000;
    if (late && record?.state !== 'down' && record?.state !== 'maintenance' && (due.get(monitor.id) ?? 0) <= t) {
      due.set(monitor.id, t + 60000);
      apply({ ...monitor, failures: 1 }, { ok: false, cls: 'timeout', message: `No ping for ${Math.round((t - last) / 60000)} minutes` }, t);
    }
  }

  // A push monitor's URL was called (plan 5.2): start, success, fail or an
  // exit status.
  function push(monitor, signal, body) {
    const t = now();
    if (signal === 'start') { pushes.set(monitor.id, { started: t }); return { ok: true }; }
    const started = pushes.get(monitor.id)?.started;
    pushes.delete(monitor.id);
    const ms = started ? t - started : undefined;
    // The push address sends up (the default) or down; ok and 0 mean up too.
    const ok = ['up', 'ok', '0'].includes(signal);
    const result = ok ? { ok: true, ms } : { ok: false, ms, cls: 'assertion', message: ['down', 'fail'].includes(signal) ? 'The job reported a failure' : `The job ended with status ${signal}` };
    apply({ ...monitor, failures: 1 }, result, t);
    if (body) onEvent({ source_type: 'monitor', source_id: monitor.id, scope: monitor.scope, resource: monitor.name, category: 'monitoring', severity: ok ? 6 : 3, event_type: ok ? 'push.ok' : 'push.failed', message: String(body).slice(0, 10240) });
    return { ok: true };
  }

  function prune(t) {
    db.run('DELETE FROM check_result WHERE ts < ?', t - RESULT_DAYS * 86400e3);
    db.run('DELETE FROM check_hour WHERE start < ?', t - HOUR_DAYS * 86400e3);
    db.run('DELETE FROM check_day WHERE start < ?', t - DAY_DAYS * 86400e3);
    db.run('DELETE FROM incident_event WHERE incident_id IN (SELECT id FROM incident WHERE closed IS NOT NULL AND closed < ?)', t - 400 * 86400e3);
    db.run('DELETE FROM incident WHERE closed IS NOT NULL AND closed < ?', t - 400 * 86400e3);
    // Monitors that no longer exist. A card's monitor comes from its
    // dashboard a few seconds after a start, so one whose dashboard hasn't
    // been read yet is kept (a restart or an update used to clear every
    // card's history); one unchecked for RESULT_DAYS has gone with its
    // dashboard.
    const ids = new Set(all().map(monitor => monitor.id));
    for (const row of db.all('SELECT monitor_id, scope, last_check FROM monitor_state')) {
      if (ids.has(row.monitor_id)) continue;
      const waiting = row.monitor_id.startsWith('card:') && !bound.has(row.scope) && (row.last_check ?? 0) > t - RESULT_DAYS * 86400e3;
      if (!waiting) forget(row.monitor_id);
    }
  }
  function forget(id) {
    states.delete(id); due.delete(id);
    db.transaction(() => {
      for (const table of ['monitor_state', 'check_result', 'check_hour', 'check_day']) db.run(`DELETE FROM ${table} WHERE monitor_id = ?`, id);
      db.run('UPDATE incident SET closed = ? WHERE monitor_id = ? AND closed IS NULL', now(), id);
    });
  }

  return {
    start(intervalMs = 1000) { timer ??= setInterval(tick, intervalMs); timer.unref?.(); },
    stop() { if (timer) clearInterval(timer); timer = null; },
    tick, apply, push, forget, evaluateGroup,
    // Cards' monitors for one dashboard, rebuilt from its configuration.
    setBound(dashboardId, monitors) {
      const before = new Map((bound.get(dashboardId) ?? []).map(monitor => [monitor.id, JSON.stringify(monitor)]));
      bound.set(dashboardId, monitors);
      const after = new Set(monitors.map(monitor => monitor.id));
      for (const id of before.keys()) if (!after.has(id)) forget(id);
      // A card whose check changed (its address, or its certificate check) is
      // checked now, so its dot doesn't show the old answer for a cycle.
      for (const monitor of monitors) if (before.has(monitor.id) && before.get(monitor.id) !== JSON.stringify(monitor)) due.set(monitor.id, now());
    },
    // Also its cards' rows kept from before a restart (not bound yet).
    dropDashboard(dashboardId) {
      for (const monitor of bound.get(dashboardId) ?? []) forget(monitor.id);
      for (const row of db.all("SELECT monitor_id FROM monitor_state WHERE scope = ? AND monitor_id LIKE 'card:%'", dashboardId)) forget(row.monitor_id);
      bound.delete(dashboardId);
    },
    monitors: all,
    byId,
    bound: dashboardId => bound.get(dashboardId) ?? [],
    state: id => states.get(id) ?? null,
    states: () => states,
    checkNow(id) { const monitor = byId(id); if (!monitor) return false; due.set(id, now()); return true; },
    runOnce: monitor => runCheck(monitor),
    get running() { return running.size; },
    // Daily availability bars and hourly response time for one monitor.
    history(id, { days = 90, hours = 24 } = {}) {
      const t = now();
      const daily = db.all('SELECT start, up, down, maint, unknown, ms_sum, ms_n FROM check_day WHERE monitor_id = ? AND start >= ? ORDER BY start', id, dayStart(t) - (days - 1) * 86400e3);
      const hourly = db.all('SELECT start, up, down, maint, unknown, ms_sum, ms_n, ms_min, ms_max FROM check_hour WHERE monitor_id = ? AND start >= ? ORDER BY start', id, hourStart(t) - (hours - 1) * HOUR);
      const recent = db.all('SELECT ts, state, ms, code, error_class, message FROM check_result WHERE monitor_id = ? AND ts >= ? ORDER BY ts', id, t - Math.min(hours, 48) * HOUR);
      // When checks began (to the hour), so a new monitor doesn't claim 90 days.
      const hourFirst = db.get('SELECT MIN(start) AS t FROM check_hour WHERE monitor_id = ?', id)?.t ?? null;
      const resultFirst = db.get('SELECT MIN(ts) AS t FROM check_result WHERE monitor_id = ?', id)?.t ?? null;
      const first = hourFirst !== null && resultFirst !== null && resultFirst - hourFirst < HOUR ? resultFirst : hourFirst ?? db.get('SELECT MIN(start) AS t FROM check_day WHERE monitor_id = ?', id)?.t ?? null;
      return { daily, hourly, recent, first, availability: { day: availability(hourly.filter(row => row.start >= t - 24 * HOUR)), week: availability(daily.filter(row => row.start >= dayStart(t) - 6 * 86400e3)), month: availability(daily.filter(row => row.start >= dayStart(t) - 29 * 86400e3)), quarter: availability(daily) } };
    },
    incidentEvent,
    localDay,
  };
}
