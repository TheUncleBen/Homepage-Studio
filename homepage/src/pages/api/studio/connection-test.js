import { performance } from "perf_hooks";

import { promise as ping } from "ping";

import { serviceProxy } from "pages/api/services/proxy";
import { withAuth } from "utils/auth";
import { substituteEnvironmentVars } from "utils/config/config";
import { connectionTest, connectionTestResult, TEST_GROUP } from "utils/config/connection-test.mjs";
import { resolveWidgetConnection } from "utils/config/studio-connections.mjs";
import { certificateCheck, certificateClass } from "utils/proxy/certificate-check.mjs";
import { httpProxy } from "utils/proxy/http";
import { captureResponse, fromController } from "utils/studio/internal";
import widgets from "widgets/widgets";

// Test connection, asked for by the Studio controller only (it strips every
// x-studio-* header a browser sends and adds this token itself). Runs the
// widget's own first request with the dialog's address and key, and answers
// with a plain reason only: never the service's response.
// Shorter than the controller's 30-second wait, so a slow address gets its own answer.
const TEST_TIMEOUT_MS = 20_000;

export const config = { api: { bodyParser: { sizeLimit: "32kb" } } };

// The first request the widget makes on its own: a mapping without segments,
// parameters or a method other than GET.
export function firstEndpoint(definition) {
  const entries = Object.entries(definition?.mappings || {});
  const simple = entries.find(
    ([, mapping]) => !mapping?.segments && !mapping?.params && (!mapping?.method || mapping.method === "GET"),
  );
  return simple?.[0];
}

const CERTIFICATE_WORDS = {
  "tls-untrusted": "its certificate isn’t trusted by Studio",
  "tls-expired": "its certificate has expired",
  "tls-name": "its certificate is for a different name",
};

const shortMs = (ms) => (ms < 1 ? "<1 ms" : `${Math.round(ms)} ms`);

// Check now, in the widget's Status setting (U8): the same check the card
// runs (pages/api/siteMonitor.js, pages/api/ping.js) on the dialog's
// address before it is saved. Answers with a plain result only.
export async function statusCheck({ check, address, skipCertificateCheck }) {
  // A saved connection's address, or a Docker secret / variable reference.
  const typed = typeof address === "string" ? address.trim() : "";
  // Secret files never go into an address that is being checked.
  if (/HOMEPAGE_FILE_/.test(typed))
    return { ok: false, kind: "address", message: "A secret file can't be part of a status address." };
  const text = withReferences(resolveWidgetConnection({ url: typed }).url || typed);
  let url = null;
  try {
    url = new URL(text);
  } catch {
    url = null;
  }
  if (check === "ping") {
    const host = url ? url.hostname : text;
    // A leading "-" would read as an option to the ping command.
    if (!host || host.startsWith("-") || !/^[A-Za-z0-9.:[\]-]{1,253}$/.test(host))
      return { ok: false, kind: "address", message: "Enter a host name or address to ping." };
    const answer = await ping.probe(host.replace(/^\[|\]$/g, ""));
    const ms = Number(answer?.time);
    return answer?.alive
      ? { ok: true, kind: "up", message: Number.isFinite(ms) ? `Up · ${shortMs(ms)}` : "Up" }
      : { ok: false, kind: "down", message: "Down · no answer to ping" };
  }
  if (!url || !["http:", "https:"].includes(url.protocol) || url.username || url.password)
    return { ok: false, kind: "address", message: "Enter a web address that starts with http:// or https://." };
  let started = performance.now();
  // Checked as the saved card will be: the certificate too, unless the
  // dialog's Check its certificate is off (D1).
  const checkCertificate = skipCertificateCheck !== true;
  let [status, , data, headers] = await httpProxy(url.href, { method: "HEAD", cookieJar: false, checkCertificate });
  let ms = performance.now() - started;
  if (status > 403) {
    started = performance.now();
    [status, , data, headers] = await httpProxy(url.href, { cookieJar: false, checkCertificate });
    ms = performance.now() - started;
  }
  if (headers === null) {
    const certificate = certificateClass(data);
    return certificate
      ? { ok: false, kind: "certificate", message: `Down · ${CERTIFICATE_WORDS[certificate]}` }
      : { ok: false, kind: "down", message: "Down · no answer" };
  }
  // As the card decides (utils/studio/status-check.js): a sign-in page is up.
  return status <= 403
    ? { ok: true, kind: "up", message: `Up · ${shortMs(ms)}` }
    : { ok: false, kind: "down", message: `Down · answered ${status}` };
}

async function handler(req, res) {
  if (!fromController(req.headers["x-studio-internal"])) return res.status(404).end();
  if (req.method !== "POST") return res.status(405).end();
  if (req.body?.status) {
    let timer;
    const answer = await Promise.race([
      statusCheck(req.body.status).catch(() => ({ ok: false, kind: "down", message: "Down · the check failed" })),
      new Promise((resolve) => {
        timer = setTimeout(
          () => resolve({ ok: false, kind: "down", message: "Down · no answer in time" }),
          TEST_TIMEOUT_MS,
        );
      }),
    ]);
    clearTimeout(timer);
    return res.status(200).json(answer);
  }
  const draft = req.body?.widget;
  if (!draft || typeof draft !== "object" || Array.isArray(draft) || typeof draft.type !== "string")
    return res.status(400).json({ error: "Send the widget to test." });
  const type = draft.type === "calendar" ? "ical" : draft.type;
  const definition = widgets[type];
  if (!definition) return res.status(400).json({ error: "This widget type can't be tested." });
  const widget = withReferences(resolveWidgetConnection(draft));
  const endpoint = firstEndpoint(definition);
  const { res: captured, result } = captureResponse();
  const request = {
    method: "GET",
    headers: {},
    query: { group: TEST_GROUP, service: "Test", index: "-1", ...(endpoint ? { endpoint } : {}) },
  };
  const started = performance.now();
  let timer;
  const finished = await Promise.race([
    connectionTest
      .run({ widget }, () =>
        certificateCheck.run({ check: req.body?.skipCertificateCheck !== true }, () => serviceProxy(request, captured)),
      )
      .then(() => true),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(false), TEST_TIMEOUT_MS);
    }),
  ]);
  clearTimeout(timer);
  if (!finished)
    return res.status(200).json({ ok: false, kind: "unreachable", message: "The address didn't answer in time." });
  const ms = performance.now() - started;
  return res.status(200).json(connectionTestResult({ status: result.status, body: result.body, ms }));
}

// The widget as the real one is loaded: services.yaml's {{HOMEPAGE_VAR_…}}
// and {{HOMEPAGE_FILE_…}} references (a key in a Docker secret) are filled
// in when the file is read, so the test fills them in too. Strings only;
// keys and structure stay as sent. The controller only sends a reference
// with the address a saved widget already uses it for (server/index.mjs). A secret file usually ends in a line
// break, which the YAML reader drops from a plain value, so this does too.
export function withReferences(value) {
  if (typeof value === "string")
    return value.includes("{{") ? substituteEnvironmentVars(value).replace(/[\r\n]+$/, "") : value;
  if (Array.isArray(value)) return value.map(withReferences);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, withReferences(entry)]));
  return value;
}

// Host check and native sign-in first, like every other route.
export default withAuth(handler);
