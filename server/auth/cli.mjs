#!/usr/bin/env node
// Command-line recovery for Studio sign-in. It needs shell access to the
// container, which already implies full control of the state volume.
//
//   docker exec -it <container> node server/auth/cli.mjs list
//   docker exec -it <container> node server/auth/cli.mjs recover <username> [--promote]
//
// `recover` writes a one-time link that signs in as that person for one
// browser session, even when local sign-in is turned off. --promote also
// makes them an administrator. The link expires after 15 minutes.
import fs from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomToken, tokenHash } from './primitives.mjs';
import { AUTH_FILE } from './store.mjs';
import { RECOVERY_FILE } from './service.mjs';

const LINK_MINUTES = 15;
const base = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function usage(code = 1) {
  console.error('Usage:\n  node server/auth/cli.mjs list\n  node server/auth/cli.mjs recover <username> [--promote]');
  process.exit(code);
}

export async function run(argv, env = process.env, out = console) {
  const [command, ...rest] = argv;
  const directory = join(resolve(env.STUDIO_STATE_DIR || join(base, 'state')), 'auth');
  let data;
  try { data = JSON.parse(await fs.readFile(join(directory, AUTH_FILE), 'utf8')); }
  catch { throw new Error(`No readable sign-in data at ${join(directory, AUTH_FILE)}. Start Studio once with sign-in on, or check STUDIO_STATE_DIR.`); }
  const users = Array.isArray(data.users) ? data.users : [];
  if (command === 'list') {
    if (!users.length) { out.log('No accounts yet. Open Studio in a browser to create the first administrator.'); return; }
    for (const user of users) out.log([user.username, user.role === 'admin' ? 'administrator' : 'member', user.source === 'oidc' ? 'single sign-on' : 'local', user.disabled ? 'disabled' : user.status].join('\t'));
    return;
  }
  if (command === 'recover') {
    const username = rest.find(item => !item.startsWith('--'))?.toLowerCase();
    if (!username) usage();
    const user = users.find(item => item.username === username);
    if (!user) throw new Error(`There is no account named "${username}". Run "list" to see them.`);
    const origin = env.STUDIO_PUBLIC_ORIGIN;
    if (!origin) throw new Error('STUDIO_PUBLIC_ORIGIN is not set, so the link address is unknown.');
    const token = randomToken();
    const request = { tokenHash: tokenHash(token), userId: user.id, promote: rest.includes('--promote'), expiresAt: Date.now() + LINK_MINUTES * 60000, createdAt: Date.now() };
    const target = join(directory, RECOVERY_FILE);
    const temporary = target + '.' + process.pid + '.tmp';
    await fs.writeFile(temporary, JSON.stringify(request), { mode: 0o600, flag: 'wx' });
    await fs.rename(temporary, target);
    out.log(`One-time recovery link for ${user.username}${request.promote ? ' (will become an administrator)' : ''}, valid for ${LINK_MINUTES} minutes:\n\n  ${new URL('/__studio/auth/recovery#' + token, origin).href}\n\nIt signs in for one browser session and is recorded in the activity log. Running this again replaces the link.`);
    return;
  }
  usage();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run(process.argv.slice(2)).catch(error => { console.error(error.message); process.exit(1); });
}
