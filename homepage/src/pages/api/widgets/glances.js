import { withAuth } from "utils/auth";
import { getPrivateWidgetOptions } from "utils/config/widget-helpers";
import createLogger from "utils/logger";
import { parseVersionForUrl } from "utils/proxy/api-helpers";
import { certificateClass } from "utils/proxy/certificate-check.mjs";
import { httpProxy } from "utils/proxy/http";

const logger = createLogger("glances");

async function retrieveFromGlancesAPI(privateWidgetOptions, endpoint) {
  let errorMessage;
  const url = privateWidgetOptions?.url;
  if (!url) {
    errorMessage = "Missing Glances URL";
    logger.error(errorMessage);
    throw new Error(errorMessage);
  }

  const apiUrl = `${url}/api/${privateWidgetOptions.version}/${endpoint}`;
  const headers = {
    "Accept-Encoding": "application/json",
  };
  if (privateWidgetOptions.username && privateWidgetOptions.password) {
    headers.Authorization = `Basic ${Buffer.from(
      `${privateWidgetOptions.username}:${privateWidgetOptions.password}`,
    ).toString("base64")}`;
  }
  const params = { method: "GET", headers };

  // The widget's certificate exception (owner decision D1).
  const [status, , data] = await httpProxy(apiUrl, {
    ...params,
    ...(privateWidgetOptions.skipCertificateCheck ? { checkCertificate: false } : {}),
  });

  if (status === 401) {
    // The status leads, so the card names the refused login (UI review M3).
    errorMessage = "HTTP 401: Authorization failure getting data from glances API";
    logger.error("%s. Data: %s", errorMessage, data.toString().slice(0, 200));
    throw new Error(errorMessage);
  }

  if (status !== 200) {
    // httpProxy's own failure is an object: its plain message, and the
    // certificate class when that was the cause (UI review M3/M4).
    const answered = Buffer.isBuffer(data) || typeof data === "string";
    const said = answered ? String(data).slice(0, 200) : (data?.error?.message ?? "");
    errorMessage = answered
      ? `HTTP ${status} getting data from glances API${said ? `: ${said}` : ""}`
      : `Couldn't reach the glances API${said ? `: ${said}` : ""}`;
    logger.error(errorMessage);
    throw Object.assign(new Error(errorMessage), { errorClass: certificateClass(data) });
  }

  return JSON.parse(Buffer.from(data).toString());
}

async function handler(req, res) {
  const { index, cputemp: includeCpuTemp, uptime: includeUptime, disk: includeDisks, version } = req.query;

  const privateWidgetOptions = await getPrivateWidgetOptions("glances", index);
  privateWidgetOptions.version = parseVersionForUrl(version, 3);

  try {
    const cpuData = await retrieveFromGlancesAPI(privateWidgetOptions, "cpu");
    const loadData = await retrieveFromGlancesAPI(privateWidgetOptions, "load");
    const memoryData = await retrieveFromGlancesAPI(privateWidgetOptions, "mem");
    const data = {
      cpu: cpuData,
      load: loadData,
      mem: memoryData,
    };

    // Disabled by default, dont call unless needed
    if (includeUptime) {
      data.uptime = await retrieveFromGlancesAPI(privateWidgetOptions, "uptime");
    }

    if (includeCpuTemp) {
      data.sensors = await retrieveFromGlancesAPI(privateWidgetOptions, "sensors");
    }

    if (includeDisks) {
      data.fs = await retrieveFromGlancesAPI(privateWidgetOptions, "fs");
    }

    return res.status(200).send(data);
  } catch (e) {
    return res.status(400).json({ error: e.message, ...(e.errorClass ? { errorClass: e.errorClass } : {}) });
  }
}

export default withAuth(handler);
