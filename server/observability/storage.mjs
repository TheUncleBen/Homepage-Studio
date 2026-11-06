// History storage for the observability engine (plan 7.5, 10.2): main.db for
// monitor state, check history, incidents and metrics, plus numbered log and
// audit segment files. Only the engine thread writes; retention removes whole
// files. Definitions (monitors, channels…) live in observability.json instead.
import fs from 'node:fs';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDatabase } from './sqlite.mjs';
import { MAIN_SCHEMA, SCHEMA_VERSION, SEGMENT_SCHEMA } from './schema.mjs';
import { searchText } from './model.mjs';

export const STREAMS = { logs: 'logs', audit: 'audit' };
const SEGMENT_MAX_BYTES = 256 * 1024 * 1024;

// Local calendar day (deployment TZ) or month, for segment boundaries.
export function localDay(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}
const periodOf = (stream, ts) => (stream === 'audit' ? localDay(ts).slice(0, 6) : localDay(ts));

// Create, write, sync, rename, read back and remove a file: the start-up
// self-test for the history directory (plan 10.6).
export function selfTest(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw Object.assign(new Error('Not a directory'), { code: 'OBSERVABILITY_STORAGE_UNSAFE' });
  const probe = join(dir, `.probe-${randomUUID()}`);
  const moved = probe + '.moved';
  const fd = fs.openSync(probe, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { fs.writeSync(fd, 'observability storage check\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(probe, moved);
  const back = fs.readFileSync(moved, 'utf8');
  fs.unlinkSync(moved);
  if (back !== 'observability storage check\n') throw Object.assign(new Error('Read back failed'), { code: 'OBSERVABILITY_STORAGE_UNSAFE' });
}

function fileSize(path) {
  let total = 0;
  for (const suffix of ['', '-wal', '-shm', '-journal']) { try { total += fs.statSync(path + suffix).size; } catch {} }
  return total;
}

function removeDatabaseFiles(path) {
  for (const suffix of ['', '-wal', '-shm', '-journal']) { try { fs.unlinkSync(path + suffix); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
}

export function openMain(dir, { journal = 'WAL' } = {}) {
  const file = join(dir, 'main.db');
  let db = openDatabase(file, { journal });
  db.exec(MAIN_SCHEMA);
  const version = db.get("SELECT value FROM meta WHERE key = 'schema'")?.value;
  if (version && Number(version) !== SCHEMA_VERSION) {
    // Fresh-deploy rule: an older history is set aside, never converted.
    db.close();
    const aside = join(dir, `set-aside-${Date.now()}`);
    fs.mkdirSync(aside, { mode: 0o700 });
    for (const name of fs.readdirSync(dir)) if (name !== aside.split('/').pop() && !name.startsWith('set-aside-') && !name.startsWith('.')) fs.renameSync(join(dir, name), join(aside, name));
    db = openDatabase(file, { journal });
    db.exec(MAIN_SCHEMA);
  }
  db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', ?)", String(SCHEMA_VERSION));
  return db;
}

// The segment writer for one stream.
function createStream(dir, main, stream, journal) {
  const folder = join(dir, stream);
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  let current = null; // { seq, day, db, path }
  const insertSql = 'INSERT INTO event (id, ts, received, severity, category, source_type, source_id, scope, resource, panel, event_type, error_class, message, fields, actor, correlation, fingerprint, restricted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
  function open(day) {
    const last = main.get('SELECT seq, file, day, closed FROM segment WHERE stream = ? ORDER BY seq DESC LIMIT 1', stream);
    if (last && !last.closed && last.day === day && fs.existsSync(join(folder, last.file)) && fileSize(join(folder, last.file)) < SEGMENT_MAX_BYTES) {
      const db = openDatabase(join(folder, last.file), { journal });
      db.exec(SEGMENT_SCHEMA);
      return { seq: last.seq, day, db, path: join(folder, last.file) };
    }
    if (last && !last.closed) main.run('UPDATE segment SET closed = 1 WHERE stream = ? AND seq = ?', stream, last.seq);
    const seq = (last?.seq ?? 0) + 1;
    const file = `${String(seq).padStart(6, '0')}.db`;
    const db = openDatabase(join(folder, file), { journal });
    db.exec(SEGMENT_SCHEMA);
    db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('stream', ?)", stream);
    main.run('INSERT INTO segment (stream, seq, file, day) VALUES (?, ?, ?, ?)', stream, seq, file, day);
    return { seq, day, db, path: join(folder, file) };
  }
  function ensure(ts) {
    const day = periodOf(stream, ts);
    // Never go back to an older period when the clock jumps backward: the
    // current segment keeps taking events (plan 7.5).
    if (current && current.day >= day && fileSize(current.path) < SEGMENT_MAX_BYTES) return current;
    if (current) { current.db.close(); main.run('UPDATE segment SET closed = 1, bytes = ? WHERE stream = ? AND seq = ?', fileSize(current.path), stream, current.seq); }
    current = open(current && current.day > day ? current.day : day);
    return current;
  }
  return {
    // Writes events (all received now) in one transaction. Returns where they went.
    write(events) {
      if (!events.length) return null;
      const segment = ensure(events[0].received);
      const { db } = segment;
      db.transaction(() => {
        for (const event of events) {
          const result = db.run(insertSql, event.id, event.ts, event.received, event.severity, event.category, event.source_type, event.source_id, event.scope, event.resource, event.panel, event.event_type, event.error_class, event.message, JSON.stringify(event.fields ?? {}), event.actor, event.correlation, event.fingerprint, event.sensitivity === 'restricted' ? 1 : 0);
          db.run('INSERT INTO event_fts (rowid, text) VALUES (?, ?)', result.lastInsertRowid, searchText(event));
        }
      });
      let first = Infinity, lastTs = -Infinity;
      for (const event of events) { first = Math.min(first, event.ts); lastTs = Math.max(lastTs, event.ts); }
      main.run('UPDATE segment SET first_ts = MIN(COALESCE(first_ts, ?), ?), last_ts = MAX(COALESCE(last_ts, ?), ?), events = events + ? WHERE stream = ? AND seq = ?', first, first, lastTs, lastTs, events.length, stream, segment.seq);
      return { stream, seq: segment.seq };
    },
    refreshSize() {
      if (current) main.run('UPDATE segment SET bytes = ? WHERE stream = ? AND seq = ?', fileSize(current.path), stream, current.seq);
    },
    get currentSeq() { return current?.seq ?? null; },
    remove(seq) {
      if (current?.seq === seq) return false;
      const row = main.get('SELECT file FROM segment WHERE stream = ? AND seq = ?', stream, seq);
      if (row) removeDatabaseFiles(join(folder, row.file));
      main.run('DELETE FROM segment WHERE stream = ? AND seq = ?', stream, seq);
      main.run('DELETE FROM event_repeat WHERE stream = ? AND seq = ?', stream, seq);
      return true;
    },
    // Gradual FTS merging on a closed segment (plan 7.5), a small step at a time.
    mergeStep(seq) {
      const row = main.get('SELECT file FROM segment WHERE stream = ? AND seq = ? AND closed = 1', stream, seq);
      if (!row) return;
      const db = openDatabase(join(folder, row.file), { journal });
      try { db.run("INSERT INTO event_fts (event_fts, rank) VALUES ('merge', 64)"); } finally { db.close(); }
    },
    // A removed person (security review L1): their events keep what happened
    // but name "removed person" instead of them, in the actor and in the
    // message Studio wrote, and the search index is kept in step.
    forgetNames(names, replacement) {
      if (!names.length) return 0;
      const escaped = names.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      const pattern = new RegExp(`(?<![\\p{L}\\p{N}_.-])(?:${escaped.join('|')})(?![\\p{L}\\p{N}_.-])`, 'gu');
      let changed = 0;
      for (const row of main.all('SELECT seq, file FROM segment WHERE stream = ? ORDER BY seq', stream)) {
        const own = current?.seq === row.seq;
        if (!own && !fs.existsSync(join(folder, row.file))) continue;
        const db = own ? current.db : openDatabase(join(folder, row.file), { journal });
        try {
          const rows = db.all(`SELECT rid, message, event_type, error_class, resource, fields, actor FROM event WHERE actor IN (${names.map(() => '?').join(', ')})`, ...names);
          if (!rows.length) continue;
          db.transaction(() => {
            for (const event of rows) {
              const before = { ...event, fields: JSON.parse(event.fields || '{}') };
              const after = { ...before, message: event.message.replace(pattern, replacement), actor: replacement };
              db.run("INSERT INTO event_fts (event_fts, rowid, text) VALUES ('delete', ?, ?)", event.rid, searchText(before));
              db.run('UPDATE event SET message = ?, actor = ? WHERE rid = ?', after.message, after.actor, event.rid);
              db.run('INSERT INTO event_fts (rowid, text) VALUES (?, ?)', event.rid, searchText(after));
              changed++;
            }
          });
        } finally { if (!own) db.close(); }
      }
      return changed;
    },
    close() { if (current) { current.db.close(); main.run('UPDATE segment SET bytes = ? WHERE stream = ? AND seq = ?', fileSize(current.path), stream, current.seq); current = null; } },
  };
}

export function createStorage({ dir, journal = 'WAL' }) {
  const main = openMain(dir, { journal });
  const streams = { logs: createStream(dir, main, 'logs', journal), audit: createStream(dir, main, 'audit', journal) };
  return {
    dir, main, streams,
    journalMode: main.journalMode(),
    // Bytes used by everything in the history directory.
    usage() {
      const segments = main.all('SELECT stream, seq, file, day, first_ts, last_ts, events, bytes, closed FROM segment ORDER BY stream, seq');
      for (const stream of Object.values(streams)) stream.refreshSize();
      let total = fileSize(join(dir, 'main.db'));
      const byStream = { logs: 0, audit: 0 };
      for (const segment of segments) {
        const size = fileSize(join(dir, segment.stream, segment.file));
        segment.bytes = size;
        byStream[segment.stream] = (byStream[segment.stream] ?? 0) + size;
        total += size;
      }
      return { total, main: fileSize(join(dir, 'main.db')), logs: byStream.logs, audit: byStream.audit, segments };
    },
    // Retention: whole files only. Logs by age and the shared budget; audit
    // by its own age. The segment being written, and anything newer than the
    // newest write, is never removed (plan 7.5).
    retain({ logDays, auditDays, budgetBytes, now = Date.now() }) {
      const removed = [];
      const newest = main.get('SELECT MAX(last_ts) AS t FROM segment')?.t ?? now;
      for (const [name, days] of [['logs', logDays], ['audit', auditDays]]) {
        const cutoff = now - days * 86400e3;
        for (const row of main.all('SELECT seq, last_ts FROM segment WHERE stream = ? AND closed = 1 AND last_ts IS NOT NULL AND last_ts < ? AND last_ts < ? ORDER BY seq', name, cutoff, newest)) {
          if (streams[name].remove(row.seq)) removed.push({ stream: name, seq: row.seq, reason: 'age' });
        }
      }
      let { total } = this.usage();
      while (total > budgetBytes) {
        const oldest = main.get("SELECT seq FROM segment WHERE stream = 'logs' AND closed = 1 ORDER BY seq LIMIT 1");
        if (!oldest || !streams.logs.remove(oldest.seq)) break;
        removed.push({ stream: 'logs', seq: oldest.seq, reason: 'budget' });
        total = this.usage().total;
      }
      return removed;
    },
    close() { for (const stream of Object.values(streams)) stream.close(); try { main.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch {} main.close(); },
  };
}
