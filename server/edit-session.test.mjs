import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createConfigStore } from './config.mjs';

// Owner decision, 4 Nov 2026: editing saves as you go, with Undo and Redo,
// and Save can never dead-end because content changed underneath.

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'homepage-studio-edit-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const options = { configDir: path.join(root, 'config'), stateDir: path.join(root, 'state') };
  const store = createConfigStore(options);
  await store.initialize();
  return { store, options };
}
const addLink = (store, current, name, editSession) => store.mutateService({ revision: current.revision, action: 'add', name, group: 'Home', config: { href: `https://${name.toLowerCase()}.example.test` }, ...(editSession ? { editSession } : {}) });
const moved = (board, id, rect) => ({ ...board, panels: board.panels.map((panel) => (panel.id === id ? { ...panel, rect } : panel)) });

test('an arrangement made before a widget was added saves, and the new widget keeps its place', async (t) => {
  const { store } = await fixture(t);
  let current = await addLink(store, await store.load(), 'First');
  const stale = moved(current.board, current.board.panels[0].id, { x: 12, y: 0, w: 6, h: 2 });
  current = await addLink(store, current, 'Second');
  const second = current.board.panels.find((panel) => panel.title === 'Second');
  const saved = await store.saveBoard({ revision: current.revision, board: stale });
  assert.deepEqual(saved.board.panels.find((panel) => panel.title === 'First').rect, { x: 12, y: 0, w: 6, h: 2 });
  assert.deepEqual(saved.board.panels.find((panel) => panel.id === second.id).rect, second.rect);
});

test('an arrangement that still holds a deleted widget saves without it', async (t) => {
  const { store } = await fixture(t);
  let current = await addLink(store, await store.load(), 'First');
  current = await addLink(store, current, 'Second');
  const second = current.board.panels.find((panel) => panel.title === 'Second');
  const stale = moved(current.board, current.board.panels[0].id, { x: 0, y: 8, w: 6, h: 2 });
  current = await store.deletePanels({ revision: current.revision, ids: [second.id] });
  const saved = await store.saveBoard({ revision: current.revision, board: stale });
  assert.deepEqual(saved.board.panels.map((panel) => panel.title), ['First']);
  assert.deepEqual(saved.board.panels[0].rect, { x: 0, y: 8, w: 6, h: 2 });
});

test('a widget added under an arrangement that now covers its place moves to free space', async (t) => {
  const { store } = await fixture(t);
  let current = await addLink(store, await store.load(), 'First');
  const first = current.board.panels[0];
  current = await addLink(store, current, 'Second');
  const second = current.board.panels.find((panel) => panel.title === 'Second');
  // The editor moved First onto where Second was later placed.
  const stale = { ...current.board, panels: current.board.panels.filter((panel) => panel.id === first.id).map((panel) => ({ ...panel, rect: { ...second.rect } })) };
  const saved = await store.saveBoard({ revision: current.revision, board: stale });
  const rects = saved.board.panels.map((panel) => panel.rect);
  assert.equal(saved.board.panels.length, 2);
  assert.deepEqual(saved.board.panels.find((panel) => panel.id === first.id).rect, second.rect);
  assert.notDeepEqual(rects[0], rects[1]);
});

test('undo and redo step through a session: content, arrangement and deletes', async (t) => {
  const { store } = await fixture(t);
  const session = 'session:alpha';
  const start = await store.load();
  let current = await addLink(store, start, 'First', session);
  const first = current.board.panels[0];
  const placed = await store.saveBoard({ revision: current.revision, board: moved(current.board, first.id, { x: 6, y: 4, w: 6, h: 2 }), editSession: session });
  current = await store.deletePanels({ revision: placed.revision, ids: [first.id], editSession: session });
  assert.deepEqual(current.board.panels, []);
  let undone = await store.undo({ revision: current.revision, editSession: session });
  assert.equal(undone.revision, placed.revision);
  assert.deepEqual(undone.board.panels.map((panel) => panel.rect), [{ x: 6, y: 4, w: 6, h: 2 }]);
  assert.equal(undone.canRedo, true);
  undone = await store.undo({ revision: undone.revision, editSession: session });
  assert.deepEqual(undone.board.panels[0].rect, first.rect);
  undone = await store.undo({ revision: undone.revision, editSession: session });
  assert.equal(undone.revision, start.revision);
  assert.equal(undone.canUndo, false);
  await assert.rejects(store.undo({ revision: undone.revision, editSession: session }), { code: 'NOTHING_TO_UNDO' });
  let redone = await store.redo({ revision: undone.revision, editSession: session });
  redone = await store.redo({ revision: redone.revision, editSession: session });
  assert.equal(redone.revision, placed.revision);
  // A new change clears what could be redone.
  const again = await addLink(store, await store.load(), 'Other', session);
  await assert.rejects(store.redo({ revision: again.revision, editSession: session }), { code: 'NOTHING_TO_UNDO' });
});

test('one snapshot per editing session, and none lost for changes outside one', async (t) => {
  const { store } = await fixture(t);
  const session = 'session:beta';
  let current = await store.load();
  for (const name of ['One', 'Two', 'Three']) current = await addLink(store, current, name, session);
  current = await store.undo({ revision: current.revision, editSession: session });
  assert.equal((await store.listBackups()).length, 1);
  current = await addLink(store, await store.load(), 'Outside');
  assert.equal((await store.listBackups()).length, 2);
  current = await addLink(store, current, 'Next session', 'session:gamma');
  current = await addLink(store, current, 'Next again', 'session:gamma');
  assert.equal((await store.listBackups()).length, 3);
});

test('undo is refused once something else changed the dashboard, and never crosses sessions', async (t) => {
  const { store } = await fixture(t);
  let current = await addLink(store, await store.load(), 'Mine', 'session:mine');
  await assert.rejects(store.undo({ revision: current.revision, editSession: 'session:theirs' }), { code: 'NOTHING_TO_UNDO' });
  await assert.rejects(store.undo({ revision: current.revision }), { code: 'NOTHING_TO_UNDO' });
  current = await addLink(store, current, 'Elsewhere');
  await assert.rejects(store.undo({ revision: current.revision, editSession: 'session:mine' }), { code: 'UNDO_UNAVAILABLE' });
  assert.ok((await store.load()).services.some((entry) => entry.name === 'Elsewhere'));
});

// Owner rule, 4 Nov 2026: every widget is self-contained (no group or
// service to choose; Q2), and the same integration can be added again.
test('adding the same integration twice makes two independent widgets, and a widget renames and links itself', async (t) => {
  const { store } = await fixture(t);
  const add = (current) => store.mutateServiceWidget({ revision: current.revision, action: 'add', type: 'pfsense', newService: { name: 'pfSense' }, config: { url: 'https://fw.example.test' } });
  let current = await add(await store.load());
  current = await add(current);
  const titles = current.board.panels.map((panel) => panel.title).sort();
  assert.deepEqual(titles, ['pfSense', 'pfSense 2']);
  const second = current.board.panels.find((panel) => panel.title === 'pfSense 2');
  const widget = (await store.load()).serviceWidgets.find((entry) => entry.id === second.id);
  current = await store.mutateServiceWidget({ revision: current.revision, action: 'update', id: widget.id, config: {}, service: { name: 'Backup firewall', href: 'https://fw2.example.test', siteMonitor: 'https://fw2.example.test' } });
  const renamed = current.board.panels.find((panel) => panel.id === second.id);
  assert.equal(renamed.title, 'Backup firewall');
  const parent = (await store.load()).services.find((entry) => entry.name === 'Backup firewall');
  assert.equal(parent.config.href, 'https://fw2.example.test');
  assert.equal(parent.config.siteMonitor, 'https://fw2.example.test');
  await assert.rejects(store.mutateServiceWidget({ revision: current.revision, action: 'update', id: widget.id, config: {}, service: { name: 'pfSense' } }), /already called “pfSense”/);
  await assert.rejects(store.mutateServiceWidget({ revision: current.revision, action: 'update', id: widget.id, config: {}, service: { widgets: [] } }), /Only the widget's name/);
  // Owner decision D1 (7 Nov 2026): the per-service certificate exception is on (true) or removed (null), nothing else.
  current = await store.mutateServiceWidget({ revision: current.revision, action: 'update', id: widget.id, config: {}, service: { skipCertificateCheck: true } });
  assert.equal((await store.load()).services.find((entry) => entry.name === 'Backup firewall').config.skipCertificateCheck, true);
  for (const value of [false, 'true', 1]) await assert.rejects(store.mutateServiceWidget({ revision: current.revision, action: 'update', id: widget.id, config: {}, service: { skipCertificateCheck: value } }), /certificate exception is on or off/);
  current = await store.mutateServiceWidget({ revision: current.revision, action: 'update', id: widget.id, config: {}, service: { skipCertificateCheck: null } });
  assert.equal('skipCertificateCheck' in (await store.load()).services.find((entry) => entry.name === 'Backup firewall').config, false);
});

test('one sign-in keeps only its latest few editing sessions, and an undo with nothing to undo creates none', async (t) => {
  const { store } = await fixture(t);
  let current = await store.load();
  // A stranger's undo for an id nobody used: refused, and it takes no slot.
  await assert.rejects(store.undo({ revision: current.revision, editSession: 'sign-in-b:nobody' }), { code: 'NOTHING_TO_UNDO' });
  current = await addLink(store, current, 'Kept', 'sign-in-b:editor');
  // Sign-in A opens four editors; only its three latest keep their steps.
  for (const [index, name] of ['One', 'Two', 'Three', 'Four'].entries()) current = await addLink(store, current, name, `sign-in-a:editor-${index}`);
  await assert.rejects(store.undo({ revision: current.revision, editSession: 'sign-in-a:editor-0' }), { code: 'NOTHING_TO_UNDO' });
  current = await store.undo({ revision: current.revision, editSession: 'sign-in-a:editor-3' });
  assert.equal(current.board.panels.some((panel) => panel.title === 'Four'), false);
  // Sign-in B's history was not pushed out by sign-in A's editors, though its
  // step is no longer the latest change, so it can't be undone now.
  await assert.rejects(store.undo({ revision: current.revision, editSession: 'sign-in-b:editor' }), { code: 'UNDO_UNAVAILABLE' });
});
