import { resolveNativePanel } from "components/studio/native-adapter.mjs";
import { serviceProxy } from "pages/api/services/proxy";
import { withAuth } from "utils/auth";
import { servicesResponse } from "utils/config/api-response";
import { collectWidget } from "utils/studio/collect";
import { captureResponse, fromController } from "utils/studio/internal";
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

export async function collectPanels(panels, data, load = proxied) {
  const results = {};
  for (const panel of panels) {
    const resolved = panel?.kind === "serviceWidget" ? resolveNativePanel(panel, data) : null;
    const loader = resolved && Object.hasOwn(loaders, resolved.widget.type) ? loaders[resolved.widget.type] : null;
    if (!loader) {
      results[panel.id] = { error: "unavailable" };
      continue;
    }
    try {
      const { default: Component } = await loader();
      const service = { ...resolved.service, widget: resolved.widget };
      results[panel.id] = await Promise.race([collectWidget(Component, service, load), timeout(PANEL_TIMEOUT_MS)]);
    } catch {
      results[panel.id] = { error: "render" };
    }
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
    panels.some((panel) => !panel || typeof panel.id !== "string" || typeof panel.nativeLocator !== "object")
  )
    return res.status(400).json({ error: "Send the panels to collect." });
  const services = (await servicesResponse()) || [];
  return res.status(200).json({ results: await collectPanels(panels, { services }) });
}

export default withAuth(handler);
