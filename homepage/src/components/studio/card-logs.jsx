import useSWR from "swr";

import { deploymentRequest, studioRequest } from "./api.mjs";
import { logsLink } from "./investigate";

// Recent logs block (mock-ups v4): this widget's latest log lines, for people
// who can read this dashboard's logs. Everyone else never sees the block
// (CardBlocks leaves it out), and Operations checks access again on the
// server for every request. With sign-in off there are no logs to show.
const LEVEL = { 0: "CRIT", 1: "CRIT", 2: "CRIT", 3: "ERROR", 4: "WARN", 5: "NOTE", 6: "INFO", 7: "DEBUG" };

export function useLogsAllowed() {
  const { data } = useSWR("/studio/api/access", studioRequest, { revalidateOnFocus: false });
  return Boolean(data?.authEnabled && data?.dashboard?.id && data?.operations?.logs);
}

export default function CardLogs({ card }) {
  const { data: access } = useSWR("/studio/api/access", studioRequest, { revalidateOnFocus: false });
  const dashboardId = access?.dashboard?.id;
  const allowed = Boolean(access?.authEnabled && dashboardId && access?.operations?.logs && card.id);
  const query = allowed
    ? `/studio/api/ops/logs/search?${new URLSearchParams({ q: `panel:${card.id}`, dashboard: dashboardId, range: "24h", limit: "10" })}`
    : null;
  const { data, error } = useSWR(query, deploymentRequest, { refreshInterval: 60000 });
  if (!allowed) return null;
  if (error) return <p className="studio-chart-note">Logs can’t be read right now.</p>;
  if (!data) return <p className="studio-chart-note">Loading logs…</p>;
  const events = Array.isArray(data.events) ? data.events : [];
  if (!events.length) return <p className="studio-chart-note">Nothing logged for this widget in the last 24 hours.</p>;
  // Any line opens Operations' logs for this widget (mock-ups v4, board 8).
  const href = logsLink({ dashboardId, panelId: card.id, range: "24h" });
  return (
    <ul className="studio-card-logs" aria-label="Recent logs">
      {events.map((event) => (
        <li key={`${event.id}-${event.ts}`}>
          <a
            className="studio-log-line"
            data-severity={event.severity}
            href={href}
            title="Open these logs in Operations"
          >
            <span className="studio-log-level">{LEVEL[event.severity] ?? "INFO"}</span>
            {/* A report sent by someone's browser says whose, so it can't pass
              for Studio's own line (security review L1). */}
            {event.source_type === "browser" && (
              <span className="studio-log-source" title="Reported by a browser">
                {event.actor ? `${event.actor}'s browser` : "A browser"}
              </span>
            )}
            <span className="studio-log-message">{event.message}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
