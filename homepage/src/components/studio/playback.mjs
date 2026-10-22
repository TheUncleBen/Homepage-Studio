/**
 * Homepage Studio stack playback. This module has no DOM or persistence access.
 * Timer/clock injection makes every transition reproducible in tests.
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
export const DEFAULT_INTERVAL_MS = 10_000;
export const DEFAULT_MANUAL_HOLD_MS = 30_000;

function duration(value, name) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) {
    throw new TypeError(`${name} must be a positive safe timer duration.`);
  }
  return value;
}

function members(value) {
  if (!Array.isArray(value) || value.length > 4096 || value.some(id => typeof id !== 'string' || !id || id.length > 256) || new Set(value).size !== value.length) {
    throw new TypeError('ids must be distinct, nonempty panel IDs.');
  }
  return [...value];
}

/**
 * A manual successful switch while playing holds the chosen member for
 * max(intervalMs, manualHoldMs), then advances once and resumes intervalMs. Blocking
 * freezes the remaining visible-time budget. It never creates catch-up ticks.
 * Explicit Pause remains paused across manual navigation and blocker changes.
 *
 * subscribe() reports transitions, not animation frames/countdown ticks.
 * getSnapshot() has stable identity until a reported transition.
 */
export function createStackPlayback(options = {}) {
  let ids = members(options.ids ?? []);
  let intervalMs = duration(options.intervalMs ?? DEFAULT_INTERVAL_MS, 'intervalMs');
  let manualHoldMs = duration(options.manualHoldMs ?? DEFAULT_MANUAL_HOLD_MS, 'manualHoldMs');
  let loop = options.loop === undefined ? true : Boolean(options.loop);
  let activeIndex = options.activeId === undefined ? 0 : ids.indexOf(options.activeId);
  if (activeIndex < 0) throw new TypeError('activeId must identify a member.');
  let playing = Boolean(options.autoplay);
  let holding = false;
  let previousId = null;
  let direction = 0;
  let remainingMs = intervalMs;
  let dueAt = null;
  let timer = null;
  let generation = 0;
  let destroyed = false;
  const blocks = new Set();
  const listeners = new Set();
  const now = options.now ?? (() => globalThis.performance?.now() ?? Date.now());
  const setTimer = options.setTimer ?? ((fn, delay) => setTimeout(fn, delay));
  const clearTimer = options.clearTimer ?? (id => clearTimeout(id));
  if (![now, setTimer, clearTimer].every(value => typeof value === 'function')) throw new TypeError('Clock and timer adapters must be functions.');
  let snapshot;

  function readNow() {
    const value = now();
    if (!Number.isFinite(value)) throw new TypeError('The playback clock must return a finite number.');
    return value;
  }

  function cancelTimer() {
    generation += 1;
    if (timer !== null) clearTimer(timer);
    timer = null;
  }

  function canRun() { return !destroyed && playing && ids.length > 1 && blocks.size === 0; }

  function publish() {
    snapshot = Object.freeze({
      ids: Object.freeze([...ids]),
      activeId: ids[activeIndex] ?? null,
      activeIndex: ids.length ? activeIndex : -1,
      previousId,
      direction,
      playing,
      holding,
      blockedReasons: Object.freeze([...blocks].sort()),
      dueAt,
      manualHoldUntil: holding ? dueAt : null,
      remainingMs,
      intervalMs,
      manualHoldMs,
      loop,
      destroyed,
    });
    // Schedule before notification. A listener may synchronously pause/dispose.
    for (const listener of [...listeners]) listener(snapshot);
  }

  function arm() {
    cancelTimer();
    dueAt = null;
    if (!canRun()) return;
    const timestamp = readNow();
    dueAt = timestamp + remainingMs;
    const token = generation;
    timer = setTimer(() => {
      if (destroyed || token !== generation || !canRun()) return;
      timer = null;
      const time = readNow();
      // A host scheduler may fire early; preserve the original deadline.
      if (time < dueAt) {
        remainingMs = dueAt - time;
        arm();
        publish();
        return;
      }
      if (!loop && activeIndex === ids.length - 1) {
        playing = false;
        holding = false;
        remainingMs = intervalMs;
        dueAt = null;
        cancelTimer();
        publish();
        return;
      }
      previousId = ids[activeIndex];
      direction = 1;
      activeIndex = (activeIndex + 1) % ids.length;
      holding = false;
      remainingMs = intervalMs;
      // Even after a suspended timer, schedule from this actual transition.
      arm();
      publish();
    }, remainingMs);
  }

  function select(id, { manual = true, direction: requestedDirection } = {}) {
    if (destroyed) return false;
    const index = ids.indexOf(id);
    if (index < 0) throw new TypeError('The selected panel is not a stack member.');
    if (index === activeIndex) return false;
    previousId = ids[activeIndex];
    direction = requestedDirection === 1 || requestedDirection === -1 ? requestedDirection : Math.sign(index - activeIndex);
    activeIndex = index;
    holding = Boolean(manual && playing);
    remainingMs = holding ? Math.max(intervalMs, manualHoldMs) : intervalMs;
    arm();
    publish();
    return true;
  }

  function move(direction, settings) {
    if (destroyed || ids.length < 2) return false;
    const index = loop
      ? (activeIndex + direction + ids.length) % ids.length
      : Math.max(0, Math.min(ids.length - 1, activeIndex + direction));
    return select(ids[index], { ...settings, direction });
  }

  function play() {
    if (destroyed || ids.length < 2 || playing) return false;
    playing = true;
    holding = false;
    remainingMs = intervalMs;
    arm();
    publish();
    return true;
  }

  function pause() {
    if (destroyed || !playing) return false;
    playing = false;
    holding = false;
    remainingMs = intervalMs;
    arm();
    publish();
    return true;
  }

  function setBlocked(reason, value) {
    if (destroyed) return false;
    if (typeof reason !== 'string' || !reason || reason.length > 128) throw new TypeError('A blocker needs a short name.');
    const blocked = Boolean(value);
    if (blocks.has(reason) === blocked) return false;
    if (blocks.size === 0 && blocked && dueAt !== null) remainingMs = Math.max(0, dueAt - readNow());
    if (blocked) blocks.add(reason); else blocks.delete(reason);
    arm();
    publish();
    return true;
  }

  function update(settings = {}) {
    if (destroyed) return false;
    // Validate the complete change before mutating running state.
    const nextIds = settings.ids === undefined ? ids : members(settings.ids);
    const nextInterval = duration(settings.intervalMs ?? intervalMs, 'intervalMs');
    const nextManual = duration(settings.manualHoldMs ?? manualHoldMs, 'manualHoldMs');
    const nextLoop = settings.loop === undefined ? loop : Boolean(settings.loop);
    const idsEqual = nextIds.length === ids.length && nextIds.every((id, index) => id === ids[index]);
    if (idsEqual && nextInterval === intervalMs && nextManual === manualHoldMs && nextLoop === loop) return false;
    const activeId = ids[activeIndex];
    const retainedIndex = nextIds.indexOf(activeId);
    const activeRemoved = activeId !== undefined && retainedIndex < 0;
    const hadEnoughMembers = ids.length > 1;
    if (dueAt !== null) remainingMs = Math.max(0, dueAt - readNow());
    ids = [...nextIds];
    activeIndex = retainedIndex >= 0 ? retainedIndex : Math.min(activeIndex, Math.max(0, ids.length - 1));
    if (activeRemoved || (!hadEnoughMembers && ids.length > 1)) {
      previousId = null;
      direction = 0;
      holding = false;
      remainingMs = nextInterval;
    } else if (!holding && nextInterval !== intervalMs) remainingMs = nextInterval;
    // Updating the configured manual duration affects the next user switch;
    // an already active hold retains its budget.
    intervalMs = nextInterval;
    manualHoldMs = nextManual;
    loop = nextLoop;
    arm();
    publish();
    return true;
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    playing = false;
    holding = false;
    dueAt = null;
    cancelTimer();
    publish();
    listeners.clear();
  }

  arm();
  publish();
  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('A playback subscriber must be a function.');
      if (destroyed) return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    select,
    next: settings => move(1, settings),
    previous: settings => move(-1, settings),
    play,
    pause,
    toggle: () => playing ? pause() : play(),
    setBlocked,
    update,
    destroy,
  });
}
