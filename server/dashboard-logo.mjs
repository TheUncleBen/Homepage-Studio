import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

// A dashboard's own logo: shown next to its name in the top bar and used as
// its browser tab icon. Without one, the Studio logo stands in. Anyone who
// can arrange the dashboard can change it (owner decision, 25 Oct 2026).
export const MAX_LOGO_BYTES = 256 * 1024;
const LOGO_FILE = 'studio-logo';
const META_FILE = 'studio-logo.json';
export const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

export class LogoError extends Error {
  constructor(message, code = 'INVALID_LOGO', status = 400) {
    super(message); this.name = 'LogoError'; this.code = code; this.status = status;
  }
}

// The type comes from the bytes, never from what the browser claimed.
export function logoType(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  const text = bytes.toString('utf8');
  if (/^﻿?\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(text)) {
    // Browsers never run an SVG's scripts in an <img> or tab icon, and the
    // file is served under a CSP without scripts. Refuse active content and
    // outside references anyway, so the file is plainly a picture.
    if (/<script|<foreignObject|<iframe|<embed|<object|\son[a-z]+\s*=|javascript:|data:text\/html|<!ENTITY|<!DOCTYPE/i.test(text)) throw new LogoError('That SVG contains scripts or embedded pages. Use a plain SVG, PNG, JPEG or WebP image.');
    if (/(?:href|src)\s*=\s*["']\s*(?!#)/i.test(text) || /url\(\s*["']?\s*(?!#)/i.test(text)) throw new LogoError('That SVG loads other files. Use an SVG without links to other files, or a PNG, JPEG or WebP image.');
    return 'image/svg+xml';
  }
  return null;
}

export function createLogoStore({ stateDir }) {
  stateDir = resolve(stateDir);
  const read = async name => {
    let handle;
    try {
      handle = await fs.open(join(stateDir, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_LOGO_BYTES) return null;
      return await handle.readFile();
    } catch (error) {
      if (['ENOENT', 'ELOOP', 'ENOTDIR'].includes(error.code)) return null;
      throw error;
    } finally { await handle?.close(); }
  };
  const write = async (name, bytes) => {
    const temp = join(stateDir, '.studio-logo-' + randomUUID() + '.tmp');
    let handle;
    try {
      handle = await fs.open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o640);
      await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = null;
      await fs.rename(temp, join(stateDir, name));
    } finally {
      await handle?.close();
      await fs.unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  };
  let queue = Promise.resolve();
  const serial = operation => { const result = queue.then(operation, operation); queue = result.catch(() => {}); return result; };
  // { type, version } of the uploaded logo, or null for the Studio logo.
  async function info() {
    const meta = await read(META_FILE);
    if (!meta) return null;
    try {
      const value = JSON.parse(meta.toString('utf8'));
      return LOGO_TYPES.includes(value.type) && typeof value.version === 'string' ? { type: value.type, version: value.version } : null;
    } catch { return null; }
  }
  return {
    info,
    read: () => serial(async () => {
      const current = await info();
      if (!current) return null;
      const bytes = await read(LOGO_FILE);
      return bytes && logoType(bytes) === current.type ? { ...current, bytes } : null;
    }),
    save: data => serial(async () => {
      if (typeof data !== 'string') throw new LogoError('Choose an image file.');
      const match = /^data:[a-z0-9.+/-]+;base64,([A-Za-z0-9+/]+={0,2})$/.exec(data);
      if (!match) throw new LogoError('Choose an image file.');
      const bytes = Buffer.from(match[1], 'base64');
      if (!bytes.length) throw new LogoError('That file is empty.');
      if (bytes.length > MAX_LOGO_BYTES) throw new LogoError(`Logos are limited to ${MAX_LOGO_BYTES / 1024} KiB. Use a smaller image.`, 'LOGO_TOO_LARGE', 413);
      const type = logoType(bytes);
      if (!type) throw new LogoError('Use a PNG, JPEG, WebP or SVG image.');
      await fs.mkdir(stateDir, { recursive: true, mode: 0o750 });
      const version = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
      // The image first: the metadata never names bytes that weren't written.
      await write(LOGO_FILE, bytes);
      await write(META_FILE, JSON.stringify({ type, version }) + '\n');
      return { type, version };
    }),
    remove: () => serial(async () => {
      for (const name of [META_FILE, LOGO_FILE]) await fs.unlink(join(stateDir, name)).catch(error => { if (error.code !== 'ENOENT') throw error; });
      return null;
    }),
  };
}
