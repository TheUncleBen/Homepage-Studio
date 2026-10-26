import { createHash } from "crypto";
import { readFile, stat } from "fs/promises";
import { join } from "path";

import { withAuth } from "utils/auth";
import {
  bookmarksResponse,
  servicesResponse,
  widgetsResponse,
} from "utils/config/api-response";
import { CONF_DIR, getSettings } from "utils/config/config";
import { readPlatformDefaults } from "utils/config/platform";

class NativeSnapshotChanged extends Error {}

function fileIdentity(value) {
  return [value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs].join(
    ":",
  );
}

async function configurationSnapshot() {
  let files;
  try {
    files = await Promise.all(
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
      ].map(async (name) => {
        const path = join(CONF_DIR, name);
        const before = fileIdentity(await stat(path, { bigint: true }));
        const bytes = await readFile(path);
        const identity = fileIdentity(await stat(path, { bigint: true }));
        if (before !== identity) throw new NativeSnapshotChanged();
        return { name, bytes, identity };
      }),
    );
  } catch {
    // Missing/unreadable files can be transient during replacement. Do not send
    // filesystem errors or private paths to the browser.
    throw new NativeSnapshotChanged();
  }
  const hash = createHash("sha256");
  files.forEach(({ name, bytes }) => {
    hash.update(name);
    hash.update("\0");
    hash.update(bytes);
    hash.update("\0");
  });
  return {
    revision: hash.digest("hex"),
    // A rollback can restore identical bytes after a helper read newer data.
    // File identities detect those replacements and stay entirely server-side.
    identity: files.map(({ identity }) => identity).join("\0"),
  };
}

async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  res.setHeader("Cache-Control", "private, no-store");
  try {
    // Native helpers read files independently. Check both bytes and private file
    // identities around them without holding a writer lock across discovery.
    const before = await configurationSnapshot();
    // Same privacy boundary as native getDashboardData: providers remain server-side;
    // native helpers retain responsibility for sanitizing each widget's render options.
    const { providers, ...settings } = getSettings();
    const [services, bookmarks, widgets] = await Promise.all([
      servicesResponse(),
      bookmarksResponse(),
      widgetsResponse(),
    ]);
    const after = await configurationSnapshot();
    if (
      before.revision !== after.revision ||
      before.identity !== after.identity
    ) {
      throw new NativeSnapshotChanged();
    }
    return res.status(200).json({
      services,
      bookmarks,
      widgets,
      settings,
      protocolVersion: 1,
      configurationRevision: after.revision,
      // Open dashboards reload the platform CSS when the default look changes.
      platformRevision: readPlatformDefaults()?.revision ?? null,
    });
  } catch (error) {
    res.setHeader("Retry-After", "1");
    const changed = error instanceof NativeSnapshotChanged;
    return res.status(503).json({
      error: changed
        ? "Native configuration changed while refreshing. Retry the refresh."
        : "Native widget data is temporarily unavailable. Retry the refresh.",
      code: changed ? "CONFIGURATION_CHANGED" : "NATIVE_DATA_UNAVAILABLE",
      retryable: true,
    });
  }
}

export default withAuth(handler);
