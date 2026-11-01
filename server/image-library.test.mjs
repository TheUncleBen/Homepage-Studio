// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createImageLibrary, imageUsage, MAX_IMAGE_BYTES } from './image-library.mjs';
import { requiredLevel } from './auth/access.mjs';

const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');
const dataUrl = (bytes, type = 'image/png') => `data:${type};base64,${bytes.toString('base64')}`;

test('the image library stores logos and backgrounds apart, by content, and reads back only valid files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-images-'));
  const library = createImageLibrary({ stateDir: root });
  assert.deepEqual(await library.list(), []);
  const logo = await library.add({ kind: 'logo', name: '../../etc/passwd\u0000.png', image: dataUrl(png) });
  assert.equal(logo.kind, 'logo');
  assert.equal(logo.name, 'passwd.png');
  assert.match(logo.id, /^[a-f0-9]{24}$/);
  // The same picture again is the same entry; as a background it is another.
  assert.equal((await library.add({ kind: 'logo', name: 'again.png', image: dataUrl(png) })).id, logo.id);
  const background = await library.add({ kind: 'background', name: 'sky.png', image: dataUrl(png) });
  assert.notEqual(background.id, logo.id);
  assert.equal((await library.list()).length, 2);
  const read = await library.read(logo.id);
  assert.equal(read.type, 'image/png');
  assert.ok(read.bytes.equals(png));
  assert.equal(await library.read('not-an-id'), null);
  // A file swapped for something else on disk is not served.
  await fs.writeFile(path.join(root, 'images', logo.id + '.png'), '<html>');
  assert.equal(await library.read(logo.id), null);
  await library.remove(background.id);
  assert.equal((await library.list()).length, 1);
  await assert.rejects(library.remove(background.id), { code: 'IMAGE_NOT_FOUND' });
});

test('the image library refuses other kinds, other types, unsafe SVG and oversized files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-images-'));
  const library = createImageLibrary({ stateDir: root });
  await assert.rejects(library.add({ kind: 'icon', image: dataUrl(png) }), { code: 'INVALID_IMAGE' });
  await assert.rejects(library.add({ kind: 'logo', image: 'https://example.com/a.png' }), { code: 'INVALID_IMAGE' });
  await assert.rejects(library.add({ kind: 'logo', image: dataUrl(Buffer.from('GIF89a....')) }), { code: 'INVALID_IMAGE' });
  await assert.rejects(library.add({ kind: 'logo', image: dataUrl(Buffer.from('<svg><script>alert(1)</script></svg>'), 'image/svg+xml') }), { code: 'INVALID_IMAGE' });
  await assert.rejects(library.add({ kind: 'background', image: dataUrl(Buffer.from('<svg><image href="https://example.com/x.png"/></svg>'), 'image/svg+xml') }), { code: 'INVALID_IMAGE' });
  const big = Buffer.concat([png, Buffer.alloc(MAX_IMAGE_BYTES.logo)]);
  await assert.rejects(library.add({ kind: 'logo', image: dataUrl(big) }), { code: 'IMAGE_TOO_LARGE' });
  assert.ok((await library.add({ kind: 'background', image: dataUrl(big) })).id, 'a background may be larger than a logo');
});

test('image usage lists every widget, page, default and file that uses an image', () => {
  const id = 'a'.repeat(24);
  const ref = { source: 'library', id };
  const usedIn = imageUsage(id, {
    board: { panels: [{ id: 'p', title: 'Jellyfin', look: { background: ref } }, { id: 'q', look: {} }], pages: [{ id: 'm', name: 'Media', background: ref }, { id: 'n', name: 'Films', icon: `/studio/api/images/${id}` }], looks: [{ id: 'l', name: 'Night', look: { fill: 'picture', background: ref } }] },
    settings: { studioTheme: { card: { background: ref }, pageBackground: ref } },
    files: { 'services.yaml': `icon: /studio/api/images/${id}`, 'bookmarks.yaml': '' },
  });
  assert.deepEqual(usedIn.map(place => place.name), ['Jellyfin', 'Saved look “Night”', 'Media', 'Films icon', 'Card background', 'Page background', 'services.yaml']);
  assert.deepEqual(imageUsage('b'.repeat(24), { board: {}, settings: {} }), []);
});

test('viewers load uploaded images; arranging adds and removes them; anything else stays admin-only', () => {
  assert.equal(requiredLevel('GET', '/studio/api/images/' + 'a'.repeat(24)).level, 'view');
  assert.equal(requiredLevel('GET', '/studio/api/images/../state.json').level, 'admin');
  assert.equal(requiredLevel('GET', '/studio/api/images').level, 'arrange');
  assert.equal(requiredLevel('POST', '/studio/api/images').level, 'arrange');
  assert.equal(requiredLevel('POST', '/studio/api/images/delete').level, 'arrange');
  assert.equal(requiredLevel('POST', '/studio/api/images/' + 'a'.repeat(24)).level, 'admin');
});
