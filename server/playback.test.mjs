import test from 'node:test';
import assert from 'node:assert/strict';
import { createStackPlayback } from '../homepage/src/components/studio/playback.mjs';

function fakeClock() {
  let time = 0, sequence = 0;
  const timers = new Map();
  const callbacks = new Map();
  return {
    now: () => time,
    setTimer(fn, delay) { const id = sequence++; timers.set(id, { at: time + delay, fn }); callbacks.set(id, fn); return id; },
    clearTimer(id) { timers.delete(id); },
    count: () => timers.size,
    jump(ms) { time += ms; },
    flushOne() { const next = [...timers].filter(([, t]) => t.at <= time).sort((a,b) => a[1].at-b[1].at)[0]; if (!next) return false; timers.delete(next[0]); next[1].fn(); return true; },
    run(ms) { const until = time + ms; let next; while ((next = [...timers].filter(([,t]) => t.at <= until).sort((a,b) => a[1].at-b[1].at)[0])) { time = next[1].at; timers.delete(next[0]); next[1].fn(); } time = until; },
    stale(id) { callbacks.get(id)?.(); },
    nextId: () => [...timers.keys()][0],
  };
}

function fixture(extra = {}) {
  const clock = fakeClock();
  const controller = createStackPlayback({ ids: ['clock','weather','search'], ...clock, ...extra });
  return { clock, controller, snap: () => controller.getSnapshot() };
}

test('starts paused with no timer; explicit Play schedules a normal interval', () => {
  const { clock, controller: c, snap } = fixture();
  assert.equal(snap().playing,false); assert.equal(clock.count(),0);
  c.play(); assert.equal(clock.count(),1); assert.equal(snap().dueAt,10_000);
  clock.run(9_999); assert.equal(snap().activeId,'clock');
  clock.run(1); assert.equal(snap().activeId,'weather'); assert.equal(snap().dueAt,20_000);
});

test('manual switch while playing holds exactly 30 seconds, then resumes normal timing', () => {
  const {clock, controller:c, snap}=fixture({autoplay:true});
  clock.run(4_000); c.next();
  assert.equal(snap().activeId,'weather'); assert.equal(snap().playing,true);
  assert.equal(snap().manualHoldUntil,34_000); assert.equal(clock.count(),1);
  clock.run(29_999); assert.equal(snap().activeId,'weather');
  clock.run(1); assert.equal(snap().activeId,'search'); assert.equal(snap().holding,false);
  clock.run(9_999); assert.equal(snap().activeId,'search');
  clock.run(1); assert.equal(snap().activeId,'clock');
});

test('each successful manual switch resets the hold from the most recent switch', () => {
  const {clock, controller:c, snap}=fixture({autoplay:true});
  c.next(); clock.run(20_000); c.previous();
  assert.equal(snap().manualHoldUntil,50_000);
  clock.run(29_999); assert.equal(snap().activeId,'clock');
  clock.run(1); assert.equal(snap().activeId,'weather');
});

test('manual selection never shortens a configured normal interval longer than 30 seconds', () => {
  const {clock, controller:c, snap}=fixture({autoplay:true,intervalMs:60_000});
  clock.run(5_000); c.next(); assert.equal(snap().manualHoldUntil,65_000);
  clock.run(59_999); assert.equal(snap().activeId,'weather');
  clock.run(1); assert.equal(snap().activeId,'search'); assert.equal(snap().dueAt,125_000);
});

test('manual changes while paused never start rotation, including after unblock', () => {
  const {clock, controller:c, snap}=fixture();
  c.next(); c.setBlocked('hidden',true); clock.run(99_000); c.previous(); c.setBlocked('hidden',false);
  assert.equal(snap().activeId,'clock'); assert.equal(snap().playing,false); assert.equal(clock.count(),0);
  c.play(); assert.equal(snap().dueAt,109_000);
});

test('Pause overrides a pending manual hold and Play starts a fresh normal interval', () => {
  const {clock, controller:c, snap}=fixture({autoplay:true});
  c.next(); clock.run(5_000); c.pause(); clock.run(40_000);
  assert.equal(snap().activeId,'weather'); assert.equal(clock.count(),0);
  c.play(); assert.equal(snap().dueAt,55_000); assert.equal(snap().holding,false);
  clock.run(10_000); assert.equal(snap().activeId,'search');
});

test('no-op selection and non-loop edge attempts do not postpone autoplay', () => {
  const {clock, controller:c, snap}=fixture({autoplay:true,loop:false});
  clock.run(4_000); assert.equal(c.select('clock'),false); assert.equal(c.previous(),false);
  assert.equal(snap().dueAt,10_000); assert.equal(snap().holding,false);
  clock.run(6_000); assert.equal(snap().activeId,'weather');
});

test('blockers freeze a manual hold; removing only one of multiple blockers does not resume', () => {
  const {clock, controller:c, snap}=fixture({autoplay:true});
  c.next(); clock.run(7_000); c.setBlocked('hidden',true); c.setBlocked('editing',true);
  assert.equal(clock.count(),0); assert.equal(snap().remainingMs,23_000);
  clock.run(60_000); c.setBlocked('hidden',false); assert.equal(clock.count(),0);
  c.setBlocked('editing',false); assert.equal(snap().dueAt,90_000); assert.equal(clock.count(),1);
  clock.run(22_999); assert.equal(snap().activeId,'weather');
  clock.run(1); assert.equal(snap().activeId,'search');
});

test('manual switch while blocked preserves playing intent and gives the new slide a full hold', () => {
  const {clock, controller:c, snap}=fixture({autoplay:true});
  c.setBlocked('content-focus',true); clock.run(50_000); c.next();
  assert.equal(snap().playing,true); assert.equal(snap().remainingMs,30_000); assert.equal(clock.count(),0);
  c.setBlocked('content-focus',false); clock.run(29_999); assert.equal(snap().activeId,'weather');
  clock.run(1); assert.equal(snap().activeId,'search');
});

test('delayed host callbacks advance once, never replay missed intervals', () => {
  const {clock, snap}=fixture({autoplay:true});
  clock.jump(120_000); clock.flushOne(); assert.equal(snap().activeId,'weather');
  assert.equal(snap().dueAt,130_000); assert.equal(clock.flushOne(),false); assert.equal(clock.count(),1);
});

test('a stale timer cannot advance after manual navigation, pause or destroy', () => {
  const {clock, controller:c, snap}=fixture({autoplay:true});
  const first=clock.nextId(); c.next(); clock.stale(first); assert.equal(snap().activeId,'weather');
  const hold=clock.nextId(); c.pause(); clock.stale(hold); assert.equal(snap().activeId,'weather');
  c.play(); const next=clock.nextId(); c.destroy(); clock.stale(next);
  assert.equal(snap().destroyed,true); assert.equal(clock.count(),0); assert.equal(c.next(),false);
});

test('non-looping playback stops after displaying the final member for its interval', () => {
  const {clock, snap}=fixture({autoplay:true,loop:false});
  clock.run(20_000); assert.equal(snap().activeId,'search'); assert.equal(snap().playing,true);
  clock.run(10_000); assert.equal(snap().activeId,'search'); assert.equal(snap().playing,false); assert.equal(clock.count(),0);
});

test('reordering retains active identity and deadline; removing active selects a valid member', () => {
  const {clock, controller:c, snap}=fixture({autoplay:true});
  c.next(); clock.run(5_000); c.update({ids:['search','weather','clock']});
  assert.equal(snap().activeId,'weather'); assert.equal(snap().manualHoldUntil,30_000);
  c.update({ids:['search','clock']}); assert.equal(snap().activeId,'clock'); assert.equal(snap().holding,false); assert.equal(snap().dueAt,15_000);
});

test('one or zero members cannot schedule; adding a second resumes intent safely', () => {
  const {clock, controller:c, snap}=fixture({ids:['clock'],autoplay:true});
  assert.equal(clock.count(),0); assert.equal(c.next(),false);
  c.update({ids:['clock','weather']}); assert.equal(clock.count(),1);
  c.update({ids:[]}); assert.equal(clock.count(),0); assert.equal(snap().activeId,null); assert.equal(snap().activeIndex,-1);
  c.update({ids:['search','clock']}); assert.equal(snap().dueAt,10_000); clock.run(10_000); assert.equal(snap().activeId,'clock');
});

test('configuration changes preserve an active hold and use the new normal interval afterward', () => {
  const {clock, controller:c, snap}=fixture({autoplay:true});
  c.next(); clock.run(8_000); c.update({intervalMs:20_000,manualHoldMs:45_000});
  assert.equal(snap().manualHoldUntil,30_000); clock.run(22_000); assert.equal(snap().dueAt,50_000);
  c.previous(); assert.equal(snap().manualHoldUntil,75_000);
});

test('invalid updates fail atomically without losing the active timer', () => {
  const {clock, controller:c, snap}=fixture({autoplay:true}); const before=snap();
  assert.throws(()=>c.update({ids:['clock','clock']}),/distinct/);
  assert.throws(()=>c.update({intervalMs:NaN}),/positive/);
  assert.throws(()=>c.select('missing'),/not a stack/);
  assert.strictEqual(snap(),before); assert.equal(clock.count(),1);
  clock.run(10_000); assert.equal(snap().activeId,'weather');
});

test('snapshots are stable/immutable and subscriptions report transitions rather than time ticks', () => {
  const {clock, controller:c, snap}=fixture({autoplay:true}); const first=snap(); const seen=[];
  const unsubscribe=c.subscribe(s=>seen.push(s)); clock.run(9_000);
  assert.strictEqual(snap(),first); assert.equal(seen.length,0);
  assert.throws(()=>snap().ids.push('bad'),TypeError); c.next(); assert.equal(seen.length,1);
  unsubscribe(); c.pause(); assert.equal(seen.length,1);
});

test('subscriber may synchronously pause without leaving a timer alive', () => {
  const {clock, controller:c, snap}=fixture({autoplay:true});
  c.subscribe(s=>{if(s.activeId==='weather'&&s.playing)c.pause();}); clock.run(10_000);
  assert.equal(snap().playing,false); assert.equal(clock.count(),0); clock.run(90_000); assert.equal(snap().activeId,'weather');
});
