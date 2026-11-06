// Log searches run here, in their own worker thread with read-only database
// connections, so a slow search never holds up checks or log writing
// (plan 5.1). Each call has a time budget and returns what it found by then.
import { parentPort, workerData } from 'node:worker_threads';
import { createPort } from './rpc.mjs';
import { createQueryRunner } from './query.mjs';

const runner = createQueryRunner({ dir: workerData.dir });
const guard = fn => params => {
  try { return fn(params ?? {}); }
  catch (error) {
    // A database that is not there yet (no events written) is an empty answer.
    if (error.code === 'ERR_SQLITE_ERROR' && /unable to open|no such table/i.test(error.message)) return null;
    throw Object.assign(new Error('The log search failed.'), { code: 'LOG_SEARCH_FAILED', status: 500 });
  }
};
createPort(parentPort, {
  search: guard(params => runner.search(params) ?? { events: [], next: null, partial: false }),
  facets: guard(params => runner.facets(params)),
  histogram: guard(params => runner.histogram(params)),
  context: guard(params => runner.context(params)),
  groups: guard(params => runner.groups(params)),
  oldest: guard(() => ({ oldest: runner.oldest() })),
  stop: () => { runner.close(); setTimeout(() => process.exit(0), 20); return { ok: true }; },
});
