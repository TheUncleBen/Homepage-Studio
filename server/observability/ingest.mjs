// The log pipeline (plan 7.3): normalize → redact → rate limit → group
// repeats → bounded queue → batched writer. Runs inside the engine thread.
import { normalizeEvent } from './model.mjs';

const RATE = 200; // events per second per source
const BURST = 1000;
const QUEUE_MAX = 10000;
// Only identical events (same words, level, type, source, resource and
// dashboard) whose own times are this close are stored once with a count.
// Events that differ only in numbers stay apart; "Similar together" groups
// those by fingerprint when reading (UI review H2).
const DEDUPE_MS = 10000;
const DEDUPE_MAX = 20000;
const PERSONAL_KEYS = ['ip', 'username', 'user_id'];

export function createIngest({ storage, redactor, batchMs = 2000, batchMax = 500, now = () => Date.now(), onDropped = () => {} }) {
  const buckets = new Map(); // source key → { tokens, at }
  const recent = new Map(); // dedupe key → { event, count, last, stream, seq }
  let queue = [];
  let dropped = 0, droppedSince = now(), written = 0, writeFailures = 0;
  let timer = null;
  const redact = (text, limit) => redactor.text(text, limit);

  function allow(key) {
    const t = now();
    let bucket = buckets.get(key);
    if (!bucket) { bucket = { tokens: BURST, at: t }; buckets.set(key, bucket); }
    bucket.tokens = Math.min(BURST, bucket.tokens + ((t - bucket.at) / 1000) * RATE);
    bucket.at = t;
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }

  function enqueue(event) {
    if (queue.length >= QUEUE_MAX) {
      // Lowest severity goes first; audit is never dropped for a lesser event.
      let worst = -1;
      for (let i = 0; i < queue.length; i++) if (queue[i].sensitivity !== 'restricted' && (worst < 0 || queue[i].severity > queue[worst].severity)) worst = i;
      if (worst < 0 || (event.sensitivity !== 'restricted' && queue[worst].severity <= event.severity)) { dropped++; return false; }
      queue.splice(worst, 1);
      dropped++;
    }
    queue.push(event);
    if (queue.length >= batchMax) flush();
    return true;
  }

  // Accepts one raw record from any source. Returns the stored event or null.
  function add(input) {
    const event = normalizeEvent(input, { redact, now: now() });
    if (!event) return null;
    const sourceKey = `${event.source_type}:${event.source_id}`;
    if (event.sensitivity !== 'restricted' && !allow(sourceKey)) { dropped++; return null; }
    // Personal details of audit events are kept apart so they can be masked
    // later without rewriting a segment (plan 7.10).
    if (event.sensitivity === 'restricted') {
      const personal = {};
      for (const key of PERSONAL_KEYS) if (key in event.fields) { personal[key] = event.fields[key]; delete event.fields[key]; }
      if (Object.keys(personal).length) event.personal = personal;
    }
    const dedupeKey = JSON.stringify([event.message, event.severity, event.event_type, sourceKey, event.resource, event.panel, event.scope]);
    const seen = recent.get(dedupeKey);
    if (seen && event.sensitivity !== 'restricted' && event.ts >= seen.event.ts && event.ts - seen.event.ts < DEDUPE_MS) {
      seen.count++; seen.last = Math.max(seen.last, event.ts); seen.dirty = true;
      return seen.event;
    }
    if (event.sensitivity !== 'restricted' && recent.size < DEDUPE_MAX) recent.set(dedupeKey, { event, first: event.received, count: 1, last: event.ts, dirty: false });
    enqueue(event);
    return event;
  }

  function flush() {
    const batch = queue;
    queue = [];
    if (batch.length) {
      const groups = { logs: [], audit: [] };
      for (const event of batch) groups[event.sensitivity === 'restricted' ? 'audit' : 'logs'].push(event);
      for (const [stream, events] of Object.entries(groups)) {
        if (!events.length) continue;
        let attempt = 0;
        for (;;) {
          try {
            const where = storage.streams[stream].write(events);
            for (const event of events) event.where = where;
            storage.main.transaction(() => {
              for (const event of events) if (event.personal) storage.main.run('INSERT OR REPLACE INTO personal (id, ts, user_id, ip, username) VALUES (?, ?, ?, ?, ?)', event.id, event.ts, event.personal.user_id ?? null, event.personal.ip ?? null, event.personal.username ?? null);
            });
            written += events.length;
            break;
          } catch (error) {
            if (++attempt >= 3) { writeFailures++; dropped += events.length; break; }
          }
        }
      }
    }
    // Repeat counts for grouped events, and forget old groups.
    const t = now();
    try {
      storage.main.transaction(() => {
        for (const [key, entry] of recent) {
          if (entry.dirty && entry.event.where) {
            storage.main.run('INSERT OR REPLACE INTO event_repeat (id, stream, seq, repeat, last_ts) VALUES (?, ?, ?, ?, ?)', entry.event.id, entry.event.where.stream, entry.event.where.seq, entry.count, entry.last);
            entry.dirty = false;
          }
          if (t - entry.first >= DEDUPE_MS && !entry.dirty) recent.delete(key);
        }
      });
    } catch {}
    if (dropped && t - droppedSince >= 60000) {
      const count = dropped;
      dropped = 0; droppedSince = t;
      onDropped(count);
    }
  }

  return {
    add,
    flush,
    start() { timer ??= setInterval(flush, batchMs); timer.unref?.(); },
    stop() { if (timer) clearInterval(timer); timer = null; flush(); },
    stats: () => ({ queued: queue.length, dropped, written, writeFailures, groups: recent.size }),
  };
}
