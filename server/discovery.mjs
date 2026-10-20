// SPDX-License-Identifier: AGPL-3.0-or-later
import http from 'node:http';
import https from 'node:https';

export const DISCOVERY_PROTOCOL = 1;
export const DISCOVERY_UPSTREAM_COMMIT = '51cc1684f9f34a7877ed462b8f94c9cc687b4dde';
export const MAX_DISCOVERED_SOURCES = 4096;
export const MAX_DISCOVERY_BYTES = 1024 * 1024;
const serviceIdPattern = /^discovered-service-[a-f0-9]{24,64}$/;
const widgetIdPattern = /^discovered-widget-[a-f0-9]{24,64}$/;
const sourceKeys = new Set(['id', 'kind', 'title', 'group', 'nativeLocator']);
const serviceLocatorKeys = new Set(['discovered', 'discoveryId', 'serviceId', 'groupPath', 'name', 'origin']);
const widgetLocatorKeys = new Set([...serviceLocatorKeys, 'widgetIndex', 'sourceKey', 'sourceIndex', 'proxyIndex', 'type']);
const warningCodes = new Set(['AMBIGUOUS_NATIVE_SOURCE', 'POSITIONAL_WIDGET_IDENTITY', 'INVALID_NATIVE_SOURCE', 'NATIVE_DISCOVERY_UNAVAILABLE', 'SOURCE_LIMIT_REACHED']);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

export class DiscoveryError extends Error {
  constructor(message, code = 'INVALID_DISCOVERY_MANIFEST', status = 422) {
    super(message); this.name = 'DiscoveryError'; this.code = code; this.status = status;
  }
}
const invalid = () => { throw new DiscoveryError('The native source manifest does not match the supported safe metadata format.'); };
const boundedText = (value, length, allowEmpty = false) => typeof value === 'string' && value.length <= length && (allowEmpty || value.trim().length > 0) && !/[\u0000-\u001f\u007f]/.test(value);
const validId = (value, pattern) => typeof value === 'string' && pattern.test(value);
function sourceLimit(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_DISCOVERED_SOURCES) throw new TypeError('Invalid discovery source limit.');
  return value;
}

function checkKeys(value, allowed, optional = []) {
  if (!record(value) || Object.keys(value).some(key => !allowed.has(key) && !optional.includes(key))) invalid();
}

function sourceDescriptor(value, stored = false) {
  checkKeys(value, sourceKeys, stored ? ['available'] : []);
  if (!['service', 'serviceWidget'].includes(value.kind) || !boundedText(value.title, 512) || !boundedText(value.group, 8192)) invalid();
  if (!validId(value.id, value.kind === 'service' ? serviceIdPattern : widgetIdPattern)) invalid();
  const locator = value.nativeLocator;
  checkKeys(locator, value.kind === 'service' ? serviceLocatorKeys : widgetLocatorKeys);
  if (locator.discovered !== true || !validId(locator.discoveryId, serviceIdPattern) || locator.serviceId !== locator.discoveryId || !boundedText(locator.name, 256)) invalid();
  if (!Array.isArray(locator.groupPath) || locator.groupPath.length < 1 || locator.groupPath.length > 20 || locator.groupPath.some(name => !boundedText(name, 256))) invalid();
  if (value.group !== locator.groupPath.join(' / ')) invalid();
  if (has(locator, 'origin') && !['docker', 'kubernetes'].includes(locator.origin)) invalid();
  const safeLocator = { discovered: true, discoveryId: locator.discoveryId, serviceId: locator.serviceId, groupPath: [...locator.groupPath], name: locator.name };
  if (has(locator, 'origin')) safeLocator.origin = locator.origin;
  if (value.kind === 'service') {
    if (value.id !== locator.discoveryId) invalid();
  } else {
    if (!['widget', 'widgets'].includes(locator.sourceKey) || !boundedText(locator.type, 256)) invalid();
    for (const key of ['widgetIndex', 'sourceIndex']) if (!Number.isSafeInteger(locator[key]) || locator[key] < 0 || locator[key] >= MAX_DISCOVERED_SOURCES) invalid();
    if (locator.sourceKey === 'widget' ? locator.sourceIndex !== 0 || locator.proxyIndex !== -1 : locator.proxyIndex !== locator.sourceIndex) invalid();
    Object.assign(safeLocator, { widgetIndex: locator.widgetIndex, sourceKey: locator.sourceKey, sourceIndex: locator.sourceIndex, proxyIndex: locator.proxyIndex, type: locator.type });
  }
  if (stored && has(value, 'available') && typeof value.available !== 'boolean') invalid();
  const safe = { id: value.id, kind: value.kind, title: value.title, group: value.group, nativeLocator: safeLocator };
  if (stored && has(value, 'available')) safe.available = value.available;
  return safe;
}

function sourceList(value, stored, maxSources) {
  if (!Array.isArray(value) || value.length > sourceLimit(maxSources)) invalid();
  const ids = new Set();
  return value.map(entry => {
    const safe = sourceDescriptor(entry, stored);
    if (ids.has(safe.id)) invalid();
    ids.add(safe.id);
    return safe;
  });
}

export function validateStoredDiscoveredSources(value = [], { maxSources = MAX_DISCOVERED_SOURCES } = {}) {
  return sourceList(value, true, maxSources);
}

/** Visibility is a separate preference; hiding never deletes retained metadata. */
export function validateHiddenDiscoveredIds(value = [], { maxSources = MAX_DISCOVERED_SOURCES } = {}) {
  if (!Array.isArray(value) || value.length > sourceLimit(maxSources) || value.some(id => !validId(id, serviceIdPattern) && !validId(id, widgetIdPattern))) invalid();
  return [...new Set(value)];
}

export function validateDiscoveryManifest(value, { maxSources = MAX_DISCOVERED_SOURCES } = {}) {
  checkKeys(value, new Set(['protocolVersion', 'upstreamCommit', 'sources', 'warnings']));
  if (value.protocolVersion !== DISCOVERY_PROTOCOL || value.upstreamCommit !== DISCOVERY_UPSTREAM_COMMIT) invalid();
  const sources = sourceList(value.sources, false, maxSources);
  const warnings = value.warnings ?? [];
  if (!Array.isArray(warnings) || warnings.length > warningCodes.size) invalid();
  const seen = new Set();
  const safeWarnings = warnings.map(warning => {
    checkKeys(warning, new Set(['code', 'count']));
    if (!warningCodes.has(warning.code) || seen.has(warning.code) || !Number.isSafeInteger(warning.count) || warning.count < 1 || warning.count > MAX_DISCOVERED_SOURCES) invalid();
    seen.add(warning.code);
    return { code: warning.code, count: warning.count };
  });
  return { protocolVersion: DISCOVERY_PROTOCOL, upstreamCommit: DISCOVERY_UPSTREAM_COMMIT, sources, warnings: safeWarnings };
}

/**
 * Keep safe source identity/geometry available during native discovery outages.
 * Missing sources are retained with available:false, not silently deleted.
 * Persist this union only with an explicit user save. Keep visibility preferences
 * separately; hidden panels still retain safe metadata and native identity.
 */
export function mergeDiscoveredSources({ persisted = [], cached = [], incoming = null, maxSources = MAX_DISCOVERED_SOURCES } = {}) {
  const merged = new Map();
  for (const source of [...sourceList(persisted, true, maxSources), ...sourceList(cached, true, maxSources)]) {
    merged.set(source.id, { ...source, available: false });
  }
  if (incoming !== null) {
    for (const source of sourceList(incoming, false, maxSources)) merged.set(source.id, { ...source, available: true });
  }
  if (merged.size > maxSources) throw new DiscoveryError('The retained native source list exceeds the configured panel limit.', 'DISCOVERY_SOURCE_LIMIT');
  return [...merged.values()];
}

function validateOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new TypeError('Discovery needs the configured HTTP(S) renderer origin.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new TypeError('Discovery needs the configured HTTP(S) renderer origin.');
  return url;
}

function validateHost(host) {
  if (typeof host !== 'string' || !host || host.length > 512 || /[\s/\\?#@]/.test(host)) throw new DiscoveryError('Discovery requires an allowed dashboard Host header.', 'INVALID_DISCOVERY_HOST', 400);
  try {
    const url = new URL(`http://${host}`);
    if (!url.hostname || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error();
    http.validateHeaderValue('Host', host);
  } catch { throw new DiscoveryError('Discovery requires an allowed dashboard Host header.', 'INVALID_DISCOVERY_HOST', 400); }
  return host;
}

/** Fixed-origin, fixed-path, bounded, read-only metadata client. No redirects. */
export function createDiscoveryClient({ upstream, timeoutMs = 5000, maxBytes = MAX_DISCOVERY_BYTES, maxSources = MAX_DISCOVERED_SOURCES } = {}) {
  const origin = validateOrigin(upstream);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000 || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 4 * MAX_DISCOVERY_BYTES || !Number.isSafeInteger(maxSources) || maxSources < 1 || maxSources > MAX_DISCOVERED_SOURCES) throw new TypeError('Invalid discovery request limits.');
  const transport = origin.protocol === 'https:' ? https : http;
  return Object.freeze({
    read(host) {
      validateHost(host); // Caller must also check membership in its host allowlist.
      return new Promise((resolve, reject) => {
        let settled = false, timer;
        const fail = (code = 'DISCOVERY_UNAVAILABLE') => finish(new DiscoveryError('Native discovery metadata is temporarily unavailable; retained dashboard sources are preserved.', code, 503));
        const finish = (error, value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          error ? reject(error) : resolve(value);
        };
        const request = transport.request(origin, { method: 'GET', path: '/api/studio/sources', headers: { host, accept: 'application/json' } }, response => {
          if (response.statusCode !== 200 || !/^application\/json(?:;|$)/i.test(response.headers['content-type'] || '')) {
            response.resume(); fail('DISCOVERY_INVALID_RESPONSE'); request.destroy(); return;
          }
          const declared = Number(response.headers['content-length']);
          if (Number.isFinite(declared) && declared > maxBytes) { fail('DISCOVERY_RESPONSE_TOO_LARGE'); response.destroy(); request.destroy(); return; }
          let length = 0; const chunks = [];
          response.on('data', chunk => {
            length += chunk.length;
            if (length > maxBytes) { fail('DISCOVERY_RESPONSE_TOO_LARGE'); response.destroy(); request.destroy(); return; }
            chunks.push(chunk);
          });
          response.on('error', () => fail());
          response.on('aborted', () => fail());
          response.on('end', () => {
            if (settled) return;
            let manifest;
            try { manifest = validateDiscoveryManifest(JSON.parse(Buffer.concat(chunks).toString('utf8')), { maxSources }); }
            catch { fail('DISCOVERY_INVALID_MANIFEST'); return; }
            finish(undefined, manifest);
          });
        });
        request.on('error', () => fail());
        timer = setTimeout(() => { fail('DISCOVERY_TIMEOUT'); request.destroy(); }, timeoutMs);
        request.end();
      });
    },
  });
}
