import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createImageLibrary } from './image-library.mjs';
import { createConnectionStore } from './connections.mjs';
import { LANGUAGES } from '../homepage/src/components/studio/languages.mjs';

// Each signed-in person's own things, kept apart from every dashboard:
// - images: logos and backgrounds uploaded "Just me". Only that person sees
//   them in the library. Using one on a dashboard copies it into that
//   dashboard's own library, so the dashboard never depends on the account.
// - connections: service addresses and keys saved "Just me"
//   (server/connections.mjs). Using one on a dashboard copies it there, as
//   with images.
// - preferences: how that person likes to see dashboards (search engine,
//   light or dark, motion, language, clock, temperature).
// Stored under <state>/people/<user id>/ and removed with the account.
export const PEOPLE_DIR = 'people';
const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PREFERENCES_FILE = 'preferences.json';

export class PreferenceError extends Error {
  constructor(message) { super(message); this.name = 'PreferenceError'; this.code = 'INVALID_PREFERENCES'; this.status = 400; }
}

export const SEARCH_ENGINES = Object.freeze({
  google: { name: 'Google', url: 'https://www.google.com/search?q=%s', suggestions: true },
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s', suggestions: true },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=%s', suggestions: true },
  brave: { name: 'Brave', url: 'https://search.brave.com/search?q=%s', suggestions: false },
  startpage: { name: 'Startpage', url: 'https://www.startpage.com/do/search?q=%s', suggestions: false },
  kagi: { name: 'Kagi', url: 'https://kagi.com/search?q=%s', suggestions: false },
});

// Every preference with its choices. The first choice is the default, and a
// default is never stored (Rule 2): choosing it again removes the key.
export const PREFERENCE_CHOICES = Object.freeze({
  searchEngine: ['google', 'duckduckgo', 'bing', 'brave', 'startpage', 'kagi', 'custom'],
  searchSuggestions: [true, false],
  searchDescriptions: [true, false],
  searchAddresses: [true, false],
  searchOpens: ['new', 'same'],
  mode: ['dashboard', 'system', 'dark', 'light'],
  motion: ['system', 'reduced', 'full'],
  language: ['dashboard', ...LANGUAGES],
  clock: ['dashboard', '24', '12'],
  temperature: ['dashboard', 'c', 'f'],
});
const TEXT_KEYS = ['searchUrl', 'suggestionsUrl'];

function webAddress(value, { needsQuery }) {
  if (typeof value !== 'string' || value.length > 500 || /[\u0000-\u001f\u007f\s]/.test(value)) return false;
  let url;
  try { url = new URL(value.replace(/%s/g, 'q')); } catch { return false; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false;
  return !needsQuery || value.includes('%s');
}

// Checks a whole preferences object and returns it without defaults.
export function validatePreferences(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PreferenceError('Send your preferences as an object.');
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (TEXT_KEYS.includes(key)) {
      if (entry === '' || entry === undefined) continue;
      if (!webAddress(entry, { needsQuery: true })) throw new PreferenceError(key === 'searchUrl' ? 'Use a web address with %s where the search goes, such as https://search.example.com/?q=%s.' : 'Use a suggestions address with %s where the search goes, or leave it empty.');
      out[key] = entry;
      continue;
    }
    const choices = PREFERENCE_CHOICES[key];
    if (!choices) throw new PreferenceError('That preference does not exist.');
    if (!choices.includes(entry)) throw new PreferenceError('Choose one of the offered values.');
    if (entry !== choices[0]) out[key] = entry;
  }
  // Custom keeps what was typed even while another engine is chosen, so
  // switching back restores it; but Custom itself needs an address.
  if (out.searchEngine === 'custom' && !out.searchUrl) throw new PreferenceError('Add the search address for your custom engine.');
  return out;
}

async function readPreferences(dir) {
  let handle;
  try {
    handle = await fs.open(join(dir, PREFERENCES_FILE), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 16 * 1024) return {};
    return validatePreferences(JSON.parse(await handle.readFile('utf8')));
  } catch (error) {
    // A missing or damaged file means the defaults; nothing else depends on it.
    if (['ENOENT', 'ELOOP'].includes(error.code) || error instanceof SyntaxError || error instanceof PreferenceError) return {};
    throw error;
  } finally { await handle?.close(); }
}

async function writePreferences(dir, value) {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const temp = join(dir, '.preferences-' + randomUUID() + '.tmp');
  let handle;
  try {
    handle = await fs.open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync(); await handle.close(); handle = null;
    await fs.rename(temp, join(dir, PREFERENCES_FILE));
  } finally {
    await handle?.close();
    await fs.unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

export function createPersonalStore({ stateRoot }) {
  const root = join(resolve(stateRoot), PEOPLE_DIR);
  const people = new Map();
  const dirFor = userId => {
    if (typeof userId !== 'string' || !USER_ID.test(userId)) throw Object.assign(new Error('Sign in first.'), { status: 401, code: 'AUTH_REQUIRED' });
    return join(root, userId);
  };
  function forUser(userId) {
    const dir = dirFor(userId);
    let person = people.get(userId);
    if (!person) {
      let queue = Promise.resolve();
      const serial = operation => { const result = queue.then(operation, operation); queue = result.catch(() => {}); return result; };
      person = {
        images: createImageLibrary({ stateDir: dir }),
        connections: createConnectionStore({ dir }),
        preferences: {
          read: () => serial(() => readPreferences(dir)),
          write: value => serial(async () => { const clean = validatePreferences(value); await writePreferences(dir, clean); return clean; }),
        },
      };
      people.set(userId, person);
    }
    return person;
  }
  return {
    forUser,
    // Removes everything a deleted account kept.
    async removeUser(userId) {
      const dir = dirFor(userId);
      people.delete(userId);
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}
