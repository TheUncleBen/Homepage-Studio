import { createHash } from 'node:crypto';
import { LookError, validateBehaviour, validateLook } from '../homepage/src/components/studio/look.mjs';
import { columnsOfPage, panelMinimum, PHONE_COLUMNS, TABLET_COLUMNS } from '../homepage/src/components/studio/geometry.mjs';
import { arrivalRect } from '../homepage/src/components/studio/layouts.mjs';

const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const digest = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 24);
const clone = (v) => JSON.parse(JSON.stringify(v));
const kinds = new Set(['service', 'serviceWidget', 'informationWidget', 'bookmark']);
// Board version 3 (fresh deployments only): 24 columns of 36 px rows, so a
// card can fit its content exactly, plus pages and per-widget look and
// behaviour overrides.
export const BOARD_VERSION = 3;
export const BOARD_COLUMNS = 24;
export const MAX_PANELS = 4096;
export const MAX_PAGES = 20;
export const DEFAULT_PAGE = Object.freeze({ id: 'home', name: 'Home' });
const PAGE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
// An icon name or address, or an image uploaded to the dashboard.
const ICON = /^(?:[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}|\/studio\/api\/images\/[a-f0-9]{24})$/;
export const DEFAULT_PLAYBACK = Object.freeze({ mode: 'manual', intervalMs: 10000, manualHoldMs: 30000, transition: 'horizontal', transitionDurationMs: 250, loop: true });

export class BoardError extends Error {
  constructor(message, code = 'INVALID_BOARD', status = 422) {
    super(message); this.name = 'BoardError'; this.code = code; this.status = status;
  }
}
const fail = (message, code) => { throw new BoardError(message, code); };
const idOK = (id) => typeof id === 'string' && id.length > 0 && id.length <= 256 && !/[\u0000-\u001f]/.test(id);

export function stableValue(value) {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableValue(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

// Reserve exact matches before positional fallbacks. Repeated reads without a
// save use deterministic IDs; structured edits persist them with the same commit.
export function reconcileIdentities(entries, previous = [], prefix) {
  const used = new Set();
  const matches = entries.map((e) => {
    let i = previous.findIndex((p, n) => !used.has(n) && p.scope === e.scope && p.type === e.type && p.key === e.key && p.fingerprint === e.fingerprint);
    if (i < 0) i = previous.findIndex((p, n) => !used.has(n) && p.scope === e.scope && p.type === e.type && p.fingerprint === e.fingerprint);
    if (i >= 0) used.add(i);
    return i;
  });
  const reserved = new Set(matches.filter((i) => i >= 0).map((i) => previous[i].id));
  const ids = new Set();
  return entries.map((e, n) => {
    let i = matches[n];
    // After unchanged entries have reserved their identities, replacing a
    // widget's type in the same native slot remains an edit of that panel.
    if (i < 0) i = previous.findIndex((p, j) => !used.has(j) && p.scope === e.scope && p.key === e.key);
    if (i >= 0) used.add(i);
    let id = i >= 0 ? previous[i].id : `${prefix}-${digest([e.scope, e.type, e.key, n, e.fingerprint])}`;
    if (!idOK(id) || ids.has(id) || (i < 0 && reserved.has(id))) id = `${prefix}-${digest([e.scope, e.type, e.key, n, e.fingerprint, 'unique'])}`;
    ids.add(id);
    return { ...e, id };
  });
}

export function identityRecords(entries) {
  return entries.map(({ id, scope, type, key, fingerprint }) => ({ id, scope, type, key, fingerprint }));
}

export function validateIdentityRecords(value, label) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > MAX_PANELS) fail(`${label} identity metadata is invalid.`, 'INVALID_STATE');
  const ids = new Set();
  for (const e of value) {
    if (!object(e) || !idOK(e.id) || ids.has(e.id) || ['scope', 'type', 'key', 'fingerprint'].some((k) => typeof e[k] !== 'string' || e[k].length > 4096)) fail(`${label} identity metadata is invalid.`, 'INVALID_STATE');
    ids.add(e.id);
  }
  return value;
}

// The furthest row a rectangle may start on.
const MAX_ROW = 200000;
export function rect(value, label = 'Panel', columns = BOARD_COLUMNS) {
  if (!object(value)) fail(`${label} requires grid position and dimensions.`);
  const { x, y, w, h } = value;
  if (![x, y, w, h].every(Number.isSafeInteger) || x < 0 || y < 0 || w < 1 || h < 1 || w > columns || x + w > columns || y > MAX_ROW || h > 2000) fail(`${label} has an invalid grid rectangle.`);
  return { x, y, w, h };
}

// A layout for each size (owner decision, 4 Nov 2026): tablet and phone
// follow desktop until someone arranges them; then board.layouts[size] keeps
// that size's rectangle for each unit (a widget not in a stack, or a stack).
export const LAYOUT_COLUMNS = Object.freeze({ tablet: TABLET_COLUMNS, phone: PHONE_COLUMNS });
function validateLayouts(value, unitIds) {
  if (value == null) return undefined;
  if (!object(value) || Object.keys(value).some((size) => !Object.hasOwn(LAYOUT_COLUMNS, size))) fail('The layouts for each size are not valid.');
  const out = {};
  for (const [size, units] of Object.entries(value)) {
    if (!object(units)) fail('The layouts for each size are not valid.');
    const kept = {};
    // A unit that no longer exists is dropped; one without a place is placed.
    for (const [id, area] of Object.entries(units)) if (unitIds.has(id)) kept[id] = rect(area, `The ${size} layout`, LAYOUT_COLUMNS[size]);
    // A size with nothing left on it follows desktop again.
    if (Object.keys(kept).length) out[size] = kept;
  }
  return Object.keys(out).length ? out : undefined;
}

export function playback(value = {}) {
  if (!object(value)) fail('Stack playback settings must be an object.');
  const p = { ...DEFAULT_PLAYBACK, ...value };
  if (!['manual', 'automatic'].includes(p.mode) || !['horizontal', 'vertical', 'fade', 'none'].includes(p.transition) || typeof p.loop !== 'boolean') fail('Stack playback mode or transition is invalid.');
  for (const name of ['intervalMs', 'manualHoldMs']) if (!Number.isSafeInteger(p[name]) || p[name] < 1000 || p[name] > 3600000) fail('Slideshow intervals must be between 1 second and 1 hour.');
  if (!Number.isSafeInteger(p.transitionDurationMs) || p.transitionDurationMs < 0 || p.transitionDurationMs > 2000) fail('Slide animation duration must be between 0 and 2000 milliseconds.');
  return Object.fromEntries(Object.keys(DEFAULT_PLAYBACK).map((k) => [k, p[k]]));
}

function lookOf(value, label) {
  try {
    return { look: validateLook(value.look), behaviour: validateBehaviour(value.behaviour) };
  } catch (error) {
    if (error instanceof LookError) fail(`${label}: ${error.message}`);
    throw error;
  }
}

// Saved looks: a named look (layout, fill, colours, edges…) to reuse on
// other widgets. Never a widget's own value arrangement.
export const MAX_SAVED_LOOKS = 30;
export function validateSavedLooks(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > MAX_SAVED_LOOKS) fail(`Keep at most ${MAX_SAVED_LOOKS} saved looks.`);
  const ids = new Set(), names = new Set();
  return value.map((entry) => {
    if (!object(entry) || !idOK(entry.id) || ids.has(entry.id)) fail('Each saved look needs a unique identity.');
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    if (!name || name.length > 40 || /[\u0000-\u001f]/.test(name)) fail('Name a saved look with 1 to 40 characters.');
    if (names.has(name.toLocaleLowerCase())) fail(`There is already a saved look called “${name}”.`);
    ids.add(entry.id); names.add(name.toLocaleLowerCase());
    const { look } = lookOf({ look: entry.look }, `Saved look “${name}”`);
    if (!look || look.values) fail(`Saved look “${name}” needs look settings and no widget values.`);
    return { id: entry.id, name, look };
  });
}

export function validatePages(value) {
  if (value == null) return [{ ...DEFAULT_PAGE }];
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_PAGES) fail(`A dashboard has 1 to ${MAX_PAGES} pages.`);
  const ids = new Set(), names = new Set();
  return value.map((page) => {
    if (!object(page) || typeof page.id !== 'string' || !PAGE_ID.test(page.id) || ids.has(page.id)) fail('Each page needs a unique identity.');
    ids.add(page.id);
    if (typeof page.name !== 'string') fail('Each page needs a name.');
    const name = page.name.trim();
    if (!name || name.length > 40 || /[\u0000-\u001f\u007f]/.test(name)) fail('A page name is 1 to 40 characters.');
    if (names.has(name.toLocaleLowerCase())) fail(`Two pages are called “${name}”. Page names must differ.`);
    names.add(name.toLocaleLowerCase());
    const out = { id: page.id, name };
    if (page.grid !== undefined) {
      if (page.grid !== 'even' && page.grid !== 'centred') fail('A page grid is even or centred.');
      if (page.grid === 'centred') out.grid = 'centred';
    }
    if (page.icon !== undefined) {
      if (typeof page.icon !== 'string' || !ICON.test(page.icon)) fail('A page icon is not valid.');
      out.icon = page.icon;
    }
    if (page.background !== undefined) {
      try { out.background = validateLook({ background: page.background }).background; }
      catch (error) { if (error instanceof LookError) fail(`Page “${name}”: ${error.message}`); throw error; }
    }
    return out;
  });
}

export function emptyBoard() { return { version: BOARD_VERSION, columns: BOARD_COLUMNS, pages: [{ ...DEFAULT_PAGE }], panels: [], stacks: [] }; }

export function validateStoredBoard(value) {
  if (value == null) return emptyBoard();
  if (!object(value) || value.version !== BOARD_VERSION || value.columns !== BOARD_COLUMNS || !Array.isArray(value.panels) || !Array.isArray(value.stacks)) fail('Unsupported board schema.', 'INVALID_STATE');
  if (value.panels.length > MAX_PANELS || value.stacks.length > MAX_PANELS) fail('The dashboard contains too many panels.', 'CONFIG_SIZE_LIMIT');
  const pages = validatePages(value.pages);
  const pageIds = new Set(pages.map((page) => page.id));
  const columnsOf = new Map(pages.map((page) => [page.id, columnsOfPage(page)]));
  const pageOf = (unit) => {
    if (unit.pageId === undefined) return pages[0].id;
    if (!pageIds.has(unit.pageId)) fail('A widget is on a page that does not exist.');
    return unit.pageId;
  };
  const ids = new Set();
  const panels = value.panels.map((p) => {
    if (!object(p) || !idOK(p.id) || ids.has(p.id) || !kinds.has(p.kind)) fail('Panel identity is invalid or duplicated.');
    ids.add(p.id);
    const { look, behaviour } = lookOf(p, p.title ? `“${String(p.title).slice(0, 80)}”` : 'A widget');
    const pageId = pageOf(p);
    const panel = { ...p, rect: rect(p.rect, 'Panel', columnsOf.get(pageId)), pageId };
    delete panel.look; delete panel.behaviour;
    if (look) panel.look = look;
    if (behaviour) panel.behaviour = behaviour;
    return panel;
  });
  const children = new Set();
  const stackIds = new Set();
  const stacks = value.stacks.map((s) => {
    if (!object(s) || !idOK(s.id) || ids.has(s.id) || stackIds.has(s.id) || !Array.isArray(s.panelIds) || s.panelIds.length < 2) fail('A stack needs a unique identity and at least two panels.');
    stackIds.add(s.id);
    for (const id of s.panelIds) {
      if (!ids.has(id) || children.has(id)) fail('A stack contains a missing, repeated or already stacked panel.');
      children.add(id);
    }
    const pageId = pageOf(s);
    return { id: s.id, panelIds: [...s.panelIds], rect: rect(s.rect, 'Stack', columnsOf.get(pageId)), pageId, playback: playback(s.playback) };
  });
  // A stacked panel lives on its stack's page.
  for (const stack of stacks) for (const id of stack.panelIds) panels.find((p) => p.id === id).pageId = stack.pageId;
  const looks = validateSavedLooks(value.looks);
  const layouts = validateLayouts(value.layouts, unitIdsOf(panels, stacks));
  return { version: BOARD_VERSION, columns: BOARD_COLUMNS, pages, panels, stacks, ...(layouts ? { layouts } : {}), ...(looks.length ? { looks } : {}) };
}

function unitIdsOf(panels, stacks) {
  const stacked = new Set(stacks.flatMap((s) => s.panelIds));
  return new Set([...stacks.map((s) => s.id), ...panels.filter((p) => !stacked.has(p.id)).map((p) => p.id)]);
}

// Places every unit a stored size layout has no place for at the end of its
// page on that size, so a widget added anywhere is on every size.
function completeLayouts(board) {
  if (!board.layouts) return board;
  const stacked = new Set(board.stacks.flatMap((s) => s.panelIds));
  const units = [...board.stacks, ...board.panels.filter((p) => !stacked.has(p.id))];
  const columnsOf = new Map(board.pages.map((page) => [page.id, columnsOfPage(page)]));
  const ids = new Set(units.map((unit) => unit.id));
  const layouts = {};
  for (const [size, stored] of Object.entries(board.layouts)) {
    const placed = Object.fromEntries(Object.entries(stored).filter(([id]) => ids.has(id)));
    // Every unit it arranged is gone: that size follows desktop again.
    if (!Object.keys(placed).length) continue;
    const bottom = new Map();
    for (const unit of units) if (placed[unit.id]) bottom.set(unit.pageId, Math.max(bottom.get(unit.pageId) ?? 0, placed[unit.id].y + placed[unit.id].h));
    for (const unit of [...units].sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x)) {
      if (placed[unit.id]) continue;
      const area = arrivalRect(unit.rect, size, columnsOf.get(unit.pageId));
      let position = { x: 0, y: bottom.get(unit.pageId) ?? 0, w: area.w, h: area.h };
      // A layout arranged far down leaves no room at the bottom within the
      // row limit (rect()): take the first free gap on that page instead, so
      // adding a widget never makes the board invalid.
      if (position.y > MAX_ROW) {
        const occupied = units.filter((other) => other.pageId === unit.pageId && placed[other.id]).map((other) => placed[other.id]);
        position = nextPosition(area, occupied, LAYOUT_COLUMNS[size] ?? BOARD_COLUMNS);
      }
      placed[unit.id] = position;
      bottom.set(unit.pageId, Math.max(bottom.get(unit.pageId) ?? 0, position.y + position.h));
    }
    layouts[size] = placed;
  }
  if (!Object.keys(layouts).length) {
    const { layouts: _dropped, ...rest } = board;
    return rest;
  }
  return { ...board, layouts };
}

function layoutOverlaps(board) {
  if (!board.layouts) return;
  const stacked = new Set(board.stacks.flatMap((s) => s.panelIds));
  const pageOfUnit = new Map([...board.stacks, ...board.panels.filter((p) => !stacked.has(p.id))].map((unit) => [unit.id, unit.pageId]));
  for (const [size, stored] of Object.entries(board.layouts)) {
    const entries = Object.entries(stored);
    for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
      if (pageOfUnit.get(entries[i][0]) === pageOfUnit.get(entries[j][0]) && intersects(entries[i][1], entries[j][1])) fail(`Widgets overlap on the ${size} layout. Move the selected widget to a free grid position.`);
    }
  }
}

export function intersects(a, b) { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }

function placementIndex(occupied, columns = BOARD_COLUMNS) {
  // Validated rectangles occupy at most 12 columns. Sparse row masks avoid an
  // allocation proportional to a distant persisted y coordinate per panel.
  const rows = new Map(), cursors = new Map();
  let bottom = 0;
  const maskOf = ({ x, w }) => ((1 << w) - 1) << x;
  function add(position) {
    const mask = maskOf(position), end = position.y + position.h;
    for (let y = position.y; y < end; y++) rows.set(y, (rows.get(y) ?? 0) | mask);
    bottom = Math.max(bottom, end);
  }
  function overlaps(position) {
    const mask = maskOf(position);
    for (let y = position.y; y < position.y + position.h; y++) if ((rows.get(y) ?? 0) & mask) return true;
    return false;
  }
  function next(size) {
    const w = Math.min(columns, Math.max(1, size.w)), h = Math.max(1, size.h);
    const key = `${w}:${h}`, cursor = cursors.get(key) ?? { x: 0, y: 0 };
    // Occupancy only grows during reconciliation. Positions rejected by an
    // earlier search of this size cannot become free, so retain its cursor.
    // Sliding column counts keep even a 1,000-row rectangle search bounded by
    // rows visited instead of rescanning its entire height at every position.
    const counts = new Array(columns).fill(0);
    let blocked = 0;
    function adjustRow(y, delta) {
      const mask = rows.get(y) ?? 0;
      if (!mask) return;
      for (let column = 0; column < columns; column++) {
        const bit = 1 << column;
        if (!(mask & bit)) continue;
        counts[column] += delta;
        if (counts[column]) blocked |= bit;
        else blocked &= ~bit;
      }
    }
    for (let y = cursor.y; y < cursor.y + h; y++) adjustRow(y, 1);
    const widthMask = (1 << w) - 1;
    for (let y = cursor.y; y <= bottom; y++) {
      for (let x = y === cursor.y ? cursor.x : 0; x <= columns - w; x++) {
        if (!(blocked & (widthMask << x))) {
          cursors.set(key, { x, y });
          return { x, y, w, h };
        }
      }
      adjustRow(y, -1); adjustRow(y + h, 1);
    }
    return { x: 0, y: bottom, w, h };
  }
  occupied.forEach(add);
  return { add, overlaps, next };
}

export function nextPosition(size, occupied, columns = BOARD_COLUMNS) { return placementIndex(occupied, columns).next(size); }

// Native information widget display names, as listed in the shipped catalog.
const INFO_WIDGET_NAMES = {
  customapi: 'Custom API',
  datetime: 'Date & Time',
  glances: 'Glances',
  greeting: 'Greeting',
  kubernetes: 'Kubernetes',
  logo: 'Logo',
  longhorn: 'Longhorn',
  openmeteo: 'Open-Meteo',
  openweathermap: 'OpenWeatherMap',
  resources: 'Resources',
  search: 'Search',
  stocks: 'Stocks',
  unifi_console: 'UniFi Controller',
  weatherapi: 'WeatherAPI',
};

export function infoWidgetLabel(type) {
  if (Object.hasOwn(INFO_WIDGET_NAMES, type)) return INFO_WIDGET_NAMES[type];
  const words = String(type ?? '').split(/[_\s-]+/).filter(Boolean);
  return words.length ? words.map((word) => word[0].toUpperCase() + word.slice(1)).join(' ') : 'Information widget';
}

// Duplicates are numbered by configuration order ("Greeting", "Greeting 2"),
// so a title changes only when an earlier widget of the same type is added,
// removed or reordered. Titles are display text; identities are unchanged.
function infoWidgetTitles(infoWidgets) {
  const counts = new Map();
  const titles = new Map();
  [...infoWidgets].sort((a, b) => a.index - b.index).forEach((widget) => {
    const label = infoWidgetLabel(widget.type);
    const count = (counts.get(label) ?? 0) + 1;
    counts.set(label, count);
    titles.set(widget, count === 1 ? label : `${label} ${count}`);
  });
  return titles;
}

export function boardSources({ services, serviceWidgets, infoWidgets, bookmarks }) {
  const sources = [];
  for (const s of services) {
    // A service that carries a widget is shown only by that widget's card:
    // its link, icon and status check belong to the card. A separate link
    // card would duplicate it (owner rule, 4 Nov 2026: never duplicate a widget).
    if (!serviceWidgets.some((w) => w.serviceId === s.id)) sources.push({ id: s.id, kind: 'service', title: s.name, group: s.group, nativeLocator: { serviceId: s.id, groupPath: s.groupPath, name: s.name } });
  }
  for (const w of serviceWidgets) {
    const s = services.find((v) => v.id === w.serviceId);
    // A service's widget is called by the service's name; only a service
    // with several widgets adds which one, by its readable name.
    const several = serviceWidgets.filter((v) => v.serviceId === w.serviceId).length > 1;
    sources.push({ id: w.id, kind: 'serviceWidget', title: several ? `${s.name} · ${infoWidgetLabel(w.type)}` : s.name, group: s.group, nativeLocator: { serviceId: s.id, groupPath: s.groupPath, name: s.name, widgetIndex: w.index, sourceKey: w.sourceKey, sourceIndex: w.sourceIndex, proxyIndex: w.sourceKey === 'widget' ? -1 : w.sourceIndex, type: w.type } });
  }
  const infoTitles = infoWidgetTitles(infoWidgets);
  for (const w of infoWidgets) sources.push({ id: w.id, kind: 'informationWidget', title: infoTitles.get(w), group: 'Information', nativeLocator: { index: w.index, type: w.type } });
  for (const b of bookmarks) sources.push({ id: b.id, kind: 'bookmark', title: b.name, group: b.group, nativeLocator: { group: b.group, name: b.name, groupIndex: b.groupIndex, bookmarkIndex: b.index } });
  if (sources.length > MAX_PANELS) fail('The dashboard contains too many independently placed panels.', 'CONFIG_SIZE_LIMIT');
  return sources;
}

// Default size of a newly added card: a third of the desktop width.
// A link, bookmark or small information widget is one compact row; an
// integration widget has room for a large value and a row below. Four fit
// across the desktop grid. Content that needs more starts at its minimum.
export const NEW_PANEL_SIZE = Object.freeze({ w: 6, h: 2 });
export const NEW_WIDGET_SIZE = Object.freeze({ w: 6, h: 4 });
export function newPanelSize(source) {
  const base = source.kind === 'serviceWidget' ? NEW_WIDGET_SIZE : NEW_PANEL_SIZE;
  const minimum = panelMinimum(source);
  return { w: Math.max(base.w, minimum.w), h: Math.max(base.h, minimum.h) };
}

export function reconcileBoard(sources, previous, { pageId } = {}) {
  previous = validateStoredBoard(previous);
  const pages = previous.pages;
  const target = pages.some((page) => page.id === pageId) ? pageId : pages[0].id;
  const sourceIds = new Set(sources.map((s) => s.id));
  const byId = new Map(previous.panels.map((p) => [p.id, p]));
  const stacked = new Set();
  const stacks = previous.stacks.flatMap((s) => {
    const panelIds = s.panelIds.filter((id) => sourceIds.has(id));
    if (panelIds.length < 2) return [];
    panelIds.forEach((id) => stacked.add(id));
    return [{ ...s, panelIds }];
  });
  // Only the page that receives new arrivals matters for their placement.
  const occupied = stacks.filter((s) => s.pageId === target).map((s) => s.rect);
  for (const s of sources) if (!stacked.has(s.id) && byId.get(s.id)?.pageId === target) occupied.push(byId.get(s.id).rect);
  let placement;
  const panels = sources.map((source) => {
    const old = byId.get(source.id);
    let position = old?.rect;
    const panel = { ...source, pageId: old?.pageId ?? target };
    if (old?.look) panel.look = old.look;
    if (old?.behaviour) panel.behaviour = old.behaviour;
    if (!position) {
      placement ??= placementIndex(occupied, columnsOfPage(pages.find((page) => page.id === target)));
      position = placement.next(newPanelSize(source));
      if (!stacked.has(source.id)) placement.add(position);
    }
    panel.rect = { ...position };
    return panel;
  });
  // A stack that shrinks to one member returns that member to a free rectangle on its page.
  for (const old of previous.stacks) {
    const survivors = old.panelIds.filter((id) => sourceIds.has(id));
    if (survivors.length !== 1) continue;
    const panel = panels.find((p) => p.id === survivors[0]);
    panel.pageId = old.pageId;
    const others = [...stacks.filter((s) => s.pageId === old.pageId).map((s) => s.rect), ...panels.filter((p) => p.id !== panel.id && !stacked.has(p.id) && p.pageId === old.pageId).map((p) => p.rect)];
    panel.rect = others.some((r) => intersects(old.rect, r)) ? nextPosition(old.rect, others, columnsOfPage(pages.find((page) => page.id === old.pageId))) : { ...old.rect };
  }
  return completeLayouts({ version: BOARD_VERSION, columns: BOARD_COLUMNS, pages, panels, stacks, ...(previous.layouts ? { layouts: previous.layouts } : {}), ...(previous.looks ? { looks: previous.looks } : {}) });
}

// An editor's arrangement, merged with content that changed underneath it
// (owner report, 4 Nov 2026: Save must never dead-end). A widget removed
// since the editor loaded is dropped; one added since keeps its current place
// (or the next free space if the arrangement now covers it). Everything the
// editor arranged is kept as it is. Overlaps it made itself still fail.
export function mergeBoardChange(input, sources, current) {
  const value = validateStoredBoard(input);
  const known = new Map(sources.map((s) => [s.id, s]));
  // reconcileBoard drops what is gone (releasing a stack left with one).
  const panels = [...value.panels];
  const have = new Set(panels.map((p) => p.id));
  const pageIds = new Set(value.pages.map((page) => page.id));
  const stacked = new Set(value.stacks.flatMap((s) => s.panelIds));
  const units = [...value.stacks, ...panels.filter((p) => !stacked.has(p.id))];
  for (const p of current?.panels ?? []) {
    if (have.has(p.id) || !known.has(p.id) || !pageIds.has(p.pageId)) continue;
    if (units.some((unit) => unit.pageId === p.pageId && intersects(unit.rect, p.rect))) continue;
    const kept = { ...p };
    panels.push(kept);
    units.push(kept);
  }
  return validateBoardChange(reconcileBoard(sources, { ...value, panels }), sources);
}

export function validateBoardChange(input, sources) {
  const value = validateStoredBoard(input);
  const map = new Map(sources.map((s) => [s.id, s]));
  if (value.panels.length !== sources.length || value.panels.some((p) => !map.has(p.id) || p.kind !== map.get(p.id).kind)) fail('The board does not match the current native content. Reload before saving.');
  // Native identity comes from the sources; placement, page, look and
  // behaviour are what an arrangement changes.
  const panels = value.panels.map((p) => {
    const panel = { ...clone(map.get(p.id)), rect: p.rect, pageId: p.pageId };
    if (p.look) panel.look = p.look;
    if (p.behaviour) panel.behaviour = p.behaviour;
    return panel;
  });
  const stacked = new Set(value.stacks.flatMap((s) => s.panelIds));
  const units = [...value.stacks.map((s) => ({ id: s.id, rect: s.rect, pageId: s.pageId })), ...panels.filter((p) => !stacked.has(p.id)).map((p) => ({ id: p.id, rect: p.rect, pageId: p.pageId }))];
  for (let i = 0; i < units.length; i++) for (let j = i + 1; j < units.length; j++) if (units[i].pageId === units[j].pageId && intersects(units[i].rect, units[j].rect)) fail('Dashboard panels overlap. Move the selected panel to a free grid position.');
  const board = completeLayouts({ version: BOARD_VERSION, columns: BOARD_COLUMNS, pages: value.pages, panels, stacks: value.stacks, ...(value.layouts ? { layouts: value.layouts } : {}), ...(value.looks ? { looks: value.looks } : {}) });
  layoutOverlaps(board);
  return board;
}
