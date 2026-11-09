// Chart history (owner choice, 1 Nov 2026: "Always-on collector"). Studio
// polls only the widgets shown as charts (or with a trend or colour rules)
// and keeps their numbers here, one file per widget in the dashboard's state
// directory. The last two days keep every sample; older samples are kept as
// 15-minute averages until the dashboard's retention (7, 30 or 90 days) ends.
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const FINE_MS = 48 * 3600 * 1000;
export const COARSE_STEP_MS = 15 * 60 * 1000;
export const RETENTION_DAYS = [7, 30, 90];
export const DEFAULT_RETENTION_DAYS = 30;
export const RANGES = { '1h': 3600e3, '6h': 6 * 3600e3, '24h': 24 * 3600e3, '7d': 7 * 86400e3, '30d': 30 * 86400e3, '90d': 90 * 86400e3 };
const MAX_FIELDS = 24;
// Field names are widget field keys or labels ("Blocked today", "Temp °C");
// slashes, quotes, angle brackets and control characters are never kept.
const FIELD = /^[^\u0000-\u001f\u007f"\\/<>`]{1,80}$/u;
const FORMAT = /^[a-z_]{1,32}$/;

export const retentionDays = settings => {
  const days = settings?.studioDefaults?.chartDays;
  return RETENTION_DAYS.includes(days) ? days : DEFAULT_RETENTION_DAYS;
};

// Only what the collector reports about a value is kept: its field, its label
// key, the formatter it used and that formatter's unit options.
function cleanField(entry) {
  if (!entry || typeof entry !== 'object' || typeof entry.field !== 'string' || !FIELD.test(entry.field)) return null;
  if (!Number.isFinite(entry.value)) return null;
  const out = { field: entry.field, value: entry.value, label: typeof entry.label === 'string' ? entry.label.slice(0, 80) : '', format: typeof entry.format === 'string' && FORMAT.test(entry.format) ? entry.format : 'plain' };
  for (const option of ['binary', 'scale_units']) if (typeof entry[option] === 'boolean') out[option] = entry[option];
  for (const option of ['units', 'unit']) if (typeof entry[option] === 'string' && /^[A-Za-z/%]{1,16}$/.test(entry[option])) out[option] = entry[option];
  return out;
}

const empty = () => ({ version: 1, fields: [], fine: [], coarse: [] });

// An average of whole numbers (counts, such as queries) stays whole.
function average(points, width) {
  const sums = new Array(width).fill(0);
  const counts = new Array(width).fill(0);
  const whole = new Array(width).fill(true);
  for (const point of points) for (let i = 0; i < width; i++) if (Number.isFinite(point[i + 1])) { sums[i] += point[i + 1]; counts[i] += 1; whole[i] &&= Number.isInteger(point[i + 1]); }
  return sums.map((sum, i) => (counts[i] ? (whole[i] ? Math.round(sum / counts[i]) : sum / counts[i]) : null));
}

// Groups points into steps of the given size: one averaged point per step.
export function downsample(points, step, width) {
  const buckets = new Map();
  for (const point of points) {
    const start = Math.floor(point[0] / step) * step;
    if (!buckets.has(start)) buckets.set(start, []);
    buckets.get(start).push(point);
  }
  return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([start, group]) => [start, ...average(group, width)]);
}

export function createHistoryStore({ stateDir }) {
  const dir = path.join(stateDir, 'history');
  const cache = new Map();
  const file = panelId => path.join(dir, createHash('sha256').update(String(panelId)).digest('hex').slice(0, 32) + '.json');
  async function load(panelId) {
    if (cache.has(panelId)) return cache.get(panelId);
    let data = empty();
    try {
      const parsed = JSON.parse(await fs.readFile(file(panelId), 'utf8'));
      if (parsed?.version === 1 && Array.isArray(parsed.fields) && Array.isArray(parsed.fine) && Array.isArray(parsed.coarse)) data = parsed;
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
    cache.set(panelId, data);
    return data;
  }
  async function save(panelId, data) {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const target = file(panelId);
    const temporary = `${target}.${randomUUID()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(data), { mode: 0o600 });
    await fs.rename(temporary, target);
  }
  return {
    // values: what the collector found for one widget.
    async record(panelId, values, { at = Date.now(), days = DEFAULT_RETENTION_DAYS } = {}) {
      const clean = (Array.isArray(values) ? values : []).map(cleanField).filter(Boolean);
      if (!clean.length) return;
      const data = await load(panelId);
      for (const entry of clean) {
        const known = data.fields.find(field => field.field === entry.field);
        const { value, ...meta } = entry;
        if (known) Object.assign(known, meta);
        else if (data.fields.length < MAX_FIELDS) data.fields.push(meta);
      }
      const point = [at, ...data.fields.map(field => clean.find(entry => entry.field === field.field)?.value ?? null)];
      data.fine.push(point);
      // Whole 15-minute steps older than two days fold into one average each.
      const cut = Math.floor((at - FINE_MS) / COARSE_STEP_MS) * COARSE_STEP_MS;
      const old = data.fine.filter(p => p[0] < cut);
      if (old.length) {
        data.fine = data.fine.filter(p => p[0] >= cut);
        data.coarse.push(...downsample(old, COARSE_STEP_MS, data.fields.length));
      }
      const keepFrom = at - days * 86400e3;
      data.coarse = data.coarse.filter(p => p[0] >= keepFrom);
      await save(panelId, data);
    },
    // The points within range, at most about 300 of them, and the latest sample.
    async read(panelId, range) {
      const span = RANGES[range];
      if (!span) throw Object.assign(new Error('Choose a chart range.'), { status: 400 });
      const data = await load(panelId);
      const width = data.fields.length;
      const now = Date.now();
      const points = [...data.coarse, ...data.fine].filter(p => p[0] >= now - span);
      const step = Math.max(60e3, Math.ceil(span / 300 / 60e3) * 60e3);
      const shown = step > 60e3 ? downsample(points, step, width) : points.map(p => [p[0], ...data.fields.map((_, i) => p[i + 1] ?? null)]);
      const last = data.fine.at(-1) ?? data.coarse.at(-1) ?? null;
      return { fields: data.fields, points: shown, latest: last ? { at: last[0], values: Object.fromEntries(data.fields.map((field, i) => [field.field, last[i + 1] ?? null])) } : null };
    },
    // When the widget's newest point was taken, or null with none yet.
    async lastAt(panelId) {
      const data = await load(panelId);
      return (data.fine.at(-1) ?? data.coarse.at(-1))?.[0] ?? null;
    },
    // Removes the history of widgets that no longer exist on the dashboard.
    async keepOnly(panelIds) {
      const keep = new Set([...panelIds].map(id => path.basename(file(id))));
      let names = [];
      try { names = await fs.readdir(dir); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
      for (const name of names) if (name.endsWith('.json') && !keep.has(name)) await fs.rm(path.join(dir, name), { force: true });
      for (const id of [...cache.keys()]) if (!keep.has(path.basename(file(id)))) cache.delete(id);
    },
  };
}
