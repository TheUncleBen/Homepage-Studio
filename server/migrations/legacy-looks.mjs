// Data version 1: widget looks from before the block widgets (candidates up
// to 53ebc3b) become blocks. The 4575c4c rebuild replaced the look settings
// layout, heroSize, trend, show, chartRange and columns, and a value's slot,
// with blocks; data still holding them made a whole dashboard refuse to load
// (owner report, 10 Nov 2026: CONFIG_NOT_READY on an in-place upgrade).
//
// Each old look is turned into the blocks that draw it the same way:
//   Hero (with its size and trend)      → Big number + Numbers below
//   Quiet                               → Quiet
//   Show as table                       → Numbers as a list
//   Show as line, area or bar chart     → Big number + Chart (+ Numbers for
//                                          values set to "Number")
//   Show as donut or pie                → Pie (+ Numbers for "Number" values)
//   Show as gauge                       → Gauge
//   Show as status history             → Status history
// A value set to Hero leads the Big number; values set to Hidden are left out
// of the blocks. The dashboard's card look can't hold blocks, so its old
// settings are applied to each widget that followed them, then removed.
//
// It runs over every dashboard's arrangement, saved looks, saved widgets
// (the dashboard's, the shared ones and each person's), the dashboard's
// pre-save snapshots and settings.yaml. A look it can't convert loses only
// the old settings, so the dashboard always loads.
import fs from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { parseDocument, isMap } from 'yaml';
import { DEFAULT_BLOCKS, validateLook } from '../../homepage/src/components/studio/look.mjs';

const LEGACY_KEYS = ['layout', 'heroSize', 'trend', 'show', 'chartRange', 'columns'];
const LEGACY_DEFAULTS = { layout: 'hero', heroSize: 'm', trend: 'off', show: 'numbers', chartRange: '24h', columns: 'auto' };
const plain = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isLegacy = (look) => plain(look) && (LEGACY_KEYS.some((key) => key in look) || (Array.isArray(look.values) && look.values.some((value) => plain(value) && 'slot' in value)));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The blocks an old look drew. `inherited` holds the dashboard card look's
// old settings, which the widget followed unless it set its own.
export function blocksFor(look, inherited = {}) {
  const old = { ...LEGACY_DEFAULTS, ...pick(inherited), ...pick(look) };
  const values = Array.isArray(look.values) ? look.values.filter(plain) : [];
  const slot = (name) => values.filter((value) => value.slot === name).map((value) => value.field);
  const hero = slot('hero')[0];
  const hidden = new Set(slot('hidden'));
  const numbers = slot('number');
  const visible = values.filter((value) => !hidden.has(value.field)).map((value) => value.field);
  // The value the Big number (or gauge) leads with: the Hero one, else the
  // first value that wasn't hidden (left alone, the block would pick the
  // first value, hidden or not).
  const lead = hero ?? (hidden.size ? visible[0] : undefined);
  const only = (list) => (hidden.size ? { values: list } : {});
  const big = { type: 'big', ...(lead ? { values: [lead] } : { first: true }), size: old.heroSize };
  const blocks = [];
  // Quiet and table listed every value that wasn't hidden, whatever its slot.
  if (old.show === 'numbers' && old.layout === 'quiet') blocks.push({ type: 'quiet', ...only(visible) });
  else if (old.show === 'numbers') blocks.push({ ...big, trend: old.trend }, { type: 'numbers', columns: old.columns, ...only(visible.filter((field) => field !== lead)) });
  else if (old.show === 'table') blocks.push({ type: 'numbers', arrange: 'list', ...only(visible) });
  else if (['line', 'area', 'bar'].includes(old.show)) {
    const charted = visible.filter((field) => !numbers.includes(field));
    blocks.push(big, { type: 'chart', style: old.show, range: old.chartRange, ...(charted.length ? { values: charted } : {}) });
  } else if (['donut', 'pie'].includes(old.show)) {
    const sliced = visible.filter((field) => !numbers.includes(field));
    blocks.push({ type: 'pie', style: old.show, ...((hidden.size || numbers.length) && sliced.length ? { values: sliced } : {}) });
  } else if (old.show === 'gauge') blocks.push({ type: 'gauge', ...(lead ? { values: [lead] } : {}) });
  else if (old.show === 'status') blocks.push({ type: 'status', range: old.chartRange });
  if (numbers.length && ['line', 'area', 'bar', 'donut', 'pie'].includes(old.show)) blocks.push({ type: 'numbers', values: numbers });
  return blocks.map((block, index) => ({ id: `b${index + 1}`, ...block }));
}
function pick(look) {
  return plain(look) ? Object.fromEntries(LEGACY_KEYS.filter((key) => key in look).map((key) => [key, look[key]])) : {};
}
function stripped(look) {
  const out = Object.fromEntries(Object.entries(look).filter(([key]) => !LEGACY_KEYS.includes(key)));
  if (Array.isArray(out.values)) out.values = out.values.map((value) => (plain(value) ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'slot')) : value));
  return out;
}

// One look, converted. `blocks: false` for looks that can't hold blocks.
export function convertLook(look, { inherited = {}, blocks = true } = {}) {
  if (!plain(look)) return look;
  const legacy = isLegacy(look) || Object.keys(pick(inherited)).some((key) => inherited[key] !== LEGACY_DEFAULTS[key]);
  if (!legacy) return look;
  const base = stripped(look);
  if (blocks && !Array.isArray(look.blocks)) {
    const made = blocksFor(look, inherited);
    try {
      const valid = validateLook({ ...base, blocks: made });
      if (valid && same(valid.blocks, DEFAULT_BLOCKS)) delete valid.blocks;
      return valid ?? {};
    } catch { /* Fall back to the old settings removed. */ }
  }
  try { return validateLook(base) ?? {}; }
  catch { return base; }
}
const tidy = (look) => (plain(look) && Object.keys(look).length ? look : undefined);

// A board (state.json's board): its widgets and its saved looks.
export function convertBoard(board, inherited) {
  if (!plain(board)) return board;
  let changed = false;
  const panels = Array.isArray(board.panels) ? board.panels.map((panel) => {
    if (!plain(panel)) return panel;
    // Old card-look settings reach only widgets that draw values: not tiles,
    // bookmarks or headings, whatever look of their own they have.
    const drawsValues = ['serviceWidget', 'informationWidget'].includes(panel.kind) && panel.nativeLocator?.type !== 'heading';
    const own = drawsValues ? inherited : {};
    if (!panel.look && !Object.keys(own).length) return panel;
    const look = convertLook(panel.look ?? {}, { inherited: own });
    if (same(look, panel.look ?? {})) return panel;
    changed = true;
    const next = { ...panel, look: tidy(look) };
    if (!next.look) delete next.look;
    return next;
  }) : board.panels;
  const looks = Array.isArray(board.looks) ? board.looks.map((entry) => {
    if (!plain(entry) || !isLegacy(entry.look)) return entry;
    changed = true;
    return { ...entry, look: convertLook(entry.look) };
  }) : board.looks;
  return changed ? { ...board, panels, ...(looks ? { looks } : {}) } : board;
}

export function convertStateText(text, inherited) {
  let state;
  try { state = JSON.parse(text); } catch { return text; }
  if (!plain(state) || !plain(state.board)) return text;
  const board = convertBoard(state.board, inherited);
  return board === state.board ? text : `${JSON.stringify({ ...state, board }, null, 2)}\n`;
}

// settings.yaml: the card look's old settings, read and removed (comments
// and everything else are kept).
export function convertSettingsText(text) {
  if (typeof text !== 'string') return { text, inherited: {} };
  let doc;
  try { doc = parseDocument(text); } catch { return { text, inherited: {} }; }
  if (doc.errors.length) return { text, inherited: {} };
  const card = doc.getIn(['studioTheme', 'card']);
  if (!isMap(card)) return { text, inherited: {} };
  const json = card.toJSON();
  const inherited = pick(json);
  if (!Object.keys(inherited).length) return { text, inherited };
  for (const key of Object.keys(inherited)) doc.deleteIn(['studioTheme', 'card', key]);
  if (!doc.getIn(['studioTheme', 'card']).items.length) doc.deleteIn(['studioTheme', 'card']);
  if (isMap(doc.get('studioTheme')) && !doc.get('studioTheme').items.length) doc.delete('studioTheme');
  return { text: doc.toString(), inherited };
}

// A saved-items file (studio-library.json): saved looks and saved widgets.
export function convertLibraryText(text) {
  let value;
  try { value = JSON.parse(text); } catch { return text; }
  if (!plain(value) || !Array.isArray(value.entries)) return text;
  let changed = false;
  const entries = value.entries.map((entry) => {
    if (plain(entry) && entry.kind === 'look' && isLegacy(entry.look)) { changed = true; return { ...entry, look: convertLook(entry.look) }; }
    if (plain(entry) && entry.kind === 'widget' && plain(entry.widget) && isLegacy(entry.widget.look)) {
      changed = true;
      const look = tidy(convertLook(entry.widget.look));
      const widget = { ...entry.widget, look };
      if (!look) delete widget.look;
      return { ...entry, widget };
    }
    return entry;
  });
  return changed ? JSON.stringify({ ...value, entries }, null, 2) + '\n' : text;
}

async function read(file) {
  try { return await fs.readFile(file, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function write(file, text) {
  const stat = await fs.stat(file);
  const temporary = `${file}.${process.pid}.upgrade.tmp`;
  const handle = await fs.open(temporary, 'w', stat.mode & 0o777);
  try { await handle.writeFile(text); await handle.sync(); } finally { await handle.close(); }
  await fs.rename(temporary, file);
}
export async function update(file, convert) {
  // Only regular files: a symlinked or hard-linked file isn't replaced by a
  // copy (config.mjs refuses those too).
  let stat;
  try { stat = await fs.lstat(file); } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  if (!stat.isFile() || stat.nlink > 1) return false;
  const text = await read(file);
  if (text === null) return false;
  const next = convert(text);
  if (next === text) return false;
  await write(file, next);
  return true;
}
const hash = (text) => createHash('sha256').update(text == null ? '\0missing' : text).digest('hex');
const location = (configDir, stateDir, name) => join(name === 'state.json' ? stateDir : configDir, name);

// A save interrupted by a crash is finished the way config.mjs would (its
// snapshot put back), so converted files aren't later replaced by old ones.
// Returns false when an interrupted save is left for manual recovery.
export async function settleInterrupted(configDir, stateDir) {
  const journal = await read(join(stateDir, 'transaction.json'));
  if (journal === null) return true;
  let backup;
  try { backup = JSON.parse(await read(join(stateDir, 'backups', `${JSON.parse(journal).backupId}.json`))); } catch { return false; }
  if (!plain(backup?.before) || !plain(backup.afterHashes)) return false;
  const names = Object.keys(backup.before);
  for (const name of names) {
    const current = await read(location(configDir, stateDir, name));
    // Edited by hand since: config.mjs asks for manual recovery; leave it.
    if (hash(current) !== hash(backup.before[name]) && hash(current) !== backup.afterHashes[name]) return false;
  }
  for (const name of names) {
    const file = location(configDir, stateDir, name);
    if (backup.before[name] === null) await fs.rm(file, { force: true });
    else if (await read(file) !== backup.before[name]) {
      if (await read(file) === null) await fs.writeFile(file, backup.before[name], { mode: name === 'state.json' ? 0o600 : 0o640 });
      else await write(file, backup.before[name]);
    }
  }
  await fs.rm(join(stateDir, 'transaction.json'), { force: true });
  return true;
}

// Every dashboard with a folder in either volume.
export async function dashboardDirs(configRoot, stateRoot) {
  const out = [{ configDir: configRoot, stateDir: stateRoot }];
  const ids = new Set();
  for (const root of [configRoot, stateRoot]) {
    try { for (const id of await fs.readdir(join(root, 'dashboards'))) ids.add(id); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  for (const id of [...ids].sort()) out.push({ configDir: join(configRoot, 'dashboards', id), stateDir: join(stateRoot, 'dashboards', id) });
  return out;
}

export async function migrateLegacyLooks({ configRoot, stateRoot, log = console }) {
  let files = 0;
  const count = (changed) => { if (changed) files += 1; };
  for (const { configDir, stateDir } of await dashboardDirs(configRoot, stateRoot)) {
    await settleInterrupted(configDir, stateDir);
    // The card look's old settings are applied to the widgets first and only
    // then removed, so an interrupted run can be repeated with the same result.
    const settings = convertSettingsText(await read(join(configDir, 'settings.yaml')));
    count(await update(join(stateDir, 'state.json'), (text) => convertStateText(text, settings.inherited)));
    count(await update(join(stateDir, 'studio-library.json'), convertLibraryText));
    // Pre-save snapshots, so restoring one doesn't bring the old looks back.
    let names = [];
    try { names = (await fs.readdir(join(stateDir, 'backups'))).filter((name) => /^backup-[A-Za-z0-9-]+\.json$/.test(name)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    for (const name of names) {
      count(await update(join(stateDir, 'backups', name), (text) => {
        let snapshot;
        try { snapshot = JSON.parse(text); } catch { return text; }
        if (!plain(snapshot?.before)) return text;
        const before = { ...snapshot.before };
        let snapshotInherited = {};
        if (typeof before['settings.yaml'] === 'string') { const result = convertSettingsText(before['settings.yaml']); before['settings.yaml'] = result.text; snapshotInherited = result.inherited; }
        if (typeof before['state.json'] === 'string') before['state.json'] = convertStateText(before['state.json'], snapshotInherited);
        return same(before, snapshot.before) ? text : `${JSON.stringify({ ...snapshot, before }, null, 2)}\n`;
      }));
    }
    count(await update(join(configDir, 'settings.yaml'), () => settings.text));
  }
  count(await update(join(stateRoot, 'studio-shared-library.json'), convertLibraryText));
  let people = [];
  try { people = await fs.readdir(join(stateRoot, 'people')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const person of people) count(await update(join(stateRoot, 'people', person, 'studio-library.json'), convertLibraryText));
  log.log(`Studio upgrade: converted old widget looks in ${files} file${files === 1 ? '' : 's'}.`);
}
