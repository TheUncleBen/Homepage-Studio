import { readFile } from 'node:fs/promises';

// The deployment's name (STUDIO_DEPLOYMENT_NAME) shows next to the Studio
// logo on Studio's own pages, on the sign-in page, in page titles, in email
// and in passkey prompts. Dashboard pages show the dashboard's name instead.
export const DEFAULT_DEPLOYMENT_NAME = 'Homepage Studio';
export function readDeploymentName(value = process.env.STUDIO_DEPLOYMENT_NAME) {
  const name = String(value ?? '').trim();
  if (!name) return DEFAULT_DEPLOYMENT_NAME;
  if (name.length > 60 || /[\u0000-\u001f\u007f<>]/.test(name)) throw new Error('STUDIO_DEPLOYMENT_NAME must be a plain name of up to 60 characters, without < or >.');
  return name;
}

// The Studio logo and its icon sizes. They are public: the sign-in page and
// every browser tab need them before anyone signs in.
const BRAND_FILES = new Map([
  ['logo.svg', 'image/svg+xml'],
  ['favicon.ico', 'image/x-icon'],
  ['apple-touch-icon.png', 'image/png'],
  ['icon-192.png', 'image/png'],
  ['icon-512.png', 'image/png'],
]);
export const BRAND_PATH = '/studio/brand/';
const cache = new Map();
export function brandFile(path) {
  if (path === '/favicon.ico') return 'favicon.ico';
  if (!path.startsWith(BRAND_PATH)) return null;
  const name = path.slice(BRAND_PATH.length);
  return BRAND_FILES.has(name) ? name : null;
}
export async function sendBrandFile(req, res, name) {
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(405, { allow: 'GET, HEAD', 'content-length': 0 });
    return res.end();
  }
  if (!cache.has(name)) cache.set(name, await readFile(new URL('./brand/' + name, import.meta.url)));
  const body = cache.get(name);
  res.writeHead(200, {
    'content-type': BRAND_FILES.get(name),
    'content-length': body.length,
    'cache-control': 'public, max-age=3600',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
  });
  return res.end(req.method === 'HEAD' ? undefined : body);
}
