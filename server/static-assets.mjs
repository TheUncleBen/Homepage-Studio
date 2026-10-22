import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve, relative, extname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { DashboardError } from './dashboard-paths.mjs';

const types = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json; charset=utf-8' };
const absent = res => { res.writeHead(404, { 'cache-control': 'no-store' }); res.end(); };
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
    const stat = await handle.stat();
    if (!stat.isFile()) return absent(res);
    const etag = '"' + stat.size.toString(16) + '-' + Math.trunc(stat.mtimeMs).toString(16) + '"';
    const headers = { 'content-type': types[extname(real).toLowerCase()] || 'application/octet-stream', 'content-length': stat.size, 'x-content-type-options': 'nosniff', 'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=60', etag, 'last-modified': stat.mtime.toUTCString() };
    if (String(req.headers['if-none-match'] || '').split(',').map(value => value.trim().replace(/^W\//, '')).includes(etag) || req.headers['if-none-match'] === '*') {
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
