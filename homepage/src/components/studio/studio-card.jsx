import { useTranslation } from "next-i18next/pages";
import { useContext } from "react";
import useSWR from "swr";

import { CardLookContext } from "./card-look";

import ResolvedIcon from "components/resolvedicon";
import KubernetesStatus from "components/services/kubernetes-status";
import ProxmoxStatus from "components/services/proxmox-status";
import DockerStatus from "components/services/status";
import ServiceWidget from "components/services/widget";
import { SettingsContext } from "utils/contexts/settings";

const TARGETS = { same: "_self", new: "_blank" };
// When each service was first seen down, so "since" means since it failed.
const downSince = new Map();

// The check behind a card's status: the service's own siteMonitor or ping
// when set, otherwise its address (fallback=1) when the widget asks for one.
function useStatus(service, groupName, check) {
  const kind = check === "ping" ? "ping" : check === "web" ? "siteMonitor" : null;
  const has = kind === "ping" ? service.ping || service.href : service.siteMonitor || service.href;
  const key =
    kind && has && groupName && service.name
      ? `/api/${kind}?${new URLSearchParams({ groupName, serviceName: service.name, fallback: "1" })}`
      : null;
  const { data, error } = useSWR(key, { refreshInterval: 30000 });
  if (!key) return null;
  if (error || data?.error) return { state: "down", text: "Error" };
  if (!data) return { state: "pending" };
  if (kind === "ping")
    return data.alive ? { state: "up", ms: Math.round(data.time) } : { state: "down" };
  return data.status > 403 ? { state: "down", code: data.status } : { state: "up", ms: Math.round(data.latency) };
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
      {show === "updown" && status.state !== "pending" && (
        <span className="studio-status-text">{status.state === "up" ? "Up" : "Down"}</span>
      )}
      <span className="studio-status-dot" aria-hidden="true" />
    </span>
  );
}

function Identity({ icon, name, description, card }) {
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
          {card.description === "show" && description && <small>{description}</small>}
        </span>
      )}
    </>
  );
}

export function CardHead({ icon, name, description, href, card, status, extra }) {
  const target = TARGETS[card.target];
  const linked = href && href !== "#" && target;
  if (card.header === "hidden" && !status && !extra) return null;
  return (
    <header className="studio-card-head">
      {card.header !== "hidden" &&
        (linked ? (
          <a className="studio-card-identity" href={href} target={target} rel="noreferrer">
            <Identity icon={icon} name={name} description={description} card={card} />
          </a>
        ) : (
          <span className="studio-card-identity">
            <Identity icon={icon} name={name} description={description} card={card} />
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
  return (
    <div className="studio-card" data-alert={down || undefined} data-has-body={Boolean(children) || down || undefined}>
      <CardHead
        icon={service.icon}
        name={service.name}
        description={service.description}
        href={service.href}
        card={card}
        status={status}
        extra={extra}
      />
      {down && !children && (
        <div className="studio-card-offline" role="status">
          <strong>Offline</strong>
          <span>
            {status.code ? `Answered ${status.code}` : "No answer"}
            {since && ` since ${since.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
          </span>
        </div>
      )}
      {children && <div className="studio-card-body">{children}</div>}
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
