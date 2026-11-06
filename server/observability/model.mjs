// The normalized log event (observability plan 7.1) and the rules every
// source passes through before storage.
import { createHash, randomBytes } from 'node:crypto';
import { ERROR_CLASSES, ERROR_WORDS } from '../../homepage/src/utils/studio/error-classes.mjs';

export const SEVERITIES = ['critical', 'critical', 'critical', 'error', 'warning', 'notice', 'info', 'debug'];
export const SEVERITY_NAMES = { critical: 2, error: 3, warning: 4, warn: 4, notice: 5, info: 6, debug: 7 };
export const severityLabel = n => ({ 0: 'Critical', 1: 'Critical', 2: 'Critical', 3: 'Error', 4: 'Warning', 5: 'Notice', 6: 'Info', 7: 'Debug' })[n] ?? 'Info';
export const CATEGORIES = ['application', 'security', 'audit', 'integration', 'monitoring', 'infrastructure'];
export const SOURCE_TYPES = ['studio', 'renderer', 'browser', 'audit', 'config', 'monitor', 'metrics', 'docker', 'ingest', 'syslog'];
// Security and audit events are restricted: administrators only, whatever a
// person's dashboard grants (build addendum 2).
export const RESTRICTED_CATEGORIES = new Set(['security', 'audit']);
export const STUDIO_SCOPE = 'studio';
// A dashboard id: "default" or a UUID (server/dashboards.mjs).
export const SCOPE = /^(?:studio|default|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const FIELD_NAME = /^[a-z0-9_.-]{1,64}$/;
const TYPE = /^[a-z0-9][a-z0-9_.-]{0,95}$/;
const SHORT = /^[^\u0000-\u001f\u007f]{1,200}$/u;

let lastMs = 0, seq = 0;
// Sortable ids: milliseconds, a sequence within the millisecond, randomness.
export function eventId(now = Date.now()) {
  if (now === lastMs) seq++; else { lastMs = now; seq = 0; }
  return now.toString(36).padStart(9, '0') + seq.toString(36).padStart(3, '0') + randomBytes(4).toString('hex');
}

// Numbers, ids, addresses and quoted values masked, so repeats of one error
// group together (plan 7.6).
export function fingerprint(eventType, message) {
  const shape = String(message)
    .replace(/"[^"]*"|'[^']*'/g, '"…"')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '#')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, '#')
    .replace(/\b[0-9a-f]{12,}\b/gi, '#')
    .replace(/\d+(?:\.\d+)?/g, '#')
    .slice(0, 400);
  return createHash('sha256').update(`${eventType}\u0000${shape}`).digest('hex').slice(0, 16);
}

// Extra words for the full-text index (plan 7.7): the class, the event type's
// words and plain words for coded errors.
export function searchText(event) {
  const words = [event.message];
  if (event.event_type) words.push(event.event_type.replace(/[._-]+/g, ' '));
  if (event.error_class) words.push(event.error_class.replace(/-/g, ' '));
  if (event.resource) words.push(event.resource);
  for (const [code, plain] of Object.entries(ERROR_WORDS)) if (event.message.includes(String(code))) words.push(plain);
  for (const [key, value] of Object.entries(event.fields ?? {})) if (typeof value === 'string' && value.length <= 200) words.push(`${key} ${value}`);
  return words.join(' ');
}

function cleanFields(fields, redact) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return {};
  const out = {};
  let count = 0, size = 0;
  for (const [key, raw] of Object.entries(fields)) {
    if (count >= 64 || !FIELD_NAME.test(key)) continue;
    let value = raw;
    if (typeof value === 'string') value = redact(value, 1024);
    else if (typeof value === 'number') { if (!Number.isFinite(value)) continue; }
    else if (typeof value !== 'boolean' && value !== null) value = redact(JSON.stringify(value) ?? '', 1024);
    size += key.length + String(value).length;
    if (size > 16 * 1024) break;
    out[key] = value;
    count++;
  }
  return out;
}

// Turns any source's record into a stored event, or null when it is unusable.
// redact(text, limit) masks secrets. Times outside ±24 h of receipt use the
// receive time (plan 7.1).
export function normalizeEvent(input, { redact, now = Date.now() }) {
  if (!input || typeof input !== 'object') return null;
  const message = redact(typeof input.message === 'string' ? input.message : String(input.message ?? ''), 8192).trim();
  const eventType = typeof input.event_type === 'string' && TYPE.test(input.event_type) ? input.event_type : 'log';
  if (!message && eventType === 'log') return null;
  let severity = Number.isInteger(input.severity) ? input.severity : SEVERITY_NAMES[String(input.severity ?? '').toLowerCase()] ?? 6;
  severity = Math.min(7, Math.max(0, severity));
  const category = CATEGORIES.includes(input.category) ? input.category : 'application';
  const sourceType = SOURCE_TYPES.includes(input.source_type) ? input.source_type : 'studio';
  const scope = typeof input.scope === 'string' && SCOPE.test(input.scope) ? input.scope : STUDIO_SCOPE;
  const ts = Number.isFinite(input.ts) && Math.abs(input.ts - now) <= 86400e3 ? Math.round(input.ts) : now;
  const short = value => (typeof value === 'string' && SHORT.test(value) ? redact(value, 200) : null);
  const fields = cleanFields(input.fields, redact);
  const event = {
    id: eventId(now), ts, received: now, severity, category,
    source_type: sourceType, source_id: short(input.source_id) ?? sourceType, scope,
    resource: short(input.resource), panel: short(input.panel), event_type: eventType,
    error_class: ERROR_CLASSES.includes(input.error_class) ? input.error_class : null,
    message: message || eventType, fields, actor: short(input.actor), correlation: short(input.correlation),
    sensitivity: RESTRICTED_CATEGORIES.has(category) || input.restricted === true ? 'restricted' : 'normal',
  };
  event.fingerprint = fingerprint(event.event_type, event.message);
  return event;
}
