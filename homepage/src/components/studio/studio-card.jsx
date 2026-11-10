import { useTranslation } from "next-i18next/pages";
import { useContext, useMemo } from "react";
import useSWR from "swr";

import { studioRequest } from "./api.mjs";
import { useBlockFit } from "./card-fit";
import { CardFitContext, CardLookContext } from "./card-look";
import { CardBlocks } from "./card-values";
import { usePreferences } from "./preferences";

import ResolvedIcon from "components/resolvedicon";
import KubernetesStatus from "components/services/kubernetes-status";
import ProxmoxStatus from "components/services/proxmox-status";
import DockerStatus from "components/services/status";
import ServiceWidget from "components/services/widget";
import { SettingsContext } from "utils/contexts/settings";
import { statusFrom, statusKind } from "utils/studio/status-check";

const TARGETS = { same: "_self", new: "_blank" };
// When each service was first seen down, so "since" means since it failed.
const downSince = new Map();

// The check behind a card's status: the service's own siteMonitor or ping
// when set, otherwise its widget's Connection address or its link
// (fallback=1) when the card asks for one.
//
// Studio's monitoring engine runs that check on the server for every card
// (owner decision D6), so every browser shows the same status and history.
// One request a dashboard serves all its cards. A card the engine doesn't
// check yet (just added) makes the check itself until it does.
function cardMonitorStatus(panel) {
  if (!panel) return null;
  if (panel.state === "up") return { state: "up", ms: panel.ms ?? undefined, since: panel.since };
  if (panel.state === "down" || panel.state === "unreachable")
    return { state: "down", code: panel.code ?? undefined, text: panel.text ?? undefined, since: panel.since };
  if (panel.state === "maintenance" || panel.state === "paused") return { state: panel.state };
  return { state: "pending" };
}
function useStatus(service, groupName, check, connected = false, panelId = null) {
  const kind = statusKind(check);
  // An integration widget's Connection address is used when nothing else is
  // set (utils/studio/status-address); the browser never sees that address.
  const has = (kind === "ping" ? service.ping : service.siteMonitor) || service.href || connected;
  const usable = Boolean(kind && has && groupName && service.name);
  const { data: monitored, error: monitoredError } = useSWR(
    usable && panelId ? "/studio/api/panel-status" : null,
    studioRequest,
    { refreshInterval: 30000, dedupingInterval: 10000 },
  );
  const fromMonitor = monitored?.available ? cardMonitorStatus(monitored.panels?.[panelId]) : null;
  // Until the engine has checked a new or changed card, the card checks for
  // itself, so its status and response time show at once (owner feedback on
  // 53ebc3b: they took minutes to appear).
  const waiting = fromMonitor?.state === "pending";
  const own = usable && (!panelId || monitoredError || (monitored && (!fromMonitor || waiting)));
  const key = own
    ? `/api/${kind}?${new URLSearchParams({ groupName, serviceName: service.name, fallback: "1" })}`
    : null;
  const { data, error } = useSWR(key, { refreshInterval: 30000 });
  if (!usable) return null;
  if (fromMonitor && !waiting) return fromMonitor;
  if (!key) return { state: "pending" };
  if (error || data?.error) return { state: "down", text: "Error" };
  if (!data) return { state: "pending" };
  return statusFrom(kind, data);
}

function StatusMark({ status, show }) {
  const { t } = useTranslation();
  if (!status) return null;
  // Under a millisecond (a ping on the local network) says so, not "0 ms".
  const time = !Number.isFinite(status.ms)
    ? ""
    : status.ms < 1
      ? `<${t("common.ms", { value: 1, style: "unit", unit: "millisecond", maximumFractionDigits: 0 })}`
      : t("common.ms", { value: status.ms, style: "unit", unit: "millisecond", maximumFractionDigits: 0 });
  const label =
    status.state === "pending"
      ? "Checking…"
      : status.state === "maintenance"
        ? "Maintenance"
        : status.state === "paused"
          ? "Not checked (paused)"
          : status.state === "down"
            ? `Down${status.code ? ` (${status.code})` : ""}`
            : `Up${time ? ` · ${time}` : ""}`;
  return (
    <span className={`studio-card-status studio-status-${status.state}`} title={label} role="img" aria-label={label}>
      {show === "time" && status.state === "up" && time && <span className="studio-status-text">{time}</span>}
      {show === "updown" && status.state === "up" && <span className="studio-status-text">Up</span>}
      {status.state === "down" && <span className="studio-status-text">{status.code ? "Down" : "Offline"}</span>}
      <span className="studio-status-dot" aria-hidden="true" />
    </span>
  );
}

function Identity({ icon, name, description, note, card }) {
  const logo = card.header === "logo-name" || card.header === "logo";
  const title = card.header === "logo-name" || card.header === "name";
  return (
    <>
      {logo && icon && (
        <span className="studio-card-logo">
          <ResolvedIcon icon={icon} width={28} height={28} alt="" />
        </span>
      )}
      {title && (
        <span className="studio-card-name">
          <strong>{name}</strong>
          {note ? (
            <small className="studio-card-note">{note}</small>
          ) : (
            card.description === "show" && description && <small>{description}</small>
          )}
        </span>
      )}
    </>
  );
}

export function CardHead({ icon, name, description, note, href, card, status, extra }) {
  const target = TARGETS[card.target];
  const linked = href && href !== "#" && target;
  if (card.header === "hidden" && !status && !extra) return null;
  return (
    <header className="studio-card-head" data-logo={card.logoPos === "above" ? "above" : undefined} data-pick="header">
      {card.header !== "hidden" &&
        (linked ? (
          <a className="studio-card-identity" href={href} target={target} rel="noreferrer">
            <Identity icon={icon} name={name} description={description} note={note} card={card} />
          </a>
        ) : (
          <span className="studio-card-identity">
            <Identity icon={icon} name={name} description={description} note={note} card={card} />
          </span>
        ))}
      <span className="studio-card-tags">
        {extra}
        <StatusMark status={status} show={card.status} />
      </span>
    </header>
  );
}

// A service tile: its logo, name and status. With nothing else to show it
// stays one compact row; when its check fails it says so in words.
// connected: an integration widget's card, whose Connection address the
// status check can use.
export function ServiceCard({ service, groupName, children, connected = false }) {
  const card = useContext(CardLookContext);
  const settings = useContext(SettingsContext)?.settings;
  const status = useStatus(service, groupName, card.statusCheck, connected, card.id ?? null);
  const { clock } = usePreferences();
  const { i18n } = useTranslation();
  const statusStyle = service.statusStyle ?? settings?.statusStyle ?? "dot";
  const extra = (
    <>
      {service.container && <DockerStatus service={service} style={statusStyle} />}
      {service.app && !service.external && <KubernetesStatus service={service} style={statusStyle} />}
      {service.proxmoxNode && service.proxmoxVMID && <ProxmoxStatus service={service} style={statusStyle} />}
    </>
  );
  const down = status?.state === "down";
  const key = `${groupName}\u0000${service.name}`;
  if (down && !downSince.has(key)) downSince.set(key, new Date());
  if (status?.state === "up") downSince.delete(key);
  // The engine knows when it went down; a card's own check only since this page opened.
  const since = down && Number.isFinite(status.since) ? new Date(status.since) : downSince.get(key);
  // A down service says so in place of its description, so even a compact
  // card shows why it is red.
  const note = down
    ? `${status.code ? `Answered ${status.code}` : status.text && status.text !== "Error" ? status.text : "No answer"}${since ? ` since ${since.toLocaleTimeString(i18n.language || [], { hour: "2-digit", minute: "2-digit", ...(clock !== "dashboard" ? { hour12: clock === "12" } : {}) })}` : ""}`
    : null;
  // The card's blocks at its size (mock-ups v4). An integration widget draws
  // them with its values; a service card has only status, response time and
  // logs blocks to draw.
  const { ref, effective, context } = useBlockFit(card);
  const sized = useMemo(
    () => ({
      ...card,
      // The name the card shows, for links that label it elsewhere (the
      // Operations logs chip; UI review M3).
      shownName: service?.name || "",
      header: effective.header,
      logoPos: effective.logoPos,
      align: effective.align,
      blocks: effective.blocks,
    }),
    [card, effective, service?.name],
  );
  const body = children ?? <CardBlocks card={sized} />;
  return (
    <CardLookContext.Provider value={sized}>
      <CardFitContext.Provider value={context}>
        <div
          ref={ref}
          className="studio-card"
          data-alert={down || card.ruleAlert || undefined}
          data-has-body={Boolean(body) || undefined}
          data-align={effective.align}
        >
          <CardHead
            icon={service.icon}
            name={service.name}
            description={service.description}
            note={note}
            href={service.href}
            card={sized}
            status={status}
            extra={extra}
          />
          {body && <div className="studio-card-body">{body}</div>}
        </div>
      </CardFitContext.Provider>
    </CardLookContext.Provider>
  );
}

// An integration widget, under its service's logo and name.
export function WidgetCard({ service, widget, groupName }) {
  return (
    <ServiceCard service={service} groupName={groupName} connected={typeof widget?.type === "string"}>
      <ServiceWidget widget={widget} service={service} />
    </ServiceCard>
  );
}

export function BookmarkCard({ bookmark }) {
  const card = useContext(CardLookContext);
  let description = bookmark.description;
  if (description === undefined) {
    try {
      description = new URL(bookmark.href).hostname;
    } catch {
      description = "";
    }
  }
  // Fitted like any card, so on a short row it says what its name and
  // address need and the board grows it (UI review R1).
  const { ref, context } = useBlockFit(card);
  return (
    <CardFitContext.Provider value={context}>
      <div ref={ref} className="studio-card">
        <CardHead
          icon={bookmark.icon}
          name={bookmark.name}
          description={description}
          href={bookmark.href}
          card={{ ...card, header: bookmark.icon ? card.header : card.header === "logo" ? "name" : card.header }}
        />
      </div>
    </CardFitContext.Provider>
  );
}
