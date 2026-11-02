import { useTranslation } from "next-i18next/pages";

import CardValues, { lastValues } from "./card-values";

// A widget that can't load, inside a Studio card. It says what failed in a
// sentence; people who can edit the widget get a link to fix it. With errors
// hidden it shows nothing alarming, only that the value is unavailable.
export function errorSummary(error) {
  let detail = error;
  if (typeof detail === "string") detail = { message: detail };
  else if (typeof detail === "number") detail = { message: `Error ${detail}` };
  if (detail?.data?.error) detail = detail.data.error;
  const message = typeof detail?.message === "string" ? detail.message : "";
  const status = /\b(4\d\d|5\d\d)\b/.exec(message)?.[1];
  const hints = {
    401: "the API key or password was refused",
    403: "the account is missing a permission",
    404: "the address or API path wasn't found",
    500: "the service reported an internal error",
    502: "a proxy in front of it didn't get an answer",
    503: "the service is unavailable",
    504: "it took too long to answer",
  };
  if (status && hints[status]) return `${status} · ${hints[status]}`;
  if (/ECONNREFUSED/i.test(message)) return "Connection refused · check the address and port";
  if (/ENOTFOUND|EAI_AGAIN/i.test(message)) return "Name not found · check the address";
  if (/ETIMEDOUT|timeout/i.test(message)) return "No answer in time";
  if (/certificate|SSL|TLS/i.test(message)) return "The certificate wasn't accepted";
  return message.length > 0 && message.length <= 90 ? message : "The service didn't answer as expected";
}

export default function CardError({ card, service, error }) {
  const { t } = useTranslation();
  const name = service?.name || "this service";
  // A new widget without its address yet points straight at its settings.
  if (error?.code === "WIDGET_NOT_SET_UP") {
    return (
      <div className="studio-card-state studio-card-setup" role="status">
        <strong>Not set up yet</strong>
        <span>Add the service address{card.onFix ? "" : " in its settings"}.</span>
        {card.onFix && (
          <button type="button" className="studio-text-button" onClick={card.onFix}>
            Open setup
          </button>
        )}
      </div>
    );
  }
  if (card.errors === "hide") {
    const last = card.id && lastValues.get(card.id);
    if (last) {
      return (
        <div className="studio-card-stale" title={t("widget.api_error")}>
          <CardValues card={{ ...card, stale: true, reportFields: undefined }} items={last.items} />
          <span className="studio-card-stale-note">
            Last value · {new Date(last.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
      );
    }
    return (
      <div className="studio-card-state studio-card-quiet-error" role="status">
        <span>Not available right now</span>
      </div>
    );
  }
  return (
    <div className="studio-card-state studio-card-error" role="status">
      <strong>Can’t reach {name}</strong>
      <span>{errorSummary(error)}</span>
      {card.onFix && (
        <button type="button" className="studio-text-button" onClick={card.onFix}>
          Fix in widget settings
        </button>
      )}
    </div>
  );
}
