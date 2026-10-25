// Durable sign-in data under <state>/auth/. Two JSON files, each replaced
// atomically by the one controller process:
//   auth.json      users, factors, groups, access lists, policies, settings
//   sessions.json  signed-in sessions (only token hashes are stored)
// plus audit.jsonl, an append-only security log rotated by size.
// A file that cannot be read safely makes the store unavailable: sign-in
// fails closed and nothing falls back to open access.
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export const AUTH_FILE = 'auth.json';
export const SESSIONS_FILE = 'sessions.json';
export const AUDIT_FILE = 'audit.jsonl';
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const AUDIT_ROTATE_BYTES = 5 * 1024 * 1024;
export const MAX_USERS = 500;
export const MAX_GROUPS = 200;
export const MAX_POLICIES = 50;
export const MAX_SESSIONS = 5000;

export class AuthError extends Error {
  constructor(message, code = 'AUTH_ERROR', status = 400, details) {
    super(message);
    this.code = code;
    this.status = status;
    if (details) this.details = details;
  }
}

export const DEFAULT_POLICY = Object.freeze({ id: 'default', name: 'Default', idleMinutes: 7 * 24 * 60, absoluteMinutes: 30 * 24 * 60, persistent: true, stepUpMinutes: 15, maxSessions: null });

export function emptyAuthData() {
  return {
    version: 1,
    revision: randomUUID(),
    setupCompletedAt: null,
    settings: { localSignIn: true, emailCode: false, deploymentName: null, oidc: { adminGroups: [], allowedGroups: [], autoCreate: true } },
    users: [],
    groups: [],
    policies: [structuredClone(DEFAULT_POLICY)],
    grants: {},
    invites: [],
  };
}

async function syncDirectory(directory) {
  const handle = await fs.open(directory, constants.O_RDONLY | constants.O_DIRECTORY);
  try { await handle.sync(); } finally { await handle.close(); }
}

async function realDirectory(directory) {
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new AuthError('Sign-in storage must be a real directory.', 'AUTH_STORAGE_UNSAFE', 503);
}

async function readJson(file) {
  let handle;
  try {
    handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error('unsafe');
    return JSON.parse(await handle.readFile('utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw new AuthError('Sign-in data could not be read safely. Restore the auth folder from a backup, or use the recovery command.', 'AUTH_STORAGE_INVALID', 503);
  } finally { await handle?.close(); }
}

async function writeJson(directory, name, value) {
  await realDirectory(directory);
  const file = join(directory, name);
  const temporary = join(directory, `.${name}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await fs.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await handle.writeFile(JSON.stringify(value) + '\n', 'utf8');
    await handle.sync();
    await handle.close(); handle = null;
    const target = await fs.lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (target && (target.isSymbolicLink() || !target.isFile())) throw new AuthError('Refusing to replace a non-file in sign-in storage.', 'AUTH_STORAGE_UNSAFE', 503);
    await fs.rename(temporary, file);
    await syncDirectory(directory);
  } finally {
    await handle?.close();
    await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

function checkShape(data) {
  const ok = data && data.version === 1 && typeof data.revision === 'string' && data.settings && typeof data.settings === 'object'
    && Array.isArray(data.users) && Array.isArray(data.groups) && Array.isArray(data.policies) && data.grants && typeof data.grants === 'object' && !Array.isArray(data.grants)
    && Array.isArray(data.invites) && data.policies.some(policy => policy.id === 'default');
  if (!ok) throw new AuthError('Sign-in data has an unexpected format. Restore the auth folder from a backup.', 'AUTH_STORAGE_INVALID', 503);
  return data;
}

export function createAuthStore({ stateRoot }) {
  const directory = join(resolve(stateRoot), 'auth');
  let data, sessions, broken = null, queue = Promise.resolve(), flushTimer = null, sessionsDirty = false;
  const serial = operation => {
    const result = queue.then(operation, operation);
    queue = result.catch(() => {});
    return result;
  };
  const available = () => { if (broken) throw broken; if (!data) throw new AuthError('Sign-in is starting. Retry shortly.', 'AUTH_NOT_READY', 503); };

  async function initialize() {
    try {
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      await realDirectory(directory);
      const stored = await readJson(join(directory, AUTH_FILE));
      data = stored === undefined ? emptyAuthData() : checkShape(stored);
      const storedSessions = await readJson(join(directory, SESSIONS_FILE));
      if (storedSessions !== undefined && (storedSessions?.version !== 1 || !Array.isArray(storedSessions.sessions))) throw new AuthError('Session data has an unexpected format.', 'AUTH_STORAGE_INVALID', 503);
      sessions = new Map((storedSessions?.sessions ?? []).map(session => [session.id, session]));
      if (stored === undefined) await writeJson(directory, AUTH_FILE, data);
      broken = null;
    } catch (error) {
      broken = error instanceof AuthError ? error : new AuthError('Sign-in storage is not available. Check the state volume permissions.', 'AUTH_STORAGE_UNAVAILABLE', 503);
      data = undefined;
      throw broken;
    }
  }

  // Returns a deep copy; callers never hold references into the live data.
  function read() { available(); return structuredClone(data); }

  // Applies `change` to a copy and publishes it atomically. The function may
  // return a value, which mutate() resolves with.
  function mutate(change) {
    return serial(async () => {
      available();
      const draft = structuredClone(data);
      const result = await change(draft);
      if (draft.users.length > MAX_USERS) throw new AuthError(`Studio supports up to ${MAX_USERS} users.`, 'USER_LIMIT');
      if (draft.groups.length > MAX_GROUPS) throw new AuthError(`Studio supports up to ${MAX_GROUPS} groups.`, 'GROUP_LIMIT');
      if (draft.policies.length > MAX_POLICIES) throw new AuthError(`Studio supports up to ${MAX_POLICIES} session policies.`, 'POLICY_LIMIT');
      const now = Date.now();
      draft.invites = draft.invites.filter(invite => invite.expiresAt > now);
      draft.revision = randomUUID();
      checkShape(draft);
      await writeJson(directory, AUTH_FILE, draft);
      data = draft;
      return result;
    });
  }

  // Sessions change often. Creation and removal are written before they are
  // reported; last-seen updates are batched.
  async function persistSessions() {
    sessionsDirty = false;
    await writeJson(directory, SESSIONS_FILE, { version: 1, sessions: [...sessions.values()] });
  }
  function scheduleFlush() {
    sessionsDirty = true;
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      if (sessionsDirty) serial(persistSessions).catch(error => console.error('Session save failed:', error.code || error.name));
    }, 60000);
    flushTimer.unref();
  }
  const sessionApi = {
    get: id => { available(); const value = sessions.get(id); return value ? structuredClone(value) : null; },
    all: () => { available(); return [...sessions.values()].map(value => structuredClone(value)); },
    put: session => serial(async () => {
      available();
      if (!sessions.has(session.id) && sessions.size >= MAX_SESSIONS) {
        // Remove the least recently used session rather than refusing sign-in.
        const oldest = [...sessions.values()].sort((a, b) => a.lastSeenAt - b.lastSeenAt)[0];
        sessions.delete(oldest.id);
      }
      sessions.set(session.id, structuredClone(session));
      await persistSessions();
    }),
    touch: (id, fields) => {
      const current = sessions.get(id);
      if (!current) return;
      Object.assign(current, fields);
      scheduleFlush();
    },
    remove: predicate => serial(async () => {
      available();
      let removed = 0;
      for (const [id, session] of sessions) if (predicate(session)) { sessions.delete(id); removed++; }
      if (removed) await persistSessions();
      return removed;
    }),
    flush: () => serial(async () => { if (sessionsDirty && sessions) await persistSessions(); }),
  };

  async function audit(event) {
    const line = JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n';
    // Also on stdout, so log tooling such as fail2ban or CrowdSec can act on it.
    console.log('studio-auth', line.trim());
    try {
      const file = join(directory, AUDIT_FILE);
      const stat = await fs.lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (stat && (!stat.isFile() || stat.isSymbolicLink())) return;
      if (stat && stat.size > AUDIT_ROTATE_BYTES) await fs.rename(file, join(directory, 'audit.1.jsonl'));
      await fs.appendFile(file, line, { mode: 0o600, flag: 'a' });
    } catch (error) { console.error('Audit log write failed:', error.code || error.name); }
  }
  async function readAudit(limit = 500) {
    const lines = [];
    for (const name of ['audit.1.jsonl', AUDIT_FILE]) {
      try {
        const handle = await fs.open(join(directory, name), constants.O_RDONLY | constants.O_NOFOLLOW);
        try { lines.push(...(await handle.readFile('utf8')).split('\n').filter(Boolean)); } finally { await handle.close(); }
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return lines.slice(-limit).reverse().map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
  }

  return {
    directory, initialize, read, mutate, sessions: sessionApi, audit, readAudit,
    get ready() { return Boolean(data) && !broken; },
    get error() { return broken; },
    close: async () => { clearTimeout(flushTimer); flushTimer = null; if (data) await sessionApi.flush().catch(() => {}); },
  };
}
