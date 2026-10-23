import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, relative, extname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { DashboardError } from './dashboard-paths.mjs';

const types = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json; charset=utf-8' };
const absent = res => { res.writeHead(404, { 'cache-control': 'no-store' }); res.end(); };
const compressedTypes = new Set(['.js', '.css', '.json', '.svg', '.txt', '.map']);

export function acceptedEncodings(header) {
  if (!header) return ['identity'];
  const qualities = new Map();
  for (const entry of String(header).toLowerCase().split(',')) {
    const [name, ...parameters] = entry.trim().split(';').map(value => value.trim());
    if (!name) continue;
    let quality = 1;
    for (const parameter of parameters) {
      if (!parameter.startsWith('q=')) continue;
      quality = /^q=(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(parameter) ? Number(parameter.slice(2)) : 0;
    }
    qualities.set(name, quality);
  }
  const quality = encoding => qualities.get(encoding) ?? (encoding === 'identity' ? (qualities.get('*') === 0 ? 0 : 1) : qualities.get('*') ?? 0);
  // Prefer Brotli, then gzip when the client assigns equal quality. An explicit
  // identity preference and q=0 exclusions still take precedence.
  return ['br', 'gzip', 'identity'].filter(encoding => quality(encoding) > 0).sort((a, b) => quality(b) - quality(a));
}

// If-None-Match uses the weak comparison (RFC 9110 13.1.2).
export function etagMatches(header, etag) {
  const value = String(header || '').trim();
  return value === '*' || value.split(',').map(entry => entry.trim().replace(/^W\//, '')).includes(etag);
}

export async function serveSharedAsset(req, res, rendererDir) {
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { allow: 'GET, HEAD', 'cache-control': 'no-store' }); return res.end(); }
  const pathname = decodeURIComponent(req.url.split('?')[0]);
  const immutable = pathname.startsWith('/_next/static/');
  const base = resolve(rendererDir, immutable ? '.next/static' : 'public');
  const target = resolve(base, pathname.slice(immutable ? '/_next/static/'.length : 1));
  const within = path => { const rel = relative(base, path); return !!rel && rel !== '..' && !rel.startsWith('../') && !rel.startsWith('/'); };
  let handle;
  try {
    if (!within(target) || await fs.realpath(base) !== base) return absent(res);
    const real = await fs.realpath(target);
    if (!within(real)) return absent(res);
    handle = await fs.open(real, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let stat = await handle.stat();
    if (!stat.isFile()) return absent(res);
    let encoding;
    const negotiable = immutable && compressedTypes.has(extname(target).toLowerCase());
    for (const candidate of acceptedEncodings(req.headers['accept-encoding'])) {
      if (candidate === 'identity') { encoding = candidate; break; }
      if (!negotiable) continue;
      let variant;
      try {
        const variantPath = await fs.realpath(`${real}.${candidate === 'gzip' ? 'gz' : 'br'}`);
        if (!within(variantPath)) continue;
        variant = await fs.open(variantPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        const variantStat = await variant.stat();
        if (!variantStat.isFile()) continue;
        await handle.close();
        handle = variant; variant = undefined; stat = variantStat; encoding = candidate;
        break;
      } catch (error) {
        if (!['ENOENT', 'ENOTDIR', 'ELOOP'].includes(error.code)) throw error;
      } finally { await variant?.close(); }
    }
    if (!encoding) { res.writeHead(406, { 'cache-control': 'no-store', vary: 'Accept-Encoding' }); return res.end(); }
    const etag = '"' + stat.size.toString(16) + '-' + Math.trunc(stat.mtimeMs).toString(16) + '-' + encoding + '"';
    const headers = { 'content-type': types[extname(target).toLowerCase()] || 'application/octet-stream', 'content-length': stat.size, 'x-content-type-options': 'nosniff', 'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=60', etag, 'last-modified': stat.mtime.toUTCString() };
    if (negotiable) headers.vary = 'Accept-Encoding';
    if (encoding !== 'identity') headers['content-encoding'] = encoding;
    if (etagMatches(req.headers['if-none-match'], etag)) {
      delete headers['content-length']; res.writeHead(304, headers); return res.end();
    }
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    const stream = handle.createReadStream({ autoClose: false });
    await pipeline(stream, res).catch(error => { if (!res.destroyed) throw error; });
  } catch (error) {
    if (res.headersSent) { res.destroy(); return; }
    if (['ENOENT', 'ENOTDIR', 'ELOOP'].includes(error.code)) return absent(res);
    throw new DashboardError('Application assets are unavailable. Check the complete image and its filesystem permissions.', 'APPLICATION_ASSET_UNAVAILABLE', 503);
  } finally { await handle?.close(); }
}
