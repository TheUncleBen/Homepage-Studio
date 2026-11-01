// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { BoardError, emptyBoard, reconcileBoard, validateBoardChange, validatePages, validateStoredBoard } from './board.mjs';

const source = (id, kind = 'service') => ({ id, kind, title: id });
const base = (panels, extra = {}) => ({ version: 3, columns: 24, pages: [{ id: 'home', name: 'Home' }, { id: 'media', name: 'Media', icon: 'mdi-movie' }], panels, stacks: [], ...extra });

test('a fresh board has one page and no tab bar is needed', () => {
  assert.deepEqual(emptyBoard().pages, [{ id: 'home', name: 'Home' }]);
  assert.deepEqual(validateStoredBoard(null).pages, [{ id: 'home', name: 'Home' }]);
});

test('pages need unique identities and names, 1 to 40 characters, at most 20', () => {
  assert.throws(() => validatePages([]), BoardError);
  assert.throws(() => validatePages([{ id: 'a', name: 'X' }, { id: 'a', name: 'Y' }]), /unique identity/);
  assert.throws(() => validatePages([{ id: 'a', name: 'Media' }, { id: 'b', name: ' media ' }]), /must differ/);
  assert.throws(() => validatePages([{ id: 'a', name: 'x'.repeat(41) }]), /1 to 40/);
  assert.throws(() => validatePages([{ id: 'Bad id', name: 'X' }]), /unique identity/);
  assert.throws(() => validatePages(Array.from({ length: 21 }, (_, i) => ({ id: `p${i}`, name: `P${i}` }))), /1 to 20/);
  assert.throws(() => validatePages([{ id: 'a', name: 'X', icon: 'a b' }]), /icon/);
  assert.deepEqual(validatePages([{ id: 'a', name: ' Media ', background: { source: 'builtin', id: 'dunes' } }]), [{ id: 'a', name: 'Media', background: { source: 'builtin', id: 'dunes' } }]);
});

test('widgets keep their page, look and behaviour; invalid values are refused', () => {
  const board = validateStoredBoard(base([{ ...source('a'), pageId: 'media', rect: { x: 0, y: 0, w: 8, h: 6 }, look: { fill: 'solid', colour: '#FFCC00' }, behaviour: { target: 'same' } }]));
  assert.equal(board.panels[0].pageId, 'media');
  assert.deepEqual(board.panels[0].look, { fill: 'solid', colour: '#ffcc00' });
  assert.throws(() => validateStoredBoard(base([{ ...source('a'), pageId: 'nowhere', rect: { x: 0, y: 0, w: 8, h: 6 } }])), /page that does not exist/);
  assert.throws(() => validateStoredBoard(base([{ ...source('a'), rect: { x: 0, y: 0, w: 8, h: 6 }, look: { fill: 'url(x)' } }])), /offered choices/);
  assert.throws(() => validateStoredBoard(base([{ ...source('a'), rect: { x: 0, y: 0, w: 8, h: 6 }, behaviour: { onclick: 'x' } }])), /Unknown/);
});

test('overlap is checked per page, and stacked widgets follow their stack\'s page', () => {
  const panels = [{ ...source('a'), pageId: 'home', rect: { x: 0, y: 0, w: 8, h: 6 } }, { ...source('b'), pageId: 'media', rect: { x: 0, y: 0, w: 8, h: 6 } }];
  assert.equal(validateBoardChange(base(panels), [source('a'), source('b')]).panels.length, 2);
  assert.throws(() => validateBoardChange(base(panels.map(p => ({ ...p, pageId: 'home' }))), [source('a'), source('b')]), /overlap/);
  const stacked = validateStoredBoard(base([...panels, { ...source('c'), pageId: 'home', rect: { x: 8, y: 0, w: 8, h: 6 } }], { stacks: [{ id: 's', panelIds: ['b', 'c'], rect: { x: 16, y: 0, w: 8, h: 6 }, pageId: 'media' }] }));
  assert.deepEqual(stacked.panels.map(p => p.pageId), ['home', 'media', 'media']);
});

test('new content lands on the requested page in its first free spot', () => {
  const previous = base([{ ...source('a'), pageId: 'media', rect: { x: 0, y: 0, w: 8, h: 6 } }]);
  const onMedia = reconcileBoard([source('a'), source('n')], previous, { pageId: 'media' });
  assert.deepEqual(onMedia.panels.find(p => p.id === 'n'), { ...source('n'), pageId: 'media', rect: { x: 8, y: 0, w: 8, h: 6 } });
  const onHome = reconcileBoard([source('a'), source('n')], previous);
  assert.deepEqual(onHome.panels.find(p => p.id === 'n').rect, { x: 0, y: 0, w: 8, h: 6 });
  assert.equal(reconcileBoard([source('a'), source('n')], previous, { pageId: 'gone' }).panels[1].pageId, 'home');
});
