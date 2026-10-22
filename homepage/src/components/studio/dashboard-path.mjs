const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const basePattern = /^\/[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

function validContext(id, basePath) {
  return {
    id: id === "default" || idPattern.test(id || "") ? id : "default",
    basePath: basePath === "" || basePattern.test(basePath || "") ? basePath : "",
  };
}

export function dashboardContext() {
  if (typeof document !== "undefined") {
    return validContext(
      document.querySelector('meta[name="studio-dashboard-id"]')?.content || "default",
      document.querySelector('meta[name="studio-dashboard-base"]')?.content || "",
    );
  }
  return validContext(process.env.STUDIO_DASHBOARD_ID || "default", process.env.STUDIO_DASHBOARD_BASE_PATH || "");
}

export function dashboardPath(path, explicitBasePath) {
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) return path;
  const supplied = explicitBasePath ?? dashboardContext().basePath;
  const basePath = supplied === "" || basePattern.test(supplied) ? supplied : "";
  if (
    !basePath ||
    path === basePath ||
    path.startsWith(`${basePath}/`) ||
    path.startsWith(`${basePath}?`) ||
    path.startsWith(`${basePath}#`)
  )
    return path;
  return `${basePath}${path === "/" ? "" : path}`;
}

function scopedResource(resource) {
  if (typeof resource === "string" && resource.startsWith("/")) return dashboardPath(resource);
  if (typeof window === "undefined" || !window.location?.origin) return resource;
  const input = typeof Request !== "undefined" && resource instanceof Request ? resource.url : resource;
  let url;
  try {
    url = new URL(input);
  } catch {
    return resource;
  }
  if (url.origin !== window.location.origin) return resource;
  url.pathname = dashboardPath(url.pathname);
  return typeof Request !== "undefined" && resource instanceof Request ? new Request(url, resource) : url;
}

export function dashboardFetch(resource, init) {
  const target = scopedResource(resource);
  return init === undefined ? fetch(target) : fetch(target, init);
}

export function dashboardStorageKey(key, explicitId) {
  const id = explicitId ?? dashboardContext().id;
  return id === "default" || !idPattern.test(id || "") ? key : `homepage-studio:${id}:${key}`;
}
