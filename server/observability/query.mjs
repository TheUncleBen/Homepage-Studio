// Log search (plan 7.7). Runs in the query worker with read-only
// connections, one segment at a time, checking its deadline between pieces.
// Every query is limited to the scopes the person may read: the caller
// passes them, and no query runs without them.
import { join } from 'node:path';
import { openDatabase } from './sqlite.mjs';

const SEVERITY_WORDS = { critical: 2, crit: 2, error: 3, err: 3, errors: 3, warning: 4, warn: 4, warnings: 4, notice: 5, info: 6, debug: 7 };
const FIELD_ALIASES = { sev: 'severity', severity: 'severity', level: 'severity', source: 'source', src: 'source', resource: 'resource', res: 'resource', type: 'type', event: 'type', class: 'class', error: 'class', dashboard: 'dashboard', scope: 'dashboard', category: 'category', cat: 'category', group: 'group', panel: 'panel', id: 'id', actor: 'actor' };
export const MAX_QUERY = 1000;

// Splits a typed search into terms. Every chip in the UI has this same text
// form, so a copied search works when pasted.
export function parseQuery(text) {
  const terms = [];
  const input = String(text ?? '').slice(0, MAX_QUERY);
  const pattern = /(-)?(?:([a-z]+):)?(?:"((?:[^"\\]|\\.)*)"|(\S+))/gi;
  let match;
  while ((match = pattern.exec(input))) {
    const [, negate, rawField, quoted, bare] = match;
    const value = (quoted ?? bare ?? '').replace(/\\(.)/g, '$1');
    const field = rawField ? FIELD_ALIASES[rawField.toLowerCase()] : null;
    if (rawField && !field) { terms.push({ kind: 'text', negate: Boolean(negate), value: `${rawField}:${value}`, phrase: quoted !== undefined }); continue; }
    if (!value) continue;
    if (field) terms.push({ kind: 'field', field, negate: Boolean(negate), value });
    else terms.push({ kind: 'text', negate: Boolean(negate), value, phrase: quoted !== undefined });
  }
  return terms;
}

// Why a typed search can't find anything because of the search itself: a
// filter name or level Studio doesn't know, or a quote left open. The log
// view shows the same reasons (server/auth/ui/ops.js queryHint).
export function queryProblem(text) {
  const input = String(text ?? '');
  if ((input.match(/"/g) ?? []).length % 2) return 'A quote is left open: close it with another ".';
  for (const [, name, value] of input.matchAll(/(?:^|\s)-?([a-z]+):("[^"]*"|\S*)/gi)) {
    const field = FIELD_ALIASES[name.toLowerCase()];
    if (!field && !value.startsWith('//')) return `“${name}:” isn’t a filter. Try severity:, source:, resource:, type:, class:, dashboard:, panel: or actor:.`;
    if (field === 'severity' && !(value.toLowerCase() in SEVERITY_WORDS) && !/^[0-7]$/.test(value)) return 'Levels are critical, error, warning, notice, info or debug (or 0 to 7).';
  }
  return '';
}

const ftsString = value => `"${value.replace(/"/g, '""')}"`;
// Words become prefix searches; a quoted phrase is matched as typed.
function ftsTerm(term) {
  const words = term.value.split(/[^\p{L}\p{N}_]+/u).filter(Boolean);
  if (!words.length) return null;
  if (term.phrase) return ftsString(words.join(' '));
  return words.map(word => `${ftsString(word)}*`).join(' AND ');
}

// Builds the WHERE clause shared by search, facets and the histogram.
export function buildFilter(terms, { from, to, scopes, restricted }) {
  const where = ['e.ts >= ?', 'e.ts <= ?'];
  const args = [from, to];
  if (Array.isArray(scopes)) {
    if (!scopes.length) where.push('0');
    else { where.push(`e.scope IN (${scopes.map(() => '?').join(', ')})`); args.push(...scopes); }
  }
  if (!restricted) where.push('e.restricted = 0');
  const positive = [], negative = [];
  for (const term of terms) {
    if (term.kind === 'text') {
      const fts = ftsTerm(term);
      if (fts) (term.negate ? negative : positive).push(fts);
      continue;
    }
    const not = term.negate ? 'NOT ' : '';
    const value = term.value;
    switch (term.field) {
      case 'severity': {
        const level = SEVERITY_WORDS[value.toLowerCase()] ?? (/^[0-7]$/.test(value) ? Number(value) : null);
        if (level === null) { where.push('0'); break; }
        where.push(`${not}(e.severity <= ?)`); args.push(level); break;
      }
      case 'source': where.push(`${not}(e.source_type = ? OR e.source_id = ?)`); args.push(value.toLowerCase(), value); break;
      case 'resource': where.push(`${not}(e.resource = ? COLLATE NOCASE)`); args.push(value); break;
      case 'type':
        if (value.endsWith('*')) { where.push(`${not}(e.event_type LIKE ? ESCAPE '\\')`); args.push(value.slice(0, -1).replace(/[\\%_]/g, '\\$&') + '%'); }
        else { where.push(`${not}(e.event_type = ?)`); args.push(value); }
        break;
      case 'class': where.push(`${not}(e.error_class = ?)`); args.push(value.toLowerCase()); break;
      case 'dashboard': where.push(`${not}(e.scope = ?)`); args.push(value); break;
      case 'category': where.push(`${not}(e.category = ?)`); args.push(value.toLowerCase()); break;
      case 'group': where.push(`${not}(e.fingerprint = ?)`); args.push(value); break;
      case 'panel': where.push(`${not}(e.panel = ?)`); args.push(value); break;
      case 'id': where.push(`${not}(e.id = ?)`); args.push(value); break;
      case 'actor': where.push(`${not}(e.actor = ?)`); args.push(value); break;
      default: break;
    }
  }
  if (positive.length) { where.push('e.rid IN (SELECT rowid FROM event_fts WHERE event_fts MATCH ?)'); args.push(positive.join(' AND ')); }
  for (const fts of negative) { where.push('e.rid NOT IN (SELECT rowid FROM event_fts WHERE event_fts MATCH ?)'); args.push(fts); }
  return { sql: where.join(' AND '), args };
}

const COLUMNS = 'e.id, e.ts, e.received, e.severity, e.category, e.source_type, e.source_id, e.scope, e.resource, e.panel, e.event_type, e.error_class, e.message, e.fields, e.actor, e.correlation, e.fingerprint, e.restricted';

function rowToEvent(row, where) {
  let fields = {};
  try { fields = JSON.parse(row.fields); } catch {}
  return { ...row, fields, restricted: Boolean(row.restricted), stream: where.stream, seq: where.seq };
}

export function createQueryRunner({ dir }) {
  let main = null;
  const segments = new Map(); // path → db
  function mainDb() { main ??= openDatabase(join(dir, 'main.db'), { readOnly: true }); return main; }
  function segmentDb(stream, file) {
    const path = join(dir, stream, file);
    let db = segments.get(path);
    if (!db) { db = openDatabase(path, { readOnly: true }); segments.set(path, db); }
    return db;
  }
  function listSegments(from, to) {
    // Close connections to files retention has removed.
    const live = new Set(mainDb().all('SELECT stream, file FROM segment').map(row => join(dir, row.stream, row.file)));
    for (const [path, db] of segments) if (!live.has(path)) { db.close(); segments.delete(path); }
    return mainDb().all('SELECT stream, seq, file, first_ts, last_ts FROM segment WHERE last_ts IS NOT NULL AND last_ts >= ? AND first_ts <= ? ORDER BY last_ts DESC', from, to);
  }
  function withRepeats(events) {
    if (!events.length) return events;
    const rows = mainDb().all(`SELECT id, repeat, last_ts FROM event_repeat WHERE id IN (${events.map(() => '?').join(', ')})`, ...events.map(event => event.id));
    const map = new Map(rows.map(row => [row.id, row]));
    for (const event of events) { const r = map.get(event.id); event.repeat = r?.repeat ?? 1; if (r) event.last_ts = r.last_ts; }
    return events;
  }
  function withPersonal(events) {
    const restricted = events.filter(event => event.restricted);
    if (!restricted.length) return events;
    const rows = mainDb().all(`SELECT id, user_id, ip, username FROM personal WHERE id IN (${restricted.map(() => '?').join(', ')})`, ...restricted.map(event => event.id));
    const map = new Map(rows.map(row => [row.id, row]));
    for (const event of restricted) { const p = map.get(event.id); event.personal = p ? { user_id: p.user_id, ip: p.ip, username: p.username } : null; }
    return events;
  }
  function deadlineFor(ms) { const end = Date.now() + ms; return () => Date.now() > end; }

  return {
    search({ query = '', from, to, scopes, restricted = false, limit = 200, before = null, budgetMs = 10000 }) {
      const terms = parseQuery(query);
      const filter = buildFilter(terms, { from, to, scopes, restricted });
      const late = deadlineFor(budgetMs);
      let results = [];
      let partial = false;
      for (const segment of listSegments(from, to)) {
        // Once enough newer results exist, older segments can't contribute.
        if (results.length >= limit && segment.last_ts < results[limit - 1].ts) break;
        if (late()) { partial = true; break; }
        let db;
        try { db = segmentDb(segment.stream, segment.file); } catch { continue; }
        const cursor = before ? ' AND (e.ts < ? OR (e.ts = ? AND e.id < ?))' : '';
        const rows = db.all(`SELECT ${COLUMNS} FROM event e WHERE ${filter.sql}${cursor} ORDER BY e.ts DESC, e.id DESC LIMIT ?`, ...filter.args, ...(before ? [before.ts, before.ts, before.id] : []), limit + 1);
        results.push(...rows.map(row => rowToEvent(row, segment)));
        results.sort((a, b) => b.ts - a.ts || (a.id < b.id ? 1 : -1));
        if (results.length > limit) results = results.slice(0, limit + 1);
      }
      const more = results.length > limit;
      const events = withPersonal(withRepeats(results.slice(0, limit)));
      return { events, next: more || partial ? (events.length ? { ts: events.at(-1).ts, id: events.at(-1).id } : null) : null, partial, terms: terms.length };
    },
    facets({ query = '', from, to, scopes, restricted = false, budgetMs = 8000 }) {
      const filter = buildFilter(parseQuery(query), { from, to, scopes, restricted });
      const late = deadlineFor(budgetMs);
      const columns = ['severity', 'source_type', 'resource', 'event_type', 'error_class', 'scope'];
      const out = Object.fromEntries(columns.map(column => [column, new Map()]));
      let total = 0, partial = false;
      for (const segment of listSegments(from, to)) {
        if (late()) { partial = true; break; }
        let db;
        try { db = segmentDb(segment.stream, segment.file); } catch { continue; }
        for (const column of columns) {
          for (const row of db.all(`SELECT e.${column} AS v, COUNT(*) AS n FROM event e WHERE ${filter.sql} GROUP BY e.${column} ORDER BY n DESC LIMIT 25`, ...filter.args)) {
            if (row.v === null) continue;
            out[column].set(row.v, (out[column].get(row.v) ?? 0) + row.n);
          }
        }
        total += db.get(`SELECT COUNT(*) AS n FROM event e WHERE ${filter.sql}`, ...filter.args).n;
      }
      const top = map => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([value, count]) => ({ value, count }));
      return { total, partial, facets: Object.fromEntries(columns.map(column => [column, top(out[column])])) };
    },
    histogram({ query = '', from, to, scopes, restricted = false, buckets = 60, budgetMs = 8000 }) {
      const filter = buildFilter(parseQuery(query), { from, to, scopes, restricted });
      const step = Math.max(1000, Math.ceil((to - from) / buckets));
      const late = deadlineFor(budgetMs);
      const counts = new Map();
      let partial = false;
      for (const segment of listSegments(from, to)) {
        if (late()) { partial = true; break; }
        let db;
        try { db = segmentDb(segment.stream, segment.file); } catch { continue; }
        for (const row of db.all(`SELECT (e.ts - ?) / ? AS b, MIN(e.severity) AS worst, COUNT(*) AS n, SUM(e.severity <= 3) AS errors, SUM(e.severity = 4) AS warnings FROM event e WHERE ${filter.sql} GROUP BY b`, from, step, ...filter.args)) {
          const index = Math.floor(row.b);
          const prior = counts.get(index) ?? { n: 0, errors: 0, warnings: 0 };
          counts.set(index, { n: prior.n + row.n, errors: prior.errors + row.errors, warnings: prior.warnings + row.warnings });
        }
      }
      const bars = [];
      for (let i = 0; i * step < to - from; i++) bars.push({ start: from + i * step, ...(counts.get(i) ?? { n: 0, errors: 0, warnings: 0 }) });
      return { step, bars, partial };
    },
    // The same source's events around one event (plan 7.7, Show surrounding).
    context({ id, stream, seq, scopes, restricted = false, span = 50 }) {
      const segment = mainDb().get('SELECT stream, seq, file FROM segment WHERE stream = ? AND seq = ?', stream, seq);
      if (!segment) return null;
      const db = segmentDb(segment.stream, segment.file);
      const pivot = db.get(`SELECT ${COLUMNS} FROM event e WHERE e.id = ?`, id);
      if (!pivot) return null;
      const visible = filter => buildFilter([], { from: 0, to: Number.MAX_SAFE_INTEGER, scopes, restricted }).sql + filter;
      const base = buildFilter([], { from: 0, to: Number.MAX_SAFE_INTEGER, scopes, restricted });
      if (!db.get(`SELECT 1 AS ok FROM event e WHERE ${base.sql} AND e.id = ?`, ...base.args, id)) return null;
      const before = db.all(`SELECT ${COLUMNS} FROM event e WHERE ${visible(' AND e.source_id = ? AND (e.ts < ? OR (e.ts = ? AND e.id < ?))')} ORDER BY e.ts DESC, e.id DESC LIMIT ?`, ...base.args, pivot.source_id, pivot.ts, pivot.ts, pivot.id, span);
      const after = db.all(`SELECT ${COLUMNS} FROM event e WHERE ${visible(' AND e.source_id = ? AND (e.ts > ? OR (e.ts = ? AND e.id > ?))')} ORDER BY e.ts ASC, e.id ASC LIMIT ?`, ...base.args, pivot.source_id, pivot.ts, pivot.ts, pivot.id, span);
      const events = [...after.reverse(), pivot, ...before].map(row => rowToEvent(row, segment));
      return { pivot: id, events: withPersonal(withRepeats(events)) };
    },
    // Repeated errors grouped by their shape (plan 7.6, Group similar).
    groups({ query = '', from, to, scopes, restricted = false, budgetMs = 8000 }) {
      const filter = buildFilter(parseQuery(query), { from, to, scopes, restricted });
      const late = deadlineFor(budgetMs);
      const groups = new Map();
      let partial = false;
      for (const segment of listSegments(from, to)) {
        if (late()) { partial = true; break; }
        let db;
        try { db = segmentDb(segment.stream, segment.file); } catch { continue; }
        for (const row of db.all(`SELECT e.fingerprint AS f, COUNT(*) AS n, MIN(e.ts) AS first, MAX(e.ts) AS last, MIN(e.severity) AS severity, MAX(e.id) AS sample FROM event e WHERE ${filter.sql} GROUP BY e.fingerprint ORDER BY n DESC LIMIT 200`, ...filter.args)) {
          const prior = groups.get(row.f);
          if (!prior) groups.set(row.f, { fingerprint: row.f, count: row.n, first: row.first, last: row.last, severity: row.severity, sample: row.sample, stream: segment.stream, seq: segment.seq });
          else { prior.count += row.n; prior.first = Math.min(prior.first, row.first); if (row.last > prior.last) { prior.last = row.last; prior.sample = row.sample; prior.stream = segment.stream; prior.seq = segment.seq; } prior.severity = Math.min(prior.severity, row.severity); }
        }
      }
      const list = [...groups.values()].sort((a, b) => b.count - a.count).slice(0, 100);
      // Each group's newest event, for its words.
      for (const group of list) {
        const segment = mainDb().get('SELECT stream, seq, file FROM segment WHERE stream = ? AND seq = ?', group.stream, group.seq);
        if (!segment) continue;
        const row = segmentDb(segment.stream, segment.file).get(`SELECT ${COLUMNS} FROM event e WHERE e.id = ?`, group.sample);
        if (row) group.event = rowToEvent(row, segment);
      }
      const repeats = withRepeats(list.map(group => group.event).filter(Boolean));
      for (const event of repeats) { const group = list.find(item => item.event === event); if (group && event.repeat > 1) group.count += event.repeat - 1; }
      return { groups: list, partial };
    },
    // How many events match, for log alert rules.
    count({ query = '', from, to, scopes, restricted = false, budgetMs = 5000 }) {
      const filter = buildFilter(parseQuery(query), { from, to, scopes, restricted });
      const late = deadlineFor(budgetMs);
      let total = 0;
      for (const segment of listSegments(from, to)) {
        if (late()) break;
        let db;
        try { db = segmentDb(segment.stream, segment.file); } catch { continue; }
        total += db.get(`SELECT COUNT(*) AS n FROM event e WHERE ${filter.sql}`, ...filter.args).n;
      }
      return total;
    },
    oldest() {
      const row = mainDb().get('SELECT MIN(first_ts) AS t FROM segment');
      return row?.t ?? null;
    },
    close() { for (const db of segments.values()) db.close(); segments.clear(); main?.close(); main = null; },
  };
}
