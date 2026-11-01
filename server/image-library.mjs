import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { LogoError, logoType } from './dashboard-logo.mjs';

// Images people upload for one dashboard: logos (widget and page icons) and
// backgrounds (cards and pages), kept apart so each picker shows only its
// own kind. Anyone who can arrange the dashboard can add and remove them;
// anyone who can view it can load them, since its cards show them.
// Uploads stay with their dashboard: they never appear on another one.
export const IMAGE_KINDS = ['logo', 'background'];
export const MAX_IMAGE_BYTES = { logo: 256 * 1024, background: 3 * 1024 * 1024 };
export const MAX_IMAGES = 200;
const INDEX_FILE = 'images.json';
const ID = /^[a-f0-9]{24}$/;
const EXTENSION = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg' };

export class ImageError extends Error {
  constructor(message, code = 'INVALID_IMAGE', status = 400, details) {
    super(message); this.name = 'ImageError'; this.code = code; this.status = status; this.details = details;
  }
}
const fail = (message, code, status, details) => { throw new ImageError(message, code, status, details); };

export const validImageId = (id) => typeof id === 'string' && ID.test(id);

function cleanName(value) {
  if (typeof value !== 'string') return 'Image';
  // Keep a readable file name; control characters and paths never reach the list.
  const name = value.split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80);
  return name || 'Image';
}

export function createImageLibrary({ stateDir }) {
  const dir = join(resolve(stateDir), 'images');
  const open = async (name, limit) => {
    let handle;
    try {
      handle = await fs.open(join(dir, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > limit) return null;
      return await handle.readFile();
    } catch (error) {
      if (['ENOENT', 'ELOOP', 'ENOTDIR'].includes(error.code)) return null;
      throw error;
    } finally { await handle?.close(); }
  };
  const write = async (name, bytes) => {
    await fs.mkdir(dir, { recursive: true, mode: 0o750 });
    const temp = join(dir, '.image-' + randomUUID() + '.tmp');
    let handle;
    try {
      handle = await fs.open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o640);
      await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = null;
      await fs.rename(temp, join(dir, name));
    } finally {
      await handle?.close();
      await fs.unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  };
  let queue = Promise.resolve();
  const serial = operation => { const result = queue.then(operation, operation); queue = result.catch(() => {}); return result; };

  async function list() {
    const text = await open(INDEX_FILE, 512 * 1024);
    if (!text) return [];
    try {
      const value = JSON.parse(text.toString('utf8'));
      return Array.isArray(value) ? value.filter(entry => validImageId(entry?.id) && IMAGE_KINDS.includes(entry.kind) && EXTENSION[entry.type]) : [];
    } catch { return []; }
  }
  const saveList = entries => write(INDEX_FILE, Buffer.from(JSON.stringify(entries, null, 2) + '\n'));

  return {
    list: () => serial(list),
    read: id => serial(async () => {
      if (!validImageId(id)) return null;
      const entry = (await list()).find(item => item.id === id);
      if (!entry) return null;
      const bytes = await open(id + '.' + EXTENSION[entry.type], MAX_IMAGE_BYTES[entry.kind]);
      // The stored bytes must still be the type the list names.
      return bytes && logoType(bytes) === entry.type ? { ...entry, bytes } : null;
    }),
    add: ({ kind, name, image }) => serial(async () => {
      if (!IMAGE_KINDS.includes(kind)) fail('Say whether this is a logo or a background.');
      if (typeof image !== 'string') fail('Choose an image file.');
      const match = /^data:[a-z0-9.+/-]+;base64,([A-Za-z0-9+/]+={0,2})$/.exec(image);
      if (!match) fail('Choose an image file.');
      const bytes = Buffer.from(match[1], 'base64');
      if (!bytes.length) fail('That file is empty.');
      const limit = MAX_IMAGE_BYTES[kind];
      if (bytes.length > limit) fail(`${kind === 'logo' ? 'Logos' : 'Backgrounds'} are limited to ${limit >= 1024 * 1024 ? limit / 1024 / 1024 + ' MiB' : limit / 1024 + ' KiB'}. Use a smaller image.`, 'IMAGE_TOO_LARGE', 413);
      let type;
      try { type = logoType(bytes); } catch (error) { if (error instanceof LogoError) fail(error.message); throw error; }
      if (!type) fail('Use a PNG, JPEG, WebP or SVG image.');
      const entries = await list();
      // The same picture twice is one entry.
      const id = createHash('sha256').update(kind).update(bytes).digest('hex').slice(0, 24);
      const existing = entries.find(entry => entry.id === id);
      if (existing) return existing;
      if (entries.length >= MAX_IMAGES) fail(`A dashboard keeps up to ${MAX_IMAGES} images. Remove some you no longer use.`, 'IMAGE_LIMIT', 409);
      const entry = { id, kind, name: cleanName(name), type, size: bytes.length, createdAt: new Date().toISOString() };
      // The bytes first: the list never names an image that wasn't written.
      await write(id + '.' + EXTENSION[type], bytes);
      await saveList([...entries, entry]);
      return entry;
    }),
    remove: id => serial(async () => {
      if (!validImageId(id)) fail('That image does not exist.', 'IMAGE_NOT_FOUND', 404);
      const entries = await list();
      const entry = entries.find(item => item.id === id);
      if (!entry) fail('That image does not exist.', 'IMAGE_NOT_FOUND', 404);
      await saveList(entries.filter(item => item.id !== id));
      await fs.unlink(join(dir, id + '.' + EXTENSION[entry.type])).catch(error => { if (error.code !== 'ENOENT') throw error; });
      return entry;
    }),
  };
}

// Where a dashboard uses an uploaded image: card and page backgrounds on its
// board, the dashboard's card and page defaults, and any configuration file
// that names its address (widget and bookmark icons).
export function imageUsage(id, { board, settings, files = {} }) {
  const places = [];
  const uses = background => background?.source === 'library' && background.id === id;
  for (const panel of board?.panels ?? []) if (uses(panel.look?.background)) places.push({ kind: 'widget', name: panel.title || panel.id });
  for (const look of board?.looks ?? []) if (uses(look.look?.background)) places.push({ kind: 'look', name: 'Saved look “' + look.name + '”' });
  for (const page of board?.pages ?? []) {
    if (uses(page.background)) places.push({ kind: 'page', name: page.name });
    if (page.icon === '/studio/api/images/' + id) places.push({ kind: 'page', name: page.name + ' icon' });
  }
  const theme = settings?.studioTheme;
  if (uses(theme?.card?.background)) places.push({ kind: 'dashboard', name: 'Card background' });
  if (uses(theme?.pageBackground)) places.push({ kind: 'dashboard', name: 'Page background' });
  for (const [file, text] of Object.entries(files)) if (typeof text === 'string' && text.includes('/studio/api/images/' + id)) places.push({ kind: 'file', name: file });
  return places;
}
