import http from 'node:http';
import https from 'node:https';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { runtimeHost } from './runtime-host.mjs';

export const UPSTREAM_COMMIT = '51cc1684f9f34a7877ed462b8f94c9cc687b4dde';

export function checkHealth({ url, host, kind, buildRevision, timeoutMs = 2500 }) {
  return new Promise((resolvePromise, reject) => {
    if (!['renderer', 'writer', 'configuration'].includes(kind)) return reject(new Error('Invalid health protocol.'));
    const target = new URL(url);
    if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) return reject(new Error('Invalid health endpoint.'));
    const transport = target.protocol === 'https:' ? https : http;
    let timer;
    const finish = (error, result) => { clearTimeout(timer); error ? reject(error) : resolvePromise(result); };
    const request = transport.get(target, { headers: { host, accept: 'application/json' } }, response => {
      let body = '';
      response.on('data', chunk => {
        body += chunk.toString('utf8');
        if (Buffer.byteLength(body) > 65536) request.destroy(new Error('Health response is too large.'));
      });
      response.on('error', finish);
      response.on('end', () => {
        if (response.statusCode !== 200) return finish(new Error('Service is not ready.'));
        let data;
        try { data = JSON.parse(body); } catch { return finish(new Error('Invalid health response.')); }
        if (!data || typeof data !== 'object' || Array.isArray(data)) return finish(new Error('Invalid health response.'));
        if (kind === 'renderer') {
          if (data.protocolVersion !== 1 || data.upstreamCommit !== UPSTREAM_COMMIT || (buildRevision && data.buildRevision !== buildRevision)) return finish(new Error('Renderer build/protocol mismatch.'));
        } else if (data.status !== 'ready') return finish(new Error('Configuration or service is not ready.'));
        finish(undefined, data);
      });
    });
    request.on('error', finish);
    timer = setTimeout(() => request.destroy(new Error('Health check timed out.')), timeoutMs);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const kind = process.argv[2] || 'writer';
    const host = process.env.STUDIO_HEALTH_HOST || runtimeHost(process.env.STUDIO_PUBLIC_ORIGIN, process.env.HOMEPAGE_ALLOWED_HOSTS).healthHost;
    const port = process.env.PORT || (kind === 'renderer' ? '3000' : '3001');
    const endpoint = kind === 'renderer' ? '/api/studio/health' : kind === 'configuration' ? '/__studio/config-ready' : '/__studio/ready';
    await checkHealth({ url: `http://127.0.0.1:${port}${endpoint}`, host, kind, buildRevision: process.env.STUDIO_BUILD_REVISION });
  } catch { process.exitCode = 1; }
}
