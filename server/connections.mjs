import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';

// Saved connections (owner-approved mock-up, 1 Nov 2026): a service address
// and its key, typed once, named, and reused on any widget. The key stays on
// this server and is never sent back, only replaced. Widgets refer to a
// connection with placeholders that the dashboard's renderer fills in when it
// reads its configuration, so changing a connection updates every widget
// that uses it:
//   url: "{{STUDIO_CONNECTION_<ID>_URL}}"   key: "{{STUDIO_CONNECTION_<ID>_KEY}}"
// Kept per dashboard (this dashboard) or per person (just me); using a
// personal one on a dashboard copies it there, as with images.
export const CONNECTIONS_FILE = 'studio-connections.json';
export const MAX_CONNECTIONS = 100;
export const SECRET_FIELDS = Object.freeze(['key', 'username', 'password']);
export const PLACEHOLDER = /\{\{STUDIO_CONNECTION_([A-F0-9]{16})_(URL|KEY|USERNAME|PASSWORD)\}\}/g;
const ID = /^[A-F0-9]{16}$/;
const MAX_FILE_BYTES = 512 * 1024;

export class ConnectionError extends Error {
  constructor(message, code = 'INVALID_CONNECTION', status = 400, details) {
    super(message); this.name = 'ConnectionError'; this.code = code; this.status = status;
    if (details) this.details = details;
  }
}
const fail = (message, code, status, details) => { throw new ConnectionError(message, code, status, details); };

export const placeholder = (id, field) => `{{STUDIO_CONNECTION_${id}_${field.toUpperCase()}}}`;

function validName(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name || name.length > 60 || /[\u0000-\u001f\u007f]/.test(name)) fail('Name the connection with 1 to 60 characters.');
  return name;
}
export function validAddress(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 500 || /[\u0000- \u007f]/.test(value.trim())) fail('Use the service address, such as https://service.example.org.');
  let url;
  try { url = new URL(value.trim()); } catch { fail('Use the service address, such as https://service.example.org.'); }
  if (!['http:', 'https:'].includes(url.protocol)) fail('A service address starts with http:// or https://.');
  if (url.username || url.password) fail('Put the user name and password in their own fields, not in the address.');
  return value.trim().replace(/\/+$/, '');
}
function validSecret(value, label) {
  if (typeof value !== 'string' || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value)) fail(`The ${label} must be text on one line, at most 4096 characters.`);
  return value;
}

// What a browser may see of a connection: never its secrets, only which are set.
export function publicConnection(entry, usedBy) {
  return {
    id: entry.id,
    name: entry.name,
    url: entry.url,
    has: Object.fromEntries(SECRET_FIELDS.map((field) => [field, Boolean(entry.secrets[field])])),
    updatedAt: entry.updatedAt,
    ...(entry.savedBy ? { savedBy: entry.savedBy } : {}),
    ...(usedBy ? { usedBy } : {}),
  };
}

// Which widgets use a connection, from the configuration text.
export function connectionUsage(id, files = {}) {
  const marker = `{{STUDIO_CONNECTION_${id}_`;
  return Object.entries(files).filter(([, text]) => typeof text === 'string' && text.includes(marker)).map(([file]) => file);
}

async function readFile(path) {
  let handle;
  try {
    handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) fail('The saved connections file is not usable.', 'CONNECTIONS_UNAVAILABLE', 503);
    const value = JSON.parse(await handle.readFile('utf8'));
    if (!value || value.version !== 1 || !Array.isArray(value.connections)) fail('The saved connections file is not usable.', 'CONNECTIONS_UNAVAILABLE', 503);
    return value.connections.filter((entry) => entry && ID.test(entry.id) && typeof entry.name === 'string' && typeof entry.url === 'string' && entry.secrets && typeof entry.secrets === 'object');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    if (error instanceof SyntaxError) fail('The saved connections file is not usable.', 'CONNECTIONS_UNAVAILABLE', 503);
    throw error;
  } finally { await handle?.close(); }
}

async function writeFile(dir, path, connections) {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const temp = join(dir, `.connections-${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await fs.open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await handle.writeFile(JSON.stringify({ version: 1, connections }, null, 2) + '\n');
    await handle.sync(); await handle.close(); handle = null;
    await fs.rename(temp, path);
  } finally {
    await handle?.close();
    await fs.unlink(temp).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  }
}

export function createConnectionStore({ dir }) {
  const path = join(dir, CONNECTIONS_FILE);
  let queue = Promise.resolve();
  const serial = (operation) => { const result = queue.then(operation, operation); queue = result.catch(() => {}); return result; };
  const find = (list, id) => list.find((entry) => entry.id === id) || fail('That connection no longer exists.', 'CONNECTION_NOT_FOUND', 404);
  const nameFree = (list, name, except) => {
    if (list.some((entry) => entry.id !== except && entry.name.toLocaleLowerCase() === name.toLocaleLowerCase())) fail(`There is already a connection called “${name}”.`);
  };
  return {
    path,
    list: () => serial(() => readFile(path)),
    // Full entries, secrets included: only for copying between places.
    read: (id) => serial(async () => find(await readFile(path), id)),
    add: (input, { id, by } = {}) => serial(async () => {
      const list = await readFile(path);
      if (list.length >= MAX_CONNECTIONS) fail(`Keep at most ${MAX_CONNECTIONS} saved connections.`);
      const name = validName(input?.name);
      nameFree(list, name);
      const secrets = {};
      for (const field of SECRET_FIELDS) if (input?.[field]) secrets[field] = validSecret(input[field], field);
      const entry = { id: id && ID.test(id) && !list.some((item) => item.id === id) ? id : randomBytes(8).toString('hex').toUpperCase(), name, url: validAddress(input?.url), secrets, updatedAt: new Date().toISOString(), ...(typeof by === 'string' && by.trim() ? { savedBy: by.trim().slice(0, 120) } : {}) };
      await writeFile(dir, path, [...list, entry]);
      return entry;
    }),
    // Empty secret fields keep what is saved (write-only); `clear` lists the
    // ones to remove.
    update: (id, input) => serial(async () => {
      const list = await readFile(path);
      const entry = find(list, id);
      const next = { ...entry, secrets: { ...entry.secrets } };
      if (input?.name !== undefined) { next.name = validName(input.name); nameFree(list, next.name, id); }
      if (input?.url !== undefined) next.url = validAddress(input.url);
      for (const field of SECRET_FIELDS) if (input?.[field]) next.secrets[field] = validSecret(input[field], field);
      for (const field of Array.isArray(input?.clear) ? input.clear : []) if (SECRET_FIELDS.includes(field)) delete next.secrets[field];
      next.updatedAt = new Date().toISOString();
      await writeFile(dir, path, list.map((item) => (item.id === id ? next : item)));
      return next;
    }),
    remove: (id, { usedBy = [] } = {}) => serial(async () => {
      const list = await readFile(path);
      find(list, id);
      if (usedBy.length) fail('Widgets still use this connection. Change them to another connection first.', 'CONNECTION_IN_USE', 409, { usedBy });
      await writeFile(dir, path, list.filter((item) => item.id !== id));
    }),
  };
}
