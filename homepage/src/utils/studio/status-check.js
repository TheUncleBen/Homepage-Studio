// One status check's answer, as the card shows it and as status history
// keeps it: up (with its time in ms) or down (with the HTTP code if any).
// kind is "ping" or "siteMonitor"; data is that endpoint's JSON answer.
// Times keep a tenth of a millisecond: a ping on the local network takes
// well under 1 ms, which rounded to a misleading "0 ms" (owner T8, 65f724c).
const tenths = (ms) => (Number.isFinite(Number(ms)) ? Math.round(Number(ms) * 10) / 10 : undefined);
export function statusFrom(kind, data) {
  if (!data || data.error) return { state: "down" };
  if (kind === "ping") return data.alive ? { state: "up", ms: tenths(data.time) } : { state: "down" };
  if (data.reachable === false) return { state: "down" };
  return data.status > 403 ? { state: "down", code: data.status } : { state: "up", ms: tenths(data.latency) };
}

export const statusKind = (check) => (check === "ping" ? "ping" : check === "web" ? "siteMonitor" : null);
