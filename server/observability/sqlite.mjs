// The one place that touches node:sqlite (approved plan D1, 6 Nov 2026). The
// module is a release candidate in Node 24 and renamed in later versions, so
// every other file goes through this adapter.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let sqlite;
function load() {
  if (sqlite) return sqlite;
  // Node prints one ExperimentalWarning the first time node:sqlite loads. It
  // carries no information for an administrator, so that single warning is
  // swallowed; every other warning still reaches stderr.
  const original = process.emitWarning;
  process.emitWarning = function (warning, ...rest) {
    const text = typeof warning === 'string' ? warning : warning?.message;
    if (/SQLite is an experimental feature/i.test(String(text))) return;
    return original.call(process, warning, ...rest);
  };
  try { sqlite = require('node:sqlite'); } finally { process.emitWarning = original; }
  return sqlite;
}

const Database = () => load().Database ?? load().DatabaseSync;

// Memory is bounded per connection: SQLite's page cache is native memory that
// worker resourceLimits do not cover (plan 5.1).
const PRAGMAS = ['PRAGMA foreign_keys = ON', 'PRAGMA cache_size = -8192', 'PRAGMA temp_store = FILE', 'PRAGMA mmap_size = 0', 'PRAGMA busy_timeout = 5000'];

export function openDatabase(file, { readOnly = false, journal = 'WAL' } = {}) {
  const Db = Database();
  const db = new Db(file, readOnly ? { readOnly: true, timeout: 5000 } : { timeout: 5000 });
  for (const pragma of PRAGMAS) db.exec(pragma);
  if (!readOnly) {
    if (journal === 'WAL') {
      const mode = db.prepare('PRAGMA journal_mode = WAL').get();
      if (String(Object.values(mode ?? {})[0]).toLowerCase() !== 'wal') db.exec('PRAGMA journal_mode = DELETE');
    } else db.exec('PRAGMA journal_mode = DELETE');
    db.exec('PRAGMA synchronous = NORMAL');
  }
  const cache = new Map();
  const statement = sql => {
    let prepared = cache.get(sql);
    if (!prepared) { prepared = db.prepare(sql); cache.set(sql, prepared); }
    return prepared;
  };
  return {
    raw: db,
    exec: sql => db.exec(sql),
    all: (sql, ...args) => statement(sql).all(...args),
    get: (sql, ...args) => statement(sql).get(...args),
    run: (sql, ...args) => statement(sql).run(...args),
    // A write transaction; nested calls join the outer one.
    transaction(fn) {
      if (db.isTransaction) return fn();
      db.exec('BEGIN IMMEDIATE');
      try { const result = fn(); db.exec('COMMIT'); return result; }
      catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
    },
    journalMode: () => String(Object.values(db.prepare('PRAGMA journal_mode').get() ?? {})[0] ?? ''),
    close() { cache.clear(); try { db.close(); } catch {} },
  };
}

// FTS5 is required for log search; checked once at start-up (plan R13).
export function hasFts5() {
  const Db = Database();
  const db = new Db(':memory:');
  try { db.exec('CREATE VIRTUAL TABLE probe USING fts5(text)'); return true; } catch { return false; } finally { db.close(); }
}

export function sqliteVersion() {
  const Db = Database();
  const db = new Db(':memory:');
  try { return db.prepare('SELECT sqlite_version() AS v').get().v; } finally { db.close(); }
}
