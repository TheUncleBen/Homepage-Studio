import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { parseDocument, isMap, isSeq, isScalar } from 'yaml';
import { MAX_PANELS, stableValue, reconcileIdentities, identityRecords, validateIdentityRecords, boardSources, reconcileBoard, validateStoredBoard, validateBoardChange, mergeBoardChange, nextPosition } from './board.mjs';
import { columnsOfPage } from '../homepage/src/components/studio/geometry.mjs';
import { validateDiscoveryManifest, validateStoredDiscoveredSources, validateHiddenDiscoveredIds, mergeDiscoveredSources } from './discovery.mjs';
import { readNativeIndexingPolicy } from './indexing-policy.mjs';

const FILES = {
  servicesYaml: 'services.yaml',
  widgetsYaml: 'widgets.yaml',
  bookmarksYaml: 'bookmarks.yaml',
  settingsYaml: 'settings.yaml',
  dockerYaml: 'docker.yaml',
  kubernetesYaml: 'kubernetes.yaml',
  proxmoxYaml: 'proxmox.yaml',
  customCss: 'custom.css',
  customJs: 'custom.js',
};
// Keep this byte-level order identical to the native /api/studio/data bridge.
// Layout/identity state is deliberately excluded from native-source pairing.
const NATIVE_REVISION_FILES = ['services.yaml', 'bookmarks.yaml', 'widgets.yaml', 'settings.yaml', 'docker.yaml', 'kubernetes.yaml', 'proxmox.yaml', 'custom.css', 'custom.js'];
const DEFAULTS = { 'services.yaml': '[]\n', 'widgets.yaml': '[]\n', 'bookmarks.yaml': '[]\n', 'settings.yaml': '{}\n', 'docker.yaml': '{}\n', 'kubernetes.yaml': '{}\n', 'proxmox.yaml': '{}\n', 'custom.css': '', 'custom.js': '' };
const ALL_FILES = [...Object.values(FILES), 'state.json'];
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_STATE_BYTES = 2 * 1024 * 1024;
const MAX_BACKUP_BYTES = 20 * MAX_FILE_BYTES;
// A dashboard export carries its image library (at most 60 MiB, base64 in
// JSON) beside its files.
export const MAX_IMPORT_BYTES = 100 * 1024 * 1024;
export const DEFAULT_BACKUP_RETENTION = 25;
// Bounds on undo history kept in memory per editing session.
export const MAX_EDIT_STEPS = 100;
export const MAX_EDIT_SESSIONS = 16;
export const MAX_EDIT_SESSION_BYTES = 48 * 1024 * 1024;
// Fixed codes naming the API operation that created a pre-change snapshot.
// They are chosen by the server per endpoint and never contain request text.
// Every snapshot names one.
const CONTENT_ACTIONS = { add: 'added', update: 'edited', delete: 'deleted' };
export const SNAPSHOT_ACTIONS = Object.freeze([
  'arrangement-saved', 'settings-saved', 'files-saved', 'snapshot-restored', 'dashboard-imported',
  'discovered-panel-hidden', 'discovered-panel-shown', 'page-deleted', 'page-duplicated', 'widgets-deleted', 'widgets-duplicated',
  'change-undone', 'change-redone',
  ...['service', 'service-widget', 'info-widget', 'bookmark'].flatMap((kind) => Object.values(CONTENT_ACTIONS).map((verb) => `${kind}-${verb}`)),
]);
const snapshotAction = (value) => (SNAPSHOT_ACTIONS.includes(value) ? value : null);
const MAX_DEPTH = 20;
const PLACEHOLDER = /\{\{\s*HOMEPAGE_(?:VAR|FILE)_[^{}\r\n]*\}\}/g;
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
// The editor's arrangement, when a content edit sends one along.
const withBoard = (change) => (own(change, 'board') ? { arrangement: change.board } : {});
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const fileHash = (value) => hash(JSON.stringify(value));

function nativeRevisionOf(raw) {
  // A fallback shown by the editor is not a physical file the renderer read.
  if (NATIVE_REVISION_FILES.some((name) => typeof raw[name] !== 'string')) return null;
  const digest = createHash('sha256');
  for (const name of NATIVE_REVISION_FILES) {
    digest.update(name);
    digest.update('\0');
    digest.update(raw[name]);
    digest.update('\0');
  }
  return digest.digest('hex');
}

export class ConfigError extends Error {
  constructor(message, code = 'INVALID_CONFIG', status = 422, details) {
    super(message);
    this.name = 'ConfigError';
    this.code = code;
    this.status = status;
    this.statusCode = status;
    if (details) this.details = details;
  }
}

function fail(message, code = 'INVALID_CONFIG', status = 422, details) {
  throw new ConfigError(message, code, status, details);
}

function named(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > 256 || /[\u0000-\u001f]/.test(value)) {
    fail(`${label} must be a nonempty string of at most 256 characters.`);
  }
  return value;
}

function singleton(value, label) {
  if (!object(value) || Object.keys(value).length !== 1) fail(`${label} must contain exactly one named entry.`);
  return named(Object.keys(value)[0], `${label} name`);
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function maskPlaceholders(source, filename) {
  let prefix;
  do { prefix = `HOMEPAGESTUDIOPLACEHOLDER${randomUUID().replaceAll('-', '')}X`; } while (source.includes(prefix));
  const replacements = [];
  // Masked-text offsets of each token, so parser positions map back to the
  // owner's original source.
  const shifts = [];
  let growth = 0;
  const text = source.replace(PLACEHOLDER, (original, offset) => {
    const token = `${prefix}${replacements.length}END`;
    replacements.push([token, original]);
    shifts.push({ masked: offset + growth, token: token.length, original: original.length });
    growth += token.length - original.length;
    return token;
  });
  const sourceOffset = (masked) => {
    let delta = 0;
    for (const shift of shifts) {
      if (masked < shift.masked) break;
      // A position inside a token points at the start of its placeholder.
      if (masked < shift.masked + shift.token) return shift.masked - delta;
      delta += shift.token - shift.original;
    }
    return masked - delta;
  };
  const restoreText = (value) => replacements.reduce((result, [token, original]) => result.replaceAll(token, () => original), value);
  const restore = (value) => {
    // YAML can represent Infinity/NaN, but the editor's JSON protocol would
    // silently replace them with null after committing the original file.
    if (typeof value === 'number' && !Number.isFinite(value)) {
      fail(`${filename} contains a non-finite number. Use a finite number, or quote the value to preserve it as text.`, 'INVALID_YAML');
    }
    if (typeof value === 'string') return restoreText(value);
    if (Array.isArray(value)) return value.map(restore);
    if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, entry]) => [restoreText(key), restore(entry)]));
    return value;
  };
  return { text, restoreText, restore, sourceOffset };
}

// One-based line and column of a UTF-16 offset, matching the yaml package's
// LineCounter convention. Computed here because prettyErrors: false leaves
// error.linePos unset.
function linePosition(source, offset) {
  const bounded = Math.max(0, Math.min(source.length, Number.isInteger(offset) ? offset : 0));
  let line = 1;
  let start = 0;
  for (let index = source.indexOf('\n'); index !== -1 && index < bounded; index = source.indexOf('\n', index + 1)) {
    line += 1;
    start = index + 1;
  }
  return { line, column: bounded - start + 1 };
}

function yamlDocument(source, filename) {
  if (typeof source !== 'string' || Buffer.byteLength(source) > MAX_FILE_BYTES) {
    fail(`${filename} must be text no larger than ${MAX_FILE_BYTES} bytes.`);
  }
  const masked = maskPlaceholders(source, filename);
  const doc = parseDocument(masked.text, { keepSourceTokens: true, uniqueKeys: true, merge: true, prettyErrors: false });
  if (doc.errors.length) {
    // Do not echo YAML snippets: they may contain inline service credentials.
    // Positions and error codes are safe and let the owner find the problem.
    const errors = doc.errors.map((error) => ({
      code: error.code,
      ...linePosition(source, masked.sourceOffset(error.pos?.[0])),
    }));
    const [first] = errors;
    fail(`${filename} contains invalid YAML at line ${first.line}, column ${first.column}.`, 'INVALID_YAML', 422, {
      file: filename,
      errors,
    });
  }
  let data;
  try { data = masked.restore(doc.toJS({ maxAliasCount: 100 })); }
  catch (error) {
    if (error instanceof ConfigError) throw error;
    fail(`${filename} contains unsupported or excessive YAML aliases.`, 'INVALID_YAML');
  }
  return { doc, data, restore: masked.restore, text: () => masked.restoreText(doc.toString({ lineWidth: 0 })) };
}

function validateServiceConfig(config, label) {
  if (!object(config)) fail(`${label} must be a mapping of Homepage service options.`);
  if (own(config, 'id') && (typeof config.id !== 'string' || !config.id || config.id.length > 256)) {
    fail(`${label}.id must be a nonempty string of at most 256 characters.`);
  }
  if (config.widget != null && !object(config.widget)) fail(`${label}.widget must be a mapping.`);
  if (config.widgets != null && (!Array.isArray(config.widgets) || config.widgets.some((entry) => !object(entry)))) {
    fail(`${label}.widgets must be a list of widget mappings.`);
  }
}

function serviceEntries(data) {
  if (data == null) data = [];
  if (!Array.isArray(data)) fail('services.yaml must contain a list of named groups.');
  const services = [];
  const groups = [];
  const ids = new Set();
  function walk(items, groupPath, nodePath, depth) {
    if (depth > MAX_DEPTH) fail('Service groups are nested too deeply.');
    const siblingNames = new Set();
    items.forEach((entry, index) => {
      const name = singleton(entry, 'Service or group');
      if (siblingNames.has(name)) fail(`Duplicate entry "${name}" in the same service group.`);
      siblingNames.add(name);
      const value = entry[name];
      const nextPath = [...nodePath, index, name];
      if (Array.isArray(value)) {
        const nextGroupPath = [...groupPath, name];
        groups.push({ name, path: nextGroupPath, label: nextGroupPath.join(' / '), nodePath: nextPath });
        walk(value, nextGroupPath, nextPath, depth + 1);
      } else {
        if (!groupPath.length) fail('Top-level entries in services.yaml must be groups containing lists.');
        validateServiceConfig(value, `Service "${name}"`);
        const id = value.id || `studio-${hash(JSON.stringify([...groupPath, name])).slice(0, 24)}`;
        if (ids.has(id)) fail(`Duplicate service id "${id}". Each tile needs a unique id.`);
        ids.add(id);
        services.push({ id, name, group: groupPath.join(' / '), groupPath: [...groupPath], path: nextPath, index, config: value });
      }
    });
  }
  walk(data, [], [], 0);
  return { services, groups };
}

function validateInfo(data) {
  if (data == null) return [];
  if (!Array.isArray(data)) fail('widgets.yaml must contain a list of information widgets.');
  return data.map((entry, index) => {
    const type = singleton(entry, 'Information widget');
    if (entry[type] != null && !object(entry[type])) fail(`Information widget "${type}" options must be a mapping.`);
    return { type, config: entry[type] ?? {}, index, fingerprint: hash(stable(entry)) };
  });
}

function bookmarkEntries(data) {
  if (data == null) return [];
  if (!Array.isArray(data)) fail('bookmarks.yaml must contain a list of bookmark groups.');
  const entries = [], groupNames = new Set();
  for (const [groupIndex, group] of data.entries()) {
    const name = singleton(group, 'Bookmark group');
    if (groupNames.has(name)) fail('Bookmark group names must be unique.');
    groupNames.add(name);
    if (!Array.isArray(group[name])) fail(`Bookmark group "${name}" must contain a list.`);
    const names = new Set();
    for (const [index, bookmark] of group[name].entries()) {
      const title = singleton(bookmark, 'Bookmark');
      if (names.has(title)) fail('Bookmark names must be unique within their group.');
      names.add(title);
      if (!Array.isArray(bookmark[title]) || bookmark[title].some((entry) => !object(entry))) {
        fail(`Bookmark "${title}" must contain a list of option mappings.`);
      }
      // Homepage renders the first mapping only. Preserve any additional entries
      // on structured edits, rather than flattening away unfamiliar YAML.
      const config = bookmark[title][0] ?? {};
      entries.push({ group: name, name: title, groupIndex, index, config,
        path: [groupIndex, name, index, title], scope: name, type: 'bookmark', key: title,
        fingerprint: hash(stableValue(config)) });
    }
  }
  return entries;
}

function validateBookmarkDestination(config) {
  if (typeof config.href !== 'string' || !config.href.trim()) fail('Enter a destination for this bookmark.', 'INVALID_BOOKMARK');
  // Native BookmarkItem derives its description with new URL(href) only when
  // no explicit description exists. Relative destinations therefore need a
  // description; native secret/environment references remain unresolved here.
  if (config.description != null || new RegExp(PLACEHOLDER.source).test(config.href)) return;
  try { new URL(config.href); }
  catch { fail('Use an absolute bookmark URL, or add a description for a relative destination.', 'INVALID_BOOKMARK'); }
}

function serviceWidgetEntries(services) {
  const entries = [];
  for (const service of services) {
    const widgets = (service.config.widgets ?? []).map((config, sourceIndex) => ({ config, sourceKey: 'widgets', sourceIndex }));
    if (service.config.widget != null) widgets.push({ config: service.config.widget, sourceKey: 'widget', sourceIndex: 0 });
    widgets.forEach(({ config, sourceKey, sourceIndex }, index) => {
      const type = named(config.type, 'Service widget type');
      entries.push({ serviceId: service.id, index, sourceKey, sourceIndex, type, config,
        scope: service.id, key: `${sourceKey}:${sourceIndex}`, fingerprint: hash(stableValue(config)) });
    });
  }
  return entries;
}

function validateSettings(data) {
  if (data != null && !object(data)) fail('settings.yaml must contain a mapping of Homepage settings.');
}

function decodeState(raw) {
  if (raw == null) return { version: 2, infoWidgets: [], serviceWidgets: [], bookmarks: [], discoveredSources: [], hiddenDiscoveredIds: [], board: null };
  let state;
  try { state = JSON.parse(raw); } catch { fail('Dashboard layout state is not valid JSON.', 'INVALID_STATE'); }
  if (!object(state) || state.version !== 2) fail('Unsupported dashboard state version.', 'INVALID_STATE');
  const infoWidgets = state.infoWidgets ?? [];
  if (!Array.isArray(infoWidgets) || infoWidgets.length > MAX_PANELS || new Set(infoWidgets.map((entry) => entry?.id)).size !== infoWidgets.length || infoWidgets.some((entry) => !object(entry) || typeof entry.id !== 'string' || !entry.id || entry.id.length > 256 || typeof entry.type !== 'string' || typeof entry.fingerprint !== 'string')) {
    fail('Information widget identity metadata is invalid.', 'INVALID_STATE');
  }
  return { version: 2, infoWidgets,
    serviceWidgets: validateIdentityRecords(state.serviceWidgets, 'Service widget'),
    bookmarks: validateIdentityRecords(state.bookmarks, 'Bookmark'),
    discoveredSources: validateStoredDiscoveredSources(state.discoveredSources ?? []),
    hiddenDiscoveredIds: validateHiddenDiscoveredIds(state.hiddenDiscoveredIds ?? []),
    board: validateStoredBoard(state.board) };
}

function reconcileInfo(entries, previous = []) {
  const used = new Set();
  const seenTypes = new Map();
  const takenIds = new Set();
  // Reserve exact matches before fallbacks so a newly inserted same-type widget
  // cannot take the identity of an unchanged widget later in the document.
  const exactMatches = entries.map((entry) => {
    const match = previous.findIndex((candidate, i) => !used.has(i) && candidate.type === entry.type && candidate.fingerprint === entry.fingerprint);
    if (match >= 0) used.add(match);
    return match;
  });
  const reservedIds = new Set(exactMatches.filter((match) => match >= 0).map((match) => previous[match].id));
  return entries.map((entry, index) => {
    const occurrence = seenTypes.get(entry.type) ?? 0;
    seenTypes.set(entry.type, occurrence + 1);
    let match = exactMatches[index];
    if (match < 0 && previous[index]?.type === entry.type && !used.has(index)) match = index;
    if (match < 0) match = previous.findIndex((candidate, i) => !used.has(i) && candidate.type === entry.type);
    if (match < 0 && previous[index] && !used.has(index)) match = index;
    let id;
    if (match >= 0) { used.add(match); id = previous[match].id; }
    else id = `info-${hash(JSON.stringify([entry.type, occurrence])).slice(0, 24)}`;
    if (takenIds.has(id) || (match < 0 && reservedIds.has(id))) id = `info-${hash(JSON.stringify([entry.type, occurrence, index, entry.fingerprint])).slice(0, 24)}`;
    takenIds.add(id);
    return { ...entry, id };
  });
}

function parseSnapshot(raw, forced = {}, discovery = {}, placement = {}) {
  // Only native YAML files are parsed; custom CSS/JavaScript are opaque text.
  const parsed = Object.fromEntries(Object.entries(FILES).filter(([, file]) => file.endsWith('.yaml')).map(([field, file]) => [field, yamlDocument(raw[file] ?? DEFAULTS[file], file)]));
  const { services, groups } = serviceEntries(parsed.servicesYaml.data);
  const info = validateInfo(parsed.widgetsYaml.data);
  for (const field of ['settingsYaml', 'dockerYaml', 'kubernetesYaml', 'proxmoxYaml']) {
    if (parsed[field].data != null && !object(parsed[field].data)) fail(`${FILES[field]} must contain a mapping of native options.`);
  }
  const state = decodeState(raw['state.json']);
  const infoWidgets = forced.infoWidgets ? info.map((entry, i) => ({ ...entry, id: forced.infoWidgets[i].id })) : reconcileInfo(info, state.infoWidgets);
  let serviceWidgets = reconcileIdentities(serviceWidgetEntries(services), state.serviceWidgets, 'widget');
  let bookmarks = reconcileIdentities(bookmarkEntries(parsed.bookmarksYaml.data), state.bookmarks, 'bookmark');
  if (forced.serviceWidgets) serviceWidgets = serviceWidgets.map((entry, i) => ({ ...entry, id: forced.serviceWidgets[i].id }));
  if (forced.bookmarks) bookmarks = bookmarks.map((entry, i) => ({ ...entry, id: forced.bookmarks[i].id }));
  const discoveredSources = mergeDiscoveredSources({ persisted: state.discoveredSources, ...discovery });
  const hiddenDiscoveredIds = state.hiddenDiscoveredIds;
  const sources = [...boardSources({ services, serviceWidgets, infoWidgets, bookmarks }), ...discoveredSources.filter((source) => !hiddenDiscoveredIds.includes(source.id))];
  if (sources.length > MAX_PANELS) fail('The dashboard contains too many independently placed panels.', 'CONFIG_SIZE_LIMIT');
  const board = reconcileBoard(sources, state.board, placement);
  return { parsed, state, services, groups, infoWidgets, serviceWidgets, bookmarks, discoveredSources, hiddenDiscoveredIds, sources, board };
}

function validateSnapshotBytes(raw) {
  for (const name of ALL_FILES) {
    const limit = name === 'state.json' ? MAX_STATE_BYTES : MAX_FILE_BYTES;
    if (raw[name] !== null && (typeof raw[name] !== 'string' || Buffer.byteLength(raw[name]) > limit)) {
      fail(`The generated ${name} exceeds its ${limit}-byte storage limit. Reduce the configuration or layout before saving.`, 'CONFIG_SIZE_LIMIT', 422, { file: name, limit });
    }
  }
}

function importFiles(archive) {
  if (!object(archive) || archive.version !== 1 || own(archive, 'files') === own(archive, 'before')) {
    fail('Choose a complete Homepage Studio dashboard export or pre-save snapshot.', 'INVALID_IMPORT');
  }
  const snapshot = own(archive, 'before');
  const allowed = snapshot ? ['version', 'createdAt', 'revision', 'changedFiles', 'action', 'before', 'afterHashes'] : ['version', 'createdAt', 'files'];
  if (Object.keys(archive).some((key) => !allowed.includes(key))) fail('The imported archive contains unsupported metadata.', 'INVALID_IMPORT');
  // The action is informational and is not imported; it only has to be a short code.
  if (own(archive, 'action') && !(typeof archive.action === 'string' && /^[a-z][a-z-]{0,47}$/.test(archive.action))) fail('The imported archive contains unsupported metadata.', 'INVALID_IMPORT');
  const files = snapshot ? archive.before : archive.files;
  if (!object(files) || Object.keys(files).length !== ALL_FILES.length || ALL_FILES.some((name) => !own(files, name)) || Object.keys(files).some((name) => !ALL_FILES.includes(name))) {
    fail('Import requires all nine native files and state.json, without additional file paths.', 'INVALID_IMPORT');
  }
  const raw = {};
  for (const name of ALL_FILES) {
    const value = files[name];
    if (typeof value !== 'string' && !(snapshot && value === null)) fail('Imported configuration files must be text.', 'INVALID_IMPORT');
    raw[name] = value === null && name !== 'state.json' ? DEFAULTS[name] : value;
  }
  validateSnapshotBytes(raw);
  return raw;
}

function backupTimestamp(name) {
  const m = /^backup-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z-/.exec(name);
  if (!m) return 0;
  const milliseconds = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.${m[7]}Z`);
  return Number.isFinite(milliseconds) ? milliseconds : 0;
}

async function verifyDirectory(directory, create = false, mode = 0o750) {
  const resolved = path.resolve(directory);
  let current = path.parse(resolved).root;
  for (const part of resolved.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    let stat;
    try { stat = await fs.lstat(current); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (!create) fail('A configured directory is missing.', 'MISSING_DIRECTORY', 500);
      try { await fs.mkdir(current, { mode }); } catch (mkdirError) { if (mkdirError.code !== 'EEXIST') throw mkdirError; }
      stat = await fs.lstat(current);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail('Configuration and state paths must use real directories, without symlinks.', 'UNSAFE_PATH', 400);
  }
  return resolved;
}

async function safeRead(file, maxBytes = MAX_FILE_BYTES) {
  let handle;
  try {
    const stat = await fs.lstat(file);
    if (stat.isSymbolicLink() || !stat.isFile()) fail('Configuration and state files must be regular files, without symlinks.', 'UNSAFE_PATH', 400);
    handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size > maxBytes) fail('Configuration file is too large or not a regular file.', 'INVALID_CONFIG');
    return await handle.readFile('utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    if (error.code === 'ELOOP') fail('Symlink file access is not allowed.', 'UNSAFE_PATH', 400);
    throw error;
  } finally { if (handle) await handle.close(); }
}

async function syncDirectory(directory) {
  const handle = await fs.open(directory, constants.O_RDONLY | constants.O_DIRECTORY);
  try { await handle.sync(); } finally { await handle.close(); }
}

async function safeRemove(file) {
  const current = await safeRead(file, 20 * MAX_FILE_BYTES);
  if (current == null) return;
  await fs.unlink(file);
  await syncDirectory(path.dirname(file));
}

async function atomicWrite(file, content, mode = 0o640) {
  await verifyDirectory(path.dirname(file));
  try {
    const stat = await fs.lstat(file);
    if (stat.isSymbolicLink() || !stat.isFile()) fail('Refusing to replace a symlink or non-file.', 'UNSAFE_PATH', 400);
    mode = stat.mode & 0o777;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = path.join(path.dirname(file), `.homepage-studio-${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await fs.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode);
    await handle.writeFile(content, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await verifyDirectory(path.dirname(file));
    const target = await fs.lstat(file).catch((error) => { if (error.code === 'ENOENT') return null; throw error; });
    if (target && (target.isSymbolicLink() || !target.isFile())) fail('Refusing to replace a symlink or non-file.', 'UNSAFE_PATH', 400);
    await fs.rename(temporary, file);
    await syncDirectory(path.dirname(file));
  } finally {
    if (handle) await handle.close();
    await fs.unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  }
}

function nodeValue(parsed, node) {
  return parsed.restore(node?.toJS ? node.toJS(parsed.doc, { maxAliasCount: 100 }) : node);
}

function updateNode(doc, existing, value, parsed) {
  if (stable(nodeValue(parsed, existing)) === stable(value)) return existing;
  if (isMap(existing) && object(value)) {
    for (const pair of [...existing.items]) if (!own(value, String(pair.key.value))) existing.delete(pair.key.value);
    for (const [key, entry] of Object.entries(value)) existing.set(key, updateNode(doc, existing.get(key, true), entry, parsed));
    return existing;
  }
  const replacement = doc.createNode(value);
  if (existing && replacement) {
    for (const property of ['comment', 'commentBefore', 'spaceBefore']) if (existing[property] != null) replacement[property] = existing[property];
  }
  return replacement;
}

function patchMap(doc, existing, patch, parsed) {
  if (!isMap(existing)) existing = doc.createNode(nodeValue(parsed, existing) ?? {});
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) existing.delete(key);
    else existing.set(key, updateNode(doc, existing.get(key, true), value, parsed));
  }
  return existing;
}

function renamePair(pair, name) {
  if (isScalar(pair.key)) pair.key.value = name;
  else pair.key = name;
}

function resolveGroup(group, groups, fallback) {
  if (group === undefined) return fallback;
  if (Array.isArray(group)) {
    if (!group.length || group.length > MAX_DEPTH) fail('A group path must contain between 1 and 20 names.');
    return group.map((entry) => named(entry, 'Group name'));
  }
  named(group, 'Group name');
  const exact = groups.filter((entry) => entry.label === group);
  if (exact.length === 1) return exact[0].path;
  const namedGroups = groups.filter((entry) => entry.name === group);
  if (namedGroups.length > 1 || exact.length > 1) fail('That group name is ambiguous; supply its complete path.', 'AMBIGUOUS_GROUP');
  return namedGroups.length === 1 ? namedGroups[0].path : [group];
}

function ensureGroup(doc, groupPath) {
  if (!doc.contents || (isScalar(doc.contents) && doc.contents.value == null)) doc.contents = doc.createNode([]);
  let sequence = doc.contents;
  for (const name of groupPath) {
    if (!isSeq(sequence)) fail('Group configuration is not a mutable YAML list.');
    let group = sequence.items.find((entry) => isMap(entry) && entry.has(name));
    if (!group) { group = doc.createNode({ [name]: [] }); sequence.add(group); }
    sequence = group.get(name, true);
    if (!isSeq(sequence)) fail(`"${name}" already exists as a service instead of a group.`);
  }
  return sequence;
}

/**
 * A single-process configuration writer. Run one Studio replica per config/state
 * directory pair. Writes are atomic per file, not atomically visible across
 * multiple files to Homepage. A durable journal restores interrupted transactions
 * on the next operation/startup; it refuses to overwrite unrelated external edits.
 */
export function createConfigStore({ configDir, stateDir, backupRetention = DEFAULT_BACKUP_RETENTION, discoveryReader }) {
  if (!configDir || !stateDir) fail('Both configDir and stateDir are required.', 'INVALID_STORE_OPTIONS', 500);
  if (!Number.isSafeInteger(backupRetention) || backupRetention < 1) fail('backupRetention must be a positive whole number.', 'INVALID_STORE_OPTIONS', 500);
  configDir = path.resolve(configDir);
  stateDir = path.resolve(stateDir);
  if (configDir === stateDir) fail('State and Homepage configuration must use separate directories.', 'INVALID_STORE_OPTIONS', 500);
  const backupsDir = path.join(stateDir, 'backups');
  const journalFile = path.join(stateDir, 'transaction.json');
  const location = (name) => {
    if (!ALL_FILES.includes(name)) fail('Unsupported configuration file.', 'UNSAFE_PATH', 400);
    return path.join(name === 'state.json' ? stateDir : configDir, name);
  };
  let initialized = false;
  let retentionWarning = null;
  let cachedDiscoveredSources = [];
  let incomingDiscoveredSources = null;
  let discoveryWarnings = [];
  let discoveryRefresh = null;
  const discoveryContext = () => ({ cached: cachedDiscoveredSources, incoming: incomingDiscoveredSources });
  let queue = Promise.resolve();
  const serialized = (operation) => {
    const next = queue.then(operation, operation);
    queue = next.catch(() => {});
    return next;
  };

  // Editing sessions (owner decision, 4 Nov 2026: autosave with Undo and
  // Redo). Every change the editor makes carries its session's key, which the
  // controller builds from the signed-in session and the editor's own id, so
  // one person's undo can only reach their own steps. Each committed change
  // records the files before it; undo puts them back while nothing else has
  // changed the dashboard since. Only a session's first change keeps its
  // snapshot, so the snapshot history holds one entry per editing session.
  // Steps live in memory: a restart or another writer ends undo.
  const editSessions = new Map();
  let activeEdit = null;
  const editEntry = (key, create) => {
    if (typeof key !== 'string' || !key || key.length > 256) return null;
    let entry = editSessions.get(key);
    if (!entry && create) {
      entry = { steps: [], redo: [], bytes: 0, started: false, usedAt: 0 };
      editSessions.set(key, entry);
      // The oldest idle sessions go first; a few people edit at once.
      while (editSessions.size > MAX_EDIT_SESSIONS) editSessions.delete(editSessions.keys().next().value);
    }
    if (entry) {
      entry.usedAt = Date.now();
      editSessions.delete(key);
      editSessions.set(key, entry);
    }
    return entry;
  };
  const rawBytes = (raw) => ALL_FILES.reduce((sum, name) => sum + (raw[name] == null ? 0 : Buffer.byteLength(raw[name])), 0);
  const pushStep = (entry, list, step) => {
    entry[list].push(step);
    entry.bytes += step.bytes;
    while (entry.steps.length + entry.redo.length > MAX_EDIT_STEPS || entry.bytes > MAX_EDIT_SESSION_BYTES) {
      const from = entry.steps.length ? entry.steps : entry.redo;
      entry.bytes -= from.shift().bytes;
    }
  };
  // Runs one editor change inside its editing session (if it names one).
  const editing = (change, operation) => serialized(async () => {
    const key = object(change) ? change.editSession : undefined;
    activeEdit = key === undefined ? null : { key, entry: editEntry(key, true), action: null };
    try { return await operation(); }
    finally { activeEdit = null; }
  });

  async function rawSnapshot() {
    await verifyDirectory(configDir);
    await verifyDirectory(stateDir);
    return Object.fromEntries(await Promise.all(ALL_FILES.map(async (name) => [name, await safeRead(location(name), name === 'state.json' ? MAX_STATE_BYTES : MAX_FILE_BYTES)])));
  }
  const revisionOf = (raw) => hash(JSON.stringify(ALL_FILES.map((name) => [name, raw[name]])));
  const backupLocation = (id) => {
    if (typeof id !== 'string' || !/^backup-[A-Za-z0-9-]{1,100}$/.test(id)) fail('Invalid backup identifier.', 'INVALID_BACKUP', 400);
    return path.join(backupsDir, `${id}.json`);
  };
  async function readBackup(id) {
    await verifyDirectory(backupsDir);
    const text = await safeRead(backupLocation(id), MAX_BACKUP_BYTES);
    if (text == null) fail('The requested backup does not exist.', 'BACKUP_NOT_FOUND', 404);
    let backup;
    try { backup = JSON.parse(text); } catch { fail('Backup metadata is invalid.', 'INVALID_BACKUP', 500); }
    const managedFiles = object(backup.before) ? Object.keys(backup.before) : [];
    if (backup.version !== 1 || !object(backup.before) || !object(backup.afterHashes) || ALL_FILES.some((name) => !managedFiles.includes(name)) || managedFiles.some((name) => !ALL_FILES.includes(name) || !(backup.before[name] === null || typeof backup.before[name] === 'string') || typeof backup.afterHashes[name] !== 'string') || !snapshotAction(backup.action)) {
      fail('Backup metadata is incomplete.', 'INVALID_BACKUP', 500);
    }
    return { ...backup, managedFiles };
  }
  async function recoverPending() {
    const text = await safeRead(journalFile);
    if (text == null) return;
    let journal;
    try { journal = JSON.parse(text); } catch { fail('A transaction journal needs manual recovery.', 'RECOVERY_REQUIRED', 503); }
    if (journal.version !== 1) fail('An unsupported transaction journal needs manual recovery.', 'RECOVERY_REQUIRED', 503);
    const backup = await readBackup(journal.backupId);
    const current = await rawSnapshot();
    if (backup.managedFiles.some((name) => fileHash(current[name]) !== fileHash(backup.before[name]) && fileHash(current[name]) !== backup.afterHashes[name])) {
      fail('An interrupted save and external file edits were found. The backup was preserved; resolve the transaction before saving again.', 'RECOVERY_REQUIRED', 503);
    }
    for (const name of backup.managedFiles) {
      if (current[name] === backup.before[name]) continue;
      if (backup.before[name] == null) await safeRemove(location(name));
      else await atomicWrite(location(name), backup.before[name], name === 'state.json' ? 0o600 : 0o640);
    }
    await safeRemove(journalFile);
  }

  async function pruneBackups() {
    // A journal's backup is recovery data, not an expired history entry. The
    // caller normally already recovered it; recheck before deleting anything.
    if (await safeRead(journalFile) !== null) return;
    const names = await orderedBackupNames();
    for (const name of names.slice(backupRetention)) {
      if (await safeRead(journalFile) !== null) return;
      await safeRemove(path.join(backupsDir, name));
    }
  }

  async function orderedBackupNames() {
    return (await fs.readdir(backupsDir)).filter((name) => /^backup-[A-Za-z0-9-]+\.json$/.test(name))
      .sort((a, b) => backupTimestamp(b) - backupTimestamp(a) || (a < b ? 1 : a > b ? -1 : 0));
  }

  async function nextBackupId() {
    // The filename is a logical ordering key, not the wall-clock display date.
    // Read the retained maximum so ties, clock rollback and process restarts
    // cannot cause the newest pre-save recovery point to be pruned first.
    const names = await orderedBackupNames();
    const milliseconds = Math.max(Date.now(), (names.length ? backupTimestamp(names[0]) : 0) + 1);
    return `backup-${new Date(milliseconds).toISOString().replace(/[-:.]/g, '')}-${randomUUID()}`;
  }

  async function maintainBackups() {
    try {
      await pruneBackups();
      retentionWarning = null;
    } catch {
      // The configuration commit has already finished. A history-cleanup error
      // must not make the client retry an otherwise successful save.
      retentionWarning = { code: 'BACKUP_RETENTION_FAILED', message: 'Configuration remains available, but older snapshots could not be removed. Check backup storage permissions and available space.' };
    }
  }
  async function ready() {
    if (!initialized) {
      await verifyDirectory(configDir, true);
      await verifyDirectory(stateDir, true, 0o700);
      await verifyDirectory(backupsDir, true, 0o700);
      initialized = true;
    }
    await recoverPending();
  }
  async function readCurrent() {
    await ready();
    const raw = await rawSnapshot();
    const parsed = parseSnapshot(raw, {}, discoveryContext());
    return { raw, ...parsed, revision: revisionOf(raw), configurationRevision: nativeRevisionOf(raw) };
  }
  async function discoverySnapshot(current) {
    await ready();
    const revision = current?.configurationRevision ?? nativeRevisionOf(await rawSnapshot());
    // Byte revisions alone cannot detect a configuration replacement followed
    // by a rollback to the same bytes while a native provider is still reading.
    // These filesystem identities stay private and are never sent to clients.
    const identities = await Promise.all(Object.values(FILES).map(async name => {
      try {
        const stat = await fs.lstat(location(name), { bigint: true });
        return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
      } catch (error) {
        if (error.code === 'ENOENT') return 'missing';
        throw error;
      }
    }));
    return revision + '\0' + identities.join('\0');
  }
  // Discovered widgets that arrived since the arrangement was last saved, so
  // the editor can offer to put them on a page. None before the first save.
  function newDiscoveredIds(current) {
    const stored = current.state.board?.panels;
    if (!Array.isArray(stored)) return [];
    const known = new Set(stored.map((panel) => panel.id));
    const discovered = new Set(current.discoveredSources.map((source) => source.id));
    return current.board.panels.filter((panel) => discovered.has(panel.id) && !known.has(panel.id)).map((panel) => panel.id);
  }
  function response(current) {
    return {
      revision: current.revision,
      configurationRevision: current.configurationRevision,
      ...Object.fromEntries(Object.entries(FILES).map(([field, file]) => [field, current.raw[file] ?? DEFAULTS[file]])),
      services: current.services,
      groups: current.groups,
      infoWidgets: current.infoWidgets.map(({ fingerprint, ...entry }) => entry),
      serviceWidgets: current.serviceWidgets.map(({ scope, key, fingerprint, ...entry }) => entry),
      bookmarks: current.bookmarks.map(({ scope, key, fingerprint, type, path, ...entry }) => entry),
      settingsConfig: current.parsed.settingsYaml.data ?? {},
      board: current.board,
      discoveredSources: current.discoveredSources,
      hiddenDiscoveredIds: current.hiddenDiscoveredIds,
      backupRetention,
      warnings: [...discoveryWarnings, ...(retentionWarning ? [retentionWarning] : [])],
    };
  }
  function checkRevision(supplied, current) {
    if (typeof supplied !== 'string' || supplied !== current.revision) {
      fail('The dashboard changed since it was loaded. Reload before saving to avoid overwriting newer changes.', 'REVISION_CONFLICT', 409, { currentRevision: current.revision });
    }
  }
  async function commit(current, desired, action) {
    // Validate the exact bytes that will be persisted, including generated
    // identity/layout state, before creating a backup or transaction journal.
    if (!snapshotAction(action)) throw new Error(`Unknown snapshot action: ${action}`);
    validateSnapshotBytes(desired);
    parseSnapshot(desired);
    const changedFiles = ALL_FILES.filter((name) => desired[name] !== current.raw[name]);
    if (!changedFiles.length) return;
    const backupId = await nextBackupId();
    const backup = {
      version: 1, createdAt: new Date().toISOString(), revision: current.revision, changedFiles,
      action,
      before: current.raw,
      afterHashes: Object.fromEntries(ALL_FILES.map((name) => [name, fileHash(desired[name])])),
    };
    const backupText = `${JSON.stringify(backup, null, 2)}\n`;
    if (Buffer.byteLength(backupText) > MAX_BACKUP_BYTES) fail('This save would create a snapshot larger than the supported backup limit.', 'BACKUP_SIZE_LIMIT');
    await atomicWrite(backupLocation(backupId), backupText, 0o600);
    if (revisionOf(await rawSnapshot()) !== current.revision) {
      await maintainBackups();
      fail('Configuration files changed while preparing the save. Reload before saving.', 'REVISION_CONFLICT', 409);
    }
    await atomicWrite(journalFile, `${JSON.stringify({ version: 1, backupId })}\n`, 0o600);
    try {
      for (const name of changedFiles) {
        if (await safeRead(location(name), name === 'state.json' ? MAX_STATE_BYTES : MAX_FILE_BYTES) !== current.raw[name]) {
          fail('A configuration file changed during the save.', 'REVISION_CONFLICT', 409);
        }
        if (desired[name] == null) await safeRemove(location(name));
        else await atomicWrite(location(name), desired[name], name === 'state.json' ? 0o600 : 0o640);
      }
      await safeRemove(journalFile);
    } catch (error) {
      try { await recoverPending(); }
      catch (recoveryError) { throw new ConfigError('The save did not finish. Its backup was preserved and recovery is required before another save.', 'RECOVERY_REQUIRED', 503, { cause: recoveryError.code }); }
      await maintainBackups();
      throw error;
    }
    const edit = activeEdit?.entry;
    if (edit) {
      // The save is complete, so its backup is no longer needed for recovery.
      if (edit.started) await safeRemove(backupLocation(backupId));
      edit.started = true;
      const step = { before: current.raw, afterRevision: revisionOf(await rawSnapshot()), bytes: rawBytes(current.raw) };
      if (activeEdit.action === 'undo') pushStep(edit, 'redo', step);
      else {
        if (activeEdit.action !== 'redo') { edit.bytes -= edit.redo.reduce((sum, item) => sum + item.bytes, 0); edit.redo = []; }
        pushStep(edit, 'steps', step);
      }
    }
    await maintainBackups();
  }

  // Undo (or redo) the editing session's latest step.
  async function stepEditInner(change, direction) {
    const entry = editEntry(change.editSession, false);
    const list = direction === 'undo' ? entry?.steps : entry?.redo;
    if (!list?.length) fail(direction === 'undo' ? 'There is nothing to undo.' : 'There is nothing to redo.', 'NOTHING_TO_UNDO', 409);
    const current = await readCurrent();
    checkRevision(change.revision, current);
    const step = list.at(-1);
    if (current.revision !== step.afterRevision) {
      editSessions.delete(change.editSession);
      fail('This dashboard was changed somewhere else, so this step can no longer be undone.', 'UNDO_UNAVAILABLE', 409);
    }
    list.pop();
    entry.bytes -= step.bytes;
    activeEdit.action = direction;
    await commit(current, { ...step.before }, direction === 'undo' ? 'change-undone' : 'change-redone');
    // The board only, like an arrangement save: people who may arrange (but
    // not read settings) can undo their own moves.
    const result = response(await readCurrent());
    return { revision: result.revision, configurationRevision: result.configurationRevision, board: result.board, discoveredSources: result.discoveredSources, hiddenDiscoveredIds: result.hiddenDiscoveredIds, warnings: result.warnings, canUndo: entry.steps.length > 0, canRedo: entry.redo.length > 0 };
  }
  async function saveCurrent(current, change, action, forced = {}, restoredState) {
    checkRevision(change.revision, current);
    const desired = { ...current.raw };
    for (const [field, file] of Object.entries(FILES)) if (own(change, field)) {
      if (typeof change[field] !== 'string') fail(`${file} must be supplied as text.`);
      desired[file] = change[field];
    }
    // Exact restore uses the snapshot's source identities and board, while the
    // optimistic revision continues to guard the current configuration.
    if (restoredState) desired['state.json'] = JSON.stringify(restoredState);
    // A content edit can carry the editor's arrangement (its look, page and
    // the rest of the draft). It becomes the layout the new content is
    // reconciled into, so both commit together.
    if (own(change, 'arrangement')) {
      const state = decodeState(desired['state.json']);
      state.board = validateStoredBoard(change.arrangement);
      desired['state.json'] = JSON.stringify(state);
    }
    if (own(change, 'hiddenDiscoveredIds')) {
      const state = decodeState(desired['state.json']);
      state.hiddenDiscoveredIds = validateHiddenDiscoveredIds(change.hiddenDiscoveredIds);
      const known = new Set(current.discoveredSources.map((source) => source.id));
      if (state.hiddenDiscoveredIds.some((id) => !known.has(id))) fail('That discovered panel is not known to this dashboard.', 'TILE_NOT_FOUND', 404);
      desired['state.json'] = JSON.stringify(state);
    }
    // New content lands on the page the editor was looking at.
    const candidate = parseSnapshot(desired, forced, discoveryContext(), { pageId: typeof change.pageId === 'string' ? change.pageId : undefined });
    const state = {
      version: 2,
      infoWidgets: candidate.infoWidgets.map(({ id, type, fingerprint }) => ({ id, type, fingerprint })),
      serviceWidgets: identityRecords(candidate.serviceWidgets),
      bookmarks: identityRecords(candidate.bookmarks),
      discoveredSources: candidate.discoveredSources.map(({ available, ...source }) => source),
      hiddenDiscoveredIds: candidate.hiddenDiscoveredIds,
      board: own(change, 'board') ? (action === 'arrangement-saved' ? mergeBoardChange(change.board, candidate.sources, current.board) : validateBoardChange(change.board, candidate.sources)) : candidate.board,
    };
    desired['state.json'] = `${JSON.stringify(state, null, 2)}\n`;
    await commit(current, desired, action);
    return response(await readCurrent());
  }

  const WIDGET_SERVICE_KEYS = new Set(['name', 'href', 'icon', 'description', 'siteMonitor', 'ping']);
  async function mutateServiceInner(change) {
    const current = await readCurrent();
    checkRevision(change.revision, current);
    if (!['add', 'update', 'delete'].includes(change.action)) fail('Unknown tile action.', 'INVALID_ACTION', 400);
    const parsed = current.parsed.servicesYaml;
    const { doc } = parsed;
    const existing = change.action === 'add' ? null : current.services.find((entry) => entry.id === change.id);
    if (change.action !== 'add' && !existing) fail('That service tile no longer exists.', 'TILE_NOT_FOUND', 404);
    if (change.action === 'delete') {
      const parent = doc.getIn(existing.path.slice(0, -2), true);
      if (!isSeq(parent)) fail('This service uses an unsupported YAML alias. Edit its YAML directly.');
      parent.items.splice(existing.index, 1);
    } else {
      const name = named(change.name ?? existing?.name, 'Service name');
      const groupPath = resolveGroup(change.group, current.groups, existing?.groupPath ?? ['Services']);
      if (current.services.some((entry) => entry.id !== existing?.id && entry.name === name && stable(entry.groupPath) === stable(groupPath))) {
        fail(`Another link is already called “${name}”. Use a different name.`, 'DUPLICATE_SERVICE');
      }
      const patch = change.config ?? {};
      if (!object(patch)) fail('Service config must be a mapping.');
      if (change.action === 'add') {
        const config = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== null));
        config.id = `studio-${randomUUID()}`;
        validateServiceConfig(config, 'Service');
        ensureGroup(doc, groupPath).add(doc.createNode({ [name]: config }));
      } else {
        const parent = doc.getIn(existing.path.slice(0, -2), true);
        const entry = parent?.items?.[existing.index];
        if (!isSeq(parent) || !isMap(entry)) fail('This service uses an unsupported YAML alias. Edit its YAML directly.');
        const servicePatch = { ...patch, id: existing.config.id || existing.id };
        entry.set(existing.name, patchMap(doc, entry.get(existing.name, true), servicePatch, parsed));
        renamePair(entry.items[0], name);
        if (stable(groupPath) !== stable(existing.groupPath)) {
          parent.items.splice(existing.index, 1);
          ensureGroup(doc, groupPath).add(entry);
        }
      }
    }
    return saveCurrent(current, { ...withBoard(change), revision: change.revision, pageId: change.pageId, servicesYaml: parsed.text() }, `service-${CONTENT_ACTIONS[change.action]}`);
  }

  async function mutateInfoInner(change) {
    const current = await readCurrent();
    checkRevision(change.revision, current);
    if (!['add', 'update', 'delete'].includes(change.action)) fail('Unknown information widget action.', 'INVALID_ACTION', 400);
    const existing = change.action === 'add' ? null : current.infoWidgets.find((entry) => entry.id === change.id);
    if (change.action !== 'add' && !existing) fail('That information widget no longer exists.', 'TILE_NOT_FOUND', 404);
    const parsed = current.parsed.widgetsYaml;
    const { doc } = parsed;
    if (!doc.contents || (isScalar(doc.contents) && doc.contents.value == null)) doc.contents = doc.createNode([]);
    if (!isSeq(doc.contents)) fail('widgets.yaml must be a mutable YAML list.');
    const identities = current.infoWidgets.map(({ id }) => ({ id }));
    if (change.action === 'delete') {
      doc.contents.items.splice(existing.index, 1);
      identities.splice(existing.index, 1);
    } else {
      const type = named(change.type ?? existing?.type, 'Information widget type');
      const config = change.config ?? {};
      if (!object(config)) fail('Information widget config must be a mapping.');
      if (change.action === 'add') {
        doc.contents.add(doc.createNode({ [type]: Object.fromEntries(Object.entries(config).filter(([, value]) => value !== null)) }));
        identities.push({ id: `info-${randomUUID()}` });
      } else {
        const entry = doc.contents.items[existing.index];
        if (!isMap(entry)) fail('This information widget uses an unsupported YAML alias. Edit its YAML directly.');
        entry.set(existing.type, patchMap(doc, entry.get(existing.type, true), config, parsed));
        renamePair(entry.items[0], type);
      }
    }
    return saveCurrent(current, { ...withBoard(change), revision: change.revision, pageId: change.pageId, widgetsYaml: parsed.text() }, `info-widget-${CONTENT_ACTIONS[change.action]}`, { infoWidgets: identities });
  }

  async function mutateBookmarkInner(change) {
    const current = await readCurrent();
    checkRevision(change.revision, current);
    if (!['add', 'update', 'delete'].includes(change.action)) fail('Unknown bookmark action.', 'INVALID_ACTION', 400);
    const existing = change.action === 'add' ? null : current.bookmarks.find((entry) => entry.id === change.id);
    if (change.action !== 'add' && !existing) fail('That bookmark no longer exists.', 'TILE_NOT_FOUND', 404);
    const parsed = current.parsed.bookmarksYaml, { doc } = parsed;
    const identities = new Map(current.bookmarks.map((entry) => [JSON.stringify([entry.group, entry.name]), entry.id]));
    if (change.action === 'delete') {
      const parent = doc.getIn([existing.groupIndex, existing.group], true);
      if (!isSeq(parent)) fail('This bookmark uses an unsupported YAML alias. Edit its YAML directly.');
      parent.items.splice(existing.index, 1);
      identities.delete(JSON.stringify([existing.group, existing.name]));
    } else {
      const group = named(change.group ?? existing?.group ?? 'Bookmarks', 'Bookmark group');
      const name = named(change.name ?? existing?.name, 'Bookmark name');
      if (current.bookmarks.some((entry) => entry.id !== existing?.id && entry.group === group && entry.name === name)) fail('That bookmark already exists in this group.', 'DUPLICATE_BOOKMARK');
      const config = change.config ?? {};
      if (!object(config)) fail('Bookmark config must be a mapping.');
      if (change.action === 'add') {
        const options = Object.fromEntries(Object.entries(config).filter(([, value]) => value !== null));
        validateBookmarkDestination(options);
        ensureGroup(doc, [group]).add(doc.createNode({ [name]: [options] }));
        identities.set(JSON.stringify([group, name]), `bookmark-${randomUUID()}`);
      } else {
        const parent = doc.getIn([existing.groupIndex, existing.group], true), entry = parent?.items?.[existing.index];
        if (!isSeq(parent) || !isMap(entry)) fail('This bookmark uses an unsupported YAML alias. Edit its YAML directly.');
        const options = entry.get(existing.name, true);
        if (!isSeq(options)) fail('Bookmark options must be a mutable YAML list.');
        if (!options.items.length) options.add(doc.createNode({}));
        options.items[0] = patchMap(doc, options.items[0], config, parsed);
        validateBookmarkDestination(nodeValue(parsed, options.items[0]));
        renamePair(entry.items[0], name);
        if (group !== existing.group) { parent.items.splice(existing.index, 1); ensureGroup(doc, [group]).add(entry); }
        identities.delete(JSON.stringify([existing.group, existing.name]));
        identities.set(JSON.stringify([group, name]), existing.id);
      }
    }
    const text = parsed.text();
    const forced = bookmarkEntries(yamlDocument(text, 'bookmarks.yaml').data).map((entry) => ({ id: identities.get(JSON.stringify([entry.group, entry.name])) }));
    return saveCurrent(current, { ...withBoard(change), revision: change.revision, pageId: change.pageId, bookmarksYaml: text }, `bookmark-${CONTENT_ACTIONS[change.action]}`, { bookmarks: forced });
  }

  async function mutateServiceWidgetInner(change) {
    const current = await readCurrent();
    checkRevision(change.revision, current);
    if (!['add', 'update', 'delete'].includes(change.action)) fail('Unknown service widget action.', 'INVALID_ACTION', 400);
    const existing = change.action === 'add' ? null : current.serviceWidgets.find((entry) => entry.id === change.id);
    if (change.action !== 'add' && !existing) fail('That service widget no longer exists.', 'TILE_NOT_FOUND', 404);
    let service = current.services.find((entry) => entry.id === (existing?.serviceId ?? change.serviceId));
    const parsed = current.parsed.servicesYaml, { doc } = parsed;
    const byService = new Map(current.services.map((entry) => [entry.id, current.serviceWidgets.filter((widget) => widget.serviceId === entry.id).map(({ id }) => ({ id }))]));
    if (change.action === 'add' && !service && object(change.newService)) {
      // Every widget is self-contained (owner rule, 4 Nov 2026): it gets its
      // own entry in the one group Studio keeps (Q2: no group to choose). The
      // same integration can be added again; a repeated name gets a number.
      const groupPath = resolveGroup(change.newService.group, current.groups, ['Services']);
      const taken = new Set(current.services.filter((entry) => stable(entry.groupPath) === stable(groupPath)).map((entry) => entry.name));
      const wanted = named(change.newService.name, 'Widget name');
      let name = wanted;
      for (let index = 2; taken.has(name); index++) name = `${wanted} ${index}`;
      const id = `studio-widget-parent-${randomUUID()}`;
      ensureGroup(doc, groupPath).add(doc.createNode({ [name]: { id } }));
      service = serviceEntries(yamlDocument(parsed.text(), 'services.yaml').data).services.find((entry) => entry.id === id);
      byService.set(id, []);
    }
    if (!service) fail('Choose an existing service or provide a new service name and group.', 'TILE_NOT_FOUND', 404);
    const parent = doc.getIn(service.path.slice(0, -2), true), entry = parent?.items?.[service.index];
    if (!isSeq(parent) || !isMap(entry)) fail('This service uses an unsupported YAML alias. Edit its YAML directly.');
    let options = entry.get(service.name, true);
    if (!isMap(options)) fail('This service uses an unsupported YAML alias. Edit its YAML directly.');
    // Pin a formerly name-derived service ID before changing its widget context.
    options.set('id', service.id);
    // The widget's name, link and status check are its service's (the card
    // shows them), so the widget dialog changes them in the same save.
    if (change.action !== 'delete' && change.service !== undefined) {
      if (!object(change.service) || Object.keys(change.service).some((key) => !WIDGET_SERVICE_KEYS.has(key))) fail('Only the widget\'s name, link, icon, description and status check can change with it.');
      const { name: rename, ...servicePatch } = change.service;
      if (Object.values(servicePatch).some((value) => value !== null && (typeof value !== 'string' || value.length > 4096))) fail('A widget\'s link, icon, description and status address are text.');
      if (Object.keys(servicePatch).length) {
        const next = patchMap(doc, options, servicePatch, parsed);
        validateServiceConfig(Object.fromEntries(Object.entries({ ...service.config, ...servicePatch }).filter(([, value]) => value !== null)), 'Widget');
        entry.set(service.name, next);
        options = entry.get(service.name, true);
      }
      if (rename !== undefined && rename !== service.name) {
        const name = named(rename, 'Widget name');
        if (current.services.some((other) => other.id !== service.id && other.name === name && stable(other.groupPath) === stable(service.groupPath))) fail(`Another widget is already called “${name}”. Use a different name.`, 'DUPLICATE_SERVICE');
        renamePair(entry.items[0], name);
      }
    }
    const identities = byService.get(service.id);
    if (change.action === 'delete') {
      if (existing.sourceKey === 'widget') options.delete('widget');
      else {
        const list = options.get('widgets', true);
        if (!isSeq(list)) fail('These widgets use an unsupported YAML alias. Edit their YAML directly.');
        list.items.splice(existing.sourceIndex, 1);
        if (!list.items.length) options.delete('widgets');
      }
      identities.splice(existing.index, 1);
      // The widget card was the service's only card (its link and status
      // belong to it), so removing the service's last widget removes the
      // whole entry rather than leaving a link card behind.
      if (!options.has('widget') && !options.has('widgets')) { parent.items.splice(service.index, 1); byService.delete(service.id); }
    } else {
      const type = named(change.type ?? change.config?.type ?? existing?.type, 'Service widget type');
      const patch = change.config ?? {};
      if (!object(patch)) fail('Service widget config must be a mapping.');
      if (change.action === 'add') {
        let list = options.get('widgets', true);
        if (list == null) { options.set('widgets', doc.createNode([])); list = options.get('widgets', true); }
        if (!isSeq(list)) fail('These widgets use an unsupported YAML alias. Edit their YAML directly.');
        const position = list.items.length;
        list.add(doc.createNode({ ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== null)), type }));
        identities.splice(position, 0, { id: `widget-${randomUUID()}` });
      } else if (existing.sourceKey === 'widget') {
        options.set('widget', patchMap(doc, options.get('widget', true), { ...patch, type }, parsed));
      } else {
        const list = options.get('widgets', true);
        if (!isSeq(list)) fail('These widgets use an unsupported YAML alias. Edit their YAML directly.');
        list.items[existing.sourceIndex] = patchMap(doc, list.items[existing.sourceIndex], { ...patch, type }, parsed);
      }
    }
    const text = parsed.text();
    const newServices = serviceEntries(yamlDocument(text, 'services.yaml').data).services;
    const forcedIdentities = newServices.flatMap((entry) => byService.get(entry.id) ?? []);
    return saveCurrent(current, { ...withBoard(change), revision: change.revision, pageId: change.pageId, servicesYaml: text }, `service-widget-${CONTENT_ACTIONS[change.action]}`, { serviceWidgets: forcedIdentities });
  }


  // Deletes a page and everything on it in one save: services, their
  // widgets, information widgets and bookmarks are removed from their files,
  // and discovered panels are hidden. The snapshot taken before the save is
  // the way back.
  // Removes these sources from their files: services (with their widgets),
  // lone widgets, information widgets and bookmarks. Discovered panels are
  // hidden instead. Returns the new file texts and source identities.
  function removeSources(current, ids) {
    const descending = (a, b) => b.index - a.index;
    // Services and the service widgets of services that stay.
    const services = current.parsed.servicesYaml;
    const removedServices = new Set(current.services.filter((entry) => ids.has(entry.id)).map((entry) => entry.id));
    const byService = new Map(current.services.map((entry) => [entry.id, current.serviceWidgets.filter((widget) => widget.serviceId === entry.id).map(({ id }) => ({ id }))]));
    const widgets = current.serviceWidgets.filter((widget) => ids.has(widget.id) && !removedServices.has(widget.serviceId));
    for (const service of current.services) {
      const mine = widgets.filter((widget) => widget.serviceId === service.id);
      if (!mine.length) continue;
      const parent = services.doc.getIn(service.path.slice(0, -2), true), entry = parent?.items?.[service.index];
      const options = isMap(entry) ? entry.get(service.name, true) : null;
      if (!isSeq(parent) || !isMap(options)) fail('A service here uses an unsupported YAML alias. Edit its YAML directly.');
      options.set('id', service.id);
      if (mine.some((widget) => widget.sourceKey === 'widget')) options.delete('widget');
      const listed = mine.filter((widget) => widget.sourceKey !== 'widget').sort((a, b) => b.sourceIndex - a.sourceIndex);
      if (listed.length) {
        const list = options.get('widgets', true);
        if (!isSeq(list)) fail('Widgets here use an unsupported YAML alias. Edit their YAML directly.');
        for (const widget of listed) list.items.splice(widget.sourceIndex, 1);
        if (!list.items.length) options.delete('widgets');
      }
      byService.set(service.id, byService.get(service.id).filter((identity) => !mine.some((widget) => widget.id === identity.id)));
      if (!options.has('widget') && !options.has('widgets')) removedServices.add(service.id);
    }
    // Every node is found before any is removed, then removed by identity,
    // so removing a service never shifts the path of one in a nested group.
    const doomed = current.services.filter((entry) => removedServices.has(entry.id)).map((service) => {
      const parent = services.doc.getIn(service.path.slice(0, -2), true);
      if (!isSeq(parent) || !parent.items[service.index]) fail('A service here uses an unsupported YAML alias. Edit its YAML directly.');
      return { parent, node: parent.items[service.index] };
    });
    for (const { parent, node } of doomed) parent.items.splice(parent.items.indexOf(node), 1);
    // Information widgets.
    const info = current.parsed.widgetsYaml;
    const infoGone = current.infoWidgets.filter((entry) => ids.has(entry.id)).sort(descending);
    if (infoGone.length && !isSeq(info.doc.contents)) fail('widgets.yaml must be a mutable YAML list.');
    for (const entry of infoGone) info.doc.contents.items.splice(entry.index, 1);
    // Bookmarks.
    const marks = current.parsed.bookmarksYaml;
    const markIdentities = new Map(current.bookmarks.map((entry) => [JSON.stringify([entry.group, entry.name]), entry.id]));
    const markGroups = new Map();
    for (const entry of current.bookmarks.filter((item) => ids.has(item.id))) {
      const key = JSON.stringify([entry.groupIndex, entry.group]);
      markGroups.set(key, [...(markGroups.get(key) || []), entry]);
      markIdentities.delete(JSON.stringify([entry.group, entry.name]));
    }
    for (const [key, list] of markGroups) {
      const parent = marks.doc.getIn(JSON.parse(key), true);
      if (!isSeq(parent)) fail('A bookmark here uses an unsupported YAML alias. Edit its YAML directly.');
      for (const entry of list.sort(descending)) parent.items.splice(entry.index, 1);
    }
    const servicesText = services.text(), bookmarksText = marks.text();
    const forced = {
      serviceWidgets: serviceEntries(yamlDocument(servicesText, 'services.yaml').data).services.flatMap((entry) => byService.get(entry.id) ?? []),
      infoWidgets: current.infoWidgets.filter((entry) => !ids.has(entry.id)).map(({ id }) => ({ id })),
      bookmarks: bookmarkEntries(yamlDocument(bookmarksText, 'bookmarks.yaml').data).map((entry) => ({ id: markIdentities.get(JSON.stringify([entry.group, entry.name])) })),
    };
    const discovered = new Set(current.discoveredSources.map((source) => source.id));
    const hidden = [...new Set([...current.hiddenDiscoveredIds, ...[...ids].filter((id) => discovered.has(id))])];
    return { servicesText, widgetsText: info.text(), bookmarksText, forced, hidden };
  }

  async function deletePageInner(change) {
    const current = await readCurrent();
    checkRevision(change.revision, current);
    const { board } = current;
    if (typeof change.pageId !== 'string' || !board.pages.some((page) => page.id === change.pageId)) fail('That page no longer exists.', 'TILE_NOT_FOUND', 404);
    if (board.pages.length < 2) fail('A dashboard keeps at least one page.');
    const ids = new Set(board.panels.filter((panel) => panel.pageId === change.pageId).map((panel) => panel.id));
    const { servicesText, widgetsText, bookmarksText, forced, hidden } = removeSources(current, ids);
    // The page goes from the layout; anything left on it moves to the first page.
    const state = decodeState(current.raw['state.json']);
    const pages = board.pages.filter((page) => page.id !== change.pageId);
    const keep = (unit) => (unit.pageId === change.pageId ? { ...unit, pageId: pages[0].id } : unit);
    state.board = {
      ...board,
      pages,
      panels: board.panels.filter((panel) => !ids.has(panel.id)).map(keep),
      stacks: board.stacks.filter((stack) => stack.pageId !== change.pageId),
    };
    return saveCurrent(current, { revision: change.revision, servicesYaml: servicesText, widgetsYaml: widgetsText, bookmarksYaml: bookmarksText, hiddenDiscoveredIds: hidden }, 'page-deleted', forced, state);
  }

  // Deletes several widgets in one save (the bulk bar). The board follows
  // the files, and a stack left with one member releases it.
  async function deletePanelsInner(change) {
    const current = await readCurrent();
    checkRevision(change.revision, current);
    const ids = panelIdSet(change.ids, current.board);
    const { servicesText, widgetsText, bookmarksText, forced, hidden } = removeSources(current, ids);
    return saveCurrent(current, { revision: change.revision, servicesYaml: servicesText, widgetsYaml: widgetsText, bookmarksYaml: bookmarksText, hiddenDiscoveredIds: hidden }, 'widgets-deleted', forced);
  }

  function panelIdSet(value, board) {
    if (!Array.isArray(value) || !value.length || value.length > MAX_PANELS || value.some((id) => typeof id !== 'string')) fail('Choose the widgets to change.');
    const known = new Set(board.panels.map((panel) => panel.id));
    if (value.some((id) => !known.has(id))) fail('A chosen widget no longer exists. Reload and try again.', 'TILE_NOT_FOUND', 404);
    return new Set(value);
  }

  // Copies these sources in their files, each named "… copy": a service
  // with every widget it carries, a lone widget, an information widget or a
  // bookmark. Returns the new texts, identities and old → new ids.
  function copySources(current, ids) {
    const idMap = new Map();
    const copyName = (base, taken) => {
      let candidate = `${base} copy`;
      for (let n = 2; taken.has(candidate); n += 1) candidate = `${base} copy ${n}`;
      taken.add(candidate);
      return candidate;
    };
    // Services. Every widget is self-contained (owner rule, 4 Nov 2026): a
    // copied widget gets its own copy of its service (link, icon, status),
    // holding only the widgets chosen, so the copy never shares an entry
    // with its original. A chosen service is copied with all its widgets.
    const services = current.parsed.servicesYaml;
    const byService = new Map(current.services.map((entry) => [entry.id, current.serviceWidgets.filter((widget) => widget.serviceId === entry.id).map(({ id }) => ({ id }))]));
    for (const service of current.services) {
      const widgets = current.serviceWidgets.filter((widget) => widget.serviceId === service.id);
      const whole = ids.has(service.id);
      const chosen = whole ? widgets : widgets.filter((widget) => ids.has(widget.id));
      if (!whole && !chosen.length) continue;
      const parent = services.doc.getIn(service.path.slice(0, -2), true), entry = parent?.items?.[service.index];
      if (!isSeq(parent) || !isMap(entry)) fail('A service here uses an unsupported YAML alias. Edit its YAML directly.');
      const taken = new Set(current.services.filter((other) => stable(other.groupPath) === stable(service.groupPath)).map((other) => other.name));
      const copy = entry.clone();
      renamePair(copy.items[0], copyName(service.name, taken));
      const options = copy.items[0].value;
      if (!isMap(options)) fail('A service here uses an unsupported YAML alias. Edit its YAML directly.');
      if (!whole) {
        if (options.has('widget') && !chosen.some((widget) => widget.sourceKey === 'widget')) options.delete('widget');
        const list = options.get('widgets', true);
        if (list != null) {
          if (!isSeq(list)) fail('Widgets here use an unsupported YAML alias. Edit their YAML directly.');
          const keep = new Set(chosen.filter((widget) => widget.sourceKey !== 'widget').map((widget) => widget.sourceIndex));
          list.items = list.items.filter((_, index) => keep.has(index));
          if (!list.items.length) options.delete('widgets');
        }
      }
      const newId = `${service.id.startsWith('studio-widget-parent-') ? 'studio-widget-parent' : 'studio'}-${randomUUID()}`;
      options.set('id', newId);
      // Appended, so the positions of entries read earlier stay valid.
      parent.add(copy);
      if (whole) idMap.set(service.id, newId);
      // Identities follow the copy's widget order: the list first, then a
      // single `widget` key, as serviceEntries reads them.
      const ordered = [...chosen].sort((a, b) => a.index - b.index);
      byService.set(newId, ordered.map((widget) => {
        const fresh = `widget-${randomUUID()}`;
        idMap.set(widget.id, fresh);
        return { id: fresh };
      }));
    }
    // Information widgets.
    const info = current.parsed.widgetsYaml;
    const infoIdentities = current.infoWidgets.map(({ id }) => ({ id }));
    for (const widget of current.infoWidgets.filter((item) => ids.has(item.id))) {
      if (!isSeq(info.doc.contents)) fail('widgets.yaml must be a mutable YAML list.');
      info.doc.contents.add(info.doc.contents.items[widget.index].clone());
      const fresh = `info-${randomUUID()}`;
      infoIdentities.push({ id: fresh });
      idMap.set(widget.id, fresh);
    }
    // Bookmarks.
    const marks = current.parsed.bookmarksYaml;
    const markIdentities = new Map(current.bookmarks.map((entry) => [JSON.stringify([entry.group, entry.name]), entry.id]));
    for (const bookmark of current.bookmarks.filter((item) => ids.has(item.id))) {
      const parent = marks.doc.getIn([bookmark.groupIndex, bookmark.group], true);
      const entry = parent?.items?.[bookmark.index];
      if (!isSeq(parent) || !isMap(entry)) fail('A bookmark here uses an unsupported YAML alias. Edit its YAML directly.');
      const taken = new Set(current.bookmarks.filter((other) => other.group === bookmark.group).map((other) => other.name));
      const copy = entry.clone();
      const copied = copyName(bookmark.name, taken);
      renamePair(copy.items[0], copied);
      parent.add(copy);
      const fresh = `bookmark-${randomUUID()}`;
      markIdentities.set(JSON.stringify([bookmark.group, copied]), fresh);
      idMap.set(bookmark.id, fresh);
    }
    const servicesText = services.text(), bookmarksText = marks.text();
    const forced = {
      serviceWidgets: serviceEntries(yamlDocument(servicesText, 'services.yaml').data).services.flatMap((entry) => byService.get(entry.id) ?? []),
      infoWidgets: infoIdentities,
      bookmarks: bookmarkEntries(yamlDocument(bookmarksText, 'bookmarks.yaml').data).map((entry) => ({ id: markIdentities.get(JSON.stringify([entry.group, entry.name])) })),
    };
    return { servicesText, widgetsText: info.text(), bookmarksText, forced, idMap };
  }

  // Duplicates several widgets in one save (the bulk bar). Each copy keeps
  // its original's look, behaviour and size, on the same page in the next
  // free space; a stack copied whole stays a stack.
  async function duplicatePanelsInner(change) {
    const current = await readCurrent();
    checkRevision(change.revision, current);
    const { board } = current;
    const ids = panelIdSet(change.ids, board);
    if (board.panels.some((panel) => ids.has(panel.id) && panel.nativeLocator?.discovered)) fail('Discovered widgets belong to their provider and cannot be duplicated.');
    const { servicesText, widgetsText, bookmarksText, forced, idMap } = copySources(current, ids);
    const state = decodeState(current.raw['state.json']);
    const stacked = new Set(board.stacks.flatMap((stack) => stack.panelIds));
    const occupied = (pageId, extra) => [
      ...board.stacks.filter((stack) => stack.pageId === pageId).map((stack) => stack.rect),
      ...board.panels.filter((panel) => panel.pageId === pageId && !stacked.has(panel.id)).map((panel) => panel.rect),
      ...extra.filter((unit) => unit.pageId === pageId).map((unit) => unit.rect),
    ];
    const columnsOn = (pageId) => columnsOfPage(board.pages.find((page) => page.id === pageId));
    const added = [];
    const stacks = [];
    for (const stack of board.stacks.filter((item) => item.panelIds.every((id) => idMap.has(id)))) {
      const rect = nextPosition({ w: stack.rect.w, h: stack.rect.h }, occupied(stack.pageId, added), columnsOn(stack.pageId));
      const copy = { ...stack, id: `stack-${randomUUID()}`, rect, panelIds: stack.panelIds.map((id) => idMap.get(id)) };
      stacks.push(copy);
      added.push(copy);
    }
    const inStack = new Set(stacks.flatMap((stack) => stack.panelIds));
    const clones = board.panels.filter((panel) => idMap.has(panel.id)).map((panel) => {
      const id = idMap.get(panel.id);
      const owner = stacks.find((stack) => stack.panelIds.includes(id));
      const rect = owner ? { ...owner.rect } : nextPosition({ w: panel.rect.w, h: panel.rect.h }, occupied(panel.pageId, added), columnsOn(panel.pageId));
      const clone = { ...panel, id, rect, pageId: owner ? owner.pageId : panel.pageId };
      if (!inStack.has(id)) added.push(clone);
      return clone;
    });
    state.board = { ...board, panels: [...board.panels, ...clones], stacks: [...board.stacks, ...stacks] };
    const result = await saveCurrent(current, { revision: change.revision, servicesYaml: servicesText, widgetsYaml: widgetsText, bookmarksYaml: bookmarksText }, 'widgets-duplicated', forced, state);
    return { ...result, ids: clones.map((panel) => panel.id), skipped: ids.size - clones.length };
  }

  // Duplicates a page and everything on it in one save: each service (with
  // its widgets), lone widget, information widget and bookmark gets a copy
  // named "… copy", placed and styled like the original on a new page.
  // Discovered panels belong to their provider and are not copied.
  async function duplicatePageInner(change) {
    const current = await readCurrent();
    checkRevision(change.revision, current);
    const { board } = current;
    const page = board.pages.find((item) => item.id === change.pageId);
    if (!page) fail('That page no longer exists.', 'TILE_NOT_FOUND', 404);
    if (board.pages.length >= 20) fail('A dashboard has at most 20 pages.');
    const pageIds = new Set(board.pages.map((item) => item.id));
    const names = new Set(board.pages.map((item) => item.name.toLocaleLowerCase()));
    let name = `${page.name} copy`.slice(0, 40);
    for (let n = 2; names.has(name.toLocaleLowerCase()); n += 1) name = `${page.name.slice(0, 32)} copy ${n}`;
    let newPageId = `${page.id.slice(0, 58)}-copy`;
    for (let n = 2; pageIds.has(newPageId); n += 1) newPageId = `${page.id.slice(0, 55)}-copy-${n}`;
    const onPage = board.panels.filter((panel) => panel.pageId === page.id);
    const ids = new Set(onPage.map((panel) => panel.id));
    const { servicesText, widgetsText, bookmarksText, forced, idMap } = copySources(current, ids);
    // The new page, with each copy where its original sits.
    const state = decodeState(current.raw['state.json']);
    const clones = onPage.filter((panel) => idMap.has(panel.id)).map((panel) => ({ ...panel, id: idMap.get(panel.id), pageId: newPageId }));
    const stacks = board.stacks.filter((stack) => stack.pageId === page.id && stack.panelIds.every((id) => idMap.has(id)))
      .map((stack) => ({ ...stack, id: `stack-${randomUUID()}`, pageId: newPageId, panelIds: stack.panelIds.map((id) => idMap.get(id)) }));
    const pages = [...board.pages];
    pages.splice(board.pages.indexOf(page) + 1, 0, { ...page, id: newPageId, name });
    state.board = { ...board, pages, panels: [...board.panels, ...clones], stacks: [...board.stacks, ...stacks] };
    const result = await saveCurrent(current, { revision: change.revision, pageId: newPageId, servicesYaml: servicesText, widgetsYaml: widgetsText, bookmarksYaml: bookmarksText }, 'page-duplicated', forced, state);
    return { ...result, pageId: newPageId, skipped: onPage.filter((panel) => !idMap.has(panel.id)).length };
  }

  async function mutateSettingsInner(change) {
    const current = await readCurrent();
    checkRevision(change.revision, current);
    if (!object(change.config)) fail('Settings must be supplied as a mapping.');
    const parsed = current.parsed.settingsYaml;
    parsed.doc.contents = patchMap(parsed.doc, parsed.doc.contents, change.config, parsed);
    return saveCurrent(current, { ...withBoard(change), revision: change.revision, pageId: change.pageId, settingsYaml: parsed.text() }, 'settings-saved');
  }

  return {
    // The caller refreshes discovery only for explicit dashboard API operations.
    // Startup, recovery, native proxy traffic and readiness must never wait on it.
    refreshDiscovery: (host, dashboard) => {
      if (!discoveryReader) return Promise.resolve();
      if (discoveryRefresh) return discoveryRefresh;
      discoveryRefresh = (async () => {
        // Recover and validate before allowing the native read, then release
        // the writer queue while providers or a cold renderer are responding.
        const before = await serialized(async () => discoverySnapshot(await readCurrent()));
        let manifest;
        try { manifest = validateDiscoveryManifest(await discoveryReader(host, dashboard)); }
        catch { /* Preserve safe retained sources on provider failure. */ }
        await serialized(async () => {
          const unchanged = before === await discoverySnapshot();
          let sources;
          if (unchanged && manifest) {
            try { sources = mergeDiscoveredSources({ cached: cachedDiscoveredSources, incoming: manifest.sources }); }
            catch { /* The retained/fresh union must also stay bounded. */ }
          }
          if (!sources) {
            incomingDiscoveredSources = null;
            discoveryWarnings = [{ code: 'NATIVE_DISCOVERY_UNAVAILABLE', message: unchanged
              ? 'Native discovery is temporarily unavailable. Retained panels and stack membership are preserved.'
              : 'Configuration changed while native discovery refreshed. Retained panels are preserved; refresh again.' }];
            return;
          }
          cachedDiscoveredSources = sources;
          incomingDiscoveredSources = manifest.sources;
          const messages = {
            AMBIGUOUS_NATIVE_SOURCE: 'Some discovered sources share a native lookup name. Resolve the conflicting names in their native configuration.',
            POSITIONAL_WIDGET_IDENTITY: 'Reordering repeated widgets of the same native type may change which panel retains its layout. Review those panels after editing the external widget list.',
            INVALID_NATIVE_SOURCE: 'Some discovered sources could not be represented safely and were omitted.',
            NATIVE_DISCOVERY_UNAVAILABLE: 'A native discovery provider is unavailable. Retained panels and stack membership are preserved.',
            SOURCE_LIMIT_REACHED: 'Native discovery reached the supported panel limit.',
          };
          discoveryWarnings = manifest.warnings.map((warning) => ({ ...warning, message: messages[warning.code] }));
        });
      })().finally(() => { discoveryRefresh = null; });
      return discoveryRefresh;
    },
    initialize: () => serialized(async () => {
      // Recover before creating defaults: a missing file may be part of an
      // interrupted transaction whose original absence must be restored first.
      await ready();
      for (const [file, content] of Object.entries(DEFAULTS)) if (await safeRead(location(file)) === null) await atomicWrite(location(file), content);
      const current = await readCurrent();
      await maintainBackups();
      return response(current);
    }),
    // Called before native HTTP and WebSocket traffic. It shares the writer's
    // queue so an interrupted transaction cannot be exposed by a native worker.
    prepareForNative: () => serialized(() => ready()),
    readIndexingPolicy: (environment) => serialized(async () => {
      await ready();
      await verifyDirectory(configDir);
      const text = await safeRead(location('settings.yaml'));
      return readNativeIndexingPolicy(text, environment);
    }),
    // When this dashboard's files last changed, for the Dashboards page. It
    // reads file times only, so edits made outside Studio count too.
    lastChanged: async () => {
      let latest = 0;
      for (const name of ALL_FILES) {
        const stat = await fs.lstat(location(name)).catch(() => null);
        if (stat?.isFile() && stat.mtimeMs > latest) latest = stat.mtimeMs;
      }
      return latest ? new Date(latest).toISOString() : null;
    },
    checkReadiness: () => serialized(async () => {
      const current = await readCurrent();
      if (Object.values(FILES).some((file) => current.raw[file] === null)) {
        fail('Homepage configuration files have not all been initialized.', 'CONFIG_NOT_INITIALIZED', 503);
      }
      for (const directory of [configDir, stateDir, backupsDir]) {
        const probe = path.join(directory, `.homepage-studio-readiness-${randomUUID()}.tmp`);
        try {
          await atomicWrite(probe, 'storage check\n', 0o600);
        } finally {
          await safeRemove(probe);
        }
      }
      await maintainBackups();
      if (retentionWarning) fail(retentionWarning.message, retentionWarning.code, 503);
      return { configuration: 'ok', persistence: 'ok', backupRetention };
    }),
    load: () => serialized(async () => response(await readCurrent())),
    loadBoard: () => serialized(async () => { const current = await readCurrent(); return { revision: current.revision, configurationRevision: current.configurationRevision, board: current.board, discoveredSources: current.discoveredSources, hiddenDiscoveredIds: current.hiddenDiscoveredIds, newDiscoveredIds: newDiscoveredIds(current), warnings: discoveryWarnings }; }),
    saveBoard: (change) => editing(change, async () => {
      const result = await saveCurrent(await readCurrent(), { revision: change.revision, board: change.board }, 'arrangement-saved');
      return { revision: result.revision, configurationRevision: result.configurationRevision, board: result.board, discoveredSources: result.discoveredSources, hiddenDiscoveredIds: result.hiddenDiscoveredIds, warnings: result.warnings };
    }),
    mutateDiscoveryVisibility: (change) => editing(change, async () => {
      const current = await readCurrent();
      checkRevision(change.revision, current);
      if (typeof change.hidden !== 'boolean') fail('Discovered panel visibility must be a boolean.', 'INVALID_ACTION', 400);
      if (!current.discoveredSources.some((source) => source.id === change.id)) fail('That discovered panel no longer exists.', 'TILE_NOT_FOUND', 404);
      const hidden = new Set(current.hiddenDiscoveredIds);
      if (change.hidden) hidden.add(change.id); else hidden.delete(change.id);
      return saveCurrent(current, { revision: change.revision, pageId: change.pageId, hiddenDiscoveredIds: [...hidden] }, change.hidden ? 'discovered-panel-hidden' : 'discovered-panel-shown');
    }),
    // Raw file saves never carry an editor arrangement; a board they send is checked strictly.
    save: ({ arrangement: ignored, ...change }) => serialized(async () => saveCurrent(await readCurrent(), change, 'files-saved')),
    undo: (change) => editing(change, () => stepEditInner(change, 'undo')),
    redo: (change) => editing(change, () => stepEditInner(change, 'redo')),
    mutateService: (change) => editing(change, () => mutateServiceInner(change)),
    mutateInfoWidget: (change) => editing(change, () => mutateInfoInner(change)),
    mutateBookmark: (change) => editing(change, () => mutateBookmarkInner(change)),
    mutateServiceWidget: (change) => editing(change, () => mutateServiceWidgetInner(change)),
    mutateSettings: (change) => editing(change, () => mutateSettingsInner(change)),
    deletePage: (change) => editing(change, () => deletePageInner(change)),
    duplicatePage: (change) => editing(change, () => duplicatePageInner(change)),
    deletePanels: (change) => editing(change, () => deletePanelsInner(change)),
    duplicatePanels: (change) => editing(change, () => duplicatePanelsInner(change)),
    listBackups: () => serialized(async () => {
      await ready();
      const names = await orderedBackupNames();
      const metadata = [];
      // Read one bounded snapshot at a time instead of materializing the whole
      // private backup history concurrently just to return its metadata.
      for (const name of names) {
        const id = name.slice(0, -5);
        const backup = await readBackup(id);
        metadata.push({ id, createdAt: backup.createdAt, revision: backup.revision, changedFiles: backup.changedFiles, action: backup.action });
      }
      return metadata;
    }),
    exportBackup: (id) => serialized(async () => {
      await ready();
      const { managedFiles, ...backup } = await readBackup(id);
      return backup;
    }),
    exportCurrent: () => serialized(async () => {
      const current = await readCurrent();
      const state = { version: 2, board: current.board,
        infoWidgets: current.infoWidgets.map(({ id, type, fingerprint }) => ({ id, type, fingerprint })),
        serviceWidgets: identityRecords(current.serviceWidgets), bookmarks: identityRecords(current.bookmarks),
        discoveredSources: current.discoveredSources.map(({ available, ...source }) => source), hiddenDiscoveredIds: current.hiddenDiscoveredIds };
      return { version: 1, createdAt: new Date().toISOString(), files: {
        ...Object.fromEntries(Object.values(FILES).map((file) => [file, current.raw[file] ?? DEFAULTS[file]])),
        'state.json': `${JSON.stringify(state, null, 2)}\n`,
      } };
    }),
    importArchive: ({ revision, archive }) => serialized(async () => {
      const current = await readCurrent();
      checkRevision(revision, current);
      const desired = importFiles(archive);
      const candidate = parseSnapshot(desired);
      const state = {
        version: 2,
        infoWidgets: candidate.infoWidgets.map(({ id, type, fingerprint }) => ({ id, type, fingerprint })),
        serviceWidgets: identityRecords(candidate.serviceWidgets), bookmarks: identityRecords(candidate.bookmarks),
        discoveredSources: candidate.discoveredSources.map(({ available, ...source }) => source),
        hiddenDiscoveredIds: candidate.hiddenDiscoveredIds,
        board: validateBoardChange(candidate.state.board ?? candidate.board, candidate.sources),
      };
      // An initial snapshot has no stored placement; other imported boards
      // must match their complete native sources without silently dropping panels.
      desired['state.json'] = `${JSON.stringify(state, null, 2)}\n`;
      await commit(current, desired, 'dashboard-imported');
      // Replaced configuration must not inherit cached descriptors from the
      // previous dashboard. Native discovery repopulates on its next refresh.
      cachedDiscoveredSources = [];
      incomingDiscoveredSources = null;
      discoveryWarnings = [];
      return response(await readCurrent());
    }),
    restoreBackup: ({ revision, backupId }) => serialized(async () => {
      const current = await readCurrent();
      checkRevision(revision, current);
      const backup = await readBackup(backupId);
      const restoredRaw = { ...current.raw, ...backup.before };
      const restored = parseSnapshot(restoredRaw);
      return saveCurrent(current, {
        revision,
        ...Object.fromEntries(Object.entries(FILES).map(([field, file]) => [field, backup.before[file] ?? DEFAULTS[file]])),
      }, 'snapshot-restored', {}, restored.state);
    }),
  };
}
