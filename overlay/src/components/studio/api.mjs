export class StudioRequestError extends Error {
  constructor(message, status, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export async function studioRequest(path, body) {
  const encoded = body === undefined ? undefined : JSON.stringify(body);
  if (
    encoded !== undefined &&
    new TextEncoder().encode(encoded).length > 2 * 1024 * 1024
  ) {
    throw new StudioRequestError(
      "This save exceeds the 2 MiB request limit. Reduce the changed configuration before saving; your draft is still here.",
      413,
    );
  }
  const response = await fetch(path, {
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
