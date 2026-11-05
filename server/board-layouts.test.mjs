import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createConfigStore } from "./config.mjs";
import { validateStoredBoard } from "./board.mjs";

// Owner decision, 4 Nov 2026: a layout for each size (tablet and phone follow
// desktop until arranged; position and size belong to the layout, never to
// the widget), and an even or centred grid per page.

async function fixture(t) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "homepage-studio-layouts-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = createConfigStore({
    configDir: path.join(root, "config"),
    stateDir: path.join(root, "state"),
  });
  await store.initialize();
  return store;
}
const addLink = (store, current, name) =>
  store.mutateService({
    revision: current.revision,
    action: "add",
    name,
    group: "Home",
    config: { href: `https://${name.toLowerCase()}.example.test` },
  });

test("a phone arrangement is kept, new widgets join it at the end, deleted ones leave it", async (t) => {
  const store = await fixture(t);
  let current = await addLink(store, await store.load(), "First");
  current = await addLink(store, current, "Second");
  const [first, second] = current.board.panels;
  const layouts = {
    phone: {
      [second.id]: { x: 0, y: 0, w: 8, h: 4 },
      [first.id]: { x: 0, y: 4, w: 4, h: 2 },
    },
  };
  current = await store.saveBoard({
    revision: current.revision,
    board: { ...current.board, layouts },
  });
  assert.deepEqual(current.board.layouts.phone[first.id], {
    x: 0,
    y: 4,
    w: 4,
    h: 2,
  });
  assert.deepEqual(
    current.board.panels.map((panel) => panel.rect),
    [first.rect, second.rect],
    "desktop is untouched",
  );
  current = await addLink(store, current, "Third");
  const third = current.board.panels.find((panel) => panel.title === "Third");
  assert.deepEqual(current.board.layouts.phone[third.id], {
    x: 0,
    y: 6,
    w: 4,
    h: third.rect.h,
  });
  current = await store.deletePanels({
    revision: current.revision,
    ids: [second.id],
  });
  assert.equal(Object.hasOwn(current.board.layouts.phone, second.id), false);
  assert.equal(
    current.board.layouts.tablet,
    undefined,
    "tablet still follows desktop",
  );
});

test("a size layout must fit its grid and must not overlap", async (t) => {
  const store = await fixture(t);
  let current = await addLink(store, await store.load(), "First");
  current = await addLink(store, current, "Second");
  const [first, second] = current.board.panels;
  await assert.rejects(
    store.saveBoard({
      revision: current.revision,
      board: {
        ...current.board,
        layouts: { phone: { [first.id]: { x: 4, y: 0, w: 8, h: 2 } } },
      },
    }),
    /phone layout has an invalid grid rectangle/,
  );
  await assert.rejects(
    store.saveBoard({
      revision: current.revision,
      board: {
        ...current.board,
        layouts: {
          phone: {
            [first.id]: { x: 0, y: 0, w: 8, h: 4 },
            [second.id]: { x: 0, y: 2, w: 8, h: 4 },
          },
        },
      },
    }),
    /overlap on the phone layout/,
  );
  await assert.rejects(
    store.saveBoard({
      revision: current.revision,
      board: { ...current.board, layouts: { watch: {} } },
    }),
    /layouts for each size/,
  );
});

test("a centred page has 25 columns; an even page 24", () => {
  const board = (grid) => ({
    version: 3,
    columns: 24,
    pages: [{ id: "home", name: "Home", ...(grid ? { grid } : {}) }],
    panels: [{ id: "a", kind: "service", rect: { x: 16, y: 0, w: 9, h: 2 } }],
    stacks: [],
  });
  assert.equal(validateStoredBoard(board("centred")).pages[0].grid, "centred");
  assert.throws(() => validateStoredBoard(board()), /invalid grid rectangle/);
  assert.equal(
    validateStoredBoard({ ...board("even"), panels: [] }).pages[0].grid,
    undefined,
  );
  assert.throws(
    () => validateStoredBoard({ ...board("diagonal"), panels: [] }),
    /even or centred/,
  );
});
