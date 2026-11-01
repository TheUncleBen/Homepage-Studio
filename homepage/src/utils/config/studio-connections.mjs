import { readFileSync, statSync } from "node:fs";

// Fills in saved connections (server/connections.mjs) where a widget's
// settings name one, such as {{STUDIO_CONNECTION_0123456789ABCDEF_KEY}}.
// The file lives in the dashboard's state, outside its configuration, and
// only this server-side reader sees the keys. An unknown or removed
// connection leaves its placeholder, so the widget reports a setup error.
const PLACEHOLDER = /\{\{STUDIO_CONNECTION_([A-F0-9]{16})_(URL|KEY|USERNAME|PASSWORD)\}\}/g;
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

export function resolveStudioConnections(text, file = process.env.STUDIO_CONNECTIONS_FILE) {
  if (!file || typeof text !== "string" || !text.includes("{{STUDIO_CONNECTION_")) return text;
  const byId = connections(file);
  return text.replace(PLACEHOLDER, (token, id, field, offset) => {
    const entry = byId.get(id);
    const value = field === "URL" ? entry?.url : entry?.secrets?.[field.toLowerCase()];
    if (typeof value !== "string") return token;
    // The value lands inside the YAML scalar that holds the placeholder, so
    // escape it for that scalar's quoting (Studio always quotes these).
    const line = text.slice(text.lastIndexOf("\n", offset) + 1, offset);
    const quote = /:\s*(["'])/.exec(line)?.[1] ?? /^\s*-\s*(["'])/.exec(line)?.[1];
    if (quote === '"') return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    if (quote === "'") return value.replace(/'/g, "''");
    return value;
  });
}
