// Saved items (owner feedback T8/T28/T30 on 65f724c, 6 Nov 2026): one place
// for everything a person has saved, and one for administrators to see what
// everyone has saved and who saved it.
//
// - My account › Saved: this person's own (Just me) saved widgets, looks,
//   connections, logos and backgrounds, with rename, delete and the
//   dashboards that use a copy (a connection or an image used on a dashboard
//   is copied there under the same id, so deleting yours never breaks it).
// - Administration › Saved items: every person's own, each dashboard's and
//   Everyone's. Dashboard connections and images are managed in that
//   dashboard's settings, where Studio checks what uses them first, so they
//   are listed here without actions.
//
// Nothing secret is listed: a widget shows its name and type, a connection
// its name and host, never keys.

export class SavedItemsError extends Error {
  constructor(message, code = 'INVALID_SAVED_ITEM', status = 400) {
    super(message); this.name = 'SavedItemsError'; this.code = code; this.status = status;
  }
}
const fail = (message, code, status) => { throw new SavedItemsError(message, code, status); };

export const SAVED_KINDS = Object.freeze(['widget', 'look', 'connection', 'logo', 'background']);
const host = (url) => { try { return new URL(url).host; } catch { return ''; } };
const kb = (size) => (Number.isSafeInteger(size) ? `${Math.max(1, Math.round(size / 1024))} KB` : '');

// Everything one place keeps, in the shape the pages show.
async function itemsOf({ library, connections, images }) {
  const items = [];
  for (const entry of library ? await library.list() : []) {
    if (entry.kind === 'widget') items.push({ kind: 'widget', id: entry.id, name: entry.name, detail: entry.widget?.type || '', updatedAt: entry.updatedAt, savedBy: entry.savedBy });
    else if (entry.kind === 'look') items.push({ kind: 'look', id: entry.id, name: entry.name, detail: '', updatedAt: entry.updatedAt, savedBy: entry.savedBy });
  }
  for (const entry of connections ? await connections.list() : []) items.push({ kind: 'connection', id: entry.id, name: entry.name, detail: host(entry.url), updatedAt: entry.updatedAt, savedBy: entry.savedBy });
  for (const entry of images ? await images.list() : []) items.push({ kind: entry.kind, id: entry.id, name: entry.name, detail: kb(entry.size), updatedAt: entry.createdAt, savedBy: entry.savedBy });
  return items.map((item) => Object.fromEntries(Object.entries(item).filter(([, value]) => value !== undefined)));
}

// Rename or delete one item in one place's stores.
async function change(stores, { action, kind, id, name }) {
  if (!['rename', 'delete'].includes(action)) fail('Choose rename or delete.');
  if (!SAVED_KINDS.includes(kind) || typeof id !== 'string' || !id) fail('Choose a saved item.');
  if (action === 'rename' && (typeof name !== 'string' || !name.trim())) fail('Give it a name.');
  if (kind === 'widget' || kind === 'look') {
    const entry = await stores.library.read(id);
    if (entry.kind !== kind) fail('That saved item no longer exists.', 'SAVED_ITEM_NOT_FOUND', 404);
    return action === 'rename' ? stores.library.update(id, { name }) : stores.library.remove(id);
  }
  if (kind === 'connection') return action === 'rename' ? stores.connections.update(id, { name }) : stores.connections.remove(id);
  const image = (await stores.images.list()).find((entry) => entry.id === id && entry.kind === kind);
  if (!image) fail('That image no longer exists.', 'SAVED_ITEM_NOT_FOUND', 404);
  return action === 'rename' ? stores.images.rename(id, name) : stores.images.remove(id);
}

// personal: server/personal.mjs; sharedLibrary: Everyone's saved widgets;
// dashboards(): [{ id, name, stores: { library, connections, images } }];
// users(): [{ id, username, displayName }].
export function createSavedItems({ personal, sharedLibrary, dashboards, users }) {
  // Which dashboards hold a copy of each connection or image id.
  async function copies() {
    const where = new Map();
    for (const dashboard of await dashboards()) {
      const ids = [
        ...(await dashboard.stores.connections.list()).map((entry) => entry.id),
        ...(await dashboard.stores.images.list()).map((entry) => entry.id),
      ];
      for (const id of new Set(ids)) where.set(id, [...(where.get(id) || []), dashboard.name]);
    }
    return where;
  }
  const withCopies = (items, where) => items.map((item) => (['connection', 'logo', 'background'].includes(item.kind) ? { ...item, usedOn: where.get(item.id) || [] } : item));
  const personStores = (userId) => personal.forUser(userId);

  return {
    async mine(userId) {
      return { items: withCopies(await itemsOf(personStores(userId)), await copies()) };
    },
    async changeMine(userId, request) {
      await change(personStores(userId), request ?? {});
      return this.mine(userId);
    },
    async all() {
      const where = await copies();
      const items = [];
      for (const user of await users()) {
        const owner = user.displayName || user.username;
        for (const item of withCopies(await itemsOf(personStores(user.id)), where)) {
          items.push({ ...item, place: { type: 'person', id: user.id, name: 'Just me' }, owner, canChange: true });
        }
      }
      for (const dashboard of await dashboards()) {
        for (const item of await itemsOf({ library: dashboard.stores.library, connections: dashboard.stores.connections, images: dashboard.stores.images })) {
          items.push({ ...item, place: { type: 'dashboard', id: dashboard.id, name: dashboard.name }, ...(item.savedBy ? { owner: item.savedBy } : {}), canChange: item.kind === 'widget' });
        }
      }
      for (const item of await itemsOf({ library: sharedLibrary })) {
        items.push({ ...item, place: { type: 'everyone', name: 'Everyone' }, ...(item.savedBy ? { owner: item.savedBy } : {}), canChange: true });
      }
      return { items };
    },
    async changeAny(request) {
      const place = request?.place;
      let stores;
      if (place?.type === 'person') {
        if (!(await users()).some((user) => user.id === place.id)) fail('That person no longer exists.', 'SAVED_ITEM_NOT_FOUND', 404);
        stores = personStores(place.id);
      } else if (place?.type === 'everyone') {
        if (!['widget'].includes(request.kind)) fail('Choose a saved item.');
        stores = { library: sharedLibrary };
      } else if (place?.type === 'dashboard') {
        if (request.kind !== 'widget') fail('Manage this dashboard’s connections and images in its settings, where Studio checks what uses them.');
        const dashboard = (await dashboards()).find((entry) => entry.id === place.id);
        if (!dashboard) fail('That dashboard no longer exists.', 'SAVED_ITEM_NOT_FOUND', 404);
        stores = dashboard.stores;
      } else fail('Choose where the saved item is.');
      await change(stores, request);
      return this.all();
    },
  };
}
