import { useTranslation } from "next-i18next/pages";
import { useContext } from "react";
import useSWR from "swr";

import { StatusHistory } from "./card-chart";
import { CardLookContext } from "./card-look";
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
function useStatus(service, groupName, check) {
  const kind = statusKind(check);
  // An integration widget's Connection address is used when nothing else is
  // set (utils/studio/status-address); the browser never sees that address.
  const widgets = Array.isArray(service.widgets) && service.widgets.length > 0;
  const has = (kind === "ping" ? service.ping : service.siteMonitor) || service.href || widgets;
  const key =
    kind && has && groupName && service.name
      ? `/api/${kind}?${new URLSearchParams({ groupName, serviceName: service.name, fallback: "1" })}`
      : null;
  const { data, error } = useSWR(key, { refreshInterval: 30000 });
  if (!key) return null;
  if (error || data?.error) return { state: "down", text: "Error" };
  if (!data) return { state: "pending" };
  return statusFrom(kind, data);
}

function StatusMark({ status, show }) {
  const { t } = useTranslation();
  if (!status) return null;
  const label =
    status.state === "pending"
      ? "Checking…"
      : status.state === "down"
        ? `Down${status.code ? ` (${status.code})` : ""}`
        : `Up · ${t("common.ms", { value: status.ms, style: "unit", unit: "millisecond", maximumFractionDigits: 0 })}`;
  return (
    <span className={`studio-card-status studio-status-${status.state}`} title={label} role="img" aria-label={label}>
      {show === "time" && status.state === "up" && (
        <span className="studio-status-text">
          {t("common.ms", { value: status.ms, style: "unit", unit: "millisecond", maximumFractionDigits: 0 })}
        </span>
      )}
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
    <header className="studio-card-head">
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
export function ServiceCard({ service, groupName, children }) {
  const card = useContext(CardLookContext);
  const settings = useContext(SettingsContext)?.settings;
  const status = useStatus(service, groupName, card.statusCheck);
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
  const since = downSince.get(key);
  // A down service says so in place of its description, so even a compact
  // card shows why it is red.
  const note = down
    ? `${status.code ? `Answered ${status.code}` : "No answer"}${since ? ` since ${since.toLocaleTimeString(i18n.language || [], { hour: "2-digit", minute: "2-digit", ...(clock !== "dashboard" ? { hour12: clock === "12" } : {}) })}` : ""}`
    : null;
  // Status history takes the place of an integration's own values.
  const body = card.show === "status" && card.statusCheck !== "off" ? <StatusHistory card={card} /> : children;
  return (
    <div
      className="studio-card"
      data-alert={down || card.ruleAlert || undefined}
      data-has-body={Boolean(body) || undefined}
    >
      <CardHead
        icon={service.icon}
        name={service.name}
        description={service.description}
        note={note}
        href={service.href}
        card={card}
        status={status}
        extra={extra}
      />
      {body && <div className="studio-card-body">{body}</div>}
    </div>
  );
}

// An integration widget, under its service's logo and name.
export function WidgetCard({ service, widget, groupName }) {
  return (
    <ServiceCard service={service} groupName={groupName}>
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
  return (
    <div className="studio-card">
      <CardHead
        icon={bookmark.icon}
        name={bookmark.name}
        description={description}
        href={bookmark.href}
        card={{ ...card, header: bookmark.icon ? card.header : card.header === "logo" ? "name" : card.header }}
      />
    </div>
  );
}
