import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function runtimeHost(origin, explicitHosts) {
  let host;
  if (origin) {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('STUDIO_PUBLIC_ORIGIN must be the exact HTTP(S) dashboard origin.');
    host = url.host.toLowerCase();
  }
  const allowed = String(explicitHosts || host || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
  if (!allowed.length || allowed.some(value => value.includes('*') || /[\s/]/.test(value))) throw new Error('Set STUDIO_PUBLIC_ORIGIN or an explicit HOMEPAGE_ALLOWED_HOSTS list.');
  for (const value of allowed) {
    const parsed = new URL(`http://${value}`);
    if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.host !== value) throw new Error('HOMEPAGE_ALLOWED_HOSTS must contain exact hosts with optional ports.');
  }
  if (host && !allowed.includes(host)) throw new Error('STUDIO_PUBLIC_ORIGIN host must be in HOMEPAGE_ALLOWED_HOSTS.');
  return { allowedHosts: allowed.join(','), healthHost: host || allowed[0] };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const value = runtimeHost(process.env.STUDIO_PUBLIC_ORIGIN, process.env.HOMEPAGE_ALLOWED_HOSTS);
    console.log(process.argv[2] === 'health' ? value.healthHost : value.allowedHosts);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
