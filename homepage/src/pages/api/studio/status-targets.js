import { resolveNativePanel } from "components/studio/native-adapter.mjs";
import { withAuth } from "utils/auth";
import { servicesResponse } from "utils/config/api-response";
import { getServiceItem } from "utils/config/service-helpers";
import { fromController } from "utils/studio/internal";
import { statusFallback } from "utils/studio/status-address";

// Card monitors (owner decision D6, 6 Nov 2026): Studio's monitoring engine
// runs each card's status check, so it asks here which address that check
// uses, worked out exactly as /api/siteMonitor and /api/ping do with
// fallback=1. Only the controller can call it (token). The answer stays on
// the server: browsers only ever see the check's result.
export const config = { api: { bodyParser: { sizeLimit: "256kb" } } };

const MAX_PANELS = 500;

export async function statusTarget(panel, data, lookup = getServiceItem) {
  const resolved = ["service", "serviceWidget"].includes(panel.kind) ? resolveNativePanel(panel, data) : null;
  if (!resolved?.service?.name || !resolved.groupName) return null;
  const item = await lookup(resolved.groupName, resolved.service.name);
  if (!item) return null;
  if (panel.check === "ping") {
    const value = item.ping || statusFallback(item);
    if (!value) return null;
    let host = value;
    try {
      host = new URL(value).hostname;
    } catch {
      // A plain host name.
    }
    return { check: "ping", host, name: item.name };
  }
  const url = item.siteMonitor || statusFallback(item);
  return url ? { check: "web", url, name: item.name } : null;
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
        !["web", "ping"].includes(panel.check),
    )
  )
    return res.status(400).json({ error: "Send the panels." });
  const services = (await servicesResponse()) || [];
  const targets = {};
  for (const panel of panels) {
    try {
      targets[panel.id] = await statusTarget(panel, { services });
    } catch {
      targets[panel.id] = null;
    }
  }
  return res.status(200).json({ targets });
}

export default withAuth(handler);
