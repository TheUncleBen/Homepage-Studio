import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { appearanceTokens } from '../homepage/src/components/studio/appearance.mjs';

// The platform default look, set in Administration → Appearance. Each
// dashboard follows each of these settings until it sets its own:
// - studio-platform.json: display mode, accent colour and background image;
// - studio-platform.css: CSS loaded on every dashboard before its own
//   custom.css, unless the dashboard turns it off.
// The renderer reads the JSON file (STUDIO_PLATFORM_FILE) when it loads a
// dashboard's settings; the controller serves the CSS at /studio/platform.css.
export const PLATFORM_FILE = 'studio-platform.json';
export const PLATFORM_CSS_FILE = 'studio-platform.css';
export const MAX_PLATFORM_CSS_BYTES = 256 * 1024;
const MAX_PLATFORM_BYTES = 16 * 1024;
export const DEFAULT_PLATFORM = Object.freeze({ mode: 'dark', accent: '#b299be', background: null });

// Studio's own pages (sign-in, Dashboards, My account, Administration) wear
// the platform look too: the same tokens a dashboard computes, under the
// pages' own variable names (server/auth/ui/app.css). Only validated mode and
// hex values reach this stylesheet.
// The success and warning colors exist only on Studio's pages, so they follow
// the chosen scheme here rather than the device's.
const STATUS_TOKENS = {
  dark: { 'ok-text': '#b8e0c6', 'ok-bg': '#1d2b23', 'ok-line': '#5f8f72', 'warn-text': '#f0d9a8', 'warn-bg': '#30291b', 'warn-line': '#9c8455' },
  light: { 'ok-text': '#1f5a37', 'ok-bg': '#e8f4ec', 'ok-line': '#5f8f72', 'warn-text': '#5e4710', 'warn-bg': '#fbf3e0', 'warn-line': '#9c8455' },
};
export function studioThemeCss({ mode, accent } = DEFAULT_PLATFORM) {
  const settings = { studioTheme: { mode, accent } };
  const block = dark => {
    const { mode: scheme, tokens } = appearanceTokens(settings, dark);
    return `:root{color-scheme:${scheme};${Object.entries({ ...tokens, ...STATUS_TOKENS[scheme] }).map(([name, value]) => `--${name}:${value};`).join('')}}`;
  };
  return mode === 'system' ? `${block(true)}\n@media (prefers-color-scheme: light){${block(false)}}\n` : `${block(true)}\n`;
}

export class PlatformError extends Error {
  constructor(message, code = 'INVALID_PLATFORM_APPEARANCE', status = 400) {
    super(message); this.name = 'PlatformError'; this.code = code; this.status = status;
  }
}
const invalid = message => { throw new PlatformError(message); };

// A background is an image address, optionally with the native Homepage
// filters (blur, saturate, brightness, opacity).
function validBackground(value) {
  if (value === null) return null;
  const image = typeof value === 'string' ? value : value?.image;
  if (typeof image !== 'string' || !image.trim() || image.length > 2048 || /[\u0000-\u001f\u007f"'()\\]/.test(image)) invalid('Give the background as an image address without quotes or brackets.');
  if (!/^(?:https?:\/\/|\/)/i.test(image.trim())) invalid('The background image address starts with https://, http:// or /.');
  if (typeof value === 'string') return image.trim();
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('Invalid background.');
  const out = { image: image.trim() };
  for (const [key, allowed] of [['blur', ['sm', 'md', 'xl']], ['saturate', null], ['brightness', null], ['opacity', null]]) {
    if (value[key] === undefined || value[key] === null) continue;
    if (allowed ? !allowed.includes(value[key]) : !(Number.isInteger(value[key]) && value[key] >= 0 && value[key] <= 200)) invalid(`Invalid background ${key}.`);
    out[key] = value[key];
  }
  if (Object.keys(value).some(key => !['image', 'blur', 'saturate', 'brightness', 'opacity'].includes(key))) invalid('Unexpected background fields.');
  return out;
}
export function validatePlatform(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('Invalid platform appearance.');
  if (Object.keys(value).some(key => !['mode', 'accent', 'background'].includes(key))) invalid('Unexpected platform appearance fields.');
  if (!['dark', 'light', 'system'].includes(value.mode)) invalid('Choose dark, light or follow device.');
  if (typeof value.accent !== 'string' || !/^#[\da-f]{6}$/.test(value.accent)) invalid('Use a hex colour such as #b299be.');
  return { mode: value.mode, accent: value.accent, background: validBackground(value.background ?? null) };
}

async function readSmall(file, limit) {
  let handle;
  try {
    handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > limit) throw new PlatformError('The platform appearance file is invalid. Fix or remove it.', 'INVALID_PLATFORM_FILE', 503);
    return await handle.readFile('utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    if (error instanceof PlatformError) throw error;
    throw new PlatformError('The platform appearance file could not be read safely.', 'INVALID_PLATFORM_FILE', 503);
  } finally { await handle?.close(); }
}
async function writeAtomic(directory, name, text) {
  const temp = join(directory, '.studio-platform-' + randomUUID() + '.tmp');
  let handle;
  try {
    handle = await fs.open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o640);
    await handle.writeFile(text, 'utf8'); await handle.sync(); await handle.close(); handle = null;
    await fs.rename(temp, join(directory, name));
  } finally {
    await handle?.close();
    await fs.unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

export function createPlatformStore({ configRoot }) {
  configRoot = resolve(configRoot);
  let queue = Promise.resolve();
  const serial = operation => { const result = queue.then(operation, operation); queue = result.catch(() => {}); return result; };
  async function read() {
    const text = await readSmall(join(configRoot, PLATFORM_FILE), MAX_PLATFORM_BYTES);
    const css = (await readSmall(join(configRoot, PLATFORM_CSS_FILE), MAX_PLATFORM_CSS_BYTES)) ?? '';
    if (text === null) return { revision: null, ...DEFAULT_PLATFORM, css };
    let stored;
    try { stored = JSON.parse(text); } catch { throw new PlatformError('The platform appearance file is invalid. Fix or remove it.', 'INVALID_PLATFORM_FILE', 503); }
    const { revision, ...settings } = stored ?? {};
    let valid;
    try { valid = validatePlatform(settings); } catch { throw new PlatformError('The platform appearance file is invalid. Fix or remove it.', 'INVALID_PLATFORM_FILE', 503); }
    return { revision: typeof revision === 'string' ? revision : null, ...valid, css };
  }
  return {
    file: join(configRoot, PLATFORM_FILE),
    read: () => serial(read),
    readCss: async () => (await readSmall(join(configRoot, PLATFORM_CSS_FILE), MAX_PLATFORM_CSS_BYTES)) ?? '',
    update: change => serial(async () => {
      if (!change || typeof change !== 'object' || Array.isArray(change)) invalid('Invalid platform appearance.');
      const current = await read();
      if ((change.revision ?? null) !== current.revision) throw new PlatformError('Someone else changed the platform appearance. Reload it; your draft is still here.', 'PLATFORM_REVISION_CONFLICT', 409);
      const { revision, css, ...settings } = change;
      const next = validatePlatform(settings);
      if (typeof css !== 'string' || Buffer.byteLength(css) > MAX_PLATFORM_CSS_BYTES) invalid(`Platform CSS is limited to ${MAX_PLATFORM_CSS_BYTES / 1024} KiB.`);
      const stored = { revision: randomUUID(), ...next };
      // The CSS goes first: a revision never names CSS that wasn't written.
      await writeAtomic(configRoot, PLATFORM_CSS_FILE, css);
      await writeAtomic(configRoot, PLATFORM_FILE, JSON.stringify(stored, null, 2) + '\n');
      return { ...stored, css };
    }),
  };
}
