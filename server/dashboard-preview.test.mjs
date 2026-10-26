import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardPreview, previewIcon } from './dashboard-preview.mjs';

test('preview icons resolve the names Homepage loads from its icon CDN, and nothing else', () => {
  const cdn = 'https://cdn.jsdelivr.net';
  assert.deepEqual(previewIcon('sonarr.png'), { src: `${cdn}/gh/homarr-labs/dashboard-icons/png/sonarr.png`, mask: false });
  assert.deepEqual(previewIcon('sonarr'), { src: `${cdn}/gh/homarr-labs/dashboard-icons/png/sonarr.png`, mask: false });
  assert.deepEqual(previewIcon('jellyfin.svg'), { src: `${cdn}/gh/homarr-labs/dashboard-icons/svg/jellyfin.svg`, mask: false });
  assert.deepEqual(previewIcon('plex.webp'), { src: `${cdn}/gh/homarr-labs/dashboard-icons/webp/plex.webp`, mask: false });
  assert.deepEqual(previewIcon('sh-immich.svg'), { src: `${cdn}/gh/selfhst/icons@main/svg/immich.svg`, mask: false });
  assert.deepEqual(previewIcon('mdi-home-#ff0000'), { src: `${cdn}/npm/@mdi/svg@latest/svg/home.svg`, mask: true });
  assert.deepEqual(previewIcon('si-github'), { src: `${cdn}/npm/simple-icons@latest/icons/github.svg`, mask: true });
  // Other sites and the dashboard's own files aren't loaded by the page.
  for (const value of ['https://example.test/x.png', 'http://example.test/x.png', '/icons/x.png', '', '  ', null, 3, {}]) assert.equal(previewIcon(value), null, String(value));
  // Nothing outside a plain file name reaches a URL.
  for (const value of ['a")b.png', '../x.png', 'a b.png', 'mdi-a"b', 'sh-a/b.png', 'x'.repeat(120) + '.png']) assert.equal(previewIcon(value), null, value);
});

test('a preview holds the layout, the look and each tile name and icon, with stacks drawn once', () => {
  const state = {
    settingsConfig: { studioTheme: { accent: '#81a8c8' } },
    services: [{ id: 's1', name: 'Sonarr', config: { icon: 'sonarr.png' } }],
    bookmarks: [{ id: 'b1', name: 'Docs', config: { icon: 'https://example.test/docs.png' } }],
    board: {
      version: 2, columns: 12,
      panels: [
        { id: 's1', kind: 'service', title: 'Sonarr', nativeLocator: { serviceId: 's1' }, rect: { x: 4, y: 0, w: 4, h: 2 } },
        { id: 'b1', kind: 'bookmark', title: 'Docs', rect: { x: 0, y: 0, w: 4, h: 2 } },
        { id: 'i1', kind: 'informationWidget', title: 'Clock', rect: { x: 0, y: 3, w: 6, h: 2 } },
        { id: 'i2', kind: 'informationWidget', title: 'Greeting', rect: { x: 0, y: 3, w: 6, h: 2 } },
      ],
      stacks: [{ id: 'st', panelIds: ['i1', 'i2'], rect: { x: 0, y: 3, w: 6, h: 2 } }],
    },
  };
  const preview = dashboardPreview(state, { mode: 'light', accent: '#b299be', background: null });
  assert.equal(preview.mode, 'light', 'the platform mode applies when the dashboard sets none');
  assert.deepEqual(Object.keys(preview.tokens), ['light']);
  assert.match(preview.tokens.light.bg, /^#[0-9a-f]{6}$/);
  assert.equal(preview.columns, 12);
  assert.equal(preview.rows, 5);
  assert.deepEqual(preview.units.map(unit => [unit.title, unit.x, unit.y, unit.count, unit.icon?.src ?? null]), [
    ['Docs', 0, 0, 1, null],
    ['Sonarr', 4, 0, 1, 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/png/sonarr.png'],
    ['Clock', 0, 3, 2, null],
  ]);
  const following = dashboardPreview({ ...state, settingsConfig: { studioTheme: { mode: 'system' } } }, null);
  assert.deepEqual(Object.keys(following.tokens).sort(), ['dark', 'light'], 'a dashboard that follows the device carries both');
  assert.deepEqual(dashboardPreview({ settingsConfig: {} }, null).units, []);
});
