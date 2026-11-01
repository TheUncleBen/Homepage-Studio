import { performance } from "perf_hooks";

import { withAuth } from "utils/auth";
import { getServiceItem } from "utils/config/service-helpers";
import createLogger from "utils/logger";
import { httpProxy } from "utils/proxy/http";

const logger = createLogger("siteMonitor");

// Studio's status history (pages/api/studio/collect.js) runs the same check.
export async function siteMonitor(req, res) {
  const { groupName, serviceName } = req.query;
  const serviceItem = await getServiceItem(groupName, serviceName);
  if (!serviceItem) {
    logger.debug(`No service item found for group ${groupName} named ${serviceName}`);
    return res.status(400).send({
      error: "Unable to find service, see log for details.",
    });
  }

  // Studio checks a service's own address when it has no siteMonitor of its
  // own and the dashboard asks for a web check (fallback=1). Only the address
  // already in services.yaml is ever probed.
  let monitorURL = serviceItem.siteMonitor;
  if (!monitorURL && req.query.fallback === "1" && /^https?:\/\//i.test(serviceItem.href || "")) {
    monitorURL = serviceItem.href;
  }

  if (!monitorURL) {
    logger.debug("No http monitor URL specified");
    return res.status(400).send({
      error: "No http monitor URL given",
    });
  }

  try {
    let startTime = performance.now();
    let [status, , , headers] = await httpProxy(monitorURL, {
      method: "HEAD",
    });
    let endTime = performance.now();

    if (status > 403) {
      // try one more time as a GET in case HEAD is rejected for whatever reason
      startTime = performance.now();
      [status, , , headers] = await httpProxy(monitorURL);
      endTime = performance.now();
    }

    return res.status(200).json({
      status,
      latency: endTime - startTime,
      // httpProxy answers 500 itself when nothing answered (no response
      // headers), so Studio can say "No answer" instead of a status code.
      ...(headers === null ? { reachable: false } : {}),
    });
  } catch (e) {
    logger.debug("Error attempting http monitor: %s", e);
    return res.status(400).send({
      error: "Error attempting http monitor, see logs.",
    });
  }
}

export default withAuth(siteMonitor);
