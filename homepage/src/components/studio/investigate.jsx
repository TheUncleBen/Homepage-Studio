import { useEffect, useState } from "react";
import useSWR from "swr";

import { deploymentRequest, studioRequest } from "./api.mjs";
import StudioDialog from "./dialog";
import { Group, Row } from "./ui";

// Investigate (observability plan 9.4, build addendum 4): why a widget looks
// wrong, for people with Monitoring or Logs on this dashboard. It shows what
// the card's monitor last found and the widget's latest log entries, and
// opens Operations for more. Operations checks access again on the server.
const STATE_WORDS = {
  up: "Up",
  down: "Down",
  unreachable: "Can’t check",
  pending: "Failing",
  maintenance: "Maintenance",
  paused: "Paused",
  unknown: "Not checked yet",
};
const SEVERITY = {
  0: "Critical",
  1: "Critical",
  2: "Critical",
  3: "Error",
  4: "Warning",
  5: "Notice",
  6: "Info",
  7: "Debug",
};
const clock = (ts) =>
  new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

// Operations' logs filtered to one widget: a chip there names it and can be
// taken off. The name is only a label; the filter is the dashboard and id.
export function logsLink({ dashboardId, panelId, name, range }) {
  const params = { panel: panelId, scope: dashboardId };
  if (name) params.name = String(name).slice(0, 80);
  if (range) params.range = range;
  return `/studio/operations#logs?${new URLSearchParams(params)}`;
}

export function operationsLink({ dashboardId, panelId, monitored, name }) {
  if (monitored) return `/studio/operations#monitor/${encodeURIComponent(`card:${dashboardId}:${panelId}`)}`;
  return logsLink({ dashboardId, panelId, name });
}

export default function InvestigateSheet({ panel, dashboardId, operations, onClose }) {
  const name = panel.title || "This widget";
  const { data: statuses } = useSWR(operations.monitoring ? "/studio/api/panel-status" : null, studioRequest);
  const status = statuses?.panels?.[panel.id] ?? null;
  const [logs, setLogs] = useState(operations.logs ? null : { events: [] });
  useEffect(() => {
    if (!operations.logs) return undefined;
    let current = true;
    const query = new URLSearchParams({ q: `panel:${panel.id}`, dashboard: dashboardId, range: "24h", limit: "5" });
    deploymentRequest(`/studio/api/ops/logs/search?${query}`)
      .then((result) => current && setLogs(result))
      .catch((error) => current && setLogs({ error }));
    return () => {
      current = false;
    };
  }, [operations.logs, panel.id, dashboardId]);
  const monitored = Boolean(operations.monitoring && status);
  const showLogs = operations.logs;
  const target =
    monitored || showLogs ? operationsLink({ dashboardId, panelId: panel.id, monitored, name: panel.name }) : null;
  return (
    <StudioDialog title={`${name}: what’s happening`} onClose={onClose}>
      <div className="studio-dialog-body studio-investigate">
        {operations.monitoring && (
          <Group title="Status check">
            {status ? (
              <>
                <Row label="Now">
                  <span className={`studio-investigate-state studio-investigate-${status.state}`}>
                    {STATE_WORDS[status.state] ?? STATE_WORDS.unknown}
                  </span>
                </Row>
                {status.since && <Row label="Since">{clock(status.since)}</Row>}
                {status.state !== "up" && status.text && <Row label="Problem">{status.text}</Row>}
                {status.state === "up" && Number.isFinite(status.ms) && (
                  <Row label="Answered in">{`${Math.max(1, Math.round(status.ms))} ms`}</Row>
                )}
                {status.warning && <Row label="Warning">Something needs a look; Operations has the details.</Row>}
              </>
            ) : (
              <p className="studio-empty-row">{statuses ? "This widget has no status check." : "Loading…"}</p>
            )}
          </Group>
        )}
        {showLogs && (
          <Group title="Latest entries, last 24 hours">
            {!logs && <p className="studio-empty-row">Loading…</p>}
            {logs?.error && <p className="studio-empty-row">{logs.error.message}</p>}
            {logs?.events && !logs.events.length && <p className="studio-empty-row">Nothing logged about it.</p>}
            {logs?.events?.map((event) => (
              <div className="studio-investigate-event" key={event.id}>
                <span className="studio-investigate-meta">
                  {SEVERITY[event.severity] ?? "Info"} · {clock(event.ts)}
                  {event.repeat > 1 ? ` · ${event.repeat} times` : ""}
                </span>
                <span className="studio-investigate-message">{event.message}</span>
              </div>
            ))}
          </Group>
        )}
        <div className="studio-inline-actions">
          <button type="button" className="studio-button studio-quiet" onClick={onClose}>
            Close
          </button>
          {target && (
            <a className="studio-button studio-primary" href={target}>
              {monitored ? "Open in Operations" : "Show in Logs"}
            </a>
          )}
        </div>
      </div>
    </StudioDialog>
  );
}
