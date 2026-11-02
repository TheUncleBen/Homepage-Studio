import { readFileSync, statSync } from "node:fs";

// Fills in saved connections (server/connections.mjs) where a widget's
// settings name one, such as {{STUDIO_CONNECTION_0123456789ABCDEF_KEY}}.
// The file lives in the dashboard's state, outside its configuration, and
// only this server-side reader sees the keys. An unknown or removed
// connection leaves its placeholder, so the widget reports a setup error.
let cached = { file: null, mtimeMs: -1, size: -1, byId: new Map() };

function connections(file) {
  let stat;
  try {
    stat = statSync(file);
  } catch {
    return new Map();
  }
  if (!stat.isFile() || stat.size > 512 * 1024) return new Map();
  if (cached.file === file && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.byId;
  let byId = new Map();
  try {
    const value = JSON.parse(readFileSync(file, "utf8"));
    if (Array.isArray(value?.connections))
      byId = new Map(
        value.connections.filter((entry) => typeof entry?.id === "string").map((entry) => [entry.id, entry]),
      );
  } catch {
    byId = new Map();
  }
  cached = { file, mtimeMs: stat.mtimeMs, size: stat.size, byId };
  return byId;
}

// A placeholder is filled in only where Studio writes it: as the whole value
// of a widget's url, key, username or password. Anywhere else (a title, a
// description, a label, settings) it stays as typed, so a saved key can never
// be shown on a page by naming it in a visible field.
const WHOLE = /^\{\{STUDIO_CONNECTION_([A-F0-9]{16})_(URL|KEY|USERNAME|PASSWORD)\}\}$/;
const FIELD = { url: "URL", key: "KEY", username: "USERNAME", password: "PASSWORD" };

export function resolveWidgetConnection(widget, file = process.env.STUDIO_CONNECTIONS_FILE) {
  if (!file || !widget || typeof widget !== "object" || Array.isArray(widget)) return widget;
  let next = widget;
  for (const [key, field] of Object.entries(FIELD)) {
    const match = typeof widget[key] === "string" ? WHOLE.exec(widget[key]) : null;
    if (!match || match[2] !== field) continue;
    const entry = connections(file).get(match[1]);
    const value = field === "URL" ? entry?.url : entry?.secrets?.[key];
    if (typeof value !== "string") continue;
    if (next === widget) next = { ...widget };
    next[key] = value;
  }
  return next;
}

// services.yaml as loaded: the widget and widgets of every service, in
// groups and nested groups.
export function resolveServiceConnections(groups, file = process.env.STUDIO_CONNECTIONS_FILE) {
  if (!file || !Array.isArray(groups)) return groups;
  const service = (config) => {
    if (!config || typeof config !== "object" || Array.isArray(config)) return config;
    const next = { ...config };
    if (config.widget) next.widget = resolveWidgetConnection(config.widget, file);
    if (Array.isArray(config.widgets)) next.widgets = config.widgets.map((w) => resolveWidgetConnection(w, file));
    return next;
  };
  // Each entry maps a name to a list (a group) or a map (a service).
  const list = (items) =>
    items.map((entry) =>
      entry && typeof entry === "object" && !Array.isArray(entry)
        ? Object.fromEntries(
            Object.entries(entry).map(([name, value]) => [name, Array.isArray(value) ? list(value) : service(value)]),
          )
        : entry,
    );
  return list(groups);
}
