export class StudioRequestError extends Error {
  constructor(message, status, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const CATALOG_PATH = "/studio/catalog.json";

// The editing session (owner decision, 4 Nov 2026: autosave with Undo and
// Redo). While the editor is open every change it sends names the session,
// so the server can step back through exactly these changes.
const EDIT_PATHS = new Set([
  "/studio/api/board",
  "/studio/api/save",
  "/studio/api/service",
  "/studio/api/info-widget",
  "/studio/api/service-widget",
  "/studio/api/bookmark",
  "/studio/api/settings",
  "/studio/api/page-delete",
  "/studio/api/page-duplicate",
  "/studio/api/widgets-delete",
  "/studio/api/widgets-duplicate",
  "/studio/api/discovery-visibility",
  "/studio/api/library/use",
  "/studio/api/undo",
  "/studio/api/redo",
]);
let editSession = null;
export function newEditSession() {
  const bytes = new Uint8Array(18);
  globalThis.crypto.getRandomValues(bytes);
  editSession = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return editSession;
}
export function endEditSession(id) {
  if (id === undefined || id === editSession) editSession = null;
}
export function currentEditSession() {
  return editSession;
}

export function studioRequest(path, body) {
  if (editSession && body && typeof body === "object" && !Array.isArray(body) && EDIT_PATHS.has(path))
    body = { ...body, editSession };
  return request(path, body, true);
}

export function deploymentRequest(path, body) {
  return request(path, body, false);
}

async function request(path, body, scoped) {
  const encoded =
    body === undefined
      ? undefined
      : JSON.stringify(body, (_key, value) => {
          if (typeof value === "number" && !Number.isFinite(value))
            throw new StudioRequestError(
              "This draft contains a non-finite number. Use a finite number, or quote it as text, before saving. Your draft has not been changed.",
              422,
            );
          return value;
        });
  const importing = path === "/studio/api/import";
  const maxBytes = (importing ? 100 : 2) * 1024 * 1024;
  if (encoded !== undefined && new TextEncoder().encode(encoded).length > maxBytes) {
    throw new StudioRequestError(
      importing
        ? "This dashboard import exceeds the 100 MiB request limit. Your current dashboard has not been changed."
        : "This save exceeds the 2 MiB request limit. Reduce the changed configuration before saving; your draft is still here.",
      413,
    );
  }
  const response = await fetch(scoped ? dashboardPath(path) : path, {
    credentials: "same-origin",
    // The fixed native catalog carries a validator, so revalidate it with
    // If-None-Match; state and configuration are never served from cache.
    cache: body === undefined && path === CATALOG_PATH ? "no-cache" : "no-store",
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-studio-request": "1",
          },
          body: encoded,
        }),
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new StudioRequestError(
      "The dashboard returned an unreadable response. Your draft is still open.",
      response.status,
    );
  }
  if (!response.ok)
    throw new StudioRequestError(
      data.error || data.message || `Request failed (${response.status})`,
      response.status,
      data,
    );
  return data;
}

export const FILES = [
  ["services.yaml", "servicesYaml"],
  ["widgets.yaml", "widgetsYaml"],
  ["bookmarks.yaml", "bookmarksYaml"],
  ["settings.yaml", "settingsYaml"],
  ["docker.yaml", "dockerYaml"],
  ["kubernetes.yaml", "kubernetesYaml"],
  ["proxmox.yaml", "proxmoxYaml"],
  ["custom.css", "customCss"],
  ["custom.js", "customJs"],
];
import { dashboardPath } from "./dashboard-path.mjs";
