import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { LookError, validateBehaviour, validateLook } from '../homepage/src/components/studio/look.mjs';
import { PLACEHOLDER, SECRET_FIELDS } from './connections.mjs';

// Saved widgets and saved looks kept beyond one widget (owner decisions C2,
// C7 and Q6, 4 Nov 2026). Three places keep them:
// - Just me: a signed-in person's own (server/personal.mjs), on every
//   dashboard they edit.
// - This dashboard: the dashboard's own, for everyone who edits it.
// - Everyone: the whole Studio, saved by administrators.
// A saved widget is its configuration only: type, settings, name, link and
// status check, look and behaviour. Never its size or place, which belong to
// each dashboard's layout. Its settings may hold keys as typed and the saved
// connections it uses, secrets included; those stay on this server and only
// the name and type ever reach a browser. Placing one copies it onto the
// dashboard as a new, independent widget.
// Saved looks on This dashboard stay in the board (board.looks) so they
// travel with its arrangement; this store keeps Just me looks.
export const LIBRARY_FILE = 'studio-library.json';
export const SHARED_LIBRARY_FILE = 'studio-shared-library.json';
export const MAX_SAVED_WIDGETS = 100;
export const MAX_PERSONAL_LOOKS = 30;
export const SCOPES = Object.freeze(['me', 'dashboard', 'everyone']);
const KINDS = new Set(['serviceWidget', 'informationWidget']);
const ID = /^[a-f0-9]{16}$/;
const TYPE = /^[A-Za-z0-9_-]{1,60}$/;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_CONFIG_BYTES = 64 * 1024;
const SERVICE_KEYS = ['href', 'siteMonitor', 'ping', 'icon', 'description'];

export class LibraryError extends Error {
  constructor(message, code = 'INVALID_LIBRARY', status = 400) {
    super(message); this.name = 'LibraryError'; this.code = code; this.status = status;
  }
}
const fail = (message, code, status) => { throw new LibraryError(message, code, status); };
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export function validName(value, what = 'it') {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name || name.length > 60 || /[\u0000-\u001f\u007f]/.test(name)) fail(`Name ${what} with 1 to 60 characters.`);
  return name;
}

function validLook(look, behaviour) {
  try { return { look: validateLook(look), behaviour: validateBehaviour(behaviour) }; }
  catch (error) { if (error instanceof LookError) fail(error.message); throw error; }
}

// The saved connections a widget's settings refer to.
export function connectionIdsOf(config) {
  const ids = new Set();
  for (const match of JSON.stringify(config ?? {}).matchAll(PLACEHOLDER)) ids.add(match[1]);
  return [...ids];
}

// Checks what a saved widget keeps; anything else is dropped.
export function validWidget(value) {
  if (!object(value) || !KINDS.has(value.kind) || typeof value.type !== 'string' || !TYPE.test(value.type)) fail('That widget cannot be saved.');
  if (!object(value.config)) fail('A saved widget\'s settings must be a mapping.');
  const config = Object.fromEntries(Object.entries(value.config).filter(([key, item]) => key !== 'type' && item !== null && item !== undefined));
  if (Buffer.byteLength(JSON.stringify(config)) > MAX_CONFIG_BYTES) fail('That widget\'s settings are too large to save.');
  const out = { kind: value.kind, type: value.type, config };
  if (value.kind === 'serviceWidget') {
    out.title = validName(value.title, 'the widget');
    const service = {};
    for (const key of SERVICE_KEYS) {
      const item = value.service?.[key];
      if (item === undefined || item === null || item === '') continue;
      if (typeof item !== 'string' || item.length > 4096) fail('A widget\'s link and status address are text.');
      service[key] = item;
    }
    if (Object.keys(service).length) out.service = service;
  }
  const { look, behaviour } = validLook(value.look, value.behaviour);
  if (look) out.look = look;
  if (behaviour) out.behaviour = behaviour;
  if (value.connections !== undefined) {
    if (!Array.isArray(value.connections) || value.connections.length > 10) fail('That widget uses too many saved connections.');
    out.connections = value.connections.map((entry) => {
      if (!object(entry) || !/^[A-F0-9]{16}$/.test(entry.id) || typeof entry.name !== 'string' || typeof entry.url !== 'string' || !object(entry.secrets)) fail('A saved connection in that widget is not usable.');
      const secrets = Object.fromEntries(SECRET_FIELDS.filter((field) => typeof entry.secrets[field] === 'string' && entry.secrets[field]).map((field) => [field, entry.secrets[field]]));
      return { id: entry.id, name: entry.name, url: entry.url, secrets };
    });
  }
  return out;
}

// What a browser sees of an entry: a widget's name and type only, never its
// settings; a look in full (it holds no secrets).
export function publicEntry(entry, scope) {
  const base = { id: entry.id, kind: entry.kind, name: entry.name, scope, updatedAt: entry.updatedAt };
  if (entry.kind === 'look') return { ...base, look: entry.look };
  return { ...base, widgetKind: entry.widget.kind, type: entry.widget.type };
}

async function readFile(path) {
  let handle;
  try {
    handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) fail('The saved widgets file is not usable.', 'LIBRARY_UNAVAILABLE', 503);
    const value = JSON.parse(await handle.readFile('utf8'));
    if (!value || value.version !== 1 || !Array.isArray(value.entries)) fail('The saved widgets file is not usable.', 'LIBRARY_UNAVAILABLE', 503);
    return value.entries.filter((entry) => entry && ID.test(entry.id) && typeof entry.name === 'string' && (entry.kind === 'look' ? object(entry.look) : entry.kind === 'widget' && object(entry.widget)));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    if (error instanceof SyntaxError) fail('The saved widgets file is not usable.', 'LIBRARY_UNAVAILABLE', 503);
    throw error;
  } finally { await handle?.close(); }
}

async function writeFile(dir, path, entries) {
  const text = JSON.stringify({ version: 1, entries }, null, 2) + '\n';
  // Never write a file this module would refuse to read back (readFile), or
  // nobody could list or delete entries to make room again.
  if (Buffer.byteLength(text) > MAX_FILE_BYTES) fail('Saved items here use all their room (2 MB). Delete some, then save again.', 'LIBRARY_FULL', 413);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const temp = join(dir, `.library-${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await fs.open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await handle.writeFile(text);
    await handle.sync(); await handle.close(); handle = null;
    await fs.rename(temp, path);
  } finally {
    await handle?.close();
    await fs.unlink(temp).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  }
}

// One place's saved widgets and looks. `looks: false` keeps widgets only
// (a dashboard's looks live in its board).
export function createLibrary({ dir, file = LIBRARY_FILE, looks = true }) {
  const path = join(dir, file);
  let queue = Promise.resolve();
  const serial = (operation) => { const result = queue.then(operation, operation); queue = result.catch(() => {}); return result; };
  const find = (list, id) => list.find((entry) => entry.id === id) || fail('That saved item no longer exists.', 'LIBRARY_NOT_FOUND', 404);
  const nameFree = (list, kind, name, except) => {
    if (list.some((entry) => entry.id !== except && entry.kind === kind && entry.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      fail(`There is already a saved ${kind === 'look' ? 'look' : 'widget'} called “${name}” here.`, 'LIBRARY_NAME_TAKEN', 409);
    }
  };
  const content = (kind, input) => {
    if (kind === 'look') {
      if (!looks) fail('Looks for this dashboard are kept with its arrangement.');
      const { look } = validLook(input.look);
      if (!look || look.values) fail('A saved look needs look settings and no widget values.');
      return { look };
    }
    if (kind === 'widget') return { widget: validWidget(input.widget) };
    fail('Choose a saved widget or a saved look.');
  };
  return {
    path,
    list: () => serial(() => readFile(path)),
    // Full entries, secrets included: only for placing on a dashboard.
    read: (id) => serial(async () => find(await readFile(path), id)),
    add: (input) => serial(async () => {
      const list = await readFile(path);
      const kind = input?.kind;
      const limit = kind === 'look' ? MAX_PERSONAL_LOOKS : MAX_SAVED_WIDGETS;
      if (list.filter((entry) => entry.kind === kind).length >= limit) fail(`Keep at most ${limit} saved ${kind === 'look' ? 'looks' : 'widgets'} here.`);
      const name = validName(input?.name, `the saved ${kind === 'look' ? 'look' : 'widget'}`);
      const value = content(kind, input);
      nameFree(list, kind, name);
      const entry = { id: randomBytes(8).toString('hex'), kind, name, ...value, updatedAt: new Date().toISOString() };
      await writeFile(dir, path, [...list, entry]);
      return entry;
    }),
    // A new name, new contents (Update), or both.
    update: (id, input) => serial(async () => {
      const list = await readFile(path);
      const entry = find(list, id);
      const next = { ...entry };
      if (input?.name !== undefined) { next.name = validName(input.name, 'it'); nameFree(list, entry.kind, next.name, id); }
      if (input?.look !== undefined || input?.widget !== undefined) Object.assign(next, content(entry.kind, input));
      next.updatedAt = new Date().toISOString();
      await writeFile(dir, path, list.map((item) => (item.id === id ? next : item)));
      return next;
    }),
    remove: (id) => serial(async () => {
      const list = await readFile(path);
      find(list, id);
      await writeFile(dir, path, list.filter((item) => item.id !== id));
    }),
    // Copies every entry from another place (a dashboard duplicated).
    copyFrom: (entries) => serial(async () => {
      const list = await readFile(path);
      const fresh = entries.filter((entry) => !list.some((item) => item.id === entry.id));
      await writeFile(dir, path, [...list, ...fresh]);
    }),
  };
}
