import { useSyncExternalStore } from "react";

import { cardLive, refreshCards } from "./card-look";
import StudioIcon from "./icons";

// One shared one-second clock for every card's freshness note. It stops
// while the tab is hidden, like the widgets' own updates.
const listeners = new Set();
let timer = null;
let now = Date.now();
function tick() {
  now = Date.now();
  listeners.forEach((listener) => listener());
}
function sync() {
  const wanted = listeners.size > 0 && !document.hidden;
  if (wanted && !timer) {
    tick();
    timer = setInterval(tick, 1000);
  } else if (!wanted && timer) {
    clearInterval(timer);
    timer = null;
  }
}
function subscribe(listener) {
  listeners.add(listener);
  if (listeners.size === 1) document.addEventListener("visibilitychange", sync);
  sync();
  return () => {
    listeners.delete(listener);
    if (!listeners.size) document.removeEventListener("visibilitychange", sync);
    sync();
  };
}
const useNow = () =>
  useSyncExternalStore(
    subscribe,
    () => now,
    () => 0,
  );

// "12 s", "5 min", "2 h": short, for a small note.
export function age(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.round(minutes / 60)} h`;
}

// How old a card's numbers are. Old numbers stay on the card (the widget
// keeps its last data), so when updates stop the note says how old they
// are; otherwise it shows on hover, with a way to refresh now.
export function freshness(live, at) {
  if (!live?.updatedAt || !at) return null;
  const since = at - live.updatedAt;
  const stale = live.interval > 0 && since > Math.max(3 * live.interval, 60000);
  const next = live.interval > 0 && !stale ? Math.max(0, live.interval - since) : null;
  return {
    stale,
    text: stale ? `${age(since)} old` : `Updated ${age(since)} ago${next !== null ? ` · next in ${age(next)}` : ""}`,
  };
}

export default function Freshness({ panelId, title }) {
  const at = useNow();
  const state = freshness(cardLive(panelId), at);
  if (!state) return null;
  return (
    <div className="studio-freshness" data-stale={state.stale || undefined}>
      <span>{state.text}</span>
      <button
        type="button"
        className="studio-freshness-refresh"
        aria-label={`Refresh ${title} now`}
        title="Refresh now"
        onClick={(event) => {
          event.stopPropagation();
          refreshCards([panelId]);
        }}
      >
        <StudioIcon name="refresh" size={13} />
      </button>
    </div>
  );
}
