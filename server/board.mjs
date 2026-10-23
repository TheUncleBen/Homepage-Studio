import { createHash } from 'node:crypto';

const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const digest = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 24);
const clone = (v) => JSON.parse(JSON.stringify(v));
const kinds = new Set(['service', 'serviceWidget', 'informationWidget', 'bookmark']);
export const BOARD_COLUMNS = 12;
export const MAX_PANELS = 4096;
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

export function rect(value, label = 'Panel') {
  if (!object(value)) fail(`${label} requires grid position and dimensions.`);
  const { x, y, w, h } = value;
  if (![x, y, w, h].every(Number.isSafeInteger) || x < 0 || y < 0 || w < 1 || h < 1 || w > BOARD_COLUMNS || x + w > BOARD_COLUMNS || y > 100000 || h > 1000) fail(`${label} has an invalid grid rectangle.`);
  return { x, y, w, h };
}

export function playback(value = {}) {
  if (!object(value)) fail('Stack playback settings must be an object.');
  const p = { ...DEFAULT_PLAYBACK, ...value };
  if (!['manual', 'automatic'].includes(p.mode) || !['horizontal', 'vertical', 'fade', 'none'].includes(p.transition) || typeof p.loop !== 'boolean') fail('Stack playback mode or transition is invalid.');
  for (const name of ['intervalMs', 'manualHoldMs']) if (!Number.isSafeInteger(p[name]) || p[name] < 1000 || p[name] > 3600000) fail('Slideshow intervals must be between 1 second and 1 hour.');
  if (!Number.isSafeInteger(p.transitionDurationMs) || p.transitionDurationMs < 0 || p.transitionDurationMs > 2000) fail('Slide animation duration must be between 0 and 2000 milliseconds.');
  return Object.fromEntries(Object.keys(DEFAULT_PLAYBACK).map((k) => [k, p[k]]));
}

export function validateStoredBoard(value) {
  if (value == null) return { version: 2, columns: BOARD_COLUMNS, panels: [], stacks: [] };
  if (!object(value) || value.version !== 2 || value.columns !== BOARD_COLUMNS || !Array.isArray(value.panels) || !Array.isArray(value.stacks)) fail('Unsupported board schema.', 'INVALID_STATE');
  if (value.panels.length > MAX_PANELS || value.stacks.length > MAX_PANELS) fail('The dashboard contains too many panels.', 'CONFIG_SIZE_LIMIT');
  const ids = new Set();
  const panels = value.panels.map((p) => {
    if (!object(p) || !idOK(p.id) || ids.has(p.id) || !kinds.has(p.kind)) fail('Panel identity is invalid or duplicated.');
    ids.add(p.id);
    return { ...p, rect: rect(p.rect) };
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
    return { id: s.id, panelIds: [...s.panelIds], rect: rect(s.rect, 'Stack'), playback: playback(s.playback) };
  });
  return { version: 2, columns: BOARD_COLUMNS, panels, stacks };
}

export function intersects(a, b) { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }

function placementIndex(occupied) {
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
    const w = Math.min(BOARD_COLUMNS, Math.max(1, size.w)), h = Math.max(1, size.h);
    const key = `${w}:${h}`, cursor = cursors.get(key) ?? { x: 0, y: 0 };
    // Occupancy only grows during reconciliation. Positions rejected by an
    // earlier search of this size cannot become free, so retain its cursor.
    // Sliding column counts keep even a 1,000-row rectangle search bounded by
    // rows visited instead of rescanning its entire height at every position.
    const counts = new Array(BOARD_COLUMNS).fill(0);
    let blocked = 0;
    function adjustRow(y, delta) {
      const mask = rows.get(y) ?? 0;
      if (!mask) return;
      for (let column = 0; column < BOARD_COLUMNS; column++) {
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
      for (let x = y === cursor.y ? cursor.x : 0; x <= BOARD_COLUMNS - w; x++) {
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

export function nextPosition(size, occupied) { return placementIndex(occupied).next(size); }

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
  unifi_console: 'Unifi Controller',
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
    const widgets = serviceWidgets.filter((w) => w.serviceId === s.id);
    const meaningful = ['href', 'description', 'icon', 'ping', 'siteMonitor', 'showStats', 'container', 'server', 'app', 'namespace', 'podSelector', 'proxmoxNode', 'proxmoxVMID'].some((k) => s.config[k] != null && s.config[k] !== false && s.config[k] !== '');
    if (!widgets.length || meaningful) sources.push({ id: s.id, kind: 'service', title: s.name, group: s.group, nativeLocator: { serviceId: s.id, groupPath: s.groupPath, name: s.name } });
  }
  for (const w of serviceWidgets) {
    const s = services.find((v) => v.id === w.serviceId);
    sources.push({ id: w.id, kind: 'serviceWidget', title: `${s.name} · ${w.type}`, group: s.group, nativeLocator: { serviceId: s.id, groupPath: s.groupPath, name: s.name, widgetIndex: w.index, sourceKey: w.sourceKey, sourceIndex: w.sourceIndex, proxyIndex: w.sourceKey === 'widget' ? -1 : w.sourceIndex, type: w.type } });
  }
  const infoTitles = infoWidgetTitles(infoWidgets);
  for (const w of infoWidgets) sources.push({ id: w.id, kind: 'informationWidget', title: infoTitles.get(w), group: 'Information', nativeLocator: { index: w.index, type: w.type } });
  for (const b of bookmarks) sources.push({ id: b.id, kind: 'bookmark', title: b.name, group: b.group, nativeLocator: { group: b.group, name: b.name, groupIndex: b.groupIndex, bookmarkIndex: b.index } });
  if (sources.length > MAX_PANELS) fail('The dashboard contains too many independently placed panels.', 'CONFIG_SIZE_LIMIT');
  return sources;
}

export function reconcileBoard(sources, previous, legacyLayout = { items: {} }) {
  previous = validateStoredBoard(previous);
  const sourceIds = new Set(sources.map((s) => s.id));
  const byId = new Map(previous.panels.map((p) => [p.id, p]));
  const stacked = new Set();
  const stacks = previous.stacks.flatMap((s) => {
    const panelIds = s.panelIds.filter((id) => sourceIds.has(id));
    if (panelIds.length < 2) return [];
    panelIds.forEach((id) => stacked.add(id));
    return [{ ...s, panelIds }];
  });
  const occupied = stacks.map((s) => s.rect);
  // Reserve valid persisted standalone positions before placing new arrivals.
  for (const s of sources) if (!stacked.has(s.id) && byId.has(s.id)) occupied.push(byId.get(s.id).rect);
  let placement;
  const panels = sources.map((source) => {
    let position = byId.get(source.id)?.rect;
    if (!position) {
      placement ??= placementIndex(occupied);
      const legacy = legacyLayout.items?.[source.id];
      try { if (legacy) position = rect(legacy); } catch { /* Old wider layouts are reflowed, not interpreted as new valid coordinates. */ }
      if (!position || placement.overlaps(position)) position = placement.next({ w: 4, h: source.kind === 'serviceWidget' ? 5 : 3 });
      if (!stacked.has(source.id)) placement.add(position);
    }
    return { ...source, rect: { ...position } };
  });
  // A stack that shrinks to one member returns that member to a free rectangle.
  for (const old of previous.stacks) {
    const survivors = old.panelIds.filter((id) => sourceIds.has(id));
    if (survivors.length !== 1) continue;
    const panel = panels.find((p) => p.id === survivors[0]);
    const others = [...stacks.map((s) => s.rect), ...panels.filter((p) => p.id !== panel.id && !stacked.has(p.id)).map((p) => p.rect)];
    panel.rect = others.some((r) => intersects(old.rect, r)) ? nextPosition(old.rect, others) : { ...old.rect };
  }
  return { version: 2, columns: BOARD_COLUMNS, panels, stacks };
}

export function validateBoardChange(input, sources) {
  const value = validateStoredBoard(input);
  const map = new Map(sources.map((s) => [s.id, s]));
  if (value.panels.length !== sources.length || value.panels.some((p) => !map.has(p.id) || p.kind !== map.get(p.id).kind)) fail('The board does not match the current native content. Reload before saving.');
  const panels = value.panels.map((p) => ({ ...clone(map.get(p.id)), rect: p.rect }));
  const stacked = new Set(value.stacks.flatMap((s) => s.panelIds));
  const units = [...value.stacks.map((s) => ({ id: s.id, rect: s.rect })), ...panels.filter((p) => !stacked.has(p.id)).map((p) => ({ id: p.id, rect: p.rect }))];
  for (let i = 0; i < units.length; i++) for (let j = i + 1; j < units.length; j++) if (intersects(units[i].rect, units[j].rect)) fail('Dashboard panels overlap. Move the selected panel to a free grid position.');
  return { version: 2, columns: BOARD_COLUMNS, panels, stacks: value.stacks };
}
