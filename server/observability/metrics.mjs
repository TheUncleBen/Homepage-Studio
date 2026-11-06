// Numeric series (plan 6): Studio's own health, its host, containers and
// monitors' response times. Every series belongs to one scope, so a
// dashboard's numbers are never visible through another dashboard.
import fs from 'node:fs';
import os from 'node:os';

const FINE_MS = 48 * 3600e3;
const STEP = 15 * 60e3;
export const SERIES_CAP = 5000;
const NAME = /^[a-z0-9_.-]{1,64}$/;
export const METRIC_RANGES = { '1h': 3600e3, '6h': 6 * 3600e3, '24h': 86400e3, '7d': 7 * 86400e3, '30d': 30 * 86400e3, '90d': 90 * 86400e3 };

export function createMetrics({ db, now = () => Date.now(), onEvent = () => {} }) {
  const ids = new Map();
  let capWarned = 0;
  function seriesId(scope, resource, name, meta = {}) {
    const key = `${scope}\u0000${resource}\u0000${name}`;
    if (ids.has(key)) return ids.get(key);
    let row = db.get('SELECT id FROM metric_series WHERE scope = ? AND resource = ? AND name = ?', scope, resource, name);
    if (!row) {
      if (db.get('SELECT COUNT(*) AS n FROM metric_series').n >= SERIES_CAP) {
        if (now() - capWarned > 3600e3) { capWarned = now(); onEvent({ source_type: 'metrics', category: 'application', severity: 4, event_type: 'metrics.cap', message: `The limit of ${SERIES_CAP} metric series was reached; new series aren't kept.` }); }
        return null;
      }
      db.run('INSERT INTO metric_series (scope, resource, name, label, unit, format, created, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', scope, resource, name, meta.label ?? name, meta.unit ?? null, meta.format ?? null, now(), now());
      row = db.get('SELECT id FROM metric_series WHERE scope = ? AND resource = ? AND name = ?', scope, resource, name);
    }
    ids.set(key, row.id);
    return row.id;
  }
  function record(scope, resource, name, value, meta = {}, ts = now()) {
    if (!Number.isFinite(value) || !NAME.test(name)) return;
    const id = seriesId(scope, String(resource).slice(0, 120), name, meta);
    if (id === null) return;
    const step = Math.floor(ts / STEP) * STEP;
    db.run('INSERT OR REPLACE INTO metric_point (series_id, ts, value) VALUES (?, ?, ?)', id, ts, value);
    db.run(`INSERT INTO metric_15m (series_id, ts, min, max, sum, count, last) VALUES (?, ?, ?, ?, ?, 1, ?)
      ON CONFLICT (series_id, ts) DO UPDATE SET min = MIN(min, excluded.min), max = MAX(max, excluded.max), sum = sum + excluded.sum, count = count + 1, last = excluded.last`, id, step, value, value, value, value);
    db.run('UPDATE metric_series SET last_seen = ? WHERE id = ?', ts, id);
  }
  return {
    record,
    // Points for a range, from the finest table that covers it, at most about
    // 300 points; gaps stay gaps (plan 6.5).
    read({ scope, resource, name, range = '24h' }) {
      const span = METRIC_RANGES[range];
      if (!span) throw Object.assign(new Error('Choose a range.'), { status: 400, code: 'INVALID_RANGE' });
      const series = db.get('SELECT * FROM metric_series WHERE scope = ? AND resource = ? AND name = ?', scope, resource, name);
      if (!series) return { series: null, points: [] };
      const from = now() - span;
      let points;
      if (span <= FINE_MS) {
        points = db.all('SELECT ts, value FROM metric_point WHERE series_id = ? AND ts >= ? ORDER BY ts', series.id, from).map(row => [row.ts, row.value]);
        const every = Math.ceil(points.length / 300);
        if (every > 1) points = points.filter((_, index) => index % every === 0 || index === points.length - 1);
      } else {
        points = db.all('SELECT ts, sum * 1.0 / count AS avg, min, max FROM metric_15m WHERE series_id = ? AND ts >= ? ORDER BY ts', series.id, from).map(row => [row.ts, row.avg, row.min, row.max]);
        const every = Math.ceil(points.length / 300);
        if (every > 1) points = points.filter((_, index) => index % every === 0 || index === points.length - 1);
      }
      const latest = db.get('SELECT ts, value FROM metric_point WHERE series_id = ? ORDER BY ts DESC LIMIT 1', series.id);
      return { series: { scope: series.scope, resource: series.resource, name: series.name, label: series.label, unit: series.unit, format: series.format, lastSeen: series.last_seen }, points, latest: latest ? [latest.ts, latest.value] : null };
    },
    list(scopes) {
      const rows = db.all('SELECT scope, resource, name, label, unit, format, last_seen FROM metric_series ORDER BY scope, resource, name');
      return Array.isArray(scopes) ? rows.filter(row => scopes.includes(row.scope)) : rows;
    },
    prune(days) {
      const t = now();
      db.run('DELETE FROM metric_point WHERE ts < ?', t - FINE_MS);
      db.run('DELETE FROM metric_15m WHERE ts < ?', t - days * 86400e3);
      for (const row of db.all('SELECT id, scope, resource, name FROM metric_series WHERE last_seen < ?', t - days * 86400e3)) {
        db.run('DELETE FROM metric_series WHERE id = ?', row.id);
        ids.delete(`${row.scope}\u0000${row.resource}\u0000${row.name}`);
      }
    },
    dropScope(scope) {
      for (const row of db.all('SELECT id, resource, name FROM metric_series WHERE scope = ?', scope)) {
        db.run('DELETE FROM metric_point WHERE series_id = ?', row.id);
        db.run('DELETE FROM metric_15m WHERE series_id = ?', row.id);
        db.run('DELETE FROM metric_series WHERE id = ?', row.id);
        ids.delete(`${scope}\u0000${row.resource}\u0000${row.name}`);
      }
    },
  };
}

// The Studio node, from inside its container: CPU from /proc/stat, memory
// from the cgroup when it has a limit, else the host, and the state volume's
// free space (plan 6.2, 5).
export function createHostSampler({ stateRoot }) {
  let last = null;
  const read = file => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };
  return function sample() {
    const out = {};
    const stat = read('/proc/stat');
    const line = stat?.split('\n').find(row => row.startsWith('cpu '));
    if (line) {
      const parts = line.trim().split(/\s+/).slice(1).map(Number);
      const idle = parts[3] + (parts[4] ?? 0);
      const total = parts.reduce((sum, value) => sum + value, 0);
      if (last && total > last.total) out.cpu = Math.round((1 - (idle - last.idle) / (total - last.total)) * 1000) / 10;
      last = { idle, total };
    } else out.cpu = Math.round((os.loadavg()[0] / os.cpus().length) * 1000) / 10;
    const limit = Number(read('/sys/fs/cgroup/memory.max'));
    const used = Number(read('/sys/fs/cgroup/memory.current'));
    if (Number.isFinite(limit) && limit > 0 && Number.isFinite(used)) { out.memory = used; out.memoryPercent = Math.round((used / limit) * 1000) / 10; }
    else { out.memory = os.totalmem() - os.freemem(); out.memoryPercent = Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 1000) / 10; }
    try {
      const disk = fs.statfsSync(stateRoot);
      out.diskFree = disk.bavail * disk.bsize;
      out.diskPercent = Math.round((1 - disk.bavail / disk.blocks) * 1000) / 10;
    } catch {}
    return out;
  };
}
