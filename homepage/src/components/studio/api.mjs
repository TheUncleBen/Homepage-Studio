export class StudioRequestError extends Error {
  constructor(message, status, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function studioRequest(path, body) {
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
  const importing = path === "/__studio/api/import";
  const maxBytes = (importing ? 40 : 2) * 1024 * 1024;
  if (encoded !== undefined && new TextEncoder().encode(encoded).length > maxBytes) {
    throw new StudioRequestError(
      importing
        ? "This dashboard import exceeds the 40 MiB request limit. Your current dashboard has not been changed."
        : "This save exceeds the 2 MiB request limit. Reduce the changed configuration before saving; your draft is still here.",
      413,
    );
  }
  const response = await fetch(scoped ? dashboardPath(path) : path, {
    credentials: "same-origin",
    cache: "no-store",
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
