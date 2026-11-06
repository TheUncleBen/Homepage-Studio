// Widget failures seen in this browser go to the dashboard's logs (Operations
// › Logs), so the people who look after it see what visitors see. Only with
// sign-in on (the controller refuses them otherwise), once per widget and
// message per page, a few at a time.
import { studioRequest } from "./api.mjs";

let enabled = false;
const seen = new Set();
let queue = [];
let timer = null;
const MAX_PER_PAGE = 30;

export function enableClientErrors(on) {
  enabled = Boolean(on);
}

export function reportClientError({ panel, widget, message }) {
  if (!enabled || typeof window === "undefined" || !message) return;
  const key = `${panel ?? ""}\u0000${message}`;
  if (seen.has(key) || seen.size >= MAX_PER_PAGE) return;
  seen.add(key);
  queue.push({ panel: panel ?? undefined, widget: widget ?? undefined, message: String(message).slice(0, 500) });
  if (!timer) timer = setTimeout(flush, 2000);
}

function flush() {
  timer = null;
  const errors = queue.slice(0, 10);
  queue = queue.slice(10);
  if (queue.length) timer = setTimeout(flush, 2000);
  // Reporting must never disturb the dashboard.
  studioRequest("/studio/api/client-errors", { errors }).catch(() => {});
}

export function resetClientErrorsForTests() {
  enabled = false;
  seen.clear();
  queue = [];
  clearTimeout(timer);
  timer = null;
}
