// One status check's answer, as the card shows it and as status history
// keeps it: up (with its time in ms) or down (with the HTTP code if any).
// kind is "ping" or "siteMonitor"; data is that endpoint's JSON answer.
export function statusFrom(kind, data) {
  if (!data || data.error) return { state: "down" };
  if (kind === "ping") return data.alive ? { state: "up", ms: Math.round(data.time) } : { state: "down" };
  if (data.reachable === false) return { state: "down" };
  return data.status > 403 ? { state: "down", code: data.status } : { state: "up", ms: Math.round(data.latency) };
}

export const statusKind = (check) => (check === "ping" ? "ping" : check === "web" ? "siteMonitor" : null);
