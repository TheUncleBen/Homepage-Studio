import { appearanceConfig, appearanceTokens, applyPlatformDefaults } from '../homepage/src/components/studio/appearance.mjs';

// The Dashboards page draws each dashboard from its saved files instead of
// running it (owner decision, 26 Oct 2026): the board's layout, the look it
// would have, and each tile's name and icon. Nothing here starts a renderer.

export const ICON_HOST = 'https://cdn.jsdelivr.net';
const ICON_SETS = { mdi: `${ICON_HOST}/npm/@mdi/svg@latest/svg/`, si: `${ICON_HOST}/npm/simple-icons@latest/icons/` };
const NAME = /^[a-z0-9][a-z0-9._-]{0,99}$/i;

// The same icon names Homepage resolves (src/components/resolvedicon.jsx), for
// the icons it loads from its icon CDN. Addresses of other sites and the
// dashboard's own files are left out: the page loads images only from itself
// and that CDN, and a dashboard's files would start the dashboard. mask is
// true for single-colour icon sets, which are drawn in the tile's colour.
export function previewIcon(value) {
  if (typeof value !== 'string') return null;
  const icon = value.trim();
  if (!icon || /^(?:https?:|\/)/i.test(icon)) return null;
  const prefix = icon.split('-')[0];
  if (prefix === 'sh') {
    const extension = icon.endsWith('.svg') ? 'svg' : icon.endsWith('.webp') ? 'webp' : 'png';
    const name = icon.replace('sh-', '').replace('.svg', '').replace('.png', '').replace('.webp', '');
    return NAME.test(name) ? { src: `${ICON_HOST}/gh/selfhst/icons@main/${extension}/${name}.${extension}`, mask: false } : null;
  }
  if (ICON_SETS[prefix]) {
    const name = icon.replace(`${prefix}-`, '').replace('.svg', '').replace(/-#[a-f0-9]{6}$/i, '');
    return NAME.test(name) ? { src: `${ICON_SETS[prefix]}${name}.svg`, mask: true } : null;
  }
  const extension = icon.endsWith('.svg') ? 'svg' : icon.endsWith('.webp') ? 'webp' : 'png';
  const name = icon.replace(/\.(?:svg|webp|png)$/, '');
  return NAME.test(name) ? { src: `${ICON_HOST}/gh/homarr-labs/dashboard-icons/${extension}/${name}.${extension}`, mask: false } : null;
}

const TOKENS = ['bg', 'surface', 'raised', 'text', 'muted', 'line', 'accent', 'accent-soft'];

// state is a dashboard's loaded configuration (config.mjs load()); platform is
// the platform default look. Every string that reaches the page is plain text
// or a URL built above; the page sets them as text and CSSOM values only.
export function dashboardPreview(state, platform) {
  const settings = applyPlatformDefaults(state.settingsConfig ?? {}, platform);
  const pick = dark => { const { tokens } = appearanceTokens(settings, dark); return Object.fromEntries(TOKENS.map(name => [name, tokens[name]])); };
  // A dashboard that follows the device gets both, and the page picks.
  const mode = appearanceConfig(settings).mode;
  const services = new Map((state.services ?? []).map(service => [service.id, service]));
  const bookmarks = new Map((state.bookmarks ?? []).map(bookmark => [bookmark.id, bookmark]));
  const iconOf = panel => {
    if (panel.kind === 'bookmark') return previewIcon(bookmarks.get(panel.id)?.config?.icon);
    if (panel.kind === 'service' || panel.kind === 'serviceWidget') return previewIcon(services.get(panel.nativeLocator?.serviceId)?.config?.icon);
    return null;
  };
  const board = state.board ?? { columns: 12, panels: [], stacks: [] };
  const byId = new Map(board.panels.map(panel => [panel.id, panel]));
  const stacked = new Set(board.stacks.flatMap(stack => stack.panelIds));
  const unit = (rect, panel, count = 1) => ({ x: rect.x, y: rect.y, w: rect.w, h: rect.h, title: String(panel?.title ?? '').slice(0, 120), icon: panel ? iconOf(panel) : null, count });
  const units = [
    ...board.panels.filter(panel => !stacked.has(panel.id)).map(panel => unit(panel.rect, panel)),
    ...board.stacks.map(stack => unit(stack.rect, byId.get(stack.panelIds[0]), stack.panelIds.length)),
  ].sort((a, b) => a.y - b.y || a.x - b.x);
  return {
    mode,
    tokens: mode === 'system' ? { dark: pick(true), light: pick(false) } : { [mode]: pick(mode === 'dark') },
    columns: board.columns ?? 12,
    rows: Math.max(0, ...units.map(item => item.y + item.h)),
    units,
  };
}
