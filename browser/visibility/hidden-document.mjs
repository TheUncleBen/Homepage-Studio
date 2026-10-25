// Run separately under a real display (xvfb-run in CI). Playwright's Chromium
// driver enables focus emulation, so this case intentionally never attaches it.
// The Playwright package supplies only its pinned executable and HTTP client.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, request } from '@playwright/test';
import { origin, resetDashboard, studioApi } from '../helpers/dashboard.mjs';
import { seedPlayback } from '../helpers/engineering.mjs';
import { observeChildClose, removeBrowserProfile, stopBrowserProcess } from './cleanup.mjs';

if (!origin) throw new Error('Set STUDIO_BROWSER_ORIGIN to a disposable Studio deployment.');
if (process.env.STUDIO_TEST_CONTAINERS !== '1' && process.env.STUDIO_DISPOSABLE_BROWSER_TEST !== '1') {
  throw new Error('Explicitly enable a disposable browser deployment; this check edits its dashboard.');
}
if (process.platform === 'linux' && !process.env.DISPLAY) throw new Error('Run this headed check under xvfb-run or a real display.');

const startedAt = Date.now();
const dwellMs = 4000;
const hiddenMs = 9000;
const profile = await mkdtemp(join(tmpdir(), 'studio-hidden-document-'));
const executable = process.env.STUDIO_VISIBILITY_EXECUTABLE || chromium.executablePath();
let api;
const failures = [];
const pending = new Map();
let sequence = 0;
let socket;
let child;
let browserProcess;
let evidence;
let primaryFailure;
let diagnostics = '';
let observedSession;
const originUrl = new URL(origin).origin;

function call(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 10000);
    pending.set(id, {
      resolve: value => { clearTimeout(timer); resolve(value); },
      reject: error => { clearTimeout(timer); reject(error); },
    });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}

async function evaluate(expression) {
  const response = await call('Runtime.evaluate', { expression, returnByValue: true }, observedSession);
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  return response.result.value;
}

async function until(read, accepts, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  let value;
  do {
    value = await read();
    if (accepts(value)) return value;
    await delay(40);
  } while (Date.now() < deadline);
  throw new Error(`${label} did not settle: ${JSON.stringify(value)}`);
}

try {
  api = await request.newContext();
  await resetDashboard(api);
  const seeded = await seedPlayback(api, { intervalMs: dwellMs });
  const firstId = seeded.board.stacks[0].panelIds[0];
  const secondId = seeded.board.stacks[0].panelIds[1];
  const backupsBefore = await studioApi(api, '/dashboard/studio/api/backups');
  const nativeIdentity = await studioApi(api, '/dashboard/api/studio/health');
  child = spawn(executable, [
    '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
    '--window-size=1440,1080', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, 'about:blank',
  ], { env: process.env, detached: process.platform !== 'win32', stdio: ['ignore', 'ignore', 'pipe'] });
  browserProcess = observeChildClose(child, { processGroup: process.platform !== 'win32' });
  child.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-5000); });
  let startupError;
  child.once('error', error => { startupError = error; });
  let endpoint;
  for (let index = 0; index < 100; index += 1) {
    if (startupError) throw startupError;
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Chrome exited during startup: ${diagnostics}`);
    try {
      const [port, path] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split('\n');
      endpoint = `ws://127.0.0.1:${port}${path}`;
      break;
    } catch { await delay(100); }
  }
  if (!endpoint) throw new Error(`Chrome DevTools endpoint unavailable: ${diagnostics}`);
  socket = new WebSocket(endpoint);
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const entry = pending.get(message.id);
    if (entry) {
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
      else entry.resolve(message.result);
      return;
    }
    if (message.sessionId !== observedSession) return;
    if (message.method === 'Runtime.exceptionThrown') failures.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    if (message.method === 'Network.responseReceived') {
      const response = message.params.response;
      if (response.status >= 500 && new URL(response.url).origin === originUrl) failures.push(`${response.status} ${new URL(response.url).pathname}`);
    }
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  const browserVersion = await call('Browser.getVersion');
  const { targetId: dashboard } = await call('Target.createTarget', { url: 'about:blank' });
  ({ sessionId: observedSession } = await call('Target.attachToTarget', { targetId: dashboard, flatten: true }));
  await call('Runtime.enable', {}, observedSession);
  await call('Network.enable', {}, observedSession);
  await call('Page.enable', {}, observedSession);
  await call('Page.navigate', { url: new URL('/dashboard', origin).href }, observedSession);
  await call('Target.activateTarget', { targetId: dashboard });
  await until(() => evaluate(`Boolean(document.querySelector('[aria-label="Play slideshow"]') && document.querySelector('[data-panel-kind="informationWidget"] [role="combobox"]'))`), Boolean, 'Native stack ready');
  const initial = await evaluate(`(() => {
    const active = () => document.querySelector('[data-stack-id]:not([aria-hidden="true"])')?.dataset.panelId;
    const events = [];
    let previous = active();
    const record = (kind, extra = {}) => events.push({ kind, at: performance.now(), active: active(), ...extra });
    document.addEventListener('visibilitychange', () => record('visibility', { hidden: document.hidden, visibility: document.visibilityState }));
    document.addEventListener('click', event => {
      if (event.target.closest('[aria-label="Play slideshow"]')) record('play');
    }, true);
    new MutationObserver(() => {
      const current = active();
      if (current !== previous) { previous = current; record('slide'); }
    }).observe(document.querySelector('.studio-canvas'), { attributes: true, attributeFilter: ['aria-hidden'], subtree: true });
    window.studioVisibilityRead = () => ({ hidden: document.hidden, visibility: document.visibilityState, active: active(), status: document.querySelector('.studio-playback-status')?.textContent, events: [...events] });
    const button = document.querySelector('[aria-label="Play slideshow"]');
    const rect = button.getBoundingClientRect();
    return { ...window.studioVisibilityRead(), x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`);
  assert.equal(initial.hidden, false);
  assert.equal(initial.visibility, 'visible');
  assert.equal(initial.active, firstId);
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: initial.x, y: initial.y, button: 'left', clickCount: 1 }, observedSession);
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: initial.x, y: initial.y, button: 'left', clickCount: 1 }, observedSession);
  const inspect = () => evaluate('window.studioVisibilityRead()');
  await until(inspect, value => value.status === 'Playing', 'Play starts the actual stack');
  await delay(1000);
  const { targetId: other } = await call('Target.createTarget', { url: 'about:blank', newWindow: false });
  await call('Target.activateTarget', { targetId: other });
  const hidden = await until(inspect, value => value.hidden && value.visibility === 'hidden' && value.status === 'Waiting', 'Real tab becomes hidden and suspends playback');
  assert.equal(hidden.active, firstId);
  await delay(hiddenMs);
  const suspended = await inspect();
  assert.equal(suspended.hidden, true);
  assert.equal(suspended.active, firstId, 'A genuinely hidden tab must retain its active widget');
  assert.equal(suspended.events.filter(event => event.kind === 'slide').length, 0);
  await call('Target.activateTarget', { targetId: dashboard });
  const visible = await until(inspect, value => !value.hidden && value.visibility === 'visible' && value.status === 'Playing', 'Real tab resumes visible playback');
  assert.equal(visible.active, firstId, 'Returning to the tab must not immediately catch up');
  const firstAdvance = await until(inspect, value => value.events.some(event => event.kind === 'slide'), 'Remaining dwell expires');
  assert.equal(firstAdvance.active, secondId);
  const nextAdvance = await until(inspect, value => value.events.filter(event => event.kind === 'slide').length >= 2, 'Following ordinary dwell expires');
  assert.equal(nextAdvance.active, firstId);
  const play = nextAdvance.events.find(event => event.kind === 'play');
  const wentHidden = nextAdvance.events.find(event => event.kind === 'visibility' && event.hidden);
  const becameVisible = nextAdvance.events.find(event => event.kind === 'visibility' && !event.hidden);
  const slides = nextAdvance.events.filter(event => event.kind === 'slide');
  const remainingMs = dwellMs - (wentHidden.at - play.at);
  const resumedAfterMs = slides[0].at - becameVisible.at;
  const followingDwellMs = slides[1].at - slides[0].at;
  assert.ok(remainingMs > 1500, `Fixture must hide before most of the dwell expires: ${remainingMs}ms remaining`);
  assert.ok(resumedAfterMs >= remainingMs - 300 && resumedAfterMs <= remainingMs + 1500, `Resume must preserve remaining time: expected ${remainingMs}ms, observed ${resumedAfterMs}ms`);
  assert.ok(followingDwellMs >= dwellMs - 300 && followingDwellMs <= dwellMs + 1500, `Next advance must use an ordinary dwell, not a catch-up burst: ${followingDwellMs}ms`);
  assert.equal(slides.length, 2);
  assert.deepEqual(await studioApi(api, '/dashboard/studio/api/backups'), backupsBefore, 'Playback must not create snapshots');
  assert.deepEqual(failures, [], 'No uncaught page exceptions or same-origin HTTP 5xx');
  evidence = {
    passed: true,
    method: 'Unmanaged headed pinned Chromium, real tab activation through raw CDP; no focus/visibility emulation or fake clock',
    nativeIdentity, browserVersion, dwellMs, hiddenMs, remainingMs, resumedAfterMs, followingDwellMs,
    events: nextAdvance.events, browserFailures: failures, elapsedMs: Date.now() - startedAt,
  };
} catch (error) {
  primaryFailure = error;
}

const cleanupFailures = [];
let browserCleanup;
let profileCleanup;
try {
  browserCleanup = await stopBrowserProcess(browserProcess, {
    requestClose: socket?.readyState === WebSocket.OPEN ? () => call('Browser.close') : undefined,
  });
} catch (error) { cleanupFailures.push(error); }
try {
  for (const item of pending.values()) item.reject(new Error('Raw browser check finished'));
  pending.clear();
  socket?.close();
} catch (error) { cleanupFailures.push(error); }
try { await api?.dispose(); } catch (error) { cleanupFailures.push(error); }
try { profileCleanup = await removeBrowserProfile(profile); } catch (error) { cleanupFailures.push(error); }
const errors = [primaryFailure, ...cleanupFailures].filter(Boolean);
if (errors.length === 1) throw errors[0];
if (errors.length > 1) throw new AggregateError(errors, 'Raw browser qualification and cleanup failed.', { cause: primaryFailure || cleanupFailures[0] });

evidence.cleanup = { browser: browserCleanup, profile: profileCleanup };
evidence.elapsedMs = Date.now() - startedAt;
if (process.env.STUDIO_VISIBILITY_EVIDENCE) await writeFile(process.env.STUDIO_VISIBILITY_EVIDENCE, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence, null, 2));
