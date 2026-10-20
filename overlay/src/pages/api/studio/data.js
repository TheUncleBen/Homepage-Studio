import { createHash } from "crypto";
import { readFile } from "fs/promises";
import { join } from "path";

import { withAuth } from "utils/auth";
import {
  bookmarksResponse,
  servicesResponse,
  widgetsResponse,
} from "utils/config/api-response";
import { CONF_DIR, getSettings } from "utils/config/config";

async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  res.setHeader("Cache-Control", "private, no-store");
  // Same privacy boundary as native getDashboardData: providers remain server-side;
  // native helpers retain responsibility for sanitizing each widget's render options.
  const { providers, ...settings } = getSettings();
  const [services, bookmarks, widgets, files] = await Promise.all([
    servicesResponse(),
    bookmarksResponse(),
    widgetsResponse(),
    Promise.all(
      [
        "services.yaml",
        "bookmarks.yaml",
        "widgets.yaml",
        "settings.yaml",
        "docker.yaml",
        "kubernetes.yaml",
        "proxmox.yaml",
        "custom.css",
        "custom.js",
      ].map(async (name) => ({
        name,
        bytes: await readFile(join(CONF_DIR, name)),
      })),
    ),
  ]);
  const hash = createHash("sha256");
  files.forEach(({ name, bytes }) => {
    hash.update(name);
    hash.update("\0");
    hash.update(bytes);
    hash.update("\0");
  });
  return res.status(200).json({
    services,
    bookmarks,
    widgets,
    settings,
    protocolVersion: 1,
    configurationRevision: hash.digest("hex"),
  });
}

export default withAuth(handler);
