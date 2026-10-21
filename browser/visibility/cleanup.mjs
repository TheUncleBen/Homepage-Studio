import { rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

// Attach immediately after spawn: 'exit' alone does not mean inherited stdio
// has closed or Chromium's descendants have finished their shutdown writes.
export function observeChildClose(child, { processGroup = false } = {}) {
  let result;
  const complete = new Promise(resolve => child.once('close', (code, signal) => {
    result = { code, signal };
    resolve(result);
  }));
  return { child, processGroup, complete, get result() { return result; } };
}

async function closesWithin(observed, milliseconds) {
  if (observed.result) return true;
  let timer;
  try {
    return await Promise.race([
      observed.complete.then(() => true),
      new Promise(resolve => { timer = setTimeout(() => resolve(false), milliseconds); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function signalOwnedProcess(observed, signal) {
  if (observed.result) return;
  const { child, processGroup } = observed;
  if (!child.pid) return; // A failed spawn still emits 'close'.
  if (processGroup) {
    // The caller must have spawned this child with detached:true on POSIX.
    // Its own group lets fallback cleanup also stop inherited-pipe descendants.
    try { process.kill(-child.pid, signal); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  } else if (child.exitCode === null && child.signalCode === null) {
    if (!child.kill(signal) && child.exitCode === null && child.signalCode === null) throw new Error(`Could not send ${signal} to the disposable browser.`);
  }
}

export async function stopBrowserProcess(observed, { requestClose, graceMs = 3000, terminateMs = 3000, killMs = 3000 } = {}) {
  if (!observed) return { method: 'not-started' };
  if (![graceMs, terminateMs, killMs].every(value => Number.isSafeInteger(value) && value >= 0 && value <= 60000)) throw new Error('Browser shutdown requires bounded timeouts.');
  if (observed.result) return { method: 'already-closed', ...observed.result };
  let closeRequestError;
  // Browser.close can terminate the transport before its reply arrives. Observe
  // process closure independently; a failed/unanswered request uses fallback.
  if (requestClose) Promise.resolve().then(requestClose).catch(error => { closeRequestError = error; });
  if (await closesWithin(observed, graceMs)) return { method: 'graceful', ...observed.result };
  signalOwnedProcess(observed, 'SIGTERM');
  if (await closesWithin(observed, terminateMs)) return { method: 'sigterm', ...observed.result };
  signalOwnedProcess(observed, 'SIGKILL');
  if (await closesWithin(observed, killMs)) return { method: 'sigkill', ...observed.result };
  throw new Error('Disposable browser did not close after bounded graceful, SIGTERM and SIGKILL shutdown.', { cause: closeRequestError });
}

const transientRemovalErrors = new Set(['EBUSY', 'EMFILE', 'ENFILE', 'ENOTEMPTY', 'EPERM']);

export async function removeBrowserProfile(profile, { remove = rm, attempts = 6, retryDelayMs = 100 } = {}) {
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 10 || !Number.isSafeInteger(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 1000) throw new Error('Browser profile removal requires bounded retries.');
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      // This single bounded loop owns retries, including a late directory entry
      // created by a descendant finishing its asynchronous profile writes.
      await remove(profile, { recursive: true, force: true, maxRetries: 0 });
      return { attempts: attempt };
    } catch (error) {
      if (!transientRemovalErrors.has(error.code) || attempt === attempts) throw error;
      await delay(retryDelayMs * attempt);
    }
  }
}
