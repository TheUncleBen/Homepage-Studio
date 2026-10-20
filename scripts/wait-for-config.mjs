import { checkHealth } from './healthcheck.mjs';
import { runtimeHost } from './runtime-host.mjs';
import { setTimeout as delay } from 'node:timers/promises';

const seconds = Number(process.env.STUDIO_STARTUP_TIMEOUT_SECONDS || 120);
if (!Number.isInteger(seconds) || seconds < 1 || seconds > 600) throw new Error('STUDIO_STARTUP_TIMEOUT_SECONDS must be 1–600.');
const origin = new URL(process.env.STUDIO_WRITER_ORIGIN || 'http://studio:3001');
if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('STUDIO_WRITER_ORIGIN must be an HTTP(S) origin.');
const host = process.env.STUDIO_HEALTH_HOST || runtimeHost(process.env.STUDIO_PUBLIC_ORIGIN, process.env.HOMEPAGE_ALLOWED_HOSTS).healthHost;
const deadline = Date.now() + seconds * 1000;
let ready = false;
while (Date.now() < deadline) {
  try {
    await checkHealth({ url: new URL('/__studio/config-ready', origin), host, kind: 'configuration', timeoutMs: Math.max(1, Math.min(2500, deadline - Date.now())) });
    ready = true;
    break;
  } catch { await delay(Math.max(1, Math.min(1000, deadline - Date.now()))); }
}
if (!ready) { console.error('Studio configuration did not become ready before the startup deadline.'); process.exitCode = 1; }
