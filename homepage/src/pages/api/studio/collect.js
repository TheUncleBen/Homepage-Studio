import { resolveNativePanel } from "components/studio/native-adapter.mjs";
import { pingCheck } from "pages/api/ping";
import { serviceProxy } from "pages/api/services/proxy";
import { siteMonitor } from "pages/api/siteMonitor";
import { withAuth } from "utils/auth";
import { servicesResponse } from "utils/config/api-response";
import { collectWidget } from "utils/studio/collect";
import { captureResponse, fromController } from "utils/studio/internal";
import { statusFrom, statusKind } from "utils/studio/status-check";
import loaders from "widgets/loaders";

// Chart history: the controller's collector asks for the current values of
// the widgets shown as charts. Only the controller can call it (token), and it
// answers with numbers and their formats only.
export const config = { api: { bodyParser: { sizeLimit: "256kb" } } };

const MAX_PANELS = 200;
const PANEL_TIMEOUT_MS = 20_000;
const PROXY = "/api/services/proxy";

// One of the widget's own requests, through the normal proxy.
export async function proxied(key) {
  const url = new URL(key, "http://studio.invalid");
  // Widget requests carry the dashboard's path prefix (/<slug>/api/…).
  if (!url.pathname.endsWith(PROXY)) throw new Error("Only proxied requests are collected.");
  const { res, result } = captureResponse();
  await serviceProxy({ method: "GET", headers: {}, query: Object.fromEntries(url.searchParams) }, res);
  if (result.status >= 400) throw new Error("Request failed");
  let body = result.body;
  if (Buffer.isBuffer(body)) body = body.toString("utf8");
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      // Text answers stay text, as SWR would hand them over.
    }
  }
  return body;
}

function timeout(ms) {
  return new Promise((resolve) => {
    setTimeout(() => resolve({ error: "timeout" }), ms).unref?.();
  });
}

// Status history: the same check the card makes (web address or ping, with
// the address as fallback), kept as up (1 or 0) and its time in ms.
const CHECKS = { siteMonitor, ping: pingCheck };
export async function checkStatus(service, groupName, check, run = CHECKS) {
  const kind = statusKind(check);
  if (!kind || !service?.name || !groupName) return { error: "unavailable" };
  const { res, result } = captureResponse();
  await run[kind]({ method: "GET", headers: {}, query: { groupName, serviceName: service.name, fallback: "1" } }, res);
  const answer = result.status >= 400 ? null : result.body;
  const status = statusFrom(kind, answer);
  return {
    values: [
      { field: "up", label: "Up", format: "plain", value: status.state === "up" ? 1 : 0 },
      ...(Number.isFinite(status.ms)
        ? [{ field: "ms", label: "Response time", format: "plain", value: status.ms }]
        : []),
    ],
  };
}

export async function collectPanels(panels, data, load = proxied, run = CHECKS) {
  const results = {};
  for (const panel of panels) {
    let checked = null;
    if (panel?.check) {
      const resolved = ["service", "serviceWidget"].includes(panel.kind) ? resolveNativePanel(panel, data) : null;
      try {
        checked = resolved
          ? await Promise.race([
              checkStatus(resolved.service, resolved.groupName, panel.check, run),
              timeout(PANEL_TIMEOUT_MS),
            ])
          : { error: "unavailable" };
      } catch {
        checked = { error: "service" };
      }
      results[panel.id] = checked;
      // A widget with status history and charted values (blocks) needs both.
      if (panel.values !== true || panel.kind !== "serviceWidget") continue;
    }
    const resolved = panel?.kind === "serviceWidget" ? resolveNativePanel(panel, data) : null;
    const loader = resolved && Object.hasOwn(loaders, resolved.widget.type) ? loaders[resolved.widget.type] : null;
    let own;
    if (!loader) own = { error: "unavailable" };
    else
      try {
        const { default: Component } = await loader();
        const service = { ...resolved.service, widget: resolved.widget };
        own = await Promise.race([collectWidget(Component, service, load), timeout(PANEL_TIMEOUT_MS)]);
      } catch {
        own = { error: "render" };
      }
    // Both: the status check's fields join the widget's own, and a failure of
    // either still keeps what the other found.
    if (checked && Array.isArray(checked.values))
      own = Array.isArray(own?.values)
        ? { ...own, values: [...checked.values, ...own.values.filter((value) => !["up", "ms"].includes(value?.field))] }
        : { ...checked, ...(own?.error ? { error: own.error } : {}) };
    results[panel.id] = own;
  }
  return results;
}

async function handler(req, res) {
  if (!fromController(req.headers["x-studio-internal"])) return res.status(404).end();
  if (req.method !== "POST") return res.status(405).end();
  const panels = req.body?.panels;
  if (
    !Array.isArray(panels) ||
    panels.length > MAX_PANELS ||
    panels.some(
      (panel) =>
        !panel ||
        typeof panel.id !== "string" ||
        typeof panel.nativeLocator !== "object" ||
        (panel.check !== undefined && !["web", "ping"].includes(panel.check)) ||
        (panel.values !== undefined && (panel.values !== true || panel.check === undefined)),
    )
  )
    return res.status(400).json({ error: "Send the panels to collect." });
  const services = (await servicesResponse()) || [];
  return res.status(200).json({ results: await collectPanels(panels, { services }) });
}

export default withAuth(handler);
