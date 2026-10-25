import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPlatformStore, DEFAULT_PLATFORM } from './platform.mjs';
import { logoType } from './dashboard-logo.mjs';

test('the platform default look starts at the defaults, saves with a revision and refuses stale or unsafe values', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-platform-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = createPlatformStore({ configRoot: root });
  const initial = await store.read();
  assert.deepEqual(initial, { revision: null, ...DEFAULT_PLATFORM, css: '' });
  const saved = await store.update({ revision: null, mode: 'light', accent: '#81a8c8', background: 'https://images.example.test/sky.jpg', css: '.x { color: red; }' });
  assert.equal(saved.mode, 'light');
  assert.equal(await store.readCss(), '.x { color: red; }');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'studio-platform.json'), 'utf8')), { revision: saved.revision, mode: 'light', accent: '#81a8c8', background: 'https://images.example.test/sky.jpg' });
  await assert.rejects(store.update({ revision: null, mode: 'dark', accent: '#000000', background: null, css: '' }), { code: 'PLATFORM_REVISION_CONFLICT' });
  for (const bad of [{ mode: 'neon' }, { accent: 'red' }, { background: 'javascript:alert(1)' }, { background: 'https://x.test/a.jpg") ; }' }, { extra: true }, { css: 'x'.repeat(256 * 1024 + 1) }]) {
    await assert.rejects(store.update({ revision: saved.revision, mode: 'dark', accent: '#000000', background: null, css: '', ...bad }), { name: 'PlatformError' }, JSON.stringify(bad).slice(0, 60));
  }
  assert.equal((await store.read()).revision, saved.revision, 'refused changes write nothing');
});

test('logos are recognized by their bytes, and SVGs with scripts or outside references are refused', () => {
  assert.equal(logoType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), 'image/png');
  assert.equal(logoType(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(logoType(Buffer.from('RIFF\0\0\0\0WEBPVP8 ')), 'image/webp');
  assert.equal(logoType(Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(#g)"/></svg>')), 'image/svg+xml');
  // Editor metadata under other prefixes (Inkscape, Sodipodi) stays allowed.
  assert.equal(logoType(Buffer.from('<svg xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"><inkscape:grid/><rect inkscape:label="tile"/></svg>')), 'image/svg+xml');
  assert.equal(logoType(Buffer.from('GIF89a')), null);
  assert.equal(logoType(Buffer.from('<html><svg></svg></html>')), null);
  assert.equal(logoType(Buffer.from('<!DOCTYPE svg [<!ENTITY x "y">]><svg/>')), null);
  for (const svg of ['<svg><script>alert(1)</script></svg>', '<svg onload="x()"></svg>', '<svg><image href="https://evil.test/x.png"/></svg>', '<svg><foreignObject/></svg>', '<svg><rect style="fill:url(https://evil.test/a)"/></svg>',
    // Namespace prefixes, XHTML content and stylesheet imports.
    '<svg xmlns:s="http://www.w3.org/2000/svg"><s:script>x()</s:script></svg>',
    '<svg xmlns:s="http://www.w3.org/2000/svg"><s:foreignObject width="1" height="1"/></svg>',
    '<svg><g xmlns:h="http://www.w3.org/1999/xhtml"><h:p>x</h:p></g></svg>',
    '<svg><rect s:onclick="x()"/></svg>',
    '<svg><style>@import "https://evil.test/x.css";</style><rect/></svg>']) {
    assert.throws(() => logoType(Buffer.from(svg)), { name: 'LogoError' }, svg);
  }
});
