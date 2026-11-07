import { useTranslation } from "next-i18next/pages";
import { useEffect } from "react";

import { CLASS_SENTENCES, classifyError } from "../../utils/studio/error-classes.mjs";

import CardValues, { lastValues } from "./card-values";
import { reportClientError } from "./client-errors.mjs";

// A widget that can't load, inside a Studio card. It says what failed in a
// sentence; people who can edit the widget get a link to fix it. With errors
// hidden it shows nothing alarming, only that the value is unavailable.
function errorDetail(error) {
  let detail = error;
  if (typeof detail === "string") detail = { message: detail };
  else if (typeof detail === "number") detail = { message: `Error ${detail}` };
  if (detail?.data?.error) detail = detail.data.error;
  if (detail?.error && typeof detail.error === "object") detail = detail.error;
  else if (typeof detail?.error === "string") detail = { ...detail, message: detail.error };
  return detail;
}

// The error's class (utils/studio/error-classes.mjs), from a class the API
// named, the proxy's own transport code, or the words of the message.
export function errorClassOf(error) {
  const detail = errorDetail(error);
  if (typeof detail?.errorClass === "string" && CLASS_SENTENCES[detail.errorClass]) return detail.errorClass;
  const raw = detail?.rawError;
  for (const code of [raw?.code, raw?.causeCode]) {
    const cls = typeof code === "string" ? classifyError({ code }) : null;
    if (cls) return cls;
  }
  return classifyError({ message: typeof detail?.message === "string" ? detail.message : "" });
}

export function errorSummary(error) {
  const detail = errorDetail(error);
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
  // A class the API named (such as a certificate problem) is the real cause,
  // even when the proxy reported it with a status.
  const cls = errorClassOf(error);
  if (cls === detail?.errorClass && cls !== "http-status") return CLASS_SENTENCES[cls];
  if (status && hints[status]) return `${status} · ${hints[status]}`;
  // The same words as monitors, Check now and the logs (one sentence a class).
  if (cls && cls !== "http-status" && CLASS_SENTENCES[cls]) return CLASS_SENTENCES[cls];
  return message.length > 0 && message.length <= 90 ? message : CLASS_SENTENCES["bad-response"];
}

// A certificate problem is fixed in the widget's Connection section.
const isCertificate = (error) => /^tls-/.test(errorClassOf(error) ?? "");

export default function CardError({ card, service, error, title }) {
  const { t } = useTranslation();
  const name = service?.name || "this service";
  const summary = error?.code === "WIDGET_NOT_SET_UP" ? null : errorSummary(error);
  // What failed goes to this dashboard's logs too (sign-in on only).
  useEffect(() => {
    if (summary)
      reportClientError({
        panel: card.id,
        widget: service?.widget?.type ?? service?.name,
        message: `${name}: ${summary}`,
      });
  }, [summary, card.id, service?.widget?.type, service?.name, name]);
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
      <strong>{title ?? `Can’t reach ${name}`}</strong>
      <span>{errorSummary(error)}</span>
      {card.onFix && (
        <button
          type="button"
          className="studio-text-button"
          onClick={() => card.onFix(isCertificate(error) ? "settings" : undefined)}
        >
          Fix in widget settings
        </button>
      )}
    </div>
  );
}
