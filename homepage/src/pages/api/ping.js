import { promise as ping } from "ping";

import { withAuth } from "utils/auth";
import { getServiceItem } from "utils/config/service-helpers";
import createLogger from "utils/logger";

const logger = createLogger("ping");

// Studio's status history (pages/api/studio/collect.js) runs the same check.
export async function pingCheck(req, res) {
  const { groupName, serviceName } = req.query;
  const serviceItem = await getServiceItem(groupName, serviceName);
  if (!serviceItem) {
    logger.debug(`No service item found for group ${groupName} named ${serviceName}`);
    return res.status(400).send({
      error: "Unable to find service, see log for details.",
    });
  }

  // Studio pings the host of a service's own address when it has no ping of
  // its own and the widget asks for a ping check (fallback=1).
  let pingHostOrURL = serviceItem.ping;
  if (!pingHostOrURL && req.query.fallback === "1" && /^https?:\/\//i.test(serviceItem.href || "")) {
    pingHostOrURL = serviceItem.href;
  }

  if (!pingHostOrURL) {
    logger.debug("No ping host specified");
    return res.status(400).send({
      error: "No ping host given",
    });
  }

  let hostname = pingHostOrURL;
  try {
    // maintain backwards compatibility with old ping where may be http://...
    hostname = new URL(pingHostOrURL).hostname;
  } catch (e) {}

  try {
    const response = await ping.probe(hostname);
    return res.status(200).json(response);
  } catch (e) {
    logger.debug("Error attempting ping: %s", e);
    return res.status(400).send({
      error: "Error attempting ping, see logs.",
    });
  }
}

export default withAuth(pingCheck);
